import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { Database } from "@workbench/db";
import { approvalActions, approvalRequests, attachmentLinks, attachments, compensationPlans, compensationPlanVersions, organizations, orgMemberships, payPeriods, projectNodes, projects, users, timerStates, workBreaks, workSessions, workSessionProjectLinks, workSessionVersions } from "@workbench/db/schema";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { AnalyticsActor, AnalyticsService } from "../analytics/service.js";
import { workContentScope, visibleWorkText, workReviewScope } from "./review-scope.js";
import { nonEmptyPlanVersion } from "../payroll/plan-range.js";

// A calendar month is an explicitly labelled fallback, never a fabricated pay period.
function monthRange(timezone: string, at: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit" }).formatToParts(at);
  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value);
  const boundary = (offset: number) => {
    let date = new Date(Date.UTC(year, month - 1 + offset, 1));
    const target = date.getTime();
    for (let i = 0; i < 3; i++) {
      const p = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
      const n = (key: string) => Number(p.find((v) => v.type === key)?.value);
      date = new Date(date.getTime() + target - Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")));
    }
    return date;
  };
  return { startsAt: boundary(0), endsAt: boundary(1) };
}

export class WorkLifecycleService {
  constructor(private readonly db: Database, private readonly analytics: AnalyticsService) {}

  async records(actor: AnalyticsActor, input: { from: string; to: string; projectId?: string | undefined; nodeId?: string | undefined; memberId?: string | undefined; orgUnitId?: string | undefined; workTypeId?: string | undefined; approvalState?: string | undefined; sourceType?: string | undefined; before?: string | undefined; limit: number }) {
    const access = await this.analytics.buildAccessCondition(actor);
    const [beforeAt, beforeId] = input.before?.split("|") ?? [];
    const visibleText = (field: Parameters<typeof visibleWorkText>[0]) => visibleWorkText(field, actor.membershipId, actor.grants);
    const rows = await this.db.select({ id: workSessions.id, version: workSessions.version, content: visibleText(workSessions.content), result: visibleText(workSessions.result), blockers: visibleText(workSessions.blockers), nextStep: visibleText(workSessions.nextStep), startAt: workSessions.startAt, endAt: workSessions.endAt, netSeconds: workSessions.netSeconds, approvalStatus: workSessions.approvalStatus, displayName: users.displayName, projectId: projectNodes.projectId, nodeId: projectNodes.id, nodeTitle: projectNodes.title, projectName: projects.name, nodeProgress: projectNodes.progress, nodeStatus: projectNodes.status }).from(workSessions).innerJoin(orgMemberships, eq(orgMemberships.id, workSessions.membershipId)).innerJoin(users, eq(users.id, orgMemberships.userId)).leftJoin(projectNodes, eq(projectNodes.id, workSessions.primaryProjectNodeId)).leftJoin(projects, eq(projects.id, projectNodes.projectId)).where(and(access, eq(workSessions.recordKind, "fact"), isNull(workSessions.deletedAt), gt(workSessions.endAt, new Date(input.from)), lt(workSessions.startAt, new Date(input.to)), input.projectId ? or(eq(projectNodes.projectId, input.projectId), sql`exists (select 1 from ${workSessionProjectLinks} wl where wl.work_session_id = ${workSessions.id} and wl.project_id = ${input.projectId})`) : undefined, input.nodeId ? or(eq(workSessions.primaryProjectNodeId, input.nodeId), sql`exists (select 1 from ${workSessionProjectLinks} wl where wl.work_session_id = ${workSessions.id} and wl.project_node_id = ${input.nodeId})`) : undefined, input.memberId ? eq(workSessions.membershipId, input.memberId) : undefined, input.orgUnitId ? eq(orgMemberships.orgUnitId, input.orgUnitId) : undefined, input.workTypeId ? eq(workSessions.workTypeId, input.workTypeId) : undefined, input.approvalState ? sql`${workSessions.approvalStatus} = ${input.approvalState}` : undefined, input.sourceType ? sql`${workSessions.source} = ${input.sourceType}` : undefined, beforeAt && beforeId ? or(lt(workSessions.startAt, new Date(beforeAt)), and(eq(workSessions.startAt, new Date(beforeAt)), lt(workSessions.id, beforeId))) : undefined)).orderBy(desc(workSessions.startAt), desc(workSessions.id)).limit(input.limit + 1);
    const items = rows.slice(0, input.limit);
    const last = items.at(-1);
    return { items, nextCursor: rows.length > input.limit && last ? `${last.startAt.toISOString()}|${last.id}` : null };
  }

