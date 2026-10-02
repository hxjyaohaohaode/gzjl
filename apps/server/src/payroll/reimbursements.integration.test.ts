import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Database } from "@workbench/db";
import { attachments, compensationPlans, compensationPlanVersions, notifications, organizations, orgMemberships, payPeriods, payrollAdjustments, payrollItems, payrollItemComponents, payrollRuns, payrollExportBatches, reimbursementRequests, users, workSessions } from "@workbench/db/schema";
import type { AuthContext } from "../auth/service.js";
import { loadServerConfig } from "../config.js";
import { EvidenceService } from "../evidence/service.js";
import { PayrollService } from "./service.js";
import { ReimbursementService } from "./reimbursements.js";
import { PayrollHandoffService } from "./handoff.js";
import { capturePayrollWorkbook } from "./bundle.js";
import ExcelJS from "exceljs";
import { addDecimalAmounts, prorateDecimalAmount } from "@workbench/shared";

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

it("keeps an approver's personal claims separate from other members and excludes self-approval from the queue", async () => {
  const { db, employee, reviewer, expense } = await fixture();
  const input = { title: "现场交通", description: "真实交通凭证", expenseDate: "2026-09-08", amount: "28.50", currency: "CNY" };
  const own = await expense.create(reviewer, input);
  const other = await expense.create(employee, input);
  const privateDraft = await expense.create(employee, input);
  for (const request of [own, other]) await db.update(reimbursementRequests).set({ status: "pending" }).where(eq(reimbursementRequests.id, request.id));

  const personal = await expense.list(reviewer, { ownOnly: true });
  expect(personal.items.map((item) => item.id)).toEqual([own.id]);
  expect(personal.canReview).toBe(false);
  expect(personal.periods).toEqual([]);
  expect((await expense.list(reviewer, { ownOnly: true, id: other.id })).items).toEqual([]);
  const queue = await expense.list(reviewer, { pendingOnly: true });
  expect(queue.items.map((item) => item.id)).toEqual([other.id]);
  expect(queue.canReview).toBe(true);
  expect((await expense.list(reviewer)).items.map((item) => item.id)).not.toContain(privateDraft.id);
  expect((await expense.list(employee, { ownOnly: false, id: own.id })).items).toEqual([]);
  for (const request of [own, other]) await db.update(reimbursementRequests).set({ status: "rejected", reviewNote: "补充凭证后重新提交" }).where(eq(reimbursementRequests.id, request.id));
  expect((await expense.list(reviewer, { pendingOnly: true })).items).toEqual([]);
  const history = await expense.list(reviewer, { reviewedOnly: true, from: "2026-09-01", to: "2026-10-01" });
  expect(history.items.map((item) => item.id)).toEqual([other.id]);
  expect(history.items[0]?.reviewNote).toBe("补充凭证后重新提交");
  expect((await expense.list(reviewer, { reviewedOnly: true, from: "2026-08-01", to: "2026-09-01" })).items).toEqual([]);
});

it.each([
  [143_992, "177.533370"], [143_886, "177.526492"],
])("reproduces the reported %s-second subsidy change and prevents %s instead of 168.19", async (seconds, oldIncorrectAmount) => {
  const { db, employee, reviewer, period, version, payroll } = await fixture();
  const transition = new Date(period.startsAt.getTime() + seconds * 1000);
  expect(addDecimalAmounts("168.19", prorateDecimalAmount("168.19", seconds, 30 * 86400)))
    .toBe(oldIncorrectAmount);
  await db.update(compensationPlanVersions).set({ effectiveTo: transition,
    config: { subsidies: [{ name: "统一补贴", amount: "168.19", distribution: "daily" }] },
  }).where(eq(compensationPlanVersions.id, version.id));
  await db.insert(compensationPlanVersions).values({ compensationPlanId: version.compensationPlanId,
    version: 2, type: "hourly", baseAmount: "100", baseUnit: "hour", createdBy: reviewer.membershipId,
    effectiveFrom: transition, config: { subsidies: [{ name: "统一补贴", amount: "168.19", distribution: "period_end" }] },
  });
  await db.update(compensationPlans).set({ activeVersion: 2 }).where(eq(compensationPlans.id, version.compensationPlanId));
  const preview = (await payroll.listOwn(employee)).livePreview!;
  expect(preview).toMatchObject({ subsidyTotal: "168.190000", estimatedAmount: "168.190000" });
  const run = await payroll.calculate(reviewer, period.id);
  const [item] = await db.select().from(payrollItems).where(eq(payrollItems.payrollRunId, run.id));
  expect(item).toMatchObject({ grossAmount: "168.190000", finalAmount: "168.190000" });
  const components = await db.select().from(payrollItemComponents).where(eq(payrollItemComponents.payrollItemId, item!.id));
  expect(components.filter((component) => component.type === "allowance")).toHaveLength(1);
  expect(components.find((component) => component.type === "allowance")!.calculationTrace).toMatchObject({
    distribution: "period_end", rounding: { policy: "category_half_up_2_decimals_largest_remainder", roundedAmount: "168.19" },
  });
});

