import { and, desc, eq, gt, inArray, isNull, lt, ne, or } from "drizzle-orm";
import type { Database } from "@workbench/db";
import {
  auditLogs,
  approvalActions,
  approvalRequests,
  projectNodes,
  projects,
  workBreaks,
  workExpectationProfiles,
  workSessions,
  workSessionVersions,
} from "@workbench/db/schema";
import {
  calculateWorkDuration,
  type CreateWorkSessionInput,
} from "@workbench/shared";

export class WorkSessionConflictError extends Error {
  constructor(message = "该时段与已有工时重叠；如确为并行工作，请明确标记并行工时。") {
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
    super("记录已被其他操作更新或当前状态不允许提交，请刷新后重试。")
    this.name = "WorkSessionVersionConflictError";
  }
}

export interface WorkActor {
  organizationId: string;
  membershipId: string;
}

/** The subset shared by the root Drizzle client and a transaction client. */
type WorkExecutor = Pick<Database, "select" | "insert">;

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
   * Creates an all-or-nothing import batch.  Each row is checked in insertion
   * order, so a non-parallel row also conflicts with an earlier row in the
   * same CSV.  Any failure rolls back every row, version and audit entry.
   */
  async createManualBatch(
    actor: WorkActor,
    inputs: CreateWorkSessionInput[],
    requestMeta: { requestId?: string; userAgent?: string } = {},
  ) {
    return this.db.transaction(async (tx) => {
      const created = [];
      for (const input of inputs) {
        created.push(
          await this.createManualWithExecutor(tx, actor, input, requestMeta),
        );
      }
      return created;
    });
  }

  private async createManualWithExecutor(
    db: WorkExecutor,
    actor: WorkActor,
    input: CreateWorkSessionInput,
    requestMeta: { requestId?: string; userAgent?: string } = {},
  ) {
    if (input.source === "timer") {
      throw new WorkSessionValidationError("计时来源必须由服务器计时状态机生成。")
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
      throw new WorkSessionValidationError("有效工时必须大于 0 秒。")
    }

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
    if (endAt > new Date(Date.now() + 5 * 60_000)) {
      throw new WorkSessionValidationError("结束时间不能晚于当前时间。")
    }

    if (input.primaryProjectNodeId) {
      const [node] = await db
        .select({ id: projectNodes.id })
        .from(projectNodes)
        .innerJoin(projects, eq(projects.id, projectNodes.projectId))
        .where(
          and(
            eq(projectNodes.id, input.primaryProjectNodeId),
            eq(projects.organizationId, actor.organizationId),
            isNull(projectNodes.deletedAt),
            isNull(projects.deletedAt),
          ),
        )
        .limit(1);
      if (!node) throw new WorkSessionValidationError("所选项目任务不存在或不可用。")
    }

    const [overlap] = await db
      .select({ id: workSessions.id })
      .from(workSessions)
      .where(
        and(
          eq(workSessions.organizationId, actor.organizationId),
          eq(workSessions.membershipId, actor.membershipId),
          isNull(workSessions.deletedAt),
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
          content: input.content,
          result: input.result,
          blockers: input.blockers,
          nextStep: input.nextStep,
          primaryProjectNodeId: input.primaryProjectNodeId,
          visibility: input.visibility,
          parallelWork: input.parallelWork,
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
      await db.insert(workSessionVersions).values({
        workSessionId: session.id,
        version: 1,
        snapshot: session,
        changeReason: "created",
        changedBy: actor.membershipId,
      });
      await db.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "work_session.created",
        entityType: "work_session",
        entityId: session.id,
        after: session,
        requestId: requestMeta.requestId,
        userAgent: requestMeta.userAgent,
      });
    return session;
  }

  async listOwn(actor: WorkActor, limit: number, before?: Date) {
    return this.db
      .select()
      .from(workSessions)
      .where(
        and(
          eq(workSessions.organizationId, actor.organizationId),
          eq(workSessions.membershipId, actor.membershipId),
          isNull(workSessions.deletedAt),
          before ? lt(workSessions.startAt, before) : undefined,
        ),
      )
      .orderBy(desc(workSessions.startAt), desc(workSessions.id))
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
    if (endAt <= startAt) throw new WorkSessionValidationError("结束时间必须晚于开始时间。");
    if (endAt > new Date(Date.now() + 5 * 60_000)) throw new WorkSessionValidationError("结束时间不能晚于当前时间。");
    return this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(workSessions).where(and(eq(workSessions.id, sessionId), eq(workSessions.organizationId, actor.organizationId), eq(workSessions.membershipId, actor.membershipId), eq(workSessions.version, expectedVersion), eq(workSessions.submissionStatus, "draft"), inArray(workSessions.approvalStatus, ["not_requested", "returned"]), isNull(workSessions.lockedAt), isNull(workSessions.deletedAt))).for("update").limit(1);
      if (!current) throw new WorkSessionVersionConflictError();
      const originalDuration = current.endAt.getTime() - current.startAt.getTime();
      if (endAt.getTime() - startAt.getTime() !== originalDuration) {
        throw new WorkSessionValidationError("日历改期必须保持原记录时长；如需调整时长，请在记录编辑中完成。");
      }
      const [overlap] = await tx.select({ id: workSessions.id }).from(workSessions).where(and(eq(workSessions.organizationId, actor.organizationId), eq(workSessions.membershipId, actor.membershipId), ne(workSessions.id, sessionId), isNull(workSessions.deletedAt), lt(workSessions.startAt, endAt), gt(workSessions.endAt, startAt))).limit(1);
      if (overlap && !current.parallelWork) throw new WorkSessionConflictError();
      const delta = startAt.getTime() - current.startAt.getTime();
      const [updated] = await tx.update(workSessions).set({ startAt, endAt, version: current.version + 1, updatedAt: new Date() }).where(and(eq(workSessions.id, sessionId), eq(workSessions.version, expectedVersion))).returning();
      if (!updated) throw new WorkSessionVersionConflictError();
      const breaks = await tx.select().from(workBreaks).where(eq(workBreaks.workSessionId, sessionId));
      for (const entry of breaks) {
        await tx.update(workBreaks).set({ startAt: new Date(entry.startAt.getTime() + delta), endAt: new Date(entry.endAt.getTime() + delta), updatedAt: new Date() }).where(eq(workBreaks.id, entry.id));
      }
      await tx.insert(workSessionVersions).values({ workSessionId: updated.id, version: updated.version, snapshot: updated, changeReason: "calendar_rescheduled", changedBy: actor.membershipId });
      await tx.insert(auditLogs).values({ organizationId: actor.organizationId, actorMembershipId: actor.membershipId, action: "work_session.calendar_rescheduled", entityType: "work_session", entityId: updated.id, before: current, after: updated });
      return updated;
    });
  }

  async submit(actor: WorkActor, sessionId: string, expectedVersion: number) {
    return this.db.transaction(async (tx) => {
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
            eq(workSessions.submissionStatus, "draft"),
            inArray(workSessions.approvalStatus, ["not_requested", "returned"]),
            isNull(workSessions.lockedAt),
            isNull(workSessions.deletedAt),
          ),
        )
        .returning();
      if (!updated) throw new WorkSessionVersionConflictError();
      await tx.insert(workSessionVersions).values({
        workSessionId: updated.id,
        version: updated.version,
        snapshot: updated,
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
            Array.isArray(updated.anomalyFlags) && updated.anomalyFlags.length > 0
              ? "high"
              : "normal",
          anomalyFlags: updated.anomalyFlags,
        })
        .returning({ id: approvalRequests.id });
      if (!approvalRequest) throw new Error("Failed to create approval request");
      await tx.insert(approvalActions).values({
        approvalRequestId: approvalRequest.id,
        actorMembershipId: actor.membershipId,
        action: "submitted",
        afterSnapshot: updated,
      });
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "work_session.submitted",
        entityType: "work_session",
        entityId: updated.id,
        after: updated,
      });
      return updated;
    });
  }
}
