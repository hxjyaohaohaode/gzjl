import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, or } from "drizzle-orm";
import type { Database } from "@workbench/db";
import {
  attachmentLinks,
  attachments,
  auditLogs,
  approvalActions,
  approvalRequests,
  projectNodes,
  projects,
  orgMemberships,
  outboxEvents,
  workBreaks,
  workExpectationProfiles,
  workSessionProjectLinks,
  workSessions,
  workSessionVersions,
} from "@workbench/db/schema";
import {
  calculateWorkDuration,
  type CreateWorkSessionInput,
  workDurationAnomalyFlags,
} from "@workbench/shared";

export class WorkSessionConflictError extends Error {
  constructor(
    message = "该时段与已有工时重叠；如确为并行工作，请明确标记并行工时。",
  ) {
    super(message);
    this.name = "WorkSessionConflictError";
  }
}

export class WorkSessionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkSessionValidationError";
  }
}

export class WorkSessionVersionConflictError extends Error {
  constructor() {
    super("记录已被其他操作更新或当前状态不允许提交，请刷新后重试。");
    this.name = "WorkSessionVersionConflictError";
  }
}

export class WorkSessionEvidenceRequiredError extends Error {
  constructor() {
    super("提交审核前必须至少提供一项审核人可见且已完成核验的证据。可上传任意格式文件，或添加链接/文字证据。");
    this.name = "WorkSessionEvidenceRequiredError";
  }
}

export interface WorkActor {
  organizationId: string;
  membershipId: string;
}

export interface ImportedWorkSessionInput {
  input: CreateWorkSessionInput;
  /** Omit only for an intentional self-import by the importing operator. */
  membershipId?: string | undefined;
}

type WorkRecordKind = "fact" | "plan";

export interface WorkSessionListOptions {
  before?: Date | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  recordKind?: WorkRecordKind | undefined;
}

const maximumPlanHorizonMs = 366 * 86_400_000;
const factualFutureGraceMs = 5 * 60_000;

function isPlanRecord(value: string): value is "plan" {
  return value === "plan";
}

/**
 * A future entry may be useful as a synchronized plan, but it must never be
 * silently represented as completed work. Plans are kept private and become
 * facts only through the explicit realization path below.
 */
function assertPlanWindow(startAt: Date, endAt: Date): void {
  const now = Date.now();
  if (endAt.getTime() <= now + factualFutureGraceMs) {
    throw new WorkSessionValidationError(
      "云端计划草稿必须包含尚未结束的时间；已经完成的工作请保存为真实工时草稿。",
    );
  }
  if (
    startAt.getTime() > now + maximumPlanHorizonMs ||
    endAt.getTime() > now + maximumPlanHorizonMs
  ) {
    throw new WorkSessionValidationError(
      "计划草稿最多可提前 366 天，避免长期日历误占与失真的计划数据。",
    );
  }
}

/** The subset shared by the root Drizzle client and a transaction client. */
export type WorkExecutor = Pick<Database, "select" | "insert">;

export class WorkSessionService {
  constructor(private readonly db: Database) {}

  async createManual(
    actor: WorkActor,
    input: CreateWorkSessionInput,
    requestMeta: { requestId?: string; userAgent?: string } = {},
  ) {
    return this.db.transaction((tx) =>
      this.createManualWithExecutor(tx, actor, input, requestMeta),
    );
  }

  /**
   * Persists an upcoming plan across devices without letting it contaminate
   * facts, approval, payroll, analytics, evidence or AI inputs. It reuses
   * the same immutable snapshots and audit trail as a factual draft so a
   * worker can safely recover or continue editing it on another device.
   */
  async createPlan(
    actor: WorkActor,
    input: CreateWorkSessionInput,
    requestMeta: { requestId?: string; userAgent?: string } = {},
  ) {
    if (input.source !== "manual") {
      throw new WorkSessionValidationError("云端计划草稿只能手工创建。");
    }
    return this.db.transaction((tx) =>
      this.createManualWithExecutor(tx, actor, input, requestMeta, {
        recordKind: "plan",
      }),
    );
  }

  /**
   * Creates an all-or-nothing import batch.  Each row is checked in insertion
   * order, so a non-parallel row also conflicts with an earlier row in the
   * same CSV.  Any failure rolls back every row, version and audit entry.
   */
  async createManualBatch(
    actor: WorkActor,
    inputs: CreateWorkSessionInput[],
    requestMeta: { requestId?: string; userAgent?: string } = {},
  ) {
    return this.createManualBatchForMembers(
      actor,
      inputs.map((input) => ({ input })),
      requestMeta,
    );
  }

  /**
   * Saves a normal end-of-day entry containing several independent work
   * segments in one database transaction. Completed segments become factual
   * drafts, while an explicitly marked not-yet-finished segment remains a
   * private plan. A validation or overlap failure rolls the entire batch back,
   * so the member never has to guess which half of the form was persisted.
   */
  async createStructuredBatch(
    actor: WorkActor,
    records: Array<{
      recordKind: WorkRecordKind;
      input: CreateWorkSessionInput;
    }>,
    requestMeta: { requestId?: string; userAgent?: string } = {},
  ) {
    return this.db.transaction(async (tx) => {
      const created = [];
      for (const record of records) {
        created.push(
          await this.createManualWithExecutor(
            tx,
            actor,
            record.input,
            requestMeta,
            { recordKind: record.recordKind },
          ),
        );
      }
      return created;
    });
  }