it("rounds the reported base salary to cents and reconciles preview, components and workbook", async () => {
  const { db, employee, reviewer, period, version, payroll } = await fixture();
  await db.update(compensationPlanVersions).set({ type: "monthly", baseAmount: "2866.920833", baseUnit: "month",
    config: { subsidies: [{ name: "统一补贴", amount: "168.19", distribution: "period_end" }] },
  }).where(eq(compensationPlanVersions.id, version.id));
  const preview = (await payroll.listOwn(employee)).livePreview!;
  expect(preview).toMatchObject({ subsidyTotal: "168.190000", estimatedAmount: "3035.110000" });
  const run = await payroll.calculate(reviewer, period.id);
  const handoff = await new PayrollHandoffService(db).preview(reviewer, run.id);
  expect(handoff.rows[0]).toMatchObject({ grossAmount: "3035.110000", finalAmount: "3035.110000",
    amounts: { wages: "2866.920000", subsidies: "168.190000" } });
  const bundle = await capturePayrollWorkbook(db, reviewer, handoff, "九月.csv");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(bundle.workbookBase64, "base64") as unknown as Parameters<typeof book.xlsx.load>[0]);
  expect(book.getWorksheet("薪资总览")!.getCell("K2").value).toBe("2866.92");
  expect(book.getWorksheet("薪资总览")!.getCell("M2").value).toBe("168.19");
  expect(book.getWorksheet("薪资总览")!.getCell("R2").value).toBe("3035.11");
});

it.each(["full_month", "boss_custom_range"] as const)("keeps individually configured legacy 168.19 benefits identical across all plan types in %s", async (range) => {
  const { db, reviewer, period, payroll } = await fixture();
  if (range === "boss_custom_range") {
    period.startsAt = new Date("2026-09-05T00:00Z"); period.endsAt = new Date("2026-09-25T00:00Z");
    await db.update(payPeriods).set({ startsAt: period.startsAt, endsAt: period.endsAt }).where(eq(payPeriods.id, period.id));
  }
  const scenarios = (["hourly", "daily", "monthly", "fixed_period", "project_based", "hybrid"] as const)
    .flatMap((type, index) => ([undefined, "daily", "period_end"] as const).map((distribution, offset) => ({ type, distribution,
      effectiveFrom: new Date(period.startsAt.getTime() + (index + offset) * 86400_000) })));
  const ids: string[] = [];
  for (const [index, scenario] of scenarios.entries()) {
    const [person] = await db.insert(users).values({ displayName: `单独设置补贴 ${index}` }).returning();
    const [member] = await db.insert(orgMemberships).values({ organizationId: reviewer.organizationId, userId: person!.id, status: "active" }).returning();
    ids.push(member!.id);
    const [plan] = await db.insert(compensationPlans).values({ organizationId: reviewer.organizationId, membershipId: member!.id,
      name: "独立计薪方案", type: scenario.type, currency: "CNY", createdBy: reviewer.membershipId }).returning();
    await db.insert(compensationPlanVersions).values({ compensationPlanId: plan!.id, version: 1, type: scenario.type,
      baseAmount: "0", baseUnit: "period", effectiveFrom: scenario.effectiveFrom, createdBy: reviewer.membershipId,
      config: { fixedAmount: "0", subsidies: [{ name: "每人独立设置的补贴", amount: "168.19", ...(scenario.distribution ? { distribution: scenario.distribution } : {}) }] } });
    const live = (await payroll.listOwn({ ...reviewer, membershipId: member!.id })).livePreview!;
    expect(live).toMatchObject({ subsidyTotal: "168.190000", estimatedAmount: "168.190000" });
    expect(live.subsidies).toHaveLength(1);
    expect(live.subsidies[0]).toMatchObject({ configuredAmount: "168.19", amount: "168.19", distribution: "period_end" });
  }
  const run = await payroll.calculate(reviewer, period.id);
  const overview = await new PayrollHandoffService(db).preview(reviewer, run.id);
  const rows = overview.rows.filter((row) => ids.includes(row.membershipId));
  expect(rows).toHaveLength(scenarios.length);
  for (const row of rows) expect(row).toMatchObject({ grossAmount: "168.190000", finalAmount: "168.190000", amounts: { subsidies: "168.190000" } });
  const components = await db.select({ memberId: payrollItems.membershipId, component: payrollItemComponents })
    .from(payrollItems).innerJoin(payrollItemComponents, eq(payrollItems.id, payrollItemComponents.payrollItemId))
    .where(eq(payrollItems.payrollRunId, run.id));
  for (const [index, id] of ids.entries()) {
    const benefits = components.filter((row) => row.memberId === id && row.component.type === "allowance");
    expect(benefits).toHaveLength(1);
    expect(benefits[0]!.component.calculationTrace).toMatchObject({ configuredDistribution: scenarios[index]!.distribution ?? "legacy_default",
      distribution: "period_end", subsidyPolicy: "fixed_configured_amount_once_per_cycle_v10" });
  }
  const capture = await capturePayrollWorkbook(db, reviewer, overview, "独立补贴.csv");
  const book = new ExcelJS.Workbook(); await book.xlsx.load(Buffer.from(capture.workbookBase64, "base64") as unknown as Parameters<typeof book.xlsx.load>[0]);
  const sheet = book.worksheets[0]!;
  expect(sheet.name).toBe("薪资总览"); expect(book.worksheets[1]!.name).toBe("周期工作记录");
  for (let index = 2; index <= sheet.rowCount; index++) if (ids.includes(String(sheet.getCell(index, 1).value))) {
    expect(sheet.getCell(index, 13).value).toBe("168.19"); expect(sheet.getCell(index, 18).value).toBe("168.19");
  }
});

