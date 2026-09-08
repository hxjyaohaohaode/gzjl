import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Database } from "@workbench/db";
import { attachments, compensationPlans, compensationPlanVersions, notifications, organizations, orgMemberships, payPeriods, payrollAdjustments, payrollItems, payrollItemComponents, users, workSessions } from "@workbench/db/schema";
import type { AuthContext } from "../auth/service.js";
import { loadServerConfig } from "../config.js";
import { EvidenceService } from "../evidence/service.js";
import { PayrollService } from "./service.js";
import { ReimbursementService } from "./reimbursements.js";

const clients: PGlite[] = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-08T12:00:00Z")); });
afterEach(async () => { vi.useRealTimers(); await Promise.all(clients.splice(0).map((client) => client.close())); });

async function fixture() {
  const pg = new PGlite(); clients.push(pg);
  const directory = resolve(import.meta.dirname, "../../../../packages/db/drizzle");
  for (const name of (await readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort()) {
    for (const statement of (await readFile(resolve(directory, name), "utf8")).split("--> statement-breakpoint").filter((value) => value.trim())) await pg.exec(statement);
  }
  const db = drizzle(pg) as unknown as Database;
  const [org] = await db.insert(organizations).values({ name: "费用测试", timezone: "UTC" }).returning();
  const people = await db.insert(users).values([{ displayName: "申请人" }, { displayName: "审批人" }]).returning();
  const members = await db.insert(orgMemberships).values(people.map((person) => ({ organizationId: org!.id, userId: person.id, status: "active" as const }))).returning();
  const actors = members.map((member, index): AuthContext => ({ userId: people[index]!.id, membershipId: member.id,
    organizationId: org!.id, displayName: people[index]!.displayName, timezone: "UTC", isOwner: false,
    grants: index === 1 ? [{ permission: "payroll.settle", scopeKind: "organization", scopeId: null }] : [] }));
  const [plan] = await db.insert(compensationPlans).values({ organizationId: org!.id, membershipId: members[0]!.id, name: "计薪", type: "hourly", currency: "CNY", createdBy: members[1]!.id }).returning();
  const [version] = await db.insert(compensationPlanVersions).values({ compensationPlanId: plan!.id, version: 1,
    type: "hourly", baseAmount: "100", baseUnit: "hour", effectiveFrom: new Date("2026-09-01Z"), createdBy: members[1]!.id }).returning();
  const [period] = await db.insert(payPeriods).values({ organizationId: org!.id, name: "九月", timezone: "UTC",
    startsAt: new Date("2026-09-01Z"), endsAt: new Date("2026-10-01Z"), cutoffAt: new Date("2026-10-05Z") }).returning();
  const config = loadServerConfig({ NODE_ENV: "test", SESSION_SECRET: "test-secret-that-is-at-least-thirty-two-bytes", DATABASE_URL: "postgresql://test:test@localhost:5432/test" });
  return { db, employee: actors[0]!, reviewer: actors[1]!, period: period!, version: version!, expense: new ReimbursementService(db), evidence: new EvidenceService(db, config), payroll: new PayrollService(db) };
}

it("freezes submitted evidence, rejects self approval and accounts an expense exactly once through settlement", async () => {
  const { db, employee, reviewer, period, expense, evidence, payroll } = await fixture();
  const claim = await expense.create(employee, { title: "交通费", description: "客户现场交通支出", expenseDate: "2026-09-03", amount: "128.35", currency: "CNY" });
  await expect(expense.act(employee, claim.id, { action: "submit", expectedVersion: 1 })).rejects.toThrow("凭证");
  const proof = await evidence.createReference(employee, claim.id, { kind: "text", textContent: "发票号 TEST-001；金额 128.35", visibility: "management_only" });
  const submitted = await expense.act(employee, claim.id, { action: "submit", expectedVersion: 1 });
  expect(await evidence.listForSession(reviewer, claim.id)).toEqual(expect.arrayContaining([expect.objectContaining({ textContent: "发票号 TEST-001；金额 128.35" })]));
  await expect(evidence.remove(employee, proof.attachment.id, "试图修改")).rejects.toThrow("冻结");
  await expect(db.update(attachments).set({ textContent: "换票" }).where(eq(attachments.id, proof.attachment.id))).rejects.toThrow();
  await expect(expense.act({ ...employee, grants: reviewer.grants }, claim.id, { action: "approve", expectedVersion: submitted.version, payPeriodId: period.id })).rejects.toThrow("不能审批自己的报销");
  await expense.act(reviewer, claim.id, { action: "approve", expectedVersion: submitted.version, payPeriodId: period.id });
  await expect(expense.act(reviewer, claim.id, { action: "approve", expectedVersion: submitted.version, payPeriodId: period.id })).rejects.toThrow("已变化");
  expect(await db.select().from(payrollAdjustments)).toHaveLength(1);
  expect(await db.select().from(notifications)).toHaveLength(1);
  expect((await payroll.listOwn(employee)).livePreview).toMatchObject({ approvedReimbursementAmount: "128.350000", estimatedAmount: "128.350000", approvedSeconds: 0 });
  const run = await payroll.calculate(reviewer, period.id);
  expect((await db.select().from(payrollItems))[0]).toMatchObject({ grossAmount: "0.000000", adjustmentAmount: "128.350000", finalAmount: "128.350000" });
  await payroll.settle(reviewer, run.id);
  expect((await expense.list(employee)).items[0]).toMatchObject({ status: "approved", periodStatus: "locked" });
  const otherOrg = { ...employee, organizationId: "00000000-0000-4000-8000-000000000999" };
  expect((await expense.list(otherOrg)).items).toEqual([]);
  await expect(evidence.listForSession(otherOrg, claim.id)).rejects.toThrow("不存在");
});

it("keeps review-visible work evidence readable after approval without exposing private evidence", async () => {
  const { db, employee, reviewer, evidence } = await fixture();
  const [work] = await db.insert(workSessions).values({ organizationId: employee.organizationId, membershipId: employee.membershipId,
    startAt: new Date("2026-09-03T08:00Z"), endAt: new Date("2026-09-03T09:00Z"), timezone: "UTC",
    grossSeconds: 3600, netSeconds: 3600, source: "manual", content: "工作证据核对", result: "完成",
    approvalStatus: "approved", submissionStatus: "submitted", visibility: "management_only" }).returning();
  await evidence.createReference(employee, work!.id, { kind: "text", textContent: "审批后仍需可读的交付结果", visibility: "management_only" });
  await evidence.createReference(employee, work!.id, { kind: "text", textContent: "本人私密备忘", visibility: "private" });
  const workReviewer = { ...reviewer, grants: [{ permission: "work.review" as const, scopeKind: "organization" as const, scopeId: null }] };
  expect(await evidence.listForSession(workReviewer, work!.id)).toEqual([expect.objectContaining({ textContent: "审批后仍需可读的交付结果" })]);
});

it("prorates daily subsidies but pays a period-end subsidy only from the final effective version", async () => {
  const { db, reviewer, period, version, payroll } = await fixture();
  await db.update(compensationPlanVersions).set({ effectiveTo: new Date("2026-09-16Z"), config: { subsidies: [
    { name: "交通", amount: "300", distribution: "daily" }, { name: "月末", amount: "100", distribution: "period_end" },
  ] } }).where(eq(compensationPlanVersions.id, version.id));
  await db.insert(compensationPlanVersions).values({ compensationPlanId: version.compensationPlanId, version: 2, type: "hourly", baseAmount: "100", baseUnit: "hour",
    effectiveFrom: new Date("2026-09-16Z"), createdBy: reviewer.membershipId,
    config: { subsidies: [{ name: "交通", amount: "600", distribution: "daily" }, { name: "月末", amount: "200", distribution: "period_end" }] } });
  await payroll.calculate(reviewer, period.id);
  expect((await db.select().from(payrollItems))[0]).toMatchObject({ grossAmount: "650.000000" });
  const components = await db.select().from(payrollItemComponents);
  expect(components.filter((item) => item.label === "交通").map((item) => item.amount)).toEqual(["150.000000", "300.000000"]);
  expect(components.filter((item) => item.label === "月末").map((item) => item.amount)).toEqual(["0.000000", "200.000000"]);
});