  /**
   * Organization-scoped import is allowed to restore records for their
   * original active members.  Target membership validation occurs inside the
   * same transaction as every row, so an invalid or deactivated recipient
   * cannot leave a partial cross-company import behind.
   */
  async createManualBatchForMembers(
    actor: WorkActor,
    records: ImportedWorkSessionInput[],
    requestMeta: { requestId?: string; userAgent?: string } = {},
  ) {
    return this.db.transaction((tx) =>
      this.createManualBatchForMembersWithExecutor(
        tx,
        actor,
        records,
        requestMeta,
      ),
    );
  }

  /**
   * Lets the guarded import confirmation use the same database transaction
   * for its claim, every work-session write, version/audit snapshots and its
   * final completed status.  Keep this public solely for that cross-service
   * atomic boundary; ordinary callers should use createManualBatchForMembers.
   */
  async createManualBatchForMembersWithExecutor(
    db: WorkExecutor,
    actor: WorkActor,
    records: ImportedWorkSessionInput[],
    requestMeta: { requestId?: string; userAgent?: string } = {},
  ) {
    const membershipIds = Array.from(
      new Set(
        records.map((record) => record.membershipId ?? actor.membershipId),
      ),
    );
    const activeMemberships = membershipIds.length
      ? await db
          .select({ id: orgMemberships.id })
          .from(orgMemberships)
          .where(
            and(
              eq(orgMemberships.organizationId, actor.organizationId),
              inArray(orgMemberships.id, membershipIds),
              eq(orgMemberships.status, "active"),
            ),
          )
      : [];
    if (activeMemberships.length !== membershipIds.length) {
      throw new WorkSessionValidationError(
        "导入目标成员不存在、已停用或不属于当前组织。",
      );
    }
    const created = [];
    for (const record of records) {
      created.push(
        await this.createManualWithExecutor(
          db,
          {
            ...actor,
            membershipId: record.membershipId ?? actor.membershipId,
          },
          record.input,
          requestMeta,
        ),
      );
    }
    return created;
  }

  /**
   * Editable work remains a draft until it enters approval. Every replacement
   * of timing, breaks, content, visibility, or project links gets a new
   * immutable version snapshot. Timer/import facts deliberately cannot be
   * rewritten through this path: their source event chains stay authoritative.
   */
  async updateManualOwn(
    actor: WorkActor,
    sessionId: string,
    expectedVersion: number,
    input: CreateWorkSessionInput,
    requestMeta: { requestId?: string; userAgent?: string } = {},
  ) {
    if (input.source !== "manual") {
      throw new WorkSessionValidationError(
        "只能编辑手工草稿；计时和导入记录保留其原始事实链。",
      );
    }
    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);
    const breaks = input.breaks.map((entry) => ({
      startAt: new Date(entry.startAt),
      endAt: new Date(entry.endAt),
    }));
    let duration;
    try {
      duration = calculateWorkDuration({ startAt, endAt }, breaks);
    } catch (error) {
      throw new WorkSessionValidationError(
        error instanceof Error ? error.message : "休息时段不合法。",
      );
    }
    if (duration.netSeconds <= 0) {
      throw new WorkSessionValidationError("有效工时必须大于 0 秒。");
    }
    const anomalyFlags = workDurationAnomalyFlags(duration);

    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(workSessions)
        .where(
          and(
            eq(workSessions.id, sessionId),
            eq(workSessions.organizationId, actor.organizationId),
            eq(workSessions.membershipId, actor.membershipId),
            eq(workSessions.version, expectedVersion),
            eq(workSessions.source, "manual"),
            eq(workSessions.submissionStatus, "draft"),
            inArray(workSessions.approvalStatus, ["not_requested", "returned"]),
            isNull(workSessions.lockedAt),
            isNull(workSessions.deletedAt),
          ),
        )
        .for("update")
        .limit(1);
      if (!current) throw new WorkSessionVersionConflictError();

      const recordKind: WorkRecordKind = isPlanRecord(current.recordKind)
        ? "plan"
        : "fact";
      if (recordKind === "plan") {
        assertPlanWindow(startAt, endAt);
      } else if (endAt > new Date(Date.now() + factualFutureGraceMs)) {
        throw new WorkSessionValidationError(
          "实际工时的结束时间不能晚于当前时间；未来计划请保存为云端计划草稿。",
        );
      }