it("uses the last configured amount once when legacy daily settings change and only prorates explicit opt-ins", async () => {
  const { db, employee, reviewer, period, version, payroll } = await fixture();
  await db.update(compensationPlanVersions).set({ effectiveTo: new Date("2026-09-16Z"), baseAmount: "0",
    config: { subsidies: [{ name: "个人补贴", amount: "168.19", distribution: "daily" }] },
  }).where(eq(compensationPlanVersions.id, version.id));
  await db.insert(compensationPlanVersions).values({ compensationPlanId: version.compensationPlanId, version: 2,
    type: "hourly", baseAmount: "0", baseUnit: "hour", createdBy: reviewer.membershipId, effectiveFrom: new Date("2026-09-16Z"),
    config: { subsidies: [{ name: "个人补贴", amount: "200.01", distribution: "daily" },
      { name: "自愿折算项目", amount: "168.19", distribution: "prorated" }] },
  });
  await db.update(compensationPlans).set({ activeVersion: 2 }).where(eq(compensationPlans.id, version.compensationPlanId));
  const live = (await payroll.listOwn(employee)).livePreview!;
  expect(live.subsidies).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: "个人补贴", amount: "200.01", distribution: "period_end" }),
    expect.objectContaining({ name: "自愿折算项目", amount: "84.10", distribution: "prorated" }),
  ]));
  expect(live.subsidies).toHaveLength(2); expect(live.subsidyTotal).toBe("284.110000");
  const run = await payroll.calculate(reviewer, period.id);
  const preview = await new PayrollHandoffService(db).preview(reviewer, run.id);
  expect(preview.rows[0]!.amounts!.subsidies).toBe("284.110000");
});

it.each([undefined, "daily", "period_end", "prorated"] as const)("saves ordinary %s settings as fixed while preserving explicit proration", async (distribution) => {
  const { employee, reviewer, payroll } = await fixture();
  const saved = await payroll.configurePlan(reviewer, { membershipId: employee.membershipId, name: "每人单独设置",
    type: "hourly", currency: "CNY", baseAmount: "100", effectiveFrom: new Date("2026-09-08Z"),
    pendingReviewCountsInEstimate: true, rules: [], subsidies: [{ name: "个人补贴", amount: "168.19", ...(distribution ? { distribution } : {}) }],
  });
  expect(saved.version.config).toMatchObject({ subsidies: [{ name: "个人补贴", amount: "168.19", distribution: distribution === "prorated" ? "prorated" : "period_end" }] });
});