  async review(actor: AnalyticsActor, from: Date, to: Date) {
    const rows = await this.db.select({ id: workSessions.id, version: workSessions.version, content: workSessions.content, result: workSessions.result, blockers: workSessions.blockers, nextStep: workSessions.nextStep, startAt: workSessions.startAt, approvalStatus: workSessions.approvalStatus }).from(workSessions).where(and(eq(workSessions.organizationId, actor.organizationId), eq(workSessions.membershipId, actor.membershipId), eq(workSessions.recordKind, "fact"), isNull(workSessions.deletedAt), gt(workSessions.endAt, from), lt(workSessions.startAt, to))).orderBy(asc(workSessions.startAt));
    return { from, to, draft: [`工作回顾（待本人校对）`, `范围：${from.toISOString()} 至 ${to.toISOString()}（结束不含）`, `事实记录：${rows.length} 条；状态分别标记，未批准内容不能表述为已批准。`, ...rows.map((r) => `\n${r.startAt.toISOString()} · ${r.approvalStatus} · v${r.version}\n工作：${r.content}\n结果：${r.result || "未填写"}\n阻塞：${r.blockers || "未填写"}\n下一步：${r.nextStep || "未填写"}\n来源：/work?record=${r.id}&version=${r.version}`)].join("\n"), sourceCount: rows.length };
  }

  async overview(actor: AnalyticsActor, now = new Date()) {
    const [organization] = await this.db.select().from(organizations).where(eq(organizations.id, actor.organizationId));
    const [period] = await this.db.select().from(payPeriods).where(and(eq(payPeriods.organizationId, actor.organizationId), lte(payPeriods.startsAt, now), gt(payPeriods.endsAt, now))).orderBy(desc(payPeriods.startsAt)).limit(1);
    const range = period ?? monthRange(organization?.timezone ?? "Asia/Shanghai", now);
    const ownFacts = and(eq(workSessions.organizationId, actor.organizationId), eq(workSessions.membershipId, actor.membershipId), eq(workSessions.recordKind, "fact"), isNull(workSessions.deletedAt), lt(workSessions.startAt, range.endsAt), gt(workSessions.endAt, range.startsAt));
    const [counts, plans, attention] = await Promise.all([
      this.db.select({ status: workSessions.approvalStatus, count: sql<number>`count(*)::integer` }).from(workSessions).where(ownFacts).groupBy(workSessions.approvalStatus),
      this.db.select({ name: compensationPlans.name, version: compensationPlanVersions.version, effectiveFrom: compensationPlanVersions.effectiveFrom, effectiveTo: compensationPlanVersions.effectiveTo }).from(compensationPlans).innerJoin(compensationPlanVersions, eq(compensationPlanVersions.compensationPlanId, compensationPlans.id)).where(and(eq(compensationPlans.organizationId, actor.organizationId), eq(compensationPlans.membershipId, actor.membershipId), isNull(compensationPlans.archivedAt), nonEmptyPlanVersion())).orderBy(desc(compensationPlanVersions.effectiveFrom)).limit(100),
      this.db.select({ id: workSessions.id, content: workSessions.content, approvalStatus: workSessions.approvalStatus, version: workSessions.version }).from(workSessions).where(and(ownFacts, inArray(workSessions.approvalStatus, ["not_requested", "returned", "pending_review"]))).orderBy(asc(workSessions.startAt)).limit(100),
    ]);
    return { period: { id: period?.id ?? null, name: period?.name ?? "本月（尚未配置结算周期）", startsAt: range.startsAt, endsAt: range.endsAt, cutoffAt: period?.cutoffAt ?? null, timezone: organization?.timezone ?? "Asia/Shanghai" }, counts: Object.fromEntries(counts.map((c) => [c.status, c.count])), plans, activePlan: plans.find((p) => p.effectiveFrom <= now && (!p.effectiveTo || p.effectiveTo > now)) ?? null, attention, attentionTruncated: counts.filter((c) => ["not_requested", "returned", "pending_review"].includes(c.status)).reduce((sum, c) => sum + c.count, 0) > attention.length };
  }

