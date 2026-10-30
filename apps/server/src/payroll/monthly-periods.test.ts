import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, and, ne } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import type { Database } from "@workbench/db";
import { organizations, organizationOwners, orgMemberships, users, workSessions, payPeriods, payrollRuns, payrollItems, payrollItemComponents, payrollAdjustments, reimbursementRequests } from "@workbench/db/schema";
import { addDecimalAmounts } from "@workbench/shared";
import type { AuthContext } from "../auth/service.js";
import { ensureMonthlyPeriods, monthlyPeriod } from "./monthly-periods.js";
import { PayrollService } from "./service.js";
import { ReimbursementService } from "./reimbursements.js";
import { PayrollHandoffService } from "./handoff.js";
import { synchronizePayroll } from "./automation.js";

const clients: PGlite[] = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(clients.splice(0).map((client) => client.close())); });

it.each([
  ["2024-02-15T12:00Z", "Asia/Shanghai", "2024-01-31T16:00:00.000Z", "2024-02-29T16:00:00.000Z"],
  ["2026-12-31T12:00Z", "UTC", "2026-12-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"],
  ["2026-03-15T12:00Z", "America/Los_Angeles", "2026-03-01T08:00:00.000Z", "2026-04-01T07:00:00.000Z"],
  ["2026-11-15T12:00Z", "America/Los_Angeles", "2026-11-01T07:00:00.000Z", "2026-12-01T08:00:00.000Z"],
])("uses exact local month boundaries for %s in %s", (now, timezone, from, to) => {
  const period = monthlyPeriod(new Date(now), timezone);
  expect(period.startsAt.toISOString()).toBe(from);
  expect(period.endsAt.toISOString()).toBe(to);
  expect(period.cutoffAt).toEqual(period.endsAt);
  expect(monthlyPeriod(period.endsAt, timezone).startsAt).toEqual(period.endsAt);
});