      const [expectation] = await tx
        .select({
          lookbackDays: workExpectationProfiles.manualEntryLookbackDays,
        })
        .from(workExpectationProfiles)
        .where(
          and(
            eq(workExpectationProfiles.membershipId, actor.membershipId),
            lt(workExpectationProfiles.effectiveFrom, new Date()),
            or(
              isNull(workExpectationProfiles.effectiveTo),
              gt(workExpectationProfiles.effectiveTo, new Date()),
            ),
          ),
        )
        .orderBy(desc(workExpectationProfiles.effectiveFrom))
        .limit(1);
      const lookbackDays = expectation?.lookbackDays ?? 7;
      if (startAt < new Date(Date.now() - lookbackDays * 86_400_000)) {
        throw new WorkSessionValidationError(
          "手工补录仅允许追溯 " +
            lookbackDays +
            " 天；更早记录需要提交更正申请。",
        );
      }

      const linkedNodeIds = Array.from(
        new Set([
          ...input.projectNodeIds,
          ...(input.primaryProjectNodeId ? [input.primaryProjectNodeId] : []),
        ]),
      );
      const primaryProjectNodeId = input.primaryProjectNodeId ?? null;
      const linkedNodes = linkedNodeIds.length
        ? await tx
            .select({
              id: projectNodes.id,
              projectId: projectNodes.projectId,
              branchId: projectNodes.branchId,
            })
            .from(projectNodes)
            .innerJoin(projects, eq(projects.id, projectNodes.projectId))
            .where(
              and(
                inArray(projectNodes.id, linkedNodeIds),
                eq(projects.organizationId, actor.organizationId),
                isNull(projectNodes.deletedAt),
                isNull(projects.deletedAt),
              ),
            )
        : [];
      if (linkedNodes.length !== linkedNodeIds.length) {
        throw new WorkSessionValidationError("所选项目任务不存在或不可用。");
      }

      const [overlap] = await tx
        .select({ id: workSessions.id })
        .from(workSessions)
        .where(
          and(
            eq(workSessions.organizationId, actor.organizationId),
            eq(workSessions.membershipId, actor.membershipId),
            ne(workSessions.id, sessionId),
            isNull(workSessions.deletedAt),
            recordKind === "fact"
              ? eq(workSessions.recordKind, "fact")
              : undefined,
            lt(workSessions.startAt, endAt),
            gt(workSessions.endAt, startAt),
          ),
        )
        .limit(1);
      if (overlap && !input.parallelWork) throw new WorkSessionConflictError();

      const now = new Date();
      const [beforeBreaks, beforeProjectLinks] = await Promise.all([
        tx
          .select()
          .from(workBreaks)
          .where(eq(workBreaks.workSessionId, sessionId)),
        tx
          .select()
          .from(workSessionProjectLinks)
          .where(eq(workSessionProjectLinks.workSessionId, sessionId)),
      ]);
      const [updated] = await tx
        .update(workSessions)
        .set({
          startAt,
          endAt,
          timezone: input.timezone,
          grossSeconds: duration.grossSeconds,
          breakSeconds: duration.breakSeconds,
          netSeconds: duration.netSeconds,
          billableSeconds: duration.netSeconds,
          content: input.content,
          result: input.result,
          blockers: input.blockers,
          nextStep: input.nextStep,
          primaryProjectNodeId,
          visibility: recordKind === "plan" ? "private" : input.visibility,
          parallelWork: input.parallelWork,
          anomalyFlags: recordKind === "plan" ? [] : anomalyFlags,
          version: current.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(workSessions.id, sessionId),
            eq(workSessions.version, expectedVersion),
          ),
        )
        .returning();
      if (!updated) throw new WorkSessionVersionConflictError();