  async context(actor: AnalyticsActor, id: string) {
    const reviewAccess = actor.grants.some((g) => g.permission === "work.review") ? workReviewScope(actor.grants) ?? sql`true` : sql`false`;
    const allowed = and(eq(workSessions.organizationId, actor.organizationId), or(workContentScope(actor.membershipId, actor.grants), reviewAccess), eq(workSessions.recordKind, "fact"), isNull(workSessions.deletedAt));
    // review scope uses orgMemberships in its correlated query, as in AnalyticsService.
    const [row] = await this.db.select({ session: workSessions, submitter: { membershipId: orgMemberships.id, status: orgMemberships.status, displayName: users.displayName } }).from(workSessions).innerJoin(orgMemberships, eq(orgMemberships.id, workSessions.membershipId)).innerJoin(users, eq(users.id, orgMemberships.userId)).where(and(allowed, eq(workSessions.id, id))).limit(1);
    const session = row?.session;
    if (!session) return null;
    const [evidence, history, links, neighbors, breaks, projectLinks, versions] = await Promise.all([
      this.db.select({ id: attachments.id, status: attachments.status, visibility: attachments.visibility }).from(attachmentLinks).innerJoin(attachments, eq(attachments.id, attachmentLinks.attachmentId)).where(and(eq(attachmentLinks.entityType, "work_session"), eq(attachmentLinks.entityId, id), eq(attachments.organizationId, actor.organizationId), isNull(attachments.deletedAt), session.membershipId === actor.membershipId ? undefined : sql`${attachments.visibility} <> 'private'`)),
      this.db.select({ action: approvalActions.action, note: approvalActions.reason, createdAt: approvalActions.createdAt, entityVersion: approvalRequests.entityVersion }).from(approvalRequests).innerJoin(approvalActions, eq(approvalActions.approvalRequestId, approvalRequests.id)).where(and(eq(approvalRequests.organizationId, actor.organizationId), eq(approvalRequests.entityType, "work_session"), eq(approvalRequests.entityId, id))).orderBy(desc(approvalActions.createdAt)).limit(100),
      this.db.select({ projectId: workSessionProjectLinks.projectId, nodeId: projectNodes.id, title: projectNodes.title, progress: projectNodes.progress, status: projectNodes.status, version: projectNodes.version, reportedProgress: workSessionProjectLinks.reportedProgress }).from(workSessionProjectLinks).innerJoin(projectNodes, eq(projectNodes.id, workSessionProjectLinks.projectNodeId)).where(eq(workSessionProjectLinks.workSessionId, id)),
      this.db.select({ id: workSessions.id, content: workSessions.content, startAt: workSessions.startAt, endAt: workSessions.endAt, approvalStatus: workSessions.approvalStatus }).from(workSessions).innerJoin(orgMemberships, eq(orgMemberships.id, workSessions.membershipId)).where(and(allowed, eq(workSessions.membershipId, session.membershipId), sql`${workSessions.id} <> ${id}`, gt(workSessions.endAt, new Date(session.startAt.getTime() - 86_400_000)), lt(workSessions.startAt, new Date(session.endAt.getTime() + 86_400_000)))).orderBy(asc(workSessions.startAt)).limit(100),
      this.db.select({ startAt: workBreaks.startAt, endAt: workBreaks.endAt }).from(workBreaks).where(eq(workBreaks.workSessionId, id)),
      this.db.select({ projectId: workSessionProjectLinks.projectId, projectNodeId: workSessionProjectLinks.projectNodeId, projectNodeTitle: projectNodes.title, isPrimary: workSessionProjectLinks.isPrimary, allocationBasisPoints: workSessionProjectLinks.allocationBasisPoints, reportedProgress: workSessionProjectLinks.reportedProgress }).from(workSessionProjectLinks).innerJoin(projectNodes, eq(projectNodes.id, workSessionProjectLinks.projectNodeId)).where(eq(workSessionProjectLinks.workSessionId, id)),
      this.db.select({ version: workSessionVersions.version, snapshot: workSessionVersions.snapshot, changeReason: workSessionVersions.changeReason, createdAt: workSessionVersions.createdAt }).from(workSessionVersions).where(eq(workSessionVersions.workSessionId, id)).orderBy(desc(workSessionVersions.version)).limit(100),
    ]);
    const [organization] = await this.db.select({ timezone: organizations.timezone }).from(organizations).where(eq(organizations.id, actor.organizationId));
    const month = monthRange(organization?.timezone ?? session.timezone, session.startAt);
    const memberCounts = await this.db.select({ status: workSessions.approvalStatus, count: sql<number>`count(*)::integer` }).from(workSessions).innerJoin(orgMemberships, eq(orgMemberships.id, workSessions.membershipId)).where(and(allowed, eq(workSessions.membershipId, session.membershipId), lt(workSessions.startAt, month.endsAt), gt(workSessions.endAt, month.startsAt))).groupBy(workSessions.approvalStatus);
    const currentTimers = actor.grants.some((g) => g.permission === "work.review" && g.scopeKind === "organization") || session.membershipId === actor.membershipId ? await this.db.select({ status: timerStates.status }).from(timerStates).where(and(eq(timerStates.membershipId, session.membershipId), inArray(timerStates.status, ["running", "paused", "on_break"]))) : [];
    const reasons: string[] = [];
    if (session.approvalStatus === "not_requested") reasons.push("尚未提交，草稿不会进入批准薪资依据。核对内容和证据后提交审核。");
    if (session.approvalStatus === "returned") reasons.push("记录已退回，请按历史退回原因修改并重新提交。");
    if (!evidence.some((e) => e.status === "available" && e.visibility !== "private")) reasons.push("缺少审核人可见的已核验证据，请添加文字、链接，或上传并核验文件。");
    if (session.endAt > new Date()) reasons.push("结束时间尚未到，请核对时区和时间；未来工作应保存为计划。");
    if (Array.isArray(session.anomalyFlags) && session.anomalyFlags.length) reasons.push("存在时间或工作异常，审批人需要核对具体原因。");
    return { submitter: row.submitter, memberWorkState: { month, counts: Object.fromEntries(memberCounts.map((c) => [c.status, c.count])), activeTimers: currentTimers.map((t) => t.status) }, session: { ...session, breaks, projectLinks }, ownRecord: session.membershipId === actor.membershipId, versions, evidenceSummary: { total: evidence.length, verified: evidence.filter((e) => e.status === "available").length }, history, links, neighbors, reasons };
  }
}