it("reconciles category half-cent amounts and negative deductions before saving the final payment", async () => {
  const { db, employee, reviewer, period, version, payroll } = await fixture();
  await db.update(compensationPlanVersions).set({ baseAmount: "10.005",
    config: { subsidies: [{ name: "半分核对补贴", amount: "1.005", distribution: "period_end" }] },
  }).where(eq(compensationPlanVersions.id, version.id));
  await db.insert(workSessions).values({ organizationId: employee.organizationId, membershipId: employee.membershipId,
    startAt: new Date("2026-09-03T08:00:00Z"), endAt: new Date("2026-09-03T09:00:00Z"), timezone: "UTC",
    grossSeconds: 3600, netSeconds: 3600, source: "manual", content: "十进制半分核对事实", approvalStatus: "approved", submissionStatus: "submitted",
  });
  await db.insert(payrollAdjustments).values({ organizationId: employee.organizationId, membershipId: employee.membershipId,
    payPeriodId: period.id, amount: "-0.005", currency: "CNY", reason: "半分扣减核对", createdBy: reviewer.membershipId,
    approvedBy: reviewer.membershipId, approvedAt: new Date(),
  });
  const run = await payroll.calculate(reviewer, period.id);
  const preview = await new PayrollHandoffService(db).preview(reviewer, run.id);
  expect(preview.rows[0]).toMatchObject({ grossAmount: "11.020000", adjustmentAmount: "-0.010000", finalAmount: "11.010000",
    amounts: { wages: "10.010000", subsidies: "1.010000", other: "-0.010000" } });
  const components = await db.select().from(payrollItemComponents);
  expect(addDecimalAmounts(...components.map((component) => component.amount))).toBe("11.010000");
});

it("rejects normalized duplicate benefits in new settings and legacy calculations without partial writes", async () => {
  const { db, employee, reviewer, period, version, payroll } = await fixture();
  const subsidies = [{ name: "补贴Ａ", amount: "168.19", distribution: "period_end" as const },
    { name: "补贴A", amount: "168.19", distribution: "period_end" as const }];
  await expect(payroll.configurePlan(reviewer, { membershipId: employee.membershipId, name: "重复补贴检查",
    type: "hourly", baseAmount: "100", currency: "CNY", rules: [], subsidies,
    effectiveFrom: new Date("2026-09-02Z"), pendingReviewCountsInEstimate: true,
  })).rejects.toThrow("不能重复设置同名补贴");
  expect(await db.select().from(compensationPlanVersions)).toHaveLength(1);
  await db.update(compensationPlanVersions).set({ config: { subsidies } }).where(eq(compensationPlanVersions.id, version.id));
  await expect(payroll.calculate(reviewer, period.id)).rejects.toThrow("同名补贴");
  expect(await db.select().from(payrollItems)).toHaveLength(0);
  expect(await db.select().from(payrollRuns)).toHaveLength(0);
});

it("blocks unconfirmed old calculation rules and rolls back stale report recalculation", async () => {
  const { db, reviewer, period, payroll } = await fixture();
  vi.setSystemTime(new Date("2026-10-08T12:00Z"));
  const run = await payroll.calculate(reviewer, period.id);
  await db.update(payrollRuns).set({ calculationVersion: "payroll-engine-v9-versioned-cent-reconciliation", inputHash: "9".repeat(64) })
    .where(eq(payrollRuns.id, run.id));
  const periodsBefore = await db.select().from(payPeriods);
  const handoff = new PayrollHandoffService(db);
  const preview = await handoff.preview(reviewer, run.id);
  expect(preview.blockers.join(" ")).toContain("旧计算规则");
  await expect(handoff.confirm(reviewer, run.id, preview.previewHash)).rejects.toThrow("旧计算规则");
  await expect(handoff.report(reviewer, run.id)).rejects.toThrow("更新计算并查看");
  expect(await db.select().from(payrollRuns)).toHaveLength(1);
  expect(await db.select().from(payrollExportBatches)).toHaveLength(0);
  expect(await db.select().from(payPeriods)).toEqual(periodsBefore);
});

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

