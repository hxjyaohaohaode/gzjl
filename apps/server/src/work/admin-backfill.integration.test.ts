import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import Fastify from "fastify";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Database } from "@workbench/db";
import { approvalActions, approvalRequests, attachments, auditLogs, compensationPlans, compensationPlanVersions,
  organizations, orgMemberships, orgUnits, payPeriods, payrollItems, users, workSessions, workSessionVersions } from "@workbench/db/schema";
import { adminWorkBackfillSchema, createWorkSessionSchema } from "@workbench/shared";
import type { AuthContext } from "../auth/service.js";
import { PayrollService } from "../payroll/service.js";
import { AnalyticsService } from "../analytics/service.js";
import { WorkLifecycleService } from "./lifecycle.js";
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
  const [org] = await db.insert(organizations).values({ name: "管理员补录验收", timezone: "UTC", settings: {
    workSubmissionPolicy: { manualEntryLookbackDays: 10, monthlyDeadlineEnabled: true, deadlineDay: 10, deadlineTime: "23:30", followingMonth: false },
  } }).returning();
  const people = await db.insert(users).values([{ displayName: "管理员" }, { displayName: "员工甲" }, { displayName: "员工乙" }]).returning();
  const members = await db.insert(orgMemberships).values(people.map((person) => ({ organizationId: org!.id, userId: person.id, status: "active" as const }))).returning();
  const actors = members.map((member, index): AuthContext => ({ userId: people[index]!.id, membershipId: member.id,
    organizationId: org!.id, displayName: people[index]!.displayName, timezone: "UTC", isOwner: false,
    grants: index === 0 ? [{ permission: "work.review", scopeKind: "organization", scopeId: null },
      { permission: "payroll.configure", scopeKind: "organization", scopeId: null }] : [{ permission: "work.view_own", scopeKind: "self", scopeId: member.id }],
  }));
  return { db, admin: actors[0]!, employee: actors[1]!, other: actors[2]!, work: new WorkSessionService(db) };
}
function input(...membershipIds: string[]) {
  return adminWorkBackfillSchema.parse({ membershipIds, startAt: "2026-09-01T08:00:00Z", endAt: "2026-09-01T10:00:00Z", timezone: "UTC", content: "补录已完成的项目开发" });
}

it("confirms multiple employees' overdue work without evidence and preserves the real administrator in every trail", async () => {
  const { db, admin, employee, other, work } = await fixture();
  await expect(work.createManual(employee, createWorkSessionSchema.parse({ ...input(employee.membershipId), source: "manual" }))).rejects.toThrow("10 天");
  const sessions = await work.createAdminBackfill(admin, input(employee.membershipId, other.membershipId), { requestId: "backfill-test" });
  expect(sessions).toHaveLength(2);
  for (const session of sessions) expect(session).toMatchObject({ netSeconds: 7200, billableSeconds: 7200, recordKind: "fact", approvalStatus: "approved", submissionStatus: "submitted",
    administrativeBackfill: { recordedBy: admin.membershipId, evidenceExempt: true } });
  expect(await db.select().from(attachments)).toHaveLength(0);
  const versions = await db.select().from(workSessionVersions);
  expect(versions).toHaveLength(2);
  expect(versions.every((version) => version.changedBy === admin.membershipId && version.changeReason?.includes("管理员补录"))).toBe(true);
  const audit = await db.select().from(auditLogs);
  expect(audit).toHaveLength(2);
  expect(audit.every((entry) => entry.actorMembershipId === admin.membershipId && entry.action === "work_session.admin_backfilled" && entry.requestId === "backfill-test")).toBe(true);
  expect((await db.select().from(approvalRequests)).every((request) => request.status === "approved" && request.requestedBy === admin.membershipId)).toBe(true);
  expect((await db.select().from(approvalActions)).every((action) => action.actorMembershipId === admin.membershipId && action.action === "management_corrected")).toBe(true);
  expect(await work.listOwn(employee, 10, { recordKind: "fact" })).toHaveLength(1);
  const context = await new WorkLifecycleService(db, new AnalyticsService(db)).context(employee, sessions.find((session) => session.membershipId === employee.membershipId)!.id);
  expect(context?.evidenceSummary).toEqual({ total: 0, verified: 0, exempt: true });
  expect(context?.reasons.some((reason) => reason.includes("缺少"))).toBe(false);
  await expect(work.createAdminBackfill(admin, input(employee.membershipId, other.membershipId))).rejects.toThrow("已有工时");
  expect(await db.select().from(workSessions)).toHaveLength(2);
});

