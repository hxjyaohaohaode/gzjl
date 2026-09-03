import { and, asc, desc, eq, gte, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Database } from "@workbench/db";
import {
  auditLogs,
  compensationPlans,
  compensationPlanVersions,
  orgMemberships,
  payrollAdjustments,
  payPeriods,
  users,
  workSessionCorrections,
  workSessionProjectLinks,
  workSessions,
} from "@workbench/db/schema";
import {
  calculateWorkDuration,
  hasPermission,
  type CreateWorkSessionInput,
  type PermissionGrant,
} from "@workbench/shared";

export interface WorkCorrectionActor {
  organizationId: string;
  membershipId: string;
  grants: PermissionGrant[];
}

export class WorkCorrectionNotFoundError extends Error {
  constructor() {
    super("更正申请不存在，或不在你的授权范围内。");
    this.name = "WorkCorrectionNotFoundError";
  }
}

export class WorkCorrectionForbiddenError extends Error {
  constructor(message = "当前账号没有处理该工时更正的权限。") {
    super(message);
    this.name = "WorkCorrectionForbiddenError";
  }
}

export class WorkCorrectionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkCorrectionConflictError";
  }
}

export class WorkCorrectionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkCorrectionValidationError";
  }
}

export interface CorrectionDecisionInput {
  decision: "approved" | "rejected";
  reviewNote?: string | undefined;
      adjustment?:
    | {
        amount: string;
      }
    | undefined;
}

type ReviewCandidate = {
  sessionId: string;
  requesterMembershipId: string;
  requesterOrgUnitId: string | null;
};

function hasAnyReviewGrant(grants: readonly PermissionGrant[]): boolean {
  return grants.some((grant) => grant.permission === "work.review");
}

/**
 * Corrections preserve the original locked fact and store a structured,
 * reviewable proposal.  A reviewer may optionally post a signed manual
 * monetary adjustment to the first open period after the locked period; the
 * system never guesses a cross-plan payroll delta.
 */
export class WorkCorrectionService {
  constructor(private readonly db: Database) {}