it("prorates explicitly opted-in subsidies but pays a period-end subsidy only from the final effective version", async () => {
  const { db, reviewer, period, version, payroll } = await fixture();
  await db.update(compensationPlanVersions).set({ effectiveTo: new Date("2026-09-16Z"), config: { subsidies: [
    { name: "交通", amount: "300", distribution: "prorated" }, { name: "月末", amount: "100", distribution: "period_end" },
  ] } }).where(eq(compensationPlanVersions.id, version.id));
  await db.insert(compensationPlanVersions).values({ compensationPlanId: version.compensationPlanId, version: 2, type: "hourly", baseAmount: "100", baseUnit: "hour",
    effectiveFrom: new Date("2026-09-16Z"), createdBy: reviewer.membershipId,
    config: { subsidies: [{ name: "交通", amount: "600", distribution: "prorated" }, { name: "月末", amount: "200", distribution: "period_end" }] } });
  await payroll.calculate(reviewer, period.id);
  expect((await db.select().from(payrollItems))[0]).toMatchObject({ grossAmount: "650.000000" });
  const components = await db.select().from(payrollItemComponents);
  expect(components.filter((item) => item.label === "交通").map((item) => item.amount)).toEqual(["150.000000", "300.000000"]);
  expect(components.filter((item) => item.label === "月末").map((item) => item.amount)).toEqual(["200.000000"]);
});

it("keeps approved expenses in their assigned month and preserves historical, pending and notification access", async () => {
  const { db, employee, reviewer, period, expense, evidence, payroll } = await fixture();
  await db.update(organizations).set({ timezone: "Asia/Shanghai" }).where(eq(organizations.id, employee.organizationId));
  const approve = async (title: string, expenseDate: string, assigned: string, amount: string) => {
    const claim = await expense.create(employee, { title, description: "核对跨月归属", expenseDate, amount, currency: "CNY" });
    await evidence.createReference(employee, claim.id, { kind: "text", textContent: "已核验费用凭证", visibility: "management_only" });
    const pending = await expense.act(employee, claim.id, { action: "submit", expectedVersion: claim.version });
    return expense.act(reviewer, claim.id, { action: "approve", expectedVersion: pending.version, payPeriodId: assigned });
  };
  const september = await approve("九月已批准交通费", "2026-09-03", period.id, "128.35");
  vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
  const [october] = await db.insert(payPeriods).values({ organizationId: employee.organizationId, name: "十月", timezone: "Asia/Shanghai", startsAt: new Date("2026-09-30T16:00:00Z"), endsAt: new Date("2026-10-31T16:00:00Z"), cutoffAt: new Date("2026-11-05T10:00:00Z") }).returning();
  const late = await approve("八月费用明确计入十月", "2026-08-15", october!.id, "20.01");
  const pending = await expense.create(employee, { title: "九月尚待审批", description: "不能从历史待办遗漏", expenseDate: "2026-09-30", amount: "10", currency: "CNY" });
  await evidence.createReference(employee, pending.id, { kind: "text", textContent: "待审批凭证", visibility: "management_only" });
  await expense.act(employee, pending.id, { action: "submit", expectedVersion: pending.version });
  expect((await expense.list(employee)).items.map((r) => r.id)).toEqual([late.id]);
  expect((await expense.list(employee, { from: "2026-09-01", to: "2026-10-01" })).items.map((r) => r.id)).toEqual(expect.arrayContaining([september.id, pending.id]));
  expect((await expense.list(reviewer, { pendingOnly: true })).items.map((r) => r.id)).toEqual([pending.id]);
  expect((await expense.list(employee, { id: september.id })).items[0]?.id).toBe(september.id);
  expect((await expense.list({ ...employee, membershipId: reviewer.membershipId }, { id: september.id })).items).toEqual([]);
  expect((await payroll.listOwn(employee)).livePreview?.approvedReimbursementAmount).toBe("20.010000");
  expect((await db.select().from(payrollAdjustments)).map((r) => r.payPeriodId).sort()).toEqual([period.id, october!.id].sort());
  await payroll.calculate(reviewer, october!.id);
  expect((await db.select().from(payrollItems))[0]?.adjustmentAmount).toBe("20.010000");
});

it("paginates monthly claims with identical timestamps without truncating or exposing another member's draft", async () => {
  const { db, employee, reviewer, expense } = await fixture();
  await db.insert(reimbursementRequests).values(Array.from({ length: 205 }, (_, i) => ({ organizationId: employee.organizationId, membershipId: employee.membershipId, title: `待办 ${i}`, description: "大量申请验收", expenseDate: "2026-09-03", amount: "1", currency: "CNY", status: "pending" as const })));
  await expense.create(employee, { title: "本人私密草稿", description: "不进入他人审批列表", expenseDate: "2026-09-03", amount: "1", currency: "CNY" });
  const all = new Set<string>(); let before: string | undefined;
  do { const page = await expense.list(reviewer, { pendingOnly: true, before, limit: 100 }); page.items.forEach((r) => all.add(r.id)); before = page.nextCursor ?? undefined; } while (before);
  expect(all.size).toBe(205);
  expect((await expense.list(reviewer)).items.every((r) => r.status !== "draft")).toBe(true);
});

