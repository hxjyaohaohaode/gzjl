import { and, desc, eq, isNull } from "drizzle-orm";
import type { Database } from "@workbench/db";
import {
  approvalActions,
  approvalRequests,
  auditLogs,
  orgMemberships,
  workSessions,
  workSessionProjectLinks,
  workSessionVersions,
} from "@workbench/db/schema";
import type { PermissionGrant } from "@workbench/shared";

export interface ApprovalActor {
  organizationId: string;
  membershipId: string;
  grants: PermissionGrant[];
}

export class ApprovalNotFoundError extends Error {
  constructor() {
    super("审核单不存在或当前账号不在审核范围内。")
    this.name = "ApprovalNotFoundError";
  }
}

export class ApprovalConflictError extends Error {
  constructor(message = "审核单已被处理，请刷新后重试。") {
    super(message);
    this.name = "ApprovalConflictError";
  }
}

function reviewGrants(actor: ApprovalActor): PermissionGrant[] {
  return actor.grants.filter((grant) => grant.permission === "work.review");
}

export class ApprovalService {
  constructor(private readonly db: Database) {}

  private async canReviewSession(
    actor: ApprovalActor,
    membershipOrgUnitId: string | null,
    workSessionId: string,
  ): Promise<boolean> {
    const grants = reviewGrants(actor);
    if (grants.some((grant) => grant.scopeKind === "organization")) return true;
    if (
      membershipOrgUnitId &&
      grants.some(
        (grant) => grant.scopeKind === "org_unit" && grant.scopeId === membershipOrgUnitId,
      )
    ) {
      return true;
    }
    const projectIds = grants
      .filter((grant) => grant.scopeKind === "project" && grant.scopeId)
      .map((grant) => grant.scopeId!);
    if (projectIds.length === 0) return false;
    const links = await this.db
      .select({ projectId: workSessionProjectLinks.projectId })
      .from(workSessionProjectLinks)
      .where(eq(workSessionProjectLinks.workSessionId, workSessionId));
    return links.some((link) => projectIds.includes(link.projectId));
  }

  async listPending(actor: ApprovalActor, limit = 50) {
    if (reviewGrants(actor).length === 0) return [];
    const candidates = await this.db
      .select({
        request: approvalRequests,
        session: workSessions,
        requesterOrgUnitId: orgMemberships.orgUnitId,
      })
      .from(approvalRequests)
      .innerJoin(
        workSessions,
        and(
          eq(approvalRequests.entityType, "work_session"),
          eq(approvalRequests.entityId, workSessions.id),
        ),
      )
      .innerJoin(orgMemberships, eq(orgMemberships.id, workSessions.membershipId))
      .where(
        and(
          eq(approvalRequests.organizationId, actor.organizationId),
          eq(approvalRequests.status, "pending"),
        ),
      )
      .orderBy(desc(approvalRequests.priority), desc(approvalRequests.requestedAt))
      .limit(Math.min(limit * 3, 300));

    const visible = [];
    for (const candidate of candidates) {
      if (
        (candidate.request.assignedReviewerId === null ||
          candidate.request.assignedReviewerId === actor.membershipId) &&
        (await this.canReviewSession(
          actor,
          candidate.requesterOrgUnitId,
          candidate.session.id,
        ))
      ) {
        visible.push(candidate);
        if (visible.length >= limit) break;
      }
    }
    return visible;
  }

  private async loadReviewable(actor: ApprovalActor, requestId: string) {
    const [record] = await this.db
      .select({
        request: approvalRequests,
        session: workSessions,
        requesterOrgUnitId: orgMemberships.orgUnitId,
      })
      .from(approvalRequests)
      .innerJoin(
        workSessions,
        and(
          eq(approvalRequests.entityType, "work_session"),
          eq(approvalRequests.entityId, workSessions.id),
        ),
      )
      .innerJoin(orgMemberships, eq(orgMemberships.id, workSessions.membershipId))
      .where(
        and(
          eq(approvalRequests.id, requestId),
          eq(approvalRequests.organizationId, actor.organizationId),
        ),
      )
      .limit(1);
    if (
      !record ||
      (record.request.assignedReviewerId !== null &&
        record.request.assignedReviewerId !== actor.membershipId) ||
      !(await this.canReviewSession(actor, record.requesterOrgUnitId, record.session.id))
    ) {
      throw new ApprovalNotFoundError();
    }
    return record;
  }

  async decide(
    actor: ApprovalActor,
    requestId: string,
    decision: "approved" | "returned",
    reason?: string,
  ) {
    const reviewable = await this.loadReviewable(actor, requestId);
    if (reviewable.request.status !== "pending") throw new ApprovalConflictError();
    if (decision === "returned" && (!reason || reason.trim().length < 2)) {
      throw new ApprovalConflictError("退回时必须填写明确原因。")
    }

    return this.db.transaction(async (tx) => {
      const [request] = await tx
        .update(approvalRequests)
        .set({ status: decision, resolvedAt: new Date() })
        .where(
          and(
            eq(approvalRequests.id, requestId),
            eq(approvalRequests.status, "pending"),
          ),
        )
        .returning();
      if (!request) throw new ApprovalConflictError();
      const [session] = await tx
        .update(workSessions)
        .set(
          decision === "approved"
            ? { approvalStatus: "approved", updatedAt: new Date() }
            : {
                approvalStatus: "returned",
                submissionStatus: "draft",
                updatedAt: new Date(),
              },
        )
        .where(
          and(
            eq(workSessions.id, request.entityId),
            eq(workSessions.approvalStatus, "pending_review"),
          ),
        )
        .returning();
      if (!session) throw new ApprovalConflictError("关联工时已不在待审核状态。")
      await tx.insert(approvalActions).values({
        approvalRequestId: request.id,
        actorMembershipId: actor.membershipId,
        action: decision,
        reason,
        beforeSnapshot: reviewable.session,
        afterSnapshot: session,
      });
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: `approval.${decision}`,
        entityType: "approval_request",
        entityId: request.id,
        before: reviewable.request,
        after: request,
        reason,
      });
      return { request, session };
    });
  }

  async managementCorrect(
    actor: ApprovalActor,
    requestId: string,
    expectedVersion: number,
    changes: {
      content?: string | undefined;
      result?: string | undefined;
      blockers?: string | undefined;
      nextStep?: string | undefined;
    },
    reason: string,
  ) {
    const reviewable = await this.loadReviewable(actor, requestId);
    if (reviewable.request.status !== "pending") throw new ApprovalConflictError();
    return this.db.transaction(async (tx) => {
      const [session] = await tx
        .update(workSessions)
        .set({
          ...changes,
          version: expectedVersion + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workSessions.id, reviewable.session.id),
            eq(workSessions.version, expectedVersion),
            eq(workSessions.approvalStatus, "pending_review"),
            isNull(workSessions.lockedAt),
          ),
        )
        .returning();
      if (!session) throw new ApprovalConflictError("工时版本已变化，管理更正未应用。")
      await tx.insert(workSessionVersions).values({
        workSessionId: session.id,
        version: session.version,
        snapshot: session,
        changeReason: `管理更正：${reason}`,
        changedBy: actor.membershipId,
      });
      await tx.insert(approvalActions).values({
        approvalRequestId: requestId,
        actorMembershipId: actor.membershipId,
        action: "management_corrected",
        reason,
        beforeSnapshot: reviewable.session,
        afterSnapshot: session,
      });
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "work_session.management_corrected",
        entityType: "work_session",
        entityId: session.id,
        before: reviewable.session,
        after: session,
        reason,
      });
      return session;
    });
  }
}