  async requestOwn(
    actor: WorkCorrectionActor,
    sessionId: string,
    proposal: CreateWorkSessionInput,
    reason: string,
  ) {
    let duration;
    try {
      duration = calculateWorkDuration(
        {
          startAt: new Date(proposal.startAt),
          endAt: new Date(proposal.endAt),
        },
        proposal.breaks.map((entry) => ({
          startAt: new Date(entry.startAt),
          endAt: new Date(entry.endAt),
        })),
      );
    } catch (error) {
      throw new WorkCorrectionValidationError(
        error instanceof Error ? error.message : "拟议的工时区间不合法。",
      );
    }
    if (duration.netSeconds <= 0) {
      throw new WorkCorrectionValidationError("拟议更正的有效工时必须大于 0 秒。");
    }
    if (new Date(proposal.endAt) > new Date(Date.now() + 5 * 60_000)) {
      throw new WorkCorrectionValidationError(
        "更正申请只能描述已发生的工作；未来安排请保存为云端计划草稿。",
      );
    }

    return this.db.transaction(async (tx) => {
      // One pending proposal per original record makes a correction a clear
      // conversation rather than a race between browser tabs.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sessionId}))`);
      const [session] = await tx
        .select()
        .from(workSessions)
        .where(
          and(
            eq(workSessions.id, sessionId),
            eq(workSessions.organizationId, actor.organizationId),
            eq(workSessions.membershipId, actor.membershipId),
            eq(workSessions.recordKind, "fact"),
            eq(workSessions.approvalStatus, "locked"),
            isNull(workSessions.deletedAt),
          ),
        )
        .for("update")
        .limit(1);
      if (!session) {
        throw new WorkCorrectionConflictError(
          "只有已结算并锁定的本人记录可以发起更正申请。",
        );
      }
      if (proposal.source !== session.source) {
        throw new WorkCorrectionValidationError(
          "更正申请必须保留原记录的来源类型，不能把计时或导入事实伪装成手工记录。",
        );
      }
      const [pending] = await tx
        .select({ id: workSessionCorrections.id })
        .from(workSessionCorrections)
        .where(
          and(
            eq(workSessionCorrections.workSessionId, session.id),
            eq(workSessionCorrections.status, "pending"),
          ),
        )
        .limit(1);
      if (pending) {
        throw new WorkCorrectionConflictError(
          "该记录已有待处理的更正申请，请等待审核结论。",
        );
      }
      const proposedSnapshot = {
        workSession: proposal,
        duration,
        base: {
          id: session.id,
          version: session.version,
          source: session.source,
          approvalStatus: session.approvalStatus,
          lockedAt: session.lockedAt,
        },
      };
      const [correction] = await tx
        .insert(workSessionCorrections)
        .values({
          workSessionId: session.id,
          requestedBy: actor.membershipId,
          baseVersion: session.version,
          proposedSnapshot,
          reason,
        })
        .returning();
      if (!correction) throw new Error("Failed to create work-session correction");
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "work_session.correction_requested",
        entityType: "work_session_correction",
        entityId: correction.id,
        before: {
          workSessionId: session.id,
          version: session.version,
          approvalStatus: session.approvalStatus,
        },
        after: {
          workSessionId: session.id,
          baseVersion: correction.baseVersion,
          proposedDuration: duration,
        },
        reason,
      });
      return correction;
    });
  }

  async listOwn(actor: WorkCorrectionActor, limit: number) {
    return this.db
      .select({ correction: workSessionCorrections, session: workSessions })
      .from(workSessionCorrections)
      .innerJoin(
        workSessions,
        eq(workSessions.id, workSessionCorrections.workSessionId),
      )
      .where(
        and(
          eq(workSessions.organizationId, actor.organizationId),
          eq(workSessions.membershipId, actor.membershipId),
          eq(workSessions.recordKind, "fact"),
          isNull(workSessions.deletedAt),
        ),
      )
      .orderBy(desc(workSessionCorrections.createdAt))
      .limit(limit);
  }

  async listPending(actor: WorkCorrectionActor, limit: number) {
    if (!hasAnyReviewGrant(actor.grants)) return [];
    const candidates = await this.db
      .select({
        correction: workSessionCorrections,
        session: workSessions,
        requesterDisplayName: users.displayName,
        requesterOrgUnitId: orgMemberships.orgUnitId,
      })
      .from(workSessionCorrections)
      .innerJoin(
        workSessions,
        eq(workSessions.id, workSessionCorrections.workSessionId),
      )
      .innerJoin(orgMemberships, eq(orgMemberships.id, workSessions.membershipId))
      .innerJoin(users, eq(users.id, orgMemberships.userId))
      .where(
        and(
          eq(workSessions.organizationId, actor.organizationId),
          eq(workSessions.recordKind, "fact"),
          eq(workSessionCorrections.status, "pending"),
          isNull(workSessions.deletedAt),
        ),
      )
      .orderBy(desc(workSessionCorrections.createdAt))
      .limit(Math.min(limit * 3, 300));
    const visible = [];
    for (const candidate of candidates) {
      const allowed = await this.canReview(
        actor,
        {
          sessionId: candidate.session.id,
          requesterMembershipId: candidate.correction.requestedBy,
          requesterOrgUnitId: candidate.requesterOrgUnitId,
        },
      );
      if (!allowed) continue;
      visible.push({
        ...candidate,
        nextOpenPeriod: await this.findNextOpenPeriod(
          actor.organizationId,
          candidate.session,
        ),
      });
      if (visible.length >= limit) break;
    }
    return visible;
  }

  async decide(
    actor: WorkCorrectionActor,
    correctionId: string,
    input: CorrectionDecisionInput,
  ) {
    const [candidate] = await this.db
      .select({
        sessionId: workSessions.id,
        requesterMembershipId: workSessionCorrections.requestedBy,
        requesterOrgUnitId: orgMemberships.orgUnitId,
      })
      .from(workSessionCorrections)
      .innerJoin(
        workSessions,
        eq(workSessions.id, workSessionCorrections.workSessionId),
      )
      .innerJoin(orgMemberships, eq(orgMemberships.id, workSessions.membershipId))
      .where(
        and(
          eq(workSessionCorrections.id, correctionId),
          eq(workSessions.organizationId, actor.organizationId),
          eq(workSessions.recordKind, "fact"),
          isNull(workSessions.deletedAt),
        ),
      )
      .limit(1);
    if (!candidate) throw new WorkCorrectionNotFoundError();
    if (!(await this.canReview(actor, candidate))) {
      throw new WorkCorrectionForbiddenError();
    }

    return this.db.transaction(async (tx) => {
      const [record] = await tx
        .select({ correction: workSessionCorrections, session: workSessions })
        .from(workSessionCorrections)
        .innerJoin(
          workSessions,
          eq(workSessions.id, workSessionCorrections.workSessionId),
        )
        .where(
          and(
            eq(workSessionCorrections.id, correctionId),
            eq(workSessionCorrections.status, "pending"),
            eq(workSessions.organizationId, actor.organizationId),
            eq(workSessions.recordKind, "fact"),
            isNull(workSessions.deletedAt),
          ),
        )
        .for("update")
        .limit(1);
      if (!record) {
        throw new WorkCorrectionConflictError("更正申请已被其他审核操作处理。",
        );
      }
      if (record.session.version !== record.correction.baseVersion) {
        throw new WorkCorrectionConflictError(
          "原始记录版本已变化，不能将旧提案应用到新的事实状态。",
        );
      }
      if (
        record.session.approvalStatus !== "locked" ||
        record.session.lockedAt === null
      ) {
        throw new WorkCorrectionConflictError(
          "原始记录已不处于结算锁定状态，不能继续按已结算更正流程处理。",
        );
      }
      if (input.decision === "rejected") {
        const [correction] = await tx
          .update(workSessionCorrections)
          .set({
            status: "rejected",
            reviewedBy: actor.membershipId,
            reviewedAt: new Date(),
          })
          .where(eq(workSessionCorrections.id, record.correction.id))
          .returning();
        if (!correction) throw new Error("Failed to reject work-session correction");
        await tx.insert(auditLogs).values({
          organizationId: actor.organizationId,
          actorMembershipId: actor.membershipId,
          action: "work_session.correction_rejected",
          entityType: "work_session_correction",
          entityId: correction.id,
          before: record.correction,
          after: correction,
          reason: input.reviewNote,
        });
        return { correction, adjustment: null, nextOpenPeriod: null };
      }

      let adjustment: typeof payrollAdjustments.$inferSelect | null = null;
      let nextOpenPeriod: { id: string; name: string; startsAt: Date; endsAt: Date } | null = null;
      let status: "approved" | "applied_next_period" = "approved";
      if (input.adjustment) {
        const [originPeriod] = await tx
          .select({ id: payPeriods.id, endsAt: payPeriods.endsAt })
          .from(payPeriods)
          .where(
            and(
              eq(payPeriods.organizationId, actor.organizationId),
              inArray(payPeriods.status, ["settled", "locked"]),
              lt(payPeriods.startsAt, record.session.endAt),
              gt(payPeriods.endsAt, record.session.startAt),
            ),
          )
          .orderBy(desc(payPeriods.endsAt))
          .limit(1);
        if (!originPeriod) {
          throw new WorkCorrectionConflictError(
            "找不到原始锁定工资周期，不能猜测下期调整归属。",
          );
        }
        const [targetPeriod] = await tx
          .select({
            id: payPeriods.id,
            name: payPeriods.name,
            startsAt: payPeriods.startsAt,
            endsAt: payPeriods.endsAt,
          })
          .from(payPeriods)
          .where(
            and(
              eq(payPeriods.organizationId, actor.organizationId),
              eq(payPeriods.status, "open"),
              gte(payPeriods.startsAt, originPeriod.endsAt),
            ),
          )
          .orderBy(asc(payPeriods.startsAt))
          .limit(1);
        if (!targetPeriod) {
          throw new WorkCorrectionConflictError(
            "尚未创建原工资周期后的开放周期，不能安全写入下期调整。",
          );
        }
        const targetPlans = await tx
          .select({ currency: compensationPlans.currency })
          .from(compensationPlans)
          .innerJoin(
            compensationPlanVersions,
            and(
              eq(
                compensationPlanVersions.compensationPlanId,
                compensationPlans.id,
              ),
              eq(
                compensationPlanVersions.version,
                compensationPlans.activeVersion,
              ),
            ),
          )
          .where(
            and(
              eq(compensationPlans.organizationId, actor.organizationId),
              eq(compensationPlans.membershipId, record.session.membershipId),
              isNull(compensationPlans.archivedAt),
              lt(compensationPlanVersions.effectiveFrom, targetPeriod.endsAt),
              or(
                isNull(compensationPlanVersions.effectiveTo),
                gt(compensationPlanVersions.effectiveTo, targetPeriod.startsAt),
              ),
            ),
          )
          .limit(2);
        if (targetPlans.length === 0) {
          throw new WorkCorrectionConflictError(
            "下期没有该成员的有效薪资方案，不能安全写入金额调整。",
          );
        }
        if (targetPlans.length > 1) {
          throw new WorkCorrectionConflictError(
            "下期存在多个同时生效的薪资方案，无法为单一更正金额判断币种；请先由薪资管理员明确方案。",
          );
        }
        const targetPlan = targetPlans[0]!;
        const [createdAdjustment] = await tx
          .insert(payrollAdjustments)
          .values({
            organizationId: actor.organizationId,
            membershipId: record.session.membershipId,
            payPeriodId: targetPeriod.id,
            amount: input.adjustment.amount,
            currency: targetPlan.currency,
            reason: `已结算工时更正：${record.correction.reason}`,
            sourceEntityType: "work_session_correction",
            sourceEntityId: record.correction.id,
            createdBy: actor.membershipId,
            approvedBy: actor.membershipId,
            approvedAt: new Date(),
          })
          .returning();
        if (!createdAdjustment) throw new Error("Failed to create payroll adjustment");
        adjustment = createdAdjustment;
        nextOpenPeriod = targetPeriod;
        status = "applied_next_period";
      }
      const [correction] = await tx
        .update(workSessionCorrections)
        .set({
          status,
          reviewedBy: actor.membershipId,
          reviewedAt: new Date(),
        })
        .where(eq(workSessionCorrections.id, record.correction.id))
        .returning();
      if (!correction) throw new Error("Failed to approve work-session correction");
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action:
          status === "applied_next_period"
            ? "work_session.correction_applied_next_period"
            : "work_session.correction_approved",
        entityType: "work_session_correction",
        entityId: correction.id,
        before: record.correction,
        after: { correction, adjustment, nextOpenPeriod },
        reason: input.reviewNote,
      });
      return { correction, adjustment, nextOpenPeriod };
    });
  }

  private async canReview(
    actor: WorkCorrectionActor,
    candidate: ReviewCandidate,
  ): Promise<boolean> {
    if (
      candidate.requesterMembershipId === actor.membershipId ||
      !hasAnyReviewGrant(actor.grants)
    ) {
      return false;
    }
    if (
      hasPermission(actor.grants, "work.review", {
        scopeKind: "organization",
      })
    ) {
      return true;
    }
    if (
      candidate.requesterOrgUnitId &&
      hasPermission(actor.grants, "work.review", {
        scopeKind: "org_unit",
        scopeId: candidate.requesterOrgUnitId,
      })
    ) {
      return true;
    }
    const projectGrantIds = actor.grants
      .filter(
        (grant) =>
          grant.permission === "work.review" &&
          grant.scopeKind === "project" &&
          grant.scopeId,
      )
      .map((grant) => grant.scopeId!);
    if (projectGrantIds.length === 0) return false;
    const links = await this.db
      .select({ projectId: workSessionProjectLinks.projectId })
      .from(workSessionProjectLinks)
      .where(eq(workSessionProjectLinks.workSessionId, candidate.sessionId));
    return links.some((link) => projectGrantIds.includes(link.projectId));
  }

  private async findNextOpenPeriod(
    organizationId: string,
    session: Pick<typeof workSessions.$inferSelect, "startAt" | "endAt">,
  ) {
    const [originPeriod] = await this.db
      .select({ endsAt: payPeriods.endsAt })
      .from(payPeriods)
      .where(
        and(
          eq(payPeriods.organizationId, organizationId),
          inArray(payPeriods.status, ["settled", "locked"]),
          lt(payPeriods.startsAt, session.endAt),
          gt(payPeriods.endsAt, session.startAt),
        ),
      )
      .orderBy(desc(payPeriods.endsAt))
      .limit(1);
    if (!originPeriod) return null;
    const [next] = await this.db
      .select({
        id: payPeriods.id,
        name: payPeriods.name,
        startsAt: payPeriods.startsAt,
        endsAt: payPeriods.endsAt,
      })
      .from(payPeriods)
      .where(
        and(
          eq(payPeriods.organizationId, organizationId),
          eq(payPeriods.status, "open"),
          gte(payPeriods.startsAt, originPeriod.endsAt),
        ),
      )
      .orderBy(asc(payPeriods.startsAt))
      .limit(1);
    return next ?? null;
  }
}
