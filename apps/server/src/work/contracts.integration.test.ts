import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import Fastify from "fastify";
import { afterEach, beforeEach, expect, it } from "vitest";
import { vi } from "vitest";
import type { Database } from "@workbench/db";
import { approvalRequests, attachmentLinks, attachments, compensationPlans, compensationPlanVersions, organizations, orgMemberships, orgUnits, payPeriods, payrollAdjustments, payrollItems, payrollRuns, projectMembers, users, workSessionCorrections, workSessions } from "@workbench/db/schema";
import { createWorkSessionSchema } from "@workbench/shared";
import type { AuthContext } from "../auth/service.js";
import { ApprovalService } from "../approvals/service.js";
import { PayrollService } from "../payroll/service.js";
import { ProjectService } from "../projects/service.js";
import { TimerService } from "../timer/service.js";
import { WorkCorrectionService } from "./correction-service.js";
import { WorkSessionService } from "./service.js";
import { registerWorkRoutes } from "./routes.js";

const clients: PGlite[] = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-22T12:00:00Z")); });
afterEach(async () => { vi.useRealTimers(); await Promise.all(clients.splice(0).map((client) => client.close())); });

async function fixture() {
  const client = new PGlite(); clients.push(client);
  const directory = resolve(import.meta.dirname, "../../../../packages/db/drizzle");
  for (const name of (await readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort()) {
    for (const statement of (await readFile(resolve(directory, name), "utf8")).split("--> statement-breakpoint").filter((value) => value.trim())) await client.exec(statement);
  }
  const db = drizzle(client) as unknown as Database;
  const [org] = await db.insert(organizations).values({ name: "业务契约核对", timezone: "UTC" }).returning();
  const people = await db.insert(users).values([{ displayName: "员工" }, { displayName: "审核人" }, { displayName: "另一部门员工" }]).returning();
  const members = await db.insert(orgMemberships).values(people.map((person) => ({ organizationId: org!.id, userId: person.id, status: "active" as const }))).returning();
  const actors = members.map((member, index): AuthContext => ({ userId: people[index]!.id, membershipId: member.id, organizationId: org!.id,
    displayName: people[index]!.displayName, timezone: "UTC", isOwner: false, grants: index === 1 ? [
      { permission: "work.review", scopeKind: "organization", scopeId: null },
      { permission: "payroll.settle", scopeKind: "organization", scopeId: null },
    ] : [{ permission: "work.view_own", scopeKind: "self", scopeId: member.id }] }));
  return { db, employee: actors[0]!, reviewer: actors[1]!, other: actors[2]!, work: new WorkSessionService(db), payroll: new PayrollService(db), corrections: new WorkCorrectionService(db) };
}

function input(startAt = "2026-09-22T08:00:00Z", endAt = "2026-09-22T09:00:00Z") {
  return createWorkSessionSchema.parse({ startAt, endAt, timezone: "UTC", source: "manual", content: "真实工作记录" });
}

async function insertWork(db: Database, actor: AuthContext, changes: Partial<typeof workSessions.$inferInsert> = {}) {
  const [session] = await db.insert(workSessions).values({ organizationId: actor.organizationId, membershipId: actor.membershipId,
    startAt: new Date("2026-09-22T08:00:00Z"), endAt: new Date("2026-09-22T09:00:00Z"), timezone: "UTC", source: "manual",
    content: "真实工作记录", grossSeconds: 3600, netSeconds: 3600, ...changes }).returning();
  return session!;
}

async function payrollFixture() {
  const result = await fixture(); const { db, employee, reviewer } = result;
  const [plan] = await db.insert(compensationPlans).values({ organizationId: employee.organizationId, membershipId: employee.membershipId,
    name: "时薪", type: "hourly", currency: "CNY", createdBy: reviewer.membershipId }).returning();
  const [version] = await db.insert(compensationPlanVersions).values({ compensationPlanId: plan!.id, version: 1, type: "hourly",
    baseAmount: "100", baseUnit: "hour", effectiveFrom: new Date("2026-08-01T00:00:00Z"), createdBy: reviewer.membershipId }).returning();
  const period = await result.payroll.createPeriod(reviewer, { name: "九月", timezone: "UTC", startsAt: new Date("2026-09-01T00:00:00Z"),
    endsAt: new Date("2026-10-01T00:00:00Z"), cutoffAt: new Date("2026-10-05T00:00:00Z") });
  return { ...result, plan: plan!, version: version!, period };
}

it("calendar rescheduling preserves timer/import provenance and the configured backfill window", async () => {
  const { db, employee, work } = await fixture();
  const draft = await work.createManual(employee, input());
  await expect(work.rescheduleOwn(employee, draft.id, 1, new Date("2026-09-01T08:00Z"), new Date("2026-09-01T09:00Z"))).rejects.toThrow("7 天");
  for (const source of ["timer", "import"] as const) {
    const original = await insertWork(db, employee, { source });
    await expect(work.rescheduleOwn(employee, original.id, 1, new Date("2026-09-22T06:00Z"), new Date("2026-09-22T07:00Z"))).rejects.toThrow("原始事实链");
  }
  expect((await work.rescheduleOwn(employee, draft.id, 1, new Date("2026-09-22T06:00Z"), new Date("2026-09-22T07:00Z"))).version).toBe(2);
});

it("a plan stays outside facts until its exact scheduled end, including the last five minutes", async () => {
  const { employee, work } = await fixture();
  const plan = await work.createPlan(employee, input("2026-09-22T13:00:00Z", "2026-09-22T14:00:00Z"));
  vi.setSystemTime(new Date("2026-09-22T13:59:00Z"));
  await expect(work.realizePlanOwn(employee, plan.id, 1)).rejects.toThrow("尚未结束");
  expect((await work.listOwn(employee, 10, { recordKind: "fact" }))).toEqual([]);
  vi.setSystemTime(new Date("2026-09-22T14:00:00Z"));
  expect((await work.realizePlanOwn(employee, plan.id, 1)).recordKind).toBe("fact");
});

it("only project participants may link timer work to a project node", async () => {
  const { db, employee, reviewer } = await fixture();
  const { project, root } = await new ProjectService(db).create(reviewer, { key: "ACCESS", name: "项目归属", color: "#3468f5" });
  const timer = new TimerService(db);
  const start = { eventId: crypto.randomUUID(), occurredAt: new Date(), content: "进行项目工作", primaryProjectNodeId: root.id, projectNodeIds: [root.id] };
  await expect(timer.start(employee, start)).rejects.toThrow("不存在或不可用");
  await db.insert(projectMembers).values({ projectId: project.id, membershipId: employee.membershipId, role: "member" });
  const running = await timer.start(employee, start);
  expect((await timer.start(employee, start)).id).toBe(running.id);
});

it("paginates equal-start records with an opaque composite cursor and accepts legacy date cursors", async () => {
  const { db, employee, work } = await fixture();
  for (let index = 0; index < 5; index += 1) await insertWork(db, employee, { parallelWork: true });
  const old = await insertWork(db, employee, { startAt: new Date("2026-09-21T08:00Z"), endAt: new Date("2026-09-21T09:00Z") });
  const app = Fastify(); app.decorate("csrfProtection", async () => {});
  await registerWorkRoutes(app, work, async (request) => { request.auth = employee; });
  const ids: string[] = []; let cursor: string | null = null;
  try {
    do {
      const result = await app.inject({ method: "GET", url: `/api/work-sessions?limit=2${cursor ? `&before=${encodeURIComponent(cursor)}` : ""}` });
      expect(result.statusCode).toBe(200);
      const body: { items: Array<{ id: string }>; nextCursor: string | null } = result.json();
      ids.push(...body.items.map((item) => item.id)); cursor = body.nextCursor;
      if (cursor) expect(cursor).toContain("|");
    } while (cursor && ids.length < 10);
    expect(ids).toHaveLength(6); expect(new Set(ids).size).toBe(6);
    const legacy = await app.inject({ method: "GET", url: "/api/work-sessions?before=2026-09-22T08:00:00Z" });
    expect(legacy.json().items.map((item: { id: string }) => item.id)).toEqual([old.id]);
  } finally { await app.close(); }
});

it("serializes simultaneous manual writes so unmarked overlapping facts cannot both commit", async () => {
  const { db, employee, work } = await fixture();
  const results = await Promise.allSettled([work.createManual(employee, input()), work.createManual(employee, input())]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  expect(await db.select().from(workSessions)).toHaveLength(1);
});

it("reports only work inside the selected calendar range after clipping overnight breaks", async () => {
  const { employee, work } = await fixture();
  await work.createManual(employee, { ...input("2026-09-21T23:00:00Z", "2026-09-22T02:00:00Z"), breaks: [
    { startAt: "2026-09-21T23:45:00Z", endAt: "2026-09-22T00:15:00Z" },
    { startAt: "2026-09-22T01:00:00Z", endAt: "2026-09-22T01:30:00Z" },
  ] });
  const previous = await work.listOwn(employee, 10, { from: new Date("2026-09-21T00:00Z"), to: new Date("2026-09-22T00:00Z") });
  const today = await work.listOwn(employee, 10, { from: new Date("2026-09-22T00:00Z"), to: new Date("2026-09-23T00:00Z") });
  expect(previous[0]).toMatchObject({ netSeconds: 7200, periodNetSeconds: 2700 });
  expect(today[0]).toMatchObject({ netSeconds: 7200, periodNetSeconds: 4500 });
  expect((await work.listOwn(employee, 10))[0]).toMatchObject({ netSeconds: 7200, periodNetSeconds: 7200 });
});

it("a member cannot forge import provenance through manual APIs to bypass backfill restrictions", async () => {
  const { db, employee, work } = await fixture();
  const forged = { ...input("2026-01-01T08:00:00Z", "2026-01-01T09:00:00Z"), source: "import" as const };
  const app = Fastify(); app.decorate("csrfProtection", async () => {});
  await registerWorkRoutes(app, work, async (request) => { request.auth = employee; });
  try {
    const single = await app.inject({ method: "POST", url: "/api/work-sessions", payload: forged });
    expect(single.statusCode).toBe(400); expect(single.json().message).toContain("导入");
    const batch = await app.inject({ method: "POST", url: "/api/work-entries/batch", payload: { entries: [
      { recordKind: "fact", input: input() }, { recordKind: "fact", input: forged },
    ] } });
    expect(batch.statusCode).toBe(400); expect(await db.select().from(workSessions)).toHaveLength(0);
  } finally { await app.close(); }
});

it("does not let a work reviewer create a payroll adjustment or review their own correction", async () => {
  const { db, employee, reviewer, corrections } = await fixture();
  const session = await insertWork(db, employee, { approvalStatus: "locked", lockedAt: new Date() });
  const correction = await corrections.requestOwn(employee, session.id, input(), "原工作描述需要补充");
  const workReviewer = { ...reviewer, grants: reviewer.grants.filter((grant) => grant.permission === "work.review") };
  await expect(corrections.decide(workReviewer, correction.id, { decision: "approved", adjustment: { amount: "500" } })).rejects.toThrow("薪资结算权限");
  await expect(corrections.decide({ ...employee, grants: reviewer.grants }, correction.id, { decision: "approved" })).rejects.toThrow("权限");
  expect(await db.select().from(payrollAdjustments)).toHaveLength(0);
  expect((await db.select().from(workSessionCorrections))[0]!.status).toBe("pending");
  expect((await corrections.decide(workReviewer, correction.id, { decision: "approved" })).correction.status).toBe("approved");
});

it("corrects into the effective historical plan version and blocks an already computed target period", async () => {
  const { db, employee, reviewer, corrections, plan, version, period } = await payrollFixture();
  await db.update(compensationPlanVersions).set({ effectiveTo: new Date("2026-10-01T00:00Z") }).where(eq(compensationPlanVersions.id, version.id));
  await db.insert(compensationPlanVersions).values({ compensationPlanId: plan.id, version: 2, type: "hourly", baseAmount: "200", baseUnit: "hour",
    effectiveFrom: new Date("2026-10-01T00:00Z"), createdBy: reviewer.membershipId });
  await db.update(compensationPlans).set({ activeVersion: 2 }).where(eq(compensationPlans.id, plan.id));
  await db.insert(payPeriods).values({ organizationId: employee.organizationId, name: "八月", timezone: "UTC", startsAt: new Date("2026-08-01Z"),
    endsAt: new Date("2026-09-01Z"), cutoffAt: new Date("2026-09-05Z"), status: "locked" });
  const session = await insertWork(db, employee, { startAt: new Date("2026-08-20T08:00Z"), endAt: new Date("2026-08-20T09:00Z"), approvalStatus: "locked", lockedAt: new Date() });
  const correction = await corrections.requestOwn(employee, session.id, input("2026-08-20T08:00:00Z", "2026-08-20T09:00:00Z"), "已核对的历史更正");
  expect((await corrections.decide(reviewer, correction.id, { decision: "approved", adjustment: { amount: "12.5" } })).adjustment?.currency).toBe("CNY");
  const second = await corrections.requestOwn(employee, session.id, input("2026-08-20T08:00:00Z", "2026-08-20T09:00:00Z"), "另一项历史更正申请");
  await db.insert(payrollRuns).values({ payPeriodId: period.id, runNumber: 1, status: "ready", calculationVersion: "test", requestedBy: reviewer.membershipId, inputHash: "test" });
  await expect(corrections.decide(reviewer, second.id, { decision: "approved", adjustment: { amount: "20" } })).rejects.toThrow("有效薪资计算批次");
  expect(await db.select().from(payrollAdjustments)).toHaveLength(1);
});

it("applies review scope before limits so another department cannot hide waiting approvals or corrections", async () => {
  const { db, employee, reviewer, other, corrections } = await fixture();
  const [unit] = await db.insert(orgUnits).values({ organizationId: employee.organizationId, name: "授权部门" }).returning();
  await db.update(orgMemberships).set({ orgUnitId: unit!.id }).where(eq(orgMemberships.id, employee.membershipId));
  const scoped = { ...reviewer, grants: [{ permission: "work.review" as const, scopeKind: "org_unit" as const, scopeId: unit!.id }] };
  const visible = await insertWork(db, employee, { approvalStatus: "locked", lockedAt: new Date() });
  const pending = await corrections.requestOwn(employee, visible.id, input(), "授权范围内的更正");
  const [approval] = await db.insert(approvalRequests).values({ organizationId: employee.organizationId, entityType: "work_session", entityId: visible.id,
    entityVersion: "1", requestedBy: employee.membershipId, requestedAt: new Date("2026-09-01Z") }).returning();
  for (let index = 0; index < 5; index += 1) {
    const hidden = await insertWork(db, other, { approvalStatus: "locked", lockedAt: new Date() });
    await db.insert(workSessionCorrections).values({ workSessionId: hidden.id, requestedBy: other.membershipId, baseVersion: 1,
      proposedSnapshot: {}, reason: "其他部门申请", createdAt: new Date("2026-10-01Z") });
    await db.insert(approvalRequests).values({ organizationId: other.organizationId, entityType: "work_session", entityId: hidden.id,
      entityVersion: "1", requestedBy: other.membershipId, requestedAt: new Date("2026-10-01Z") });
  }
  expect((await new ApprovalService(db).listPending(scoped, 1)).map((entry) => entry.request.id)).toEqual([approval!.id]);
  expect((await corrections.listPending(scoped, 1)).map((entry) => entry.correction.id)).toEqual([pending.id]);
});

it("serializes overlapping payroll period creation and rejects invalid timezones", async () => {
  const { db, reviewer, payroll } = await fixture();
  const period = { name: "九月", timezone: "UTC", startsAt: new Date("2026-09-01Z"), endsAt: new Date("2026-10-01Z"), cutoffAt: new Date("2026-10-05Z") };
  await expect(payroll.createPeriod(reviewer, { ...period, timezone: "Invalid/Zone" })).rejects.toThrow("有效");
  const results = await Promise.allSettled([payroll.createPeriod(reviewer, period), payroll.createPeriod(reviewer, period)]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(await db.select().from(payPeriods)).toHaveLength(1);
});

it("refuses to settle a snapshot after newly approved work appears and leaves every record unlocked", async () => {
  const { db, employee, reviewer, payroll, period } = await payrollFixture();
  const first = await insertWork(db, employee, { approvalStatus: "approved" });
  const run = await payroll.calculate(reviewer, period.id);
  const second = await insertWork(db, employee, { approvalStatus: "approved", startAt: new Date("2026-09-22T10:00Z"), endAt: new Date("2026-09-22T11:00Z") });
  await expect(payroll.settle(reviewer, run.id)).rejects.toThrow("重新计算");
  expect((await db.select().from(workSessions)).filter((session) => [first.id, second.id].includes(session.id)).map((session) => session.approvalStatus)).toEqual(["approved", "approved"]);
  expect((await db.select().from(payrollRuns))[0]!.status).toBe("ready");
  await payroll.cancelCalculation(reviewer, run.id);
  const recalculated = await payroll.calculate(reviewer, period.id);
  expect((await payroll.settle(reviewer, recalculated.id)).status).toBe("settled");
});

it("refuses to settle after payroll rules change and never locks uncalculated members", async () => {
  const { db, employee, other, reviewer, payroll, period, version } = await payrollFixture();
  await insertWork(db, employee, { approvalStatus: "approved" });
  const unpaid = await insertWork(db, other, { approvalStatus: "approved" });
  const run = await payroll.calculate(reviewer, period.id);
  await db.update(compensationPlanVersions).set({ baseAmount: "200" }).where(eq(compensationPlanVersions.id, version.id));
  await expect(payroll.settle(reviewer, run.id)).rejects.toThrow("重新计算");
  await payroll.cancelCalculation(reviewer, run.id);
  const current = await payroll.calculate(reviewer, period.id);
  await payroll.settle(reviewer, current.id);
  expect((await db.select().from(workSessions).where(eq(workSessions.id, unpaid.id)))[0]!.approvalStatus).toBe("approved");
});

it.each(["approval-first", "settlement-first"])("coordinates %s without locking unpaid newly approved work", async (order) => {
  const { db, employee, reviewer, payroll, period } = await payrollFixture();
  await insertWork(db, employee, { approvalStatus: "approved" });
  const run = await payroll.calculate(reviewer, period.id);
  const pending = await insertWork(db, employee, { approvalStatus: "pending_review", submissionStatus: "submitted",
    startAt: new Date("2026-09-22T10:00Z"), endAt: new Date("2026-09-22T11:00Z") });
  const [proof] = await db.insert(attachments).values({ organizationId: employee.organizationId, uploadedBy: employee.membershipId,
    kind: "text", textContent: "审批证据", status: "available", visibility: "management_only" }).returning();
  await db.insert(attachmentLinks).values({ attachmentId: proof!.id, entityType: "work_session", entityId: pending.id, createdBy: employee.membershipId });
  const [request] = await db.insert(approvalRequests).values({ organizationId: employee.organizationId, entityType: "work_session", entityId: pending.id,
    entityVersion: "1", requestedBy: employee.membershipId }).returning();
  const approve = () => new ApprovalService(db).decide(reviewer, request!.id, "approved");
  const settle = () => payroll.settle(reviewer, run.id);
  const result = await Promise.allSettled(order === "approval-first" ? [approve(), settle()] : [settle(), approve()]);
  expect(result[order === "approval-first" ? 0 : 1]!.status).toBe("fulfilled");
  expect(result[order === "approval-first" ? 1 : 0]!.status).toBe("rejected");
  expect((await db.select().from(workSessions).where(eq(workSessions.id, pending.id)))[0]).toMatchObject({ approvalStatus: "approved", lockedAt: null });
});

it("finishes overlapping timers, requires explicit review and pays each effective second once", async () => {
  const { db, employee, reviewer, work, payroll, period } = await payrollFixture();
  await insertWork(db, employee, { approvalStatus: "approved" });
  const timers = new TimerService(db);
  const running = await timers.start(employee, { eventId: crypto.randomUUID(), occurredAt: new Date("2026-09-22T08:30Z"), content: "计时与补录重叠", timezone: "UTC" });
  const stopEvent = { eventId: crypto.randomUUID(), eventType: "stop" as const, occurredAt: new Date("2026-09-22T09:30Z") };
  const stopped = await timers.transition(employee, running.id, stopEvent);
  expect(stopped.status).toBe("stopped");
  expect((await timers.transition(employee, running.id, stopEvent)).workSessionId).toBe(stopped.workSessionId);
  expect(await db.select().from(workSessions)).toHaveLength(2);
  const [record] = await db.select().from(workSessions).where(eq(workSessions.id, stopped.workSessionId!));
  expect(record!.anomalyFlags).toContain("overlapping_work_requires_review");
  const [proof] = await db.insert(attachments).values({ organizationId: employee.organizationId, uploadedBy: employee.membershipId,
    kind: "text", textContent: "计时交付核对材料", status: "available", visibility: "management_only" }).returning();
  await db.insert(attachmentLinks).values({ attachmentId: proof!.id, entityType: "work_session", entityId: record!.id, createdBy: employee.membershipId });
  await work.submit(employee, record!.id, record!.version);
  const [request] = await db.select().from(approvalRequests).where(eq(approvalRequests.entityId, record!.id));
  const approvals = new ApprovalService(db);
  await expect(approvals.decide(reviewer, request!.id, "approved")).rejects.toThrow("核对说明");
  await approvals.decide(reviewer, request!.id, "approved", "已核对并行记录，重复时段只计一次工资");
  const run = await payroll.calculate(reviewer, period.id);
  expect((await db.select().from(payrollItems).where(eq(payrollItems.payrollRunId, run.id)))[0]).toMatchObject({ approvedSeconds: 5400, grossAmount: "150.000000" });
  expect((await payroll.listOwn(employee)).livePreview).toMatchObject({ approvedSeconds: 5400, estimatedAmount: "150.000000" });
});

it("reports aggregate monetary overflow before persisting a payroll batch", async () => {
  const { db, employee, reviewer, payroll, period, version } = await payrollFixture();
  await db.update(compensationPlanVersions).set({ baseAmount: "99999999999999" }).where(eq(compensationPlanVersions.id, version.id));
  await insertWork(db, employee, { approvalStatus: "approved", endAt: new Date("2026-09-22T10:00Z"), grossSeconds: 7200, netSeconds: 7200 });
  await expect(payroll.calculate(reviewer, period.id)).rejects.toThrow("14 位整数");
  expect(await db.select().from(payrollRuns)).toHaveLength(0);
});
