import { and, desc, eq, gt, isNull, lte, or } from "drizzle-orm";
import type { Database } from "@workbench/db";
import { auditLogs, organizations, organizationOwners, workExpectationProfiles } from "@workbench/db/schema";
import { workSubmissionDeadline, workSubmissionPolicySchema, type WorkSubmissionPolicy } from "@workbench/shared";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { lockPayrollInputs } from "../payroll/input-lock.js";

type PolicyDatabase = Pick<Database, "select">;
export class WorkSubmissionPolicyError extends Error { readonly statusCode = 409; }
export async function effectiveWorkPolicy(db: PolicyDatabase, organizationId: string, membershipId: string, now = new Date()) {
  const [org] = await db.select({ settings: organizations.settings, timezone: organizations.timezone }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org) throw new WorkSubmissionPolicyError("组织不存在或已不可用。");
  const settings = (org.settings ?? {}) as Record<string, unknown>;
  const raw = settings.workSubmissionPolicy as (WorkSubmissionPolicy & { version?: number }) | undefined;
  const [profile] = await db.select({ days: workExpectationProfiles.manualEntryLookbackDays }).from(workExpectationProfiles).where(and(eq(workExpectationProfiles.membershipId, membershipId), lte(workExpectationProfiles.effectiveFrom, now), or(isNull(workExpectationProfiles.effectiveTo), gt(workExpectationProfiles.effectiveTo, now)))).orderBy(desc(workExpectationProfiles.effectiveFrom)).limit(1);
  const policy = workSubmissionPolicySchema.parse(raw ?? { manualEntryLookbackDays: profile?.days ?? 7 });
  return { ...policy, version: raw?.version ?? 0, timezone: org.timezone, currentMonthDeadline: workSubmissionDeadline(policy, now, org.timezone), inheritedMemberProfile: !raw };
}
export async function assertWorkSubmissionWindow(db: PolicyDatabase, organizationId: string, membershipId: string, startAt: Date, checkLookback = true) {
  const now = new Date(); const policy = await effectiveWorkPolicy(db, organizationId, membershipId, now);
  if (checkLookback) {
    const cutoff = policy.manualEntryLookbackDays === 0
      ? new Intl.DateTimeFormat("en-CA", { timeZone: policy.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(startAt) !== new Intl.DateTimeFormat("en-CA", { timeZone: policy.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
      : startAt < new Date(now.getTime() - policy.manualEntryLookbackDays * 86_400_000);
    if (cutoff) throw new WorkSubmissionPolicyError(`手工补录仅允许追溯 ${policy.manualEntryLookbackDays} 天（老板设置；0 表示仅当天）；更早记录需要提交更正申请，不能直接补录。`);
  }
  const deadline = workSubmissionDeadline(policy, startAt, policy.timezone);
  if (deadline && now >= deadline) throw new WorkSubmissionPolicyError(`该记录所属月份的提交截止时间已过（${deadline.toLocaleString("zh-CN", { timeZone: policy.timezone })}，${policy.timezone}），不能补录、恢复或提交该月历史工时。请联系老板处理有留痕的更正。`);
}
export function registerWorkPolicyRoutes(app: FastifyInstance, db: Database, authenticate: preHandlerHookHandler) {
  app.get("/api/work-policy", { preHandler: authenticate }, (request) => effectiveWorkPolicy(db, request.auth!.organizationId, request.auth!.membershipId));
  app.put("/api/work-policy", { preHandler: [app.csrfProtection, authenticate] }, async (request, reply) => {
    const actor = request.auth!;
    const [owner] = await db.select().from(organizationOwners).where(and(eq(organizationOwners.organizationId, actor.organizationId), eq(organizationOwners.membershipId, actor.membershipId)));
    if (!owner) return reply.code(403).send({ error: "owner_required", message: "只有当前组织老板 / 所有者可以修改提交与补录规则。" });
    const input = workSubmissionPolicySchema.extend({ expectedVersion: z.number().int().min(0) }).parse(request.body);
    const { expectedVersion, ...policy } = input;
    return db.transaction(async (tx) => {
      await lockPayrollInputs(tx, actor.organizationId);
      const [org] = await tx.select().from(organizations).where(eq(organizations.id, actor.organizationId)).for("update");
      const settings = (org!.settings ?? {}) as Record<string, unknown>;
      const before = settings.workSubmissionPolicy as { version?: number } | undefined;
      if ((before?.version ?? 0) !== expectedVersion) throw new WorkSubmissionPolicyError("提交规则已被另一个页面修改，请重新读取后保存。");
      workSubmissionDeadline(policy, new Date(), org!.timezone);
      const after = { ...policy, version: expectedVersion + 1 };
      await tx.update(organizations).set({ settings: { ...settings, workSubmissionPolicy: after }, updatedAt: new Date() }).where(eq(organizations.id, actor.organizationId));
      await tx.insert(auditLogs).values({ organizationId: actor.organizationId, actorMembershipId: actor.membershipId, action: "work.submission_policy.updated", entityType: "organization", entityId: actor.organizationId, before, after });
      return after;
    });
  });
}