async function fixture() {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-30T23:59:59.999Z"));
  const client = new PGlite(); clients.push(client);
  const directory = resolve(import.meta.dirname, "../../../../packages/db/drizzle");
  for (const file of (await readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort()) {
    for (const statement of (await readFile(resolve(directory, file), "utf8")).split("--> statement-breakpoint").filter((value) => value.trim())) await client.exec(statement);
  }
  const db = drizzle(client) as unknown as Database;
  const [org] = await db.insert(organizations).values({ name: "自动薪资", timezone: "UTC" }).returning();
  const people = await db.insert(users).values([{ displayName: "负责人" }, { displayName: "员工" }]).returning();
  const members = await db.insert(orgMemberships).values(people.map((user) => ({ organizationId: org!.id, userId: user.id, status: "active" as const, joinedAt: new Date("2026-09-01Z") }))).returning();
  await db.insert(organizationOwners).values({ organizationId: org!.id, membershipId: members[0]!.id });
  const actors = members.map((member, i): AuthContext => ({ organizationId: org!.id, membershipId: member.id, userId: people[i]!.id, displayName: people[i]!.displayName, timezone: "UTC", isOwner: i === 0, grants: i === 0 ? [{ permission: "payroll.settle", scopeKind: "organization", scopeId: null }] : [] }));
  return { db, owner: actors[0]!, employee: actors[1]!, payroll: new PayrollService(db), expense: new ReimbursementService(db) };
}

it("automatically closes months, prices each second exactly once and refreshes approved reimbursements without duplicate batches", async () => {
  const { db, owner, employee, payroll, expense } = await fixture();
  const plan = { membershipId: employee.membershipId, name: "分段时薪", type: "hourly" as const, currency: "CNY", pendingReviewCountsInEstimate: false, rules: [], subsidies: [{ name: "固定补贴", amount: "168.19" }] };
  await payroll.configurePlan(owner, { ...plan, baseAmount: "36", effectiveFrom: new Date("2026-09-01Z") });
  await payroll.configurePlan(owner, { ...plan, baseAmount: "72", effectiveFrom: new Date("2026-09-15Z") });
  await db.insert(workSessions).values([
    { startAt: new Date("2026-09-14T23:59:59Z"), endAt: new Date("2026-09-15T00:00:01Z") },
    { startAt: new Date("2026-09-30T23:59:59Z"), endAt: new Date("2026-10-01T00:00:01Z") },
  ].map((time) => ({ ...time, organizationId: owner.organizationId, membershipId: employee.membershipId, timezone: "UTC", source: "manual" as const, grossSeconds: 2, netSeconds: 2, content: "分段边界", approvalStatus: "approved" as const, submissionStatus: "submitted" as const })));
  const listed = await expense.list(owner);
  const september = listed.periods.find((period) => period.startsAt.toISOString() === "2026-09-01T00:00:00.000Z")!;
  expect(september.automatic).toBe(true);
  await payroll.synchronizeMonthly(owner);
  expect(await db.select().from(payrollRuns)).toHaveLength(0);
  await expect(payroll.calculate(owner, september.id)).rejects.toThrow("尚未结束");
  vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
  const report = vi.fn(); await synchronizePayroll(db, report);
  expect(report).not.toHaveBeenCalled();
  const [run] = await db.select().from(payrollRuns);
  expect(run!.status).toBe("ready");
  const [item] = await db.select().from(payrollItems).where(eq(payrollItems.payrollRunId, run!.id));
  expect(item).toMatchObject({ approvedSeconds: 3, grossAmount: "168.240000", finalAmount: "168.240000" });
  const components = await db.select().from(payrollItemComponents).where(eq(payrollItemComponents.payrollItemId, item!.id));
  expect(addDecimalAmounts(...components.map((component) => component.amount))).toBe(item!.finalAmount);
  await synchronizePayroll(db, report); await payroll.synchronizeMonthly(owner);
  expect(await db.select().from(payrollRuns)).toHaveLength(1);
  expect((await expense.list(owner)).periods.map((period) => period.id)).toContain(september.id);
  const claim = await expense.create(employee, { title: "零点后补充报销", description: "应入九月的费用", expenseDate: "2026-09-30", amount: "0.105", currency: "CNY" });
  await db.update(reimbursementRequests).set({ status: "pending" }).where(eq(reimbursementRequests.id, claim.id));
  await expense.act(owner, claim.id, { action: "approve", expectedVersion: claim.version, payPeriodId: september.id });
  await expect(expense.act(owner, claim.id, { action: "approve", expectedVersion: claim.version, payPeriodId: september.id })).rejects.toThrow("已变化");
  expect((await db.select().from(payrollRuns).where(eq(payrollRuns.id, run!.id)))[0]!.status).toBe("cancelled");
  await expect(payroll.settle(owner, run!.id)).rejects.toThrow();
  await synchronizePayroll(db, report);
  const active = await db.select().from(payrollRuns).where(and(eq(payrollRuns.payPeriodId, september.id), ne(payrollRuns.status, "cancelled")));
  expect(active).toHaveLength(1);
  const current = active[0]!;
  expect((await db.select().from(payrollItems).where(eq(payrollItems.payrollRunId, current.id)))[0]).toMatchObject({ finalAmount: "168.350000", adjustmentAmount: "0.110000" });
  expect(await db.select().from(payrollAdjustments)).toHaveLength(1);
  const handoff = new PayrollHandoffService(db);
  const preview = await handoff.preview(owner, current.id);
  expect(preview.blockers).toEqual([]);
  await handoff.confirm(owner, current.id, preview.previewHash);
  expect((await expense.list(owner)).periods.map((period) => period.id)).not.toContain(september.id);
  vi.setSystemTime(new Date("2026-11-01Z"));
  await synchronizePayroll(db, report);
  const october = (await db.select().from(payPeriods)).find((period) => period.name === "2026-10 薪资")!;
  const octoberRun = (await db.select().from(payrollRuns).where(eq(payrollRuns.payPeriodId, october.id)))[0]!;
  expect((await db.select().from(payrollItems).where(eq(payrollItems.payrollRunId, octoberRun.id)))[0]).toMatchObject({ approvedSeconds: 1, grossAmount: "168.210000", adjustmentAmount: "0.000000" });
  expect((await db.select().from(payrollRuns).where(eq(payrollRuns.id, current.id)))[0]!.status).toBe("settled");
});

it("creates the current month without a plan and preserves overlapping historical periods", async () => {
  const { db, owner, payroll } = await fixture();
  const legacy = await payroll.createPeriod(owner, { name: "旧自定义周期", timezone: "UTC", startsAt: new Date("2026-08-15Z"), endsAt: new Date("2026-09-15Z"), cutoffAt: new Date("2026-09-16Z") });
  const issues = await ensureMonthlyPeriods(db, owner.organizationId);
  expect(issues).toHaveLength(2);
  expect(await db.select().from(payPeriods)).toEqual([legacy]);
  vi.setSystemTime(new Date("2026-11-02Z"));
  await ensureMonthlyPeriods(db, owner.organizationId);
  await ensureMonthlyPeriods(db, owner.organizationId);
  expect((await db.select().from(payPeriods)).map((period) => period.name).sort()).toEqual(["2026-10 薪资", "2026-11 薪资", "旧自定义周期"].sort());
});

it("retries a missing plan and blocks confirmation until pending work is reviewed", async () => {
  const { db, owner, employee, payroll } = await fixture();
  await Promise.all([ensureMonthlyPeriods(db, owner.organizationId), ensureMonthlyPeriods(db, owner.organizationId)]);
  expect(await db.select().from(payPeriods)).toHaveLength(1);
  vi.setSystemTime(new Date("2026-10-01Z"));
  expect(await payroll.synchronizeMonthly(owner)).toEqual([expect.objectContaining({ message: expect.stringContaining("没有生效的薪资方案") })]);
  await payroll.configurePlan(owner, { membershipId: employee.membershipId, name: "恢复方案", type: "hourly", baseAmount: "10", currency: "CNY", effectiveFrom: new Date("2026-09-01Z"), pendingReviewCountsInEstimate: true, rules: [] });
  const [work] = await db.insert(workSessions).values({ organizationId: owner.organizationId, membershipId: employee.membershipId, startAt: new Date("2026-09-15T01:00Z"), endAt: new Date("2026-09-15T02:00Z"), grossSeconds: 3600, netSeconds: 3600, source: "manual", timezone: "UTC", content: "待审核工作", approvalStatus: "pending_review", submissionStatus: "submitted" }).returning();
  await payroll.synchronizeMonthly(owner);
  const [pending] = await db.select().from(payrollRuns);
  const handoff = new PayrollHandoffService(db);
  const preview = await handoff.preview(owner, pending!.id);
  expect(preview.blockers.join(" ")).toMatch(/待审|复核/);
  await expect(handoff.confirm(owner, pending!.id, preview.previewHash)).rejects.toThrow();
  await db.update(workSessions).set({ approvalStatus: "approved", version: 2 }).where(eq(workSessions.id, work!.id));
  await payroll.synchronizeMonthly(owner);
  const active = await db.select().from(payrollRuns).where(ne(payrollRuns.status, "cancelled"));
  expect(active).toHaveLength(1);
  expect(active[0]!.status).toBe("ready");
  expect((await db.select().from(payrollItems).where(eq(payrollItems.payrollRunId, active[0]!.id)))[0]!.finalAmount).toBe("10.000000");
});
