import { and, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { Database } from "@workbench/db";
import { attachmentLinks, attachments, auditLogs, compensationPlans, compensationPlanVersions, notifications, outboxEvents, payPeriods, payrollAdjustments, payrollRuns, reimbursementRequests, users, orgMemberships } from "@workbench/db/schema";
import { hasPermission } from "@workbench/shared";
import type { AuthContext } from "../auth/service.js";
import { PayrollConflictError, PayrollNotFoundError } from "./service.js";

export const canReviewReimbursements = (actor: AuthContext) =>
  hasPermission(actor.grants, "payroll.settle", { scopeKind: "organization" });

export class ReimbursementService {
  constructor(private readonly db: Database) {}

  async list(actor: AuthContext) {
    const reviewer = canReviewReimbursements(actor);
    const items = await this.db.select({ request: reimbursementRequests, memberName: users.displayName, periodName: payPeriods.name, periodStatus: payPeriods.status })
      .from(reimbursementRequests)
      .innerJoin(orgMemberships, eq(orgMemberships.id, reimbursementRequests.membershipId))
      .innerJoin(users, eq(users.id, orgMemberships.userId))
      .leftJoin(payPeriods, eq(payPeriods.id, reimbursementRequests.payPeriodId))
      .where(and(eq(reimbursementRequests.organizationId, actor.organizationId),
        reviewer ? or(eq(reimbursementRequests.membershipId, actor.membershipId), ne(reimbursementRequests.status, "draft")) : eq(reimbursementRequests.membershipId, actor.membershipId)))
      .orderBy(desc(reimbursementRequests.createdAt)).limit(200);
    const periods = reviewer ? await this.db.select().from(payPeriods)
      .where(and(eq(payPeriods.organizationId, actor.organizationId), eq(payPeriods.status, "open")))
      .orderBy(desc(payPeriods.startsAt)) : [];
    return { items: items.map(({ request, ...details }) => ({ ...request, ...details })), periods, canReview: reviewer, membershipId: actor.membershipId };
  }

  async create(actor: AuthContext, input: { title: string; description: string; expenseDate: string; amount: string; currency: string }) {
    return this.db.transaction(async (tx) => {
      const [request] = await tx.insert(reimbursementRequests).values({ ...input,
        organizationId: actor.organizationId, membershipId: actor.membershipId }).returning();
      await tx.insert(auditLogs).values({ organizationId: actor.organizationId, actorMembershipId: actor.membershipId,
        action: "reimbursement.created", entityType: "reimbursement", entityId: request!.id, after: request });
      await tx.insert(outboxEvents).values({ organizationId: actor.organizationId, eventType: "payroll.changed", entityType: "reimbursement",
        entityId: request!.id, entityVersion: 1, payload: { change: "created" } });
      return request!;
    });
  }

  async act(actor: AuthContext, id: string, input: { action: "submit" | "cancel" | "approve" | "reject"; expectedVersion: number; note?: string | undefined; payPeriodId?: string | undefined }) {
    return this.db.transaction(async (tx) => {
      const [request] = await tx.select().from(reimbursementRequests)
        .where(and(eq(reimbursementRequests.id, id), eq(reimbursementRequests.organizationId, actor.organizationId)))
        .for("update");
      if (!request) throw new PayrollNotFoundError();
      if (request.version !== input.expectedVersion) throw new PayrollConflictError("报销状态已变化，请刷新后重试。");
      const reviewing = input.action === "approve" || input.action === "reject";
      if (reviewing ? (!canReviewReimbursements(actor) || request.membershipId === actor.membershipId) : request.membershipId !== actor.membershipId)
        throw new PayrollConflictError(reviewing ? "需要另一位有薪资结算权限的人员审批，不能审批自己的报销。" : "只能操作自己的报销申请。");
      if ((input.action === "submit" && request.status !== "draft") ||
          (reviewing && request.status !== "pending") ||
          (input.action === "cancel" && !["draft", "pending"].includes(request.status)))
        throw new PayrollConflictError("当前状态不允许此操作。");
      if (input.action === "submit") {
        const evidence = await tx.select({ item: attachments }).from(attachmentLinks)
          .innerJoin(attachments, eq(attachments.id, attachmentLinks.attachmentId))
          .where(and(eq(attachmentLinks.entityType, "reimbursement"), eq(attachmentLinks.entityId, id),
            eq(attachments.organizationId, actor.organizationId), isNull(attachments.deletedAt)));
        if (!evidence.some(({ item }) => item.status === "available" && item.visibility !== "private"))
          throw new PayrollConflictError("请先添加至少一项已核验且对审批人可见的发票或报销凭证。");
        if (evidence.some(({ item }) => item.status === "pending_upload"))
          throw new PayrollConflictError("还有文件未上传完成，请完成上传或移除后提交。");
      }
      if (input.action === "approve") {
        if (!input.payPeriodId) throw new PayrollConflictError("请选择计入的开放薪资周期。");
        const [period] = await tx.select().from(payPeriods).where(and(eq(payPeriods.id, input.payPeriodId),
          eq(payPeriods.organizationId, actor.organizationId))).for("update");
        if (!period || period.status !== "open") throw new PayrollConflictError("周期正在计算或已结算，请先取消计算或选择其他开放周期。");
        const [activeRun] = await tx.select({ id: payrollRuns.id }).from(payrollRuns)
          .where(and(eq(payrollRuns.payPeriodId, period.id), inArray(payrollRuns.status, ["queued", "calculating", "ready", "review_required", "settled"])));
        if (activeRun) throw new PayrollConflictError("该周期已有计算批次，请取消批次后再纳入报销。");
        const [plan] = await tx.select({ currency: compensationPlans.currency }).from(compensationPlans)
          .innerJoin(compensationPlanVersions, eq(compensationPlanVersions.compensationPlanId, compensationPlans.id))
          .where(and(eq(compensationPlans.organizationId, actor.organizationId),
            eq(compensationPlans.membershipId, request.membershipId), isNull(compensationPlans.archivedAt),
            lt(compensationPlanVersions.effectiveFrom, period.endsAt),
            or(isNull(compensationPlanVersions.effectiveTo), gt(compensationPlanVersions.effectiveTo, period.startsAt))));
        if (!plan || plan.currency !== request.currency) throw new PayrollConflictError("请先为申请人配置周期内生效且币种一致的薪资方案；系统不会自动换汇。");
        await tx.insert(payrollAdjustments).values({ organizationId: actor.organizationId, membershipId: request.membershipId,
          payPeriodId: period.id, amount: request.amount, currency: request.currency,
          reason: `报销：${request.title}`, sourceEntityType: "reimbursement", sourceEntityId: id,
          createdBy: request.membershipId, approvedBy: actor.membershipId, approvedAt: new Date() });
      }
      const status = { submit: "pending", cancel: "cancelled", approve: "approved", reject: "rejected" }[input.action] as typeof request.status;
      const [updated] = await tx.update(reimbursementRequests).set({ status, version: sql`${reimbursementRequests.version} + 1`, updatedAt: new Date(),
        ...(input.action === "submit" ? { submittedAt: new Date() } : {}),
        ...(reviewing ? { reviewedBy: actor.membershipId, reviewedAt: new Date(), reviewNote: input.note ?? null } : {}),
        ...(input.action === "approve" ? { payPeriodId: input.payPeriodId } : {}),
      }).where(eq(reimbursementRequests.id, id)).returning();
      await tx.insert(auditLogs).values({ organizationId: actor.organizationId, actorMembershipId: actor.membershipId,
        action: `reimbursement.${input.action}`, entityType: "reimbursement", entityId: id, before: request, after: updated });
      await tx.insert(outboxEvents).values({ organizationId: actor.organizationId, eventType: "payroll.changed",
        entityType: "reimbursement", entityId: id, entityVersion: updated!.version, payload: { change: input.action } });
      if (reviewing) await tx.insert(notifications).values({ organizationId: actor.organizationId,
        recipientMembershipId: request.membershipId, category: "reimbursement_result", severity: "info",
        title: input.action === "approve" ? "报销申请已批准" : "报销申请已驳回",
        body: `“${request.title}”已处理，请在薪资页查看审批说明和结算周期。`,
        actionUrl: `/payroll#reimbursement-${id}`, dedupeKey: `reimbursement:${id}:${updated!.version}` });
      return updated!;
    });
  }
}