it("uses the actual target employee and department scope, rejecting self, inactive, foreign and project-only targets", async () => {
  const { db, admin, employee, other, work } = await fixture();
  const [unit] = await db.insert(orgUnits).values({ organizationId: admin.organizationId, name: "开发部门" }).returning();
  await db.update(orgMemberships).set({ orgUnitId: unit!.id }).where(eq(orgMemberships.id, employee.membershipId));
  const scoped: AuthContext = { ...admin, grants: [{ permission: "work.review", scopeKind: "org_unit", scopeId: unit!.id }] };
  expect((await work.listBackfillMembers(scoped)).map((member) => member.membershipId)).toEqual([employee.membershipId]);
  await expect(work.createAdminBackfill(scoped, input(employee.membershipId, other.membershipId))).rejects.toThrow("授权范围");
  await expect(work.createAdminBackfill(admin, input(admin.membershipId))).rejects.toThrow("其他在职员工");
  await expect(work.createAdminBackfill(employee, input(other.membershipId))).rejects.toThrow("管理员");
  await expect(work.createAdminBackfill({ ...admin, grants: [{ permission: "work.review", scopeKind: "project", scopeId: crypto.randomUUID() }] }, input(employee.membershipId))).rejects.toThrow("管理员");
  await db.update(orgMemberships).set({ status: "inactive" }).where(eq(orgMemberships.id, other.membershipId));
  await expect(work.createAdminBackfill(admin, input(other.membershipId))).rejects.toThrow("在职员工");
  const [foreignOrg] = await db.insert(organizations).values({ name: "其他组织" }).returning();
  const [foreign] = await db.insert(orgMemberships).values({ organizationId: foreignOrg!.id, userId: other.userId, status: "active" }).returning();
  await expect(work.createAdminBackfill(admin, input(employee.membershipId, foreign!.id))).rejects.toThrow("授权范围");
  expect(await db.select().from(workSessions)).toHaveLength(0);
  expect(await work.createAdminBackfill(scoped, input(employee.membershipId))).toHaveLength(1);
});

it("rolls back the entire batch when a later employee overlaps, and rejects future work", async () => {
  const { db, admin, employee, other, work } = await fixture();
  const ids = [employee.membershipId, other.membershipId].sort();
  await work.createAdminBackfill(admin, input(ids[1]!));
  await expect(work.createAdminBackfill(admin, input(...ids))).rejects.toThrow("本次补录未保存任何记录");
  expect(await db.select().from(workSessions)).toHaveLength(1);
  expect(await db.select().from(auditLogs)).toHaveLength(1);
  expect(await db.select().from(approvalRequests)).toHaveLength(1);
  await expect(work.createAdminBackfill(admin, { ...input(ids[0]!), endAt: "2026-09-23T10:00:00Z" })).rejects.toThrow("已经结束");
});

it("protects locked and settled payroll periods, including intervals crossing the boundary", async () => {
  const { db, admin, employee, work } = await fixture();
  const period = await new PayrollService(db).createPeriod(admin, { name: "已关闭周期", timezone: "UTC", startsAt: new Date("2026-09-01T09:00:00Z"), endsAt: new Date("2026-09-02T00:00:00Z"), cutoffAt: new Date("2026-09-03T00:00:00Z") });
  for (const status of ["locked", "settled"] as const) {
    await db.update(payPeriods).set({ status }).where(eq(payPeriods.id, period.id));
    await expect(work.createAdminBackfill(admin, input(employee.membershipId))).rejects.toThrow("已锁定或已结算");
  }
  expect(await db.select().from(workSessions)).toHaveLength(0);
});

it("includes confirmed backfill in normal payroll calculation", async () => {
  const { db, admin, employee, work } = await fixture();
  const [plan] = await db.insert(compensationPlans).values({ organizationId: admin.organizationId, membershipId: employee.membershipId, name: "时薪", type: "hourly", currency: "CNY", createdBy: admin.membershipId }).returning();
  await db.insert(compensationPlanVersions).values({ compensationPlanId: plan!.id, version: 1, type: "hourly", baseAmount: "100", baseUnit: "hour", effectiveFrom: new Date("2026-08-01T00:00:00Z"), createdBy: admin.membershipId });
  const payroll = new PayrollService(db);
  const period = await payroll.createPeriod(admin, { name: "九月", timezone: "UTC", startsAt: new Date("2026-09-01T00:00:00Z"), endsAt: new Date("2026-10-01T00:00:00Z"), cutoffAt: new Date("2026-10-05T00:00:00Z") });
  await work.createAdminBackfill(admin, input(employee.membershipId));
  const run = await payroll.calculate(admin, period.id);
  const [item] = await db.select().from(payrollItems).where(eq(payrollItems.payrollRunId, run.id));
  expect(item).toMatchObject({ membershipId: employee.membershipId, approvedSeconds: 7200, pendingSeconds: 0 });
  expect(Number(item!.finalAmount)).toBe(200);
});

it("exposes the guarded member picker and POST route while ordinary members cannot use either", async () => {
  const { admin, employee, work } = await fixture();
  let actor = employee;
  const app = Fastify(); app.decorate("csrfProtection", async () => {});
  await registerWorkRoutes(app, work, async (request) => { request.auth = actor; });
  try {
    expect((await app.inject({ method: "GET", url: "/api/work-sessions/admin-backfill/members" })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/work-sessions/admin-backfill", payload: input(employee.membershipId) })).statusCode).toBe(403);
    actor = admin;
    const members = await app.inject({ method: "GET", url: "/api/work-sessions/admin-backfill/members" });
    expect(members.statusCode).toBe(200); expect(members.json().items).toHaveLength(2);
    const saved = await app.inject({ method: "POST", url: "/api/work-sessions/admin-backfill", payload: input(employee.membershipId) });
    expect(saved.statusCode).toBe(201); expect(saved.json().sessions[0].approvalStatus).toBe("approved");
    expect((await app.inject({ method: "POST", url: "/api/work-sessions/admin-backfill", payload: input(employee.membershipId) })).statusCode).toBe(409);
  } finally { await app.close(); }
});