      await tx.delete(workBreaks).where(eq(workBreaks.workSessionId, sessionId));
      if (breaks.length > 0) {
        await tx.insert(workBreaks).values(
          breaks.map((entry) => ({
            workSessionId: sessionId,
            startAt: entry.startAt,
            endAt: entry.endAt,
          })),
        );
      }
      await tx
        .delete(workSessionProjectLinks)
        .where(eq(workSessionProjectLinks.workSessionId, sessionId));
      const projectLinks = linkedNodeIds.map((nodeId) => {
        const node = linkedNodes.find((candidate) => candidate.id === nodeId);
        if (!node) {
          throw new WorkSessionValidationError("所选项目任务不存在或不可用。");
        }
        return {
          workSessionId: sessionId,
          projectId: node.projectId,
          projectNodeId: node.id,
          projectBranchId: node.branchId,
          isPrimary: node.id === primaryProjectNodeId,
          allocationBasisPoints: node.id === primaryProjectNodeId ? 10_000 : 0,
        };
      });
      if (projectLinks.length > 0) {
        await tx.insert(workSessionProjectLinks).values(projectLinks);
      }
      const snapshot = { ...updated, breaks, projectLinks };
      await tx.insert(workSessionVersions).values({
        workSessionId: sessionId,
        version: updated.version,
        snapshot,
        changeReason:
          recordKind === "plan" ? "plan_updated" : "draft_updated",
        changedBy: actor.membershipId,
      });
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action:
          recordKind === "plan"
            ? "work_plan.updated"
            : "work_session.draft_updated",
        entityType: "work_session",
        entityId: sessionId,
        before: {
          ...current,
          breaks: beforeBreaks,
          projectLinks: beforeProjectLinks,
        },
        after: snapshot,
        requestId: requestMeta.requestId,
        userAgent: requestMeta.userAgent,
      });
      await tx.insert(outboxEvents).values({
        organizationId: actor.organizationId,
        eventType: "work_session.changed",
        entityType: "work_session",
        entityId: updated.id,
        entityVersion: updated.version,
        payload: { change: recordKind === "plan" ? "plan_updated" : "draft_updated" },
      });
      return snapshot;
    });
  }

  private async createManualWithExecutor(
    db: WorkExecutor,
    actor: WorkActor,
    input: CreateWorkSessionInput,
    requestMeta: { requestId?: string; userAgent?: string } = {},
    options: { recordKind?: WorkRecordKind } = {},
  ) {
    const recordKind = options.recordKind ?? "fact";
    if (input.source === "timer") {
      throw new WorkSessionValidationError(
        "计时来源必须由服务器计时状态机生成。",
      );
    }
    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);
    const breaks = input.breaks.map((entry) => ({
      startAt: new Date(entry.startAt),
      endAt: new Date(entry.endAt),
    }));
    let duration;
    try {
      duration = calculateWorkDuration({ startAt, endAt }, breaks);
    } catch (error) {
      throw new WorkSessionValidationError(
        error instanceof Error ? error.message : "休息时段不合法。",
      );
    }
    if (duration.netSeconds <= 0) {
      throw new WorkSessionValidationError("有效工时必须大于 0 秒。");
    }
    const anomalyFlags = workDurationAnomalyFlags(duration);

    // The import endpoint is separately permission-gated and hashes the
    // preview before confirming it. It may therefore restore historical facts
    // from a verified archive, whereas ordinary manual backfill stays bounded
    // by the member's active expectation profile.
    if (input.source !== "import" && recordKind === "fact") {
      const [expectation] = await db
        .select({ lookbackDays: workExpectationProfiles.manualEntryLookbackDays })
        .from(workExpectationProfiles)
        .where(
          and(
            eq(workExpectationProfiles.membershipId, actor.membershipId),
            lt(workExpectationProfiles.effectiveFrom, new Date()),
            or(
              isNull(workExpectationProfiles.effectiveTo),
              gt(workExpectationProfiles.effectiveTo, new Date()),
            ),
          ),
        )
        .orderBy(desc(workExpectationProfiles.effectiveFrom))
        .limit(1);
      const lookbackDays = expectation?.lookbackDays ?? 7;
      const cutoff = new Date(Date.now() - lookbackDays * 86_400_000);
      if (startAt < cutoff) {
        throw new WorkSessionValidationError(
          `手工补录仅允许追溯 ${lookbackDays} 天；更早记录需要提交更正申请。`,
        );
      }
    }
    if (recordKind === "plan") {
      assertPlanWindow(startAt, endAt);
    } else if (endAt > new Date(Date.now() + factualFutureGraceMs)) {
      throw new WorkSessionValidationError("结束时间不能晚于当前时间。");
    }

    const linkedNodeIds = Array.from(
      new Set([
        ...input.projectNodeIds,
        ...(input.primaryProjectNodeId ? [input.primaryProjectNodeId] : []),
      ]),
    );
    const primaryProjectNodeId = input.primaryProjectNodeId ?? null;
    const linkedNodes = linkedNodeIds.length
      ? await db
          .select({
            id: projectNodes.id,
            projectId: projectNodes.projectId,
            branchId: projectNodes.branchId,
          })
          .from(projectNodes)
          .innerJoin(projects, eq(projects.id, projectNodes.projectId))
          .where(
            and(
              inArray(projectNodes.id, linkedNodeIds),
              eq(projects.organizationId, actor.organizationId),
              isNull(projectNodes.deletedAt),
              isNull(projects.deletedAt),
            ),
          )
      : [];
    if (linkedNodes.length !== linkedNodeIds.length) {
      throw new WorkSessionValidationError("所选项目任务不存在或不可用。");
    }

    const [overlap] = await db
      .select({ id: workSessions.id })
      .from(workSessions)
      .where(
        and(
            eq(workSessions.organizationId, actor.organizationId),
            eq(workSessions.membershipId, actor.membershipId),
            isNull(workSessions.deletedAt),
            recordKind === "fact"
              ? eq(workSessions.recordKind, "fact")
              : undefined,
            lt(workSessions.startAt, endAt),
          gt(workSessions.endAt, startAt),
        ),
      )
      .limit(1);
    if (overlap && !input.parallelWork) throw new WorkSessionConflictError();

    const [session] = await db
      .insert(workSessions)
      .values({
        organizationId: actor.organizationId,
        membershipId: actor.membershipId,
        startAt,
        endAt,
        timezone: input.timezone,
        grossSeconds: duration.grossSeconds,
        breakSeconds: duration.breakSeconds,
        netSeconds: duration.netSeconds,
        billableSeconds: duration.netSeconds,
        source: input.source,
        recordKind,
        content: input.content,
        result: input.result,
        blockers: input.blockers,
        nextStep: input.nextStep,
        primaryProjectNodeId,
        visibility: recordKind === "plan" ? "private" : input.visibility,
        parallelWork: input.parallelWork,
        anomalyFlags: recordKind === "plan" ? [] : anomalyFlags,
      })
      .returning();
    if (!session) throw new Error("Failed to create work session");

    if (breaks.length > 0) {
      await db.insert(workBreaks).values(
        breaks.map((entry) => ({
          workSessionId: session.id,
          startAt: entry.startAt,
          endAt: entry.endAt,
        })),
      );
    }
    const projectLinks = linkedNodeIds.map((nodeId) => {
      const node = linkedNodes.find((candidate) => candidate.id === nodeId);
      if (!node)
        throw new WorkSessionValidationError("所选项目任务不存在或不可用。");
      return {
        workSessionId: session.id,
        projectId: node.projectId,
        projectNodeId: node.id,
        projectBranchId: node.branchId,
        isPrimary: node.id === primaryProjectNodeId,
        allocationBasisPoints: node.id === primaryProjectNodeId ? 10_000 : 0,
      };
    });
    if (projectLinks.length > 0) {
      await db.insert(workSessionProjectLinks).values(projectLinks);
    }
    const snapshot = { ...session, breaks, projectLinks };
    await db.insert(workSessionVersions).values({
      workSessionId: session.id,
      version: 1,
      snapshot,
      changeReason: recordKind === "plan" ? "plan_created" : "created",
      changedBy: actor.membershipId,
    });
    await db.insert(auditLogs).values({
      organizationId: actor.organizationId,
      actorMembershipId: actor.membershipId,
      action:
        recordKind === "plan" ? "work_plan.created" : "work_session.created",
      entityType: "work_session",
      entityId: session.id,
      after: snapshot,
      requestId: requestMeta.requestId,
      userAgent: requestMeta.userAgent,
    });
    await db.insert(outboxEvents).values({
      organizationId: actor.organizationId,
      eventType: "work_session.changed",
      entityType: "work_session",
      entityId: session.id,
      entityVersion: session.version,
      payload: { change: recordKind === "plan" ? "plan_created" : "created" },
    });
    return snapshot;
  }

  async listOwn(
    actor: WorkActor,
    limit: number,
    options: WorkSessionListOptions = {},
  ) {
    const sessions = await this.db
      .select()
      .from(workSessions)
      .where(
        and(
          eq(workSessions.organizationId, actor.organizationId),
          eq(workSessions.membershipId, actor.membershipId),
          isNull(workSessions.deletedAt),
          options.recordKind
            ? eq(workSessions.recordKind, options.recordKind)
            : undefined,
          options.before ? lt(workSessions.startAt, options.before) : undefined,
          options.from ? gt(workSessions.endAt, options.from) : undefined,
          options.to ? lt(workSessions.startAt, options.to) : undefined,
        ),
      )
      .orderBy(desc(workSessions.startAt), desc(workSessions.id))
      .limit(limit);
    if (sessions.length === 0) return sessions;
    const [links, breaks] = await Promise.all([
      this.db
        .select({
          workSessionId: workSessionProjectLinks.workSessionId,
          projectId: workSessionProjectLinks.projectId,
          projectNodeId: workSessionProjectLinks.projectNodeId,
          projectBranchId: workSessionProjectLinks.projectBranchId,
          isPrimary: workSessionProjectLinks.isPrimary,
          allocationBasisPoints: workSessionProjectLinks.allocationBasisPoints,
          projectNodeTitle: projectNodes.title,
        })
        .from(workSessionProjectLinks)
        .innerJoin(
          projectNodes,
          eq(projectNodes.id, workSessionProjectLinks.projectNodeId),
        )
        .where(
          inArray(
            workSessionProjectLinks.workSessionId,
            sessions.map((session) => session.id),
          ),
        ),
      this.db
        .select({
          workSessionId: workBreaks.workSessionId,
          startAt: workBreaks.startAt,
          endAt: workBreaks.endAt,
        })
        .from(workBreaks)
        .where(
          inArray(
            workBreaks.workSessionId,
            sessions.map((session) => session.id),
          ),
        )
        .orderBy(asc(workBreaks.startAt)),
    ]);
    const linksBySession = new Map<string, typeof links>();
    for (const link of links) {
      linksBySession.set(link.workSessionId, [
        ...(linksBySession.get(link.workSessionId) ?? []),
        link,
      ]);
    }
    const breaksBySession = new Map<string, typeof breaks>();
    for (const entry of breaks) {
      breaksBySession.set(entry.workSessionId, [
        ...(breaksBySession.get(entry.workSessionId) ?? []),
        entry,
      ]);
    }
    return sessions.map((session) => ({
      ...session,
      projectLinks: linksBySession.get(session.id) ?? [],
      breaks: breaksBySession.get(session.id) ?? [],
    }));
  }

  /**
   * An immutable backup is only useful if its owner can inspect it.  The
   * join keeps both tenant and membership boundaries in the database query;
   * a guessed record id therefore yields no historical payload.
   */
  async listVersionsOwn(actor: WorkActor, sessionId: string, limit: number) {
    return this.db
      .select({
        id: workSessionVersions.id,
        version: workSessionVersions.version,
        snapshot: workSessionVersions.snapshot,
        changeReason: workSessionVersions.changeReason,
        createdAt: workSessionVersions.createdAt,
      })
      .from(workSessionVersions)
      .innerJoin(
        workSessions,
        eq(workSessions.id, workSessionVersions.workSessionId),
      )
      .where(
        and(
          eq(workSessionVersions.workSessionId, sessionId),
          eq(workSessions.organizationId, actor.organizationId),
          eq(workSessions.membershipId, actor.membershipId),
          isNull(workSessions.deletedAt),
        ),
      )
      .orderBy(desc(workSessionVersions.version))
      .limit(limit);
  }

  /** Move an editable draft without altering its approved financial duration. */
  async rescheduleOwn(
    actor: WorkActor,
    sessionId: string,
    expectedVersion: number,
    startAt: Date,
    endAt: Date,
  ) {
    if (endAt <= startAt)
      throw new WorkSessionValidationError("结束时间必须晚于开始时间。");
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(workSessions)
        .where(
          and(
            eq(workSessions.id, sessionId),
            eq(workSessions.organizationId, actor.organizationId),
            eq(workSessions.membershipId, actor.membershipId),
            eq(workSessions.version, expectedVersion),
            eq(workSessions.submissionStatus, "draft"),
            inArray(workSessions.approvalStatus, ["not_requested", "returned"]),
            isNull(workSessions.lockedAt),
            isNull(workSessions.deletedAt),
          ),
        )
        .for("update")
        .limit(1);
      if (!current) throw new WorkSessionVersionConflictError();
      const recordKind: WorkRecordKind = isPlanRecord(current.recordKind)
        ? "plan"
        : "fact";
      if (recordKind === "plan") {
        assertPlanWindow(startAt, endAt);
      } else if (endAt > new Date(Date.now() + factualFutureGraceMs)) {
        throw new WorkSessionValidationError("结束时间不能晚于当前时间。");
      }
      const originalDuration =
        current.endAt.getTime() - current.startAt.getTime();
      if (endAt.getTime() - startAt.getTime() !== originalDuration) {
        throw new WorkSessionValidationError(
          "日历改期必须保持原记录时长；如需调整时长，请在记录编辑中完成。",
        );
      }
      const [overlap] = await tx
        .select({ id: workSessions.id })
        .from(workSessions)
        .where(
          and(
            eq(workSessions.organizationId, actor.organizationId),
            eq(workSessions.membershipId, actor.membershipId),
            ne(workSessions.id, sessionId),
            isNull(workSessions.deletedAt),
            recordKind === "fact"
              ? eq(workSessions.recordKind, "fact")
              : undefined,
            lt(workSessions.startAt, endAt),
            gt(workSessions.endAt, startAt),
          ),
        )
        .limit(1);
      if (overlap && !current.parallelWork)
        throw new WorkSessionConflictError();
      const delta = startAt.getTime() - current.startAt.getTime();
      const [updated] = await tx
        .update(workSessions)
        .set({
          startAt,
          endAt,
          version: current.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workSessions.id, sessionId),
            eq(workSessions.version, expectedVersion),
          ),
        )
        .returning();
      if (!updated) throw new WorkSessionVersionConflictError();
      const [breaks, projectLinks] = await Promise.all([
        tx
          .select()
          .from(workBreaks)
          .where(eq(workBreaks.workSessionId, sessionId)),
        tx
          .select()
          .from(workSessionProjectLinks)
          .where(eq(workSessionProjectLinks.workSessionId, sessionId)),
      ]);
      const shiftedBreaks = breaks.map((entry) => ({
        ...entry,
        startAt: new Date(entry.startAt.getTime() + delta),
        endAt: new Date(entry.endAt.getTime() + delta),
      }));
      for (const entry of breaks) {
        await tx
          .update(workBreaks)
          .set({
            startAt: new Date(entry.startAt.getTime() + delta),
            endAt: new Date(entry.endAt.getTime() + delta),
            updatedAt: new Date(),
          })
          .where(eq(workBreaks.id, entry.id));
      }
      await tx
        .insert(workSessionVersions)
        .values({
          workSessionId: updated.id,
          version: updated.version,
          snapshot: { ...updated, breaks: shiftedBreaks, projectLinks },
          changeReason:
            recordKind === "plan"
              ? "plan_calendar_rescheduled"
              : "calendar_rescheduled",
          changedBy: actor.membershipId,
        });
      await tx
        .insert(auditLogs)
        .values({
          organizationId: actor.organizationId,
          actorMembershipId: actor.membershipId,
          action:
            recordKind === "plan"
              ? "work_plan.calendar_rescheduled"
              : "work_session.calendar_rescheduled",
          entityType: "work_session",
          entityId: updated.id,
          before: { ...current, breaks, projectLinks },
          after: { ...updated, breaks: shiftedBreaks, projectLinks },
        });
      await tx.insert(outboxEvents).values({
        organizationId: actor.organizationId,
        eventType: "work_session.changed",
        entityType: "work_session",
        entityId: updated.id,
        entityVersion: updated.version,
        payload: { change: "rescheduled" },
      });
      return { ...updated, breaks: shiftedBreaks, projectLinks };
    });
  }

  /**
   * Turns a synchronized future plan into an ordinary editable fact only
   * after its end time has arrived. The plan row is not copied: its existing
   * versions, breaks and project links remain one continuous audit chain,
   * while the explicit kind transition makes the boundary visible forever.
   */
  async realizePlanOwn(
    actor: WorkActor,
    sessionId: string,
    expectedVersion: number,
  ) {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(workSessions)
        .where(
          and(
            eq(workSessions.id, sessionId),
            eq(workSessions.organizationId, actor.organizationId),
            eq(workSessions.membershipId, actor.membershipId),
            eq(workSessions.version, expectedVersion),
            eq(workSessions.recordKind, "plan"),
            eq(workSessions.submissionStatus, "draft"),
            inArray(workSessions.approvalStatus, ["not_requested", "returned"]),
            isNull(workSessions.lockedAt),
            isNull(workSessions.deletedAt),
          ),
        )
        .for("update")
        .limit(1);
      if (!current) throw new WorkSessionVersionConflictError();
      if (
        current.endAt >
        new Date(Date.now() + factualFutureGraceMs)
      ) {
        throw new WorkSessionValidationError(
          "计划尚未结束，不能提前转成真实工时。请在实际完成后核对时间与结果再转换。",
        );
      }

      const [overlap] = await tx
        .select({ id: workSessions.id })
        .from(workSessions)
        .where(
          and(
            eq(workSessions.organizationId, actor.organizationId),
            eq(workSessions.membershipId, actor.membershipId),
            eq(workSessions.recordKind, "fact"),
            ne(workSessions.id, sessionId),
            isNull(workSessions.deletedAt),
            lt(workSessions.startAt, current.endAt),
            gt(workSessions.endAt, current.startAt),
          ),
        )
        .limit(1);
      if (overlap && !current.parallelWork) throw new WorkSessionConflictError();

      const [breaks, projectLinks] = await Promise.all([
        tx
          .select()
          .from(workBreaks)
          .where(eq(workBreaks.workSessionId, sessionId)),
        tx
          .select()
          .from(workSessionProjectLinks)
          .where(eq(workSessionProjectLinks.workSessionId, sessionId)),
      ]);
      const anomalyFlags = workDurationAnomalyFlags({
        grossSeconds: current.grossSeconds,
        breakSeconds: current.breakSeconds,
        netSeconds: current.netSeconds,
      });
      const [updated] = await tx
        .update(workSessions)
        .set({
          recordKind: "fact",
          anomalyFlags,
          version: current.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workSessions.id, sessionId),
            eq(workSessions.version, expectedVersion),
            eq(workSessions.recordKind, "plan"),
          ),
        )
        .returning();
      if (!updated) throw new WorkSessionVersionConflictError();
      const snapshot = { ...updated, breaks, projectLinks };
      await tx.insert(workSessionVersions).values({
        workSessionId: updated.id,
        version: updated.version,
        snapshot,
        changeReason: "plan_realized_as_work_draft",
        changedBy: actor.membershipId,
      });
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "work_plan.realized_as_work_draft",
        entityType: "work_session",
        entityId: updated.id,
        before: { ...current, breaks, projectLinks },
        after: snapshot,
      });
      await tx.insert(outboxEvents).values({
        organizationId: actor.organizationId,
        eventType: "work_session.changed",
        entityType: "work_session",
        entityId: updated.id,
        entityVersion: updated.version,
        payload: { change: "plan_realized" },
      });
      return snapshot;
    });
  }

  async submit(actor: WorkActor, sessionId: string, expectedVersion: number) {
    return this.db.transaction(async (tx) => {
      const [reviewableEvidence] = await tx
        .select({ id: attachments.id })
        .from(attachmentLinks)
        .innerJoin(attachments, eq(attachments.id, attachmentLinks.attachmentId))
        .where(
          and(
            eq(attachmentLinks.entityType, "work_session"),
            eq(attachmentLinks.entityId, sessionId),
            eq(attachments.organizationId, actor.organizationId),
            eq(attachments.status, "available"),
            inArray(attachments.visibility, ["management_only", "project_visible"]),
            isNull(attachments.deletedAt),
          ),
        )
        .limit(1);
      if (!reviewableEvidence) throw new WorkSessionEvidenceRequiredError();
      const [updated] = await tx
        .update(workSessions)
        .set({
          submissionStatus: "submitted",
          approvalStatus: "pending_review",
          submittedAt: new Date(),
          updatedAt: new Date(),
          version: expectedVersion + 1,
        })
        .where(
          and(
            eq(workSessions.id, sessionId),
            eq(workSessions.organizationId, actor.organizationId),
            eq(workSessions.membershipId, actor.membershipId),
            eq(workSessions.version, expectedVersion),
            eq(workSessions.recordKind, "fact"),
            eq(workSessions.submissionStatus, "draft"),
            inArray(workSessions.approvalStatus, ["not_requested", "returned"]),
            isNull(workSessions.lockedAt),
            isNull(workSessions.deletedAt),
            lt(
              workSessions.endAt,
              new Date(Date.now() + factualFutureGraceMs + 1),
            ),
          ),
        )
        .returning();
      if (!updated) throw new WorkSessionVersionConflictError();
      const [breaks, projectLinks] = await Promise.all([
        tx
          .select()
          .from(workBreaks)
          .where(eq(workBreaks.workSessionId, updated.id)),
        tx
          .select()
          .from(workSessionProjectLinks)
          .where(eq(workSessionProjectLinks.workSessionId, updated.id)),
      ]);
      const snapshot = { ...updated, breaks, projectLinks };
      await tx.insert(workSessionVersions).values({
        workSessionId: updated.id,
        version: updated.version,
        snapshot,
        changeReason: "submitted_for_approval",
        changedBy: actor.membershipId,
      });
      const [approvalRequest] = await tx
        .insert(approvalRequests)
        .values({
          organizationId: actor.organizationId,
          entityType: "work_session",
          entityId: updated.id,
          entityVersion: String(updated.version),
          requestedBy: actor.membershipId,
          priority:
            Array.isArray(updated.anomalyFlags) &&
            updated.anomalyFlags.length > 0
              ? "high"
              : "normal",
          anomalyFlags: updated.anomalyFlags,
        })
        .returning({ id: approvalRequests.id });
      if (!approvalRequest)
        throw new Error("Failed to create approval request");
      await tx.insert(approvalActions).values({
        approvalRequestId: approvalRequest.id,
        actorMembershipId: actor.membershipId,
        action: "submitted",
        afterSnapshot: snapshot,
      });
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "work_session.submitted",
        entityType: "work_session",
        entityId: updated.id,
        after: snapshot,
      });
      await tx.insert(outboxEvents).values({
        organizationId: actor.organizationId,
        eventType: "work_session.changed",
        entityType: "work_session",
        entityId: updated.id,
        entityVersion: updated.version,
        payload: { change: "submitted" },
      });
      return snapshot;
    });
  }

  async withdrawSubmission(
    actor: WorkActor,
    sessionId: string,
    expectedVersion: number,
  ) {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(workSessions)
        .where(
          and(
            eq(workSessions.id, sessionId),
            eq(workSessions.organizationId, actor.organizationId),
            eq(workSessions.membershipId, actor.membershipId),
            eq(workSessions.version, expectedVersion),
            eq(workSessions.recordKind, "fact"),
            eq(workSessions.submissionStatus, "submitted"),
            eq(workSessions.approvalStatus, "pending_review"),
            isNull(workSessions.lockedAt),
            isNull(workSessions.deletedAt),
          ),
        )
        .limit(1);
      if (!current) throw new WorkSessionVersionConflictError();

      const [request] = await tx
        .update(approvalRequests)
        .set({ status: "cancelled", resolvedAt: new Date() })
        .where(
          and(
            eq(approvalRequests.organizationId, actor.organizationId),
            eq(approvalRequests.entityType, "work_session"),
            eq(approvalRequests.entityId, sessionId),
            eq(approvalRequests.status, "pending"),
          ),
        )
        .returning();
      if (!request) throw new WorkSessionVersionConflictError();

      const [updated] = await tx
        .update(workSessions)
        .set({
          submissionStatus: "draft",
          approvalStatus: "not_requested",
          submittedAt: null,
          updatedAt: new Date(),
          version: expectedVersion + 1,
        })
        .where(
          and(
            eq(workSessions.id, sessionId),
            eq(workSessions.version, expectedVersion),
            eq(workSessions.approvalStatus, "pending_review"),
          ),
        )
        .returning();
      if (!updated) throw new WorkSessionVersionConflictError();

      const [breaks, projectLinks] = await Promise.all([
        tx.select().from(workBreaks).where(eq(workBreaks.workSessionId, sessionId)),
        tx
          .select()
          .from(workSessionProjectLinks)
          .where(eq(workSessionProjectLinks.workSessionId, sessionId)),
      ]);
      const beforeSnapshot = { ...current, breaks, projectLinks };
      const snapshot = { ...updated, breaks, projectLinks };
      await tx.insert(workSessionVersions).values({
        workSessionId: sessionId,
        version: updated.version,
        snapshot,
        changeReason: "approval_submission_withdrawn",
        changedBy: actor.membershipId,
      });
      await tx.insert(approvalActions).values({
        approvalRequestId: request.id,
        actorMembershipId: actor.membershipId,
        action: "cancelled",
        reason: "提交人撤回并准备修改",
        beforeSnapshot,
        afterSnapshot: snapshot,
      });
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "work_session.submission_withdrawn",
        entityType: "work_session",
        entityId: sessionId,
        before: beforeSnapshot,
        after: snapshot,
      });
      await tx.insert(outboxEvents).values({
        organizationId: actor.organizationId,
        eventType: "work_session.changed",
        entityType: "work_session",
        entityId: sessionId,
        entityVersion: updated.version,
        payload: { change: "submission_withdrawn" },
      });
      return snapshot;
    });
  }
}