it("exports one workbook with the full salary overview first and only cycle work records second", async () => {
  const { db, employee, reviewer, period, version, expense, evidence, payroll } = await fixture();
  await db.update(compensationPlanVersions).set({ config: { subsidies: [{ name: "月末交通补贴", amount: "30", distribution: "period_end" }] } }).where(eq(compensationPlanVersions.id, version.id));
  await db.insert(workSessions).values({ organizationId: employee.organizationId, membershipId: employee.membershipId, startAt: new Date("2026-09-03T08:00Z"), endAt: new Date("2026-09-03T09:00Z"), timezone: "UTC", source: "manual", grossSeconds: 3600, netSeconds: 3600, content: "九月完整工作提交单", result: "交付完成", submissionStatus: "submitted", approvalStatus: "approved" });
  await db.insert(workSessions).values([
    { startAt: new Date("2026-08-31T23:00Z"), endAt: period.startsAt, content: "周期之前的工作不可混入" },
    { startAt: period.endsAt, endAt: new Date("2026-10-01T01:00Z"), content: "周期之后的工作不可混入" },
  ].map((r) => ({ ...r, organizationId: employee.organizationId, membershipId: employee.membershipId,
    timezone: "UTC", source: "manual" as const, grossSeconds: 3600, netSeconds: 3600,
    submissionStatus: "submitted" as const, approvalStatus: "approved" as const })));
  const claim = await expense.create(employee, { title: "九月交通报销", description: "客户现场交通费", expenseDate: "2026-09-03", amount: "128.35", currency: "CNY" });
  await evidence.createReference(employee, claim.id, { kind: "text", textContent: "交通凭证", visibility: "management_only" });
  const pending = await expense.act(employee, claim.id, { action: "submit", expectedVersion: claim.version });
  await expense.act(reviewer, claim.id, { action: "approve", expectedVersion: pending.version, payPeriodId: period.id });
  await db.insert(payrollAdjustments).values({ organizationId: employee.organizationId, membershipId: employee.membershipId, payPeriodId: period.id, amount: "-5", currency: "CNY", reason: "已确认扣减", createdBy: reviewer.membershipId, approvedBy: reviewer.membershipId, approvedAt: new Date() });
  const run = await payroll.calculate(reviewer, period.id);
  const preview = await new PayrollHandoffService(db).preview(reviewer, run.id);
  expect(preview.rows.find((r) => r.membershipId === employee.membershipId)?.amounts).toEqual({ wages: "100.000000", bonus: "0.000000", subsidies: "30.000000", reimbursements: "128.350000", other: "-5.000000" });
  const captured = await capturePayrollWorkbook(db, reviewer, preview, "九月.csv");
  const book = new ExcelJS.Workbook(); await book.xlsx.load(Buffer.from(captured.workbookBase64, "base64") as unknown as Parameters<typeof book.xlsx.load>[0]);
  expect(book.worksheets.map((sheet) => sheet.name)).toEqual([
    "薪资总览", "周期工作记录", "工资组成", "报销明细", "工作证据目录", "规则与来源",
  ]);
  const sheet = book.getWorksheet("薪资总览")!;
  const column = (name: string) => { let found = 0; sheet.getRow(1).eachCell((cell, index) => { if (cell.value === name) found = index; }); expect(found).toBeGreaterThan(0); return found; };
  const value = (name: string) => sheet.getCell(2, column(name)).value;
  expect(value("工作工资")).toBe("100.00"); expect(value("补贴")).toBe("30.00");
  expect(value("已批准报销")).toBe("128.35"); expect(value("其他调整（含扣减及更正）")).toBe("-5.00");
  expect(value("最终金额")).toBe("253.35"); expect(value("薪资周期")).toBe("九月");
  expect(JSON.stringify(book.getWorksheet("周期工作记录")!.getSheetValues())).toContain("九月完整工作提交单");
  expect(JSON.stringify(sheet.getSheetValues())).not.toContain("九月完整工作提交单");
  expect(captured.workRowCount).toBe(1);
  expect(JSON.stringify(book.getWorksheet("周期工作记录")!.getSheetValues())).not.toContain("周期之前");
  expect(JSON.stringify(book.getWorksheet("周期工作记录")!.getSheetValues())).not.toContain("周期之后");
  expect(JSON.stringify(book.getWorksheet("报销明细")!.getSheetValues())).toContain("九月交通报销");
});