export async function registerLifecycleRoutes(app: FastifyInstance, service: WorkLifecycleService, authenticate: preHandlerHookHandler) {
  const range = z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) }).refine((q) => Date.parse(q.to) > Date.parse(q.from) && Date.parse(q.to) - Date.parse(q.from) <= 366 * 86_400_000, "时间范围必须为正且最多 366 天。");
  app.get("/api/analytics/records", { preHandler: authenticate }, (request) => {
    const query = range.safeExtend({ projectId: z.uuid().optional(), nodeId: z.uuid().optional(), memberId: z.uuid().optional(), orgUnitId: z.uuid().optional(), workTypeId: z.uuid().optional(), approvalState: z.enum(["not_requested", "pending_review", "approved", "returned", "locked"]).optional(), sourceType: z.enum(["manual", "timer", "import"]).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), before: z.string().regex(/^[^|]+\|[a-f0-9-]{36}$/i).refine((v) => z.iso.datetime({ offset: true }).safeParse(v.split("|")[0]).success && z.uuid().safeParse(v.split("|")[1]).success).optional() }).parse(request.query);
    return service.records(request.auth!, query);
  });
  app.get("/api/work-reviews/me", { preHandler: authenticate }, (request) => {
    const q = range.parse(request.query);
    return service.review(request.auth!, new Date(q.from), new Date(q.to));
  });
  app.get("/api/work-lifecycle/me", { preHandler: authenticate }, (request) => service.overview(request.auth!));
  app.get("/api/work-facts/:id", { preHandler: authenticate }, async (request, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const result = await service.context(request.auth!, id);
    return result ?? reply.code(404).send({ error: "work_fact_not_found", message: "记录不存在或当前账号无权查看。" });
  });
}
