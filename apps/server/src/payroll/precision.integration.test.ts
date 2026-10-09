import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import type { Database } from "@workbench/db";
import { calculateWorkDuration } from "@workbench/shared";
import {
  compensationPlans,
  compensationPlanVersions,
  organizations,
  orgMemberships,
  payPeriods,
  payrollItemComponents,
  payrollItems,
  payrollRuns,
  payrollSnapshots,
  payslips,
  rateRules,
  users,
  workBreaks,
  workSessions,
} from "@workbench/db/schema";
import { PAYROLL_CALCULATION_VERSION, PayrollService } from "./service.js";
import { WorkSessionService } from "../work/service.js";
import { TimerService } from "../timer/service.js";
import { PayrollHandoffService } from "./handoff.js";
import { capturePayrollWorkbook } from "./bundle.js";
import ExcelJS from "exceljs";

const clients: PGlite[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function fixture(options: { versioned?: boolean; includePending?: boolean } = {}) {
  const client = new PGlite();
  clients.push(client);
  const directory = resolve(import.meta.dirname, "../../../../packages/db/drizzle");
  for (const name of (await readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort()) {
    for (const statement of (await readFile(resolve(directory, name), "utf8"))
      .split("--> statement-breakpoint").filter((value) => value.trim())) {
      await client.exec(statement);
    }
  }
  const db = drizzle(client) as unknown as Database;
  const [organization] = await db.insert(organizations).values({ name: "薪资精度交叉回归", timezone: "UTC" }).returning();
  const people = await db.insert(users).values([{ displayName: "员工" }, { displayName: "结算人" }]).returning();
  const members = await db.insert(orgMemberships).values(people.map((person) => ({
    organizationId: organization!.id, userId: person.id, status: "active" as const,
  }))).returning();
  const employee = members[0]!;
  const actor = { organizationId: organization!.id, membershipId: members[1]!.id };
  const [plan] = await db.insert(compensationPlans).values({
    organizationId: organization!.id, membershipId: employee.id, name: "边界计薪", type: "hourly",
    currency: "CNY", createdBy: actor.membershipId, activeVersion: options.versioned ? 2 : 1,
  }).returning();
  const versionInputs = options.versioned ? [
    { version: 1, baseAmount: "100", effectiveFrom: new Date("2026-09-01T00:00:00Z"), effectiveTo: new Date("2026-09-22T14:00:00Z") },
    { version: 2, baseAmount: "200", effectiveFrom: new Date("2026-09-22T14:00:00Z"), effectiveTo: null },
  ] : [{ version: 1, baseAmount: "3600", effectiveFrom: new Date("2026-09-01T00:00:00Z"), effectiveTo: null }];
  const versions = await db.insert(compensationPlanVersions).values(versionInputs.map((version) => ({
    ...version, compensationPlanId: plan!.id, type: "hourly" as const, baseUnit: "hour", createdBy: actor.membershipId,
    pendingReviewCountsInEstimate: options.includePending ?? true,
  }))).returning();
  if (options.versioned) {
    await db.insert(rateRules).values(versions.map((version) => ({
      compensationPlanVersionId: version.id, type: "overtime" as const, priority: 100,
      conditions: { thresholdSeconds: 8 * 3600 }, calculation: { multiplier: "2", stack: false },
    })));
  }
  const [period] = await db.insert(payPeriods).values({
    organizationId: actor.organizationId, name: "九月计薪边界", timezone: "UTC", startsAt: new Date("2026-09-01T00:00:00Z"),
    endsAt: new Date("2026-10-01T00:00:00Z"), cutoffAt: new Date("2026-10-05T00:00:00Z"),
  }).returning();
  const service = new PayrollService(db);
  async function work(start: string, end: string, approvalStatus: "approved" | "pending_review" = "approved") {
    const startAt = new Date(`2026-09-22T${start}Z`);
    const endAt = new Date(`2026-09-22T${end}Z`);
    const seconds = Math.floor((endAt.getTime() - startAt.getTime()) / 1000);
    const [session] = await db.insert(workSessions).values({
      organizationId: actor.organizationId, membershipId: employee.id, startAt, endAt, timezone: "UTC", source: "timer",
      content: "计薪边界事实", grossSeconds: seconds, netSeconds: seconds, parallelWork: true,
      submissionStatus: "submitted", approvalStatus,
    }).returning();
    return session!;
  }
  async function calculate() {
    const run = await service.calculate(actor, period!.id);
    const [item] = await db.select().from(payrollItems).where(eq(payrollItems.payrollRunId, run.id));
    const components = await db.select().from(payrollItemComponents).where(eq(payrollItemComponents.payrollItemId, item!.id));
    return { run, item: item!, components };
  }
  return { db, service, actor, employee: { organizationId: actor.organizationId, membershipId: employee.id },
    period: period!, versions, work, calculate };
}

it("keeps the same-day overtime threshold across effective hourly plan versions", async () => {
  const { versions, work, calculate } = await fixture({ versioned: true });
  const session = await work("08:00:00", "20:00:00");
  const { item, components } = await calculate();
  expect(item).toMatchObject({ approvedSeconds: 43_200, pendingSeconds: 0, grossAmount: "2600.000000", estimate: false });
  const amountFor = (versionId: string) => components.filter((component) => component.sourceEntityId === versionId)
    .reduce((sum, component) => sum + Number(component.amount), 0);
  expect(amountFor(versions[0]!.id)).toBe(600);
  expect(amountFor(versions[1]!.id)).toBe(2000);
  expect(components.filter((component) => component.type === "overtime")).toHaveLength(1);
  for (const component of components) {
    expect(component.calculationTrace).toMatchObject({ sourceIds: [session.id] });
  }
});

it("uses historical hourly versions identically in live preview and the selected cycle", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-23T12:00:00Z"));
  const { employee, service, work, calculate } = await fixture({ versioned: true });
  await work("08:00:00", "09:00:00"); await work("16:00:00", "17:00:00");
  const preview = (await service.listOwn(employee)).livePreview!;
  const { item } = await calculate();
  expect(preview).toMatchObject({ approvedSeconds: 7200, estimatedAmount: "300.000000" });
  expect(item).toMatchObject({ approvedSeconds: 7200, grossAmount: preview.estimatedAmount });
});

it("stops overlapping scheme versions before storing a duplicate payment", async () => {
  const { db, versions, work, calculate } = await fixture({ versioned: true });
  await db.update(compensationPlanVersions).set({ effectiveTo: null }).where(eq(compensationPlanVersions.id, versions[0]!.id));
  await work("08:00:00", "20:00:00");
  await expect(calculate()).rejects.toThrow("生效区间重叠");
  expect(await db.select().from(payrollItems)).toHaveLength(0);
});

it("counts one daily salary using the last applicable approved rate on a version-change day", async () => {
  const { db, work, calculate } = await fixture({ versioned: true });
  await db.update(compensationPlanVersions).set({ type: "daily", baseUnit: "day" });
  await work("08:00:00", "20:00:00");
  const { item, components } = await calculate();
  expect(item).toMatchObject({ grossAmount: "200.000000", approvedSeconds: 43_200, estimate: false });
  const charged = components.filter((component) => component.unit === "day" && Number(component.quantity) > 0);
  expect(charged).toHaveLength(1);
  expect(charged[0]!.calculationTrace).toMatchObject({ dailyVersionPolicy: "one_day_last_applicable_approved_rate" });
});

it("counts one daily salary across identical rate versions and keeps an approved day confirmed", async () => {
  const { db, work, calculate } = await fixture({ versioned: true });
  await db.update(compensationPlanVersions).set({ type: "daily", baseUnit: "day", baseAmount: "100" });
  await work("08:00:00", "09:00:00"); await work("16:00:00", "17:00:00", "pending_review");
  const { item, components } = await calculate();
  expect(item).toMatchObject({ grossAmount: "100.000000", estimate: false, approvedSeconds: 3600, pendingSeconds: 3600 });
  expect(components.filter((component) => component.unit === "day" && Number(component.quantity) > 0)).toHaveLength(1);
});

it.each([
  { includePending: false, amount: "1200.000000", estimate: false },
  { includePending: true, amount: "2600.000000", estimate: true },
])("respects includePending=$includePending when carrying earlier-version daily work", async ({ includePending, amount, estimate }) => {
  const { work, calculate } = await fixture({ versioned: true, includePending });
  await work("08:00:00", "14:00:00", "pending_review");
  await work("14:00:00", "20:00:00");
  const { item, components } = await calculate();
  expect(item).toMatchObject({ approvedSeconds: 21_600, pendingSeconds: 21_600, grossAmount: amount, estimate });
  expect(components.filter((component) => component.type === "overtime")).toHaveLength(includePending ? 1 : 0);
});

it("keeps fractional-millisecond overlap totals consistent with payable seconds", async () => {
  const { work, calculate } = await fixture();
  const approved = await work("08:00:00.100", "10:00:00.100");
  const pending = await work("09:00:00.600", "11:00:00.600", "pending_review");
  const { item, components } = await calculate();
  expect(item).toMatchObject({ approvedSeconds: 7200, pendingSeconds: 3600, grossAmount: "10800.000000", estimate: true });
  expect(components.reduce((sum, component) => sum + Number(component.quantity), 0)).toBe(item.approvedSeconds + item.pendingSeconds);
  const sourceIds = components.flatMap((component) => (component.calculationTrace as { sourceIds: string[] }).sourceIds);
  expect(new Set(sourceIds)).toEqual(new Set([approved.id, pending.id]));
});

it("does not lose whole payable seconds at consecutive millisecond source boundaries", async () => {
  const { work, calculate } = await fixture();
  await work("08:00:00.900", "09:00:00.900");
  await work("08:30:00.800", "09:30:00.800");
  await work("09:00:00.700", "10:00:00.700");
  const { item, components } = await calculate();
  // Three integer-duration facts cover one uninterrupted 7199.8-second interval.
  // Provenance boundaries must not discard each fragment's fractional remainder.
  expect(item).toMatchObject({ approvedSeconds: 7199, pendingSeconds: 0, grossAmount: "7199.000000", estimate: false });
  expect(components.reduce((sum, component) => sum + Number(component.quantity), 0)).toBe(7199);
});

it("does not count or lock work when only its break intersects the effective plan", async () => {
  const { db, service, actor, versions, work, calculate } = await fixture();
  await db.update(compensationPlanVersions).set({ effectiveFrom: new Date("2026-09-22T09:00:00Z") })
    .where(eq(compensationPlanVersions.id, versions[0]!.id));
  const session = await work("08:00:00", "10:00:00");
  await db.insert(workBreaks).values({ workSessionId: session.id,
    startAt: new Date("2026-09-22T09:00:00Z"), endAt: new Date("2026-09-22T10:00:00Z") });
  await db.update(workSessions).set({ breakSeconds: 3600, netSeconds: 3600 }).where(eq(workSessions.id, session.id));
  const { run, item } = await calculate();
  expect(item).toMatchObject({ approvedSeconds: 0, pendingSeconds: 0, grossAmount: "0.000000" });
  await service.settle(actor, run.id);
  const [uncharged] = await db.select().from(workSessions).where(eq(workSessions.id, session.id));
  expect(uncharged).toMatchObject({ approvalStatus: "approved", lockedAt: null, version: 1 });
});

it.each([false, true])("keeps confirmed whole seconds independent of pending coverage (includePending=%s)", async (includePending) => {
  const { work, calculate } = await fixture({ includePending });
  await work("08:00:00.000", "08:00:01.000", "pending_review");
  const approved = await work("08:00:00.500", "09:00:00.500");
  const { item, components } = await calculate();
  expect(item).toMatchObject({ approvedSeconds: 3600, pendingSeconds: 0, grossAmount: "3600.000000", estimate: false });
  expect(components.reduce((sum, component) => sum + Number(component.quantity), 0)).toBe(3600);
  expect(components.every((component) => (component.calculationTrace as { sourceIds: string[] }).sourceIds.includes(approved.id))).toBe(true);
});

it.each(["current", "legacy"] as const)("counts real elapsed work around fractional breaks for %s stored durations", async (mode) => {
  const { db, employee, work, calculate } = await fixture();
  const session = await work("08:00:00.100", "08:00:10.100");
  const rest = { startAt: new Date("2026-09-22T08:00:04.700Z"), endAt: new Date("2026-09-22T08:00:05.500Z") };
  const duration = calculateWorkDuration({ startAt: session.startAt, endAt: session.endAt }, [rest]);
  // The real work is 4.6 + 4.6 = 9.2 seconds, irrespective of the break boundary.
  expect(duration).toEqual({ grossSeconds: 10, breakSeconds: 1, netSeconds: 9 });
  const stored = mode === "legacy" ? { grossSeconds: 10, breakSeconds: 0, netSeconds: 10 } : duration;
  await db.insert(workBreaks).values({ workSessionId: session.id, ...rest });
  await db.update(workSessions).set(stored).where(eq(workSessions.id, session.id));
  const workService = new WorkSessionService(db);
  const unfiltered = await workService.listOwn(employee, 10);
  const ranged = await workService.listOwn(employee, 10, {
    from: new Date("2026-09-22T00:00:00Z"), to: new Date("2026-09-23T00:00:00Z"),
  });
  expect(unfiltered[0]).toMatchObject({ id: session.id, netSeconds: stored.netSeconds, periodNetSeconds: 9 });
  expect(ranged[0]).toMatchObject({ id: session.id, netSeconds: stored.netSeconds, periodNetSeconds: 9 });
  const { run, item, components } = await calculate();
  expect(run.calculationVersion).toBe(PAYROLL_CALCULATION_VERSION);
  expect(item).toMatchObject({ approvedSeconds: 9, pendingSeconds: 0, grossAmount: "9.000000", estimate: false });
  expect(components.reduce((sum, component) => sum + Number(component.quantity), 0)).toBe(9);
  const [unchanged] = await db.select().from(workSessions).where(eq(workSessions.id, session.id));
  expect(unchanged).toMatchObject({ ...stored, startAt: session.startAt, endAt: session.endAt, version: 1 });
  const [unchangedBreak] = await db.select().from(workBreaks).where(eq(workBreaks.workSessionId, session.id));
  expect(unchangedBreak).toMatchObject(rest);
  const [snapshot] = await db.select().from(payrollSnapshots).where(eq(payrollSnapshots.payrollRunId, run.id));
  const payload = snapshot!.payload as { sessions: Array<{ id: string; netSeconds: number }> };
  expect(payload.sessions.find((entry) => entry.id === session.id)?.netSeconds).toBe(stored.netSeconds);
});

it("loads owner payroll and charges elapsed work for an older segment-rounded timer fact", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-23T12:00:00Z"));
  const { db, service, actor, work, calculate } = await fixture();
  const session = await work("08:00:00.100", "08:00:10.100");
  await db.insert(workBreaks).values({ workSessionId: session.id,
    startAt: new Date("2026-09-22T08:00:04.700Z"), endAt: new Date("2026-09-22T08:00:05.500Z"),
  });
  // The historical timer saved floor(4.6) + floor(4.6) = 8 seconds.
  await db.update(workSessions).set({ grossSeconds: 10, breakSeconds: 2, netSeconds: 8 })
    .where(eq(workSessions.id, session.id));
  const overview = await service.managementOverview(actor);
  expect(overview.liveItemIssues).toEqual([]);
  expect(overview.liveItems).toHaveLength(1);
  expect(overview.liveItems[0]?.preview.approvedSeconds).toBe(9);
  const { item } = await calculate();
  expect(item).toMatchObject({ approvedSeconds: 9, grossAmount: "9.000000" });
  const [unchanged] = await db.select().from(workSessions).where(eq(workSessions.id, session.id));
  expect(unchanged).toMatchObject({ netSeconds: 8, breakSeconds: 2 });
});

it("persists new timer sessions with the same duration as their exact break intervals", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-23T12:00:00Z"));
  const { db, service, actor, employee, calculate } = await fixture();
  const timerService = new TimerService(db);
  const started = await timerService.start(employee, {
    eventId: crypto.randomUUID(), occurredAt: new Date("2026-09-22T08:00:00.100Z"),
    content: "分段计时", timezone: "UTC",
  });
  for (const [eventType, time] of [
    ["pause", "08:00:04.700"], ["resume", "08:00:05.500"], ["stop", "08:00:10.100"],
  ] as const) {
    await timerService.transition(employee, started.id, {
      eventId: crypto.randomUUID(), eventType, occurredAt: new Date(`2026-09-22T${time}Z`),
    });
  }
  const [session] = await db.select().from(workSessions);
  expect(session).toMatchObject({ source: "timer", grossSeconds: 10, breakSeconds: 1, netSeconds: 9, billableSeconds: 9 });
  const [rest] = await db.select().from(workBreaks);
  expect(rest).toMatchObject({ startAt: new Date("2026-09-22T08:00:04.700Z"), endAt: new Date("2026-09-22T08:00:05.500Z") });
  await db.update(workSessions).set({ submissionStatus: "submitted", approvalStatus: "pending_review" })
    .where(eq(workSessions.id, session!.id));
  const overview = await service.managementOverview(actor);
  expect(overview.liveItemIssues).toEqual([]);
  expect(overview.liveItems[0]?.preview.pendingSeconds).toBe(9);
  const { item } = await calculate();
  expect(item).toMatchObject({ pendingSeconds: 9, grossAmount: "9.000000" });
});

it("keeps owner controls available while identifying an unrelated invalid fact", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-23T12:00:00Z"));
  const { db, service, actor, work, calculate } = await fixture();
  const session = await work("08:00:00.100", "08:00:10.100");
  await db.insert(workBreaks).values({ workSessionId: session.id,
    startAt: new Date("2026-09-22T08:00:04.700Z"), endAt: new Date("2026-09-22T08:00:05.500Z"),
  });
  await db.update(workSessions).set({ source: "manual", breakSeconds: 2, netSeconds: 8 })
    .where(eq(workSessions.id, session.id));
  const overview = await service.managementOverview(actor);
  expect(overview.members).toHaveLength(2);
  expect(overview.periods).toHaveLength(1);
  expect(overview.liveItems).toEqual([]);
  expect(overview.liveItemIssues).toEqual([expect.objectContaining({
    message: expect.stringContaining(session.id),
  })]);
  await expect(calculate()).rejects.toThrow(/净时长与休息区间不一致/);
});

it("does not treat genuinely corrupt stored work duration as a legacy rounding difference", async () => {
  const { db, work, calculate } = await fixture();
  const session = await work("08:00:00.100", "08:00:10.100");
  await db.insert(workBreaks).values({ workSessionId: session.id,
    startAt: new Date("2026-09-22T08:00:04.700Z"), endAt: new Date("2026-09-22T08:00:05.500Z") });
  // The old and new valid calculations give 10 and 9, never 20.
  await db.update(workSessions).set({ grossSeconds: 20, breakSeconds: 0, netSeconds: 20 }).where(eq(workSessions.id, session.id));
  await expect(calculate()).rejects.toThrow(/净时长|不一致/);
  expect(await db.select().from(payrollItems)).toHaveLength(0);
  const [unchanged] = await db.select().from(workSessions).where(eq(workSessions.id, session.id));
  expect(unchanged).toMatchObject({ netSeconds: 20, version: 1 });
});

it("requires recalculation of an old ready engine run even when factual snapshot inputs still match", async () => {
  const { db, service, actor, work, calculate } = await fixture();
  const session = await work("08:00:00", "09:00:00");
  const { run } = await calculate();
  const [beforeSnapshot] = await db.select().from(payrollSnapshots).where(eq(payrollSnapshots.payrollRunId, run.id));
  await db.update(payrollRuns).set({ calculationVersion: "payroll-engine-v7-deduplicated-effective-time" }).where(eq(payrollRuns.id, run.id));
  await expect(service.settle(actor, run.id)).rejects.toThrow(/重新计算|重算/);
  const [unchanged] = await db.select().from(workSessions).where(eq(workSessions.id, session.id));
  expect(unchanged).toMatchObject({ approvalStatus: "approved", lockedAt: null, version: 1 });
  const [notSettled] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, run.id));
  expect(notSettled).toMatchObject({ status: "ready", settledAt: null });
  expect((await db.select().from(payrollSnapshots).where(eq(payrollSnapshots.payrollRunId, run.id)))[0]).toEqual(beforeSnapshot);
  expect(await db.select().from(payslips)).toHaveLength(0);
});

it("keeps already settled legacy amounts and snapshots immutable on repeated settlement and export", async () => {
  const { db, service, actor, work, calculate } = await fixture();
  await work("08:00:00", "09:00:00");
  const { run } = await calculate();
  await service.settle(actor, run.id);
  const [legacy] = await db.update(payrollRuns).set({ calculationVersion: "payroll-engine-v7-deduplicated-effective-time" })
    .where(eq(payrollRuns.id, run.id)).returning();
  const beforeSnapshot = await db.select().from(payrollSnapshots).where(eq(payrollSnapshots.payrollRunId, run.id));
  const beforeItems = await db.select().from(payrollItems).where(eq(payrollItems.payrollRunId, run.id));
  const beforeWork = await db.select().from(workSessions);
  const beforePayslips = await db.select().from(payslips);
  await expect(service.settle(actor, run.id)).resolves.toEqual(legacy);
  await expect(service.settle(actor, run.id)).resolves.toEqual(legacy);
  const exported = await service.financeExport(actor, run.id);
  expect(exported.csv).toContain("3600.00,0.00,3600.00");
  expect(await db.select().from(payrollSnapshots).where(eq(payrollSnapshots.payrollRunId, run.id))).toEqual(beforeSnapshot);
  expect(await db.select().from(payrollItems).where(eq(payrollItems.payrollRunId, run.id))).toEqual(beforeItems);
  expect(await db.select().from(workSessions)).toEqual(beforeWork);
  expect(await db.select().from(payslips)).toEqual(beforePayslips);
});

it.each(["daily", "hourly"] as const)("does not charge or lock %s work for a remaining fractional interval with no payable whole second", async (type) => {
  const { db, service, actor, versions, work, calculate } = await fixture();
  await db.update(compensationPlans).set({ type }).where(eq(compensationPlans.id, versions[0]!.compensationPlanId));
  await db.update(compensationPlanVersions).set({ type, baseAmount: "100", baseUnit: type === "daily" ? "day" : "hour",
    effectiveFrom: new Date("2026-09-22T08:00:00.600Z"),
  }).where(eq(compensationPlanVersions.id, versions[0]!.id));
  const session = await work("08:00:00.100", "08:00:01.100");
  const { run, item, components } = await calculate();
  expect(item).toMatchObject({ approvedSeconds: 0, pendingSeconds: 0, grossAmount: "0.000000", estimate: false });
  expect(components.filter((component) => component.unit === "day")).toEqual(type === "daily" ? [
    expect.objectContaining({ quantity: "0.000000", amount: "0.000000" }),
  ] : []);
  await service.settle(actor, run.id);
  const [uncharged] = await db.select().from(workSessions).where(eq(workSessions.id, session.id));
  expect(uncharged).toMatchObject({ approvalStatus: "approved", lockedAt: null, version: 1 });
});

it("locks the paid source after member-wide fractional work adds up to one whole second", async () => {
  const { db, service, actor, period, work, calculate } = await fixture();
  // Both facts are valid one-second records. The period intersects each for
  // 0.6 seconds, with a real 0.8-second gap between their working fragments.
  await db.update(payPeriods).set({ startsAt: new Date("2026-09-22T08:00:00.500Z"),
    endsAt: new Date("2026-09-22T08:00:02.500Z"),
  }).where(eq(payPeriods.id, period.id));
  const first = await work("08:00:00.100", "08:00:01.100");
  await work("08:00:01.900", "08:00:02.900");
  const { run, item, components } = await calculate();
  expect(item).toMatchObject({ approvedSeconds: 1, pendingSeconds: 0, grossAmount: "1.000000", estimate: false });
  expect(components.reduce((sum, component) => sum + Number(component.quantity), 0)).toBe(1);
  const paidSourceIds = components.filter((component) => Number(component.quantity) > 0)
    .flatMap((component) => (component.calculationTrace as { sourceIds: string[] }).sourceIds);
  expect(paidSourceIds).toEqual([first.id]);
  await service.settle(actor, run.id);
  const settledFacts = await db.select().from(workSessions);
  for (const sourceId of paidSourceIds) {
    expect(settledFacts.find((session) => session.id === sourceId)).toMatchObject({ approvalStatus: "locked", version: 2 });
    expect(settledFacts.find((session) => session.id === sourceId)?.lockedAt).toBeInstanceOf(Date);
  }
});


it("replaces the whole chosen month at the configured hourly price and preserves prices outside it", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-23T12:00:00Z"));
  const { db, versions, employee, service, actor, period, work, calculate } = await fixture({ versioned: true });
  await db.update(compensationPlanVersions).set({ effectiveFrom: new Date("2026-08-01Z") }).where(eq(compensationPlanVersions.id, versions[0]!.id));
  await work("08:00:00", "09:00:00"); await work("16:00:00", "17:00:00");
  for (const startAt of [new Date("2026-08-31T12:00Z"), new Date("2026-10-01T12:00Z")]) {
    await db.insert(workSessions).values({ organizationId: actor.organizationId, membershipId: employee.membershipId,
      startAt, endAt: new Date(startAt.getTime() + 3600000), timezone: "UTC", source: "manual", grossSeconds: 3600, netSeconds: 3600,
      content: "其他月份", submissionStatus: "submitted", approvalStatus: "approved" });
  }
  const oldRun = await calculate();
  const input = { membershipId: employee.membershipId, name: "本月统一时薪", type: "hourly" as const, currency: "CNY", baseAmount: "80.00",
    effectiveFrom: period.startsAt, effectiveTo: period.endsAt, pendingReviewCountsInEstimate: true, rules: [] };
  await service.configurePlan(actor, input);
  await expect(service.settle(actor, oldRun.run.id)).rejects.toThrow();
  const updated = await calculate();
  expect(updated.item).toMatchObject({ approvedSeconds: 7200, grossAmount: "160.000000" });
  expect(updated.components.every((component) => component.rate === "80.000000")).toBe(true);
  expect((await service.listOwn(employee)).livePreview).toMatchObject({ approvedSeconds: 7200, estimatedAmount: "160.000000", baseAmount: "80.000000" });
  // Editing the same period a second time must replace, rather than add, wages.
  await service.configurePlan(actor, { ...input, baseAmount: "85.00" });
  expect((await calculate()).item.grossAmount).toBe("170.000000");
  for (const [start, end, amount] of [["2026-08-01Z", "2026-09-01Z", "100.000000"], ["2026-10-01Z", "2026-11-01Z", "200.000000"]]) {
    const [outside] = await db.insert(payPeriods).values({ organizationId: actor.organizationId, name: "其他月份", timezone: "UTC",
      startsAt: new Date(start!), endsAt: new Date(end!), cutoffAt: new Date(end!) }).returning();
    const run = await service.calculate(actor, outside!.id);
    const [item] = await db.select().from(payrollItems).where(eq(payrollItems.payrollRunId, run.id));
    expect(item?.grossAmount).toBe(amount);
  }
  await service.settle(actor, (await calculate()).run.id);
  await expect(service.configurePlan(actor, { ...input, baseAmount: "90" })).rejects.toThrow("已结算或锁定");
});

it.each(["monthly", "fixed_period", "hybrid"] as const)("pays the complete configured %s amount even when saved late in the month", async (type) => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-23T12:00:00Z"));
  const { employee, service, actor, period, work, calculate } = await fixture();
  await work("08:00:00", "10:00:00");
  await service.configurePlan(actor, { membershipId: employee.membershipId, name: "完整范围固定工资", type, currency: "CNY",
    baseAmount: type === "hybrid" ? "80.00" : "3000.00", fixedAmount: "3000.00", effectiveFrom: period.startsAt, effectiveTo: period.endsAt,
    pendingReviewCountsInEstimate: true, rules: [] });
  const amount = type === "hybrid" ? "3160.000000" : "3000.000000";
  expect((await calculate()).item.grossAmount).toBe(amount);
  expect((await service.listOwn(employee)).livePreview?.estimatedAmount).toBe(amount);
});

it("splits a configured cross-month fixed period across calendar months without paying the full amount twice", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-23T12:00:00Z"));
  const { db, versions, employee, service, actor, period, calculate } = await fixture();
  await db.update(compensationPlanVersions).set({ baseAmount: "0" }).where(eq(compensationPlanVersions.id, versions[0]!.id));
  await service.configurePlan(actor, { membershipId: employee.membershipId, name: "跨月完整三十天", type: "fixed_period", currency: "CNY",
    baseAmount: "3000.00", effectiveFrom: new Date("2026-09-10Z"), effectiveTo: new Date("2026-10-10Z"), pendingReviewCountsInEstimate: true, rules: [] });
  expect((await calculate()).item.grossAmount).toBe("2100.000000");
  expect((await service.listOwn(employee)).livePreview?.estimatedAmount).toBe("2100.000000");
  vi.setSystemTime(new Date("2026-10-10T12:00:00Z"));
  expect((await service.listOwn(employee)).livePreview?.estimatedAmount).toBe("900.000000");
  await db.update(payPeriods).set({ startsAt: new Date("2026-09-10Z"), endsAt: new Date("2026-10-10Z") }).where(eq(payPeriods.id, period.id));
  expect((await calculate()).item.grossAmount).toBe("3000.000000");
});

it("keeps a month's work and breaks strictly inside organization-local boundaries", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-23T12:00:00Z"));
  const { db, employee, service, actor, period, calculate } = await fixture();
  const startsAt = new Date("2026-08-31T16:00Z"), endsAt = new Date("2026-09-30T16:00Z");
  await db.update(organizations).set({ timezone: "Asia/Shanghai" }).where(eq(organizations.id, actor.organizationId));
  await db.update(payPeriods).set({ startsAt, endsAt, timezone: "Asia/Shanghai" }).where(eq(payPeriods.id, period.id));
  await service.configurePlan(actor, { membershipId: employee.membershipId, name: "当月时薪", type: "hourly", currency: "CNY", baseAmount: "80",
    effectiveFrom: startsAt, effectiveTo: endsAt, pendingReviewCountsInEstimate: true, rules: [] });
  const [crossing] = await db.insert(workSessions).values({ organizationId: actor.organizationId, membershipId: employee.membershipId,
    startAt: new Date("2026-08-31T15:00Z"), endAt: new Date("2026-08-31T17:00Z"), timezone: "Asia/Shanghai", source: "manual", grossSeconds: 7200, breakSeconds: 3600, netSeconds: 3600,
    content: "跨月含休息", submissionStatus: "submitted", approvalStatus: "approved" }).returning();
  await db.insert(workBreaks).values({ workSessionId: crossing!.id, startAt: new Date("2026-08-31T15:30Z"), endAt: new Date("2026-08-31T16:30Z") });
  await db.insert(workSessions).values({ organizationId: actor.organizationId, membershipId: employee.membershipId,
    startAt: new Date("2026-09-30T15:30Z"), endAt: new Date("2026-09-30T16:30Z"), timezone: "Asia/Shanghai", source: "manual", grossSeconds: 3600, netSeconds: 3600,
    content: "跨至下月", submissionStatus: "submitted", approvalStatus: "approved" });
  const { run, item } = await calculate();
  expect(item).toMatchObject({ approvedSeconds: 3600, grossAmount: "80.000000" });
  expect((await service.listOwn(employee)).livePreview).toMatchObject({ approvedSeconds: 3600, estimatedAmount: "80.000000" });
  const preview = await new PayrollHandoffService(db).preview(actor, run.id);
  const workbook = await capturePayrollWorkbook(db, actor, preview, "九月.csv", { report: true, blockers: preview.blockers });
  const book = new ExcelJS.Workbook(); await book.xlsx.load(Buffer.from(workbook.workbookBase64, "base64") as unknown as Parameters<typeof book.xlsx.load>[0]);
  for (const sheet of book.worksheets) expect(JSON.stringify(sheet.getRow(1).values)).not.toMatch(/编号|时区|币种|版本|追踪|SHA/);
  const records = book.getWorksheet("周期工作记录")!;
  expect(records.rowCount).toBe(3);
  expect(records.getCell("B2").value).toBe("2026/09/01 00:00:00");
  expect(records.getCell("C3").value).toBe("2026/10/01 00:00:00");
  expect(records.getCell("D2").value).toBe(0.5); expect(records.getCell("D3").value).toBe(0.5);
});

it("keeps fixed and prorated subsidies attached to the configured cycle in monthly previews", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-23T12:00:00Z"));
  const { employee, service, actor } = await fixture();
  const input = { membershipId: employee.membershipId, name: "月中结束的完整周期", type: "hourly" as const, currency: "CNY", baseAmount: "80",
    effectiveFrom: new Date("2026-09-10Z"), effectiveTo: new Date("2026-09-25Z"), pendingReviewCountsInEstimate: true, rules: [],
    subsidies: [{ name: "固定交通补贴", amount: "168.19", distribution: "period_end" as const }] };
  await service.configurePlan(actor, input);
  const september = (await service.listOwn(employee)).livePreview!;
  expect(september.subsidyTotal).toBe("168.190000");
  expect(september.salaryTimeline.find((day) => day.date === "2026-09-24")?.approvedAmount).toBe("168.190000");
  await service.configurePlan(actor, { ...input, effectiveTo: new Date("2026-10-10Z"),
    subsidies: [{ name: "跨月交通补贴", amount: "300", distribution: "prorated" }] });
  expect((await service.listOwn(employee)).livePreview!.subsidyTotal).toBe("210.000000");
  vi.setSystemTime(new Date("2026-10-10T12:00:00Z"));
  expect((await service.listOwn(employee)).livePreview!.subsidyTotal).toBe("90.000000");
});

it("does not use work before an explicitly configured period to trigger its weekly reward", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-23T12:00:00Z"));
  const { db, employee, service, actor, period, calculate } = await fixture();
  await service.configurePlan(actor, { membershipId: employee.membershipId, name: "本期独立奖励", type: "hourly", currency: "CNY", baseAmount: "80",
    effectiveFrom: new Date("2026-09-10Z"), effectiveTo: new Date("2026-09-25Z"), pendingReviewCountsInEstimate: true,
    rules: [{ type: "weekly_bonus", priority: 400, thresholdSeconds: 5 * 3600, rewardSeconds: 3600 }] });
  for (const [start, hours] of [["2026-09-07T08:00Z", 5], ["2026-09-10T08:00Z", 1]] as const) {
    await db.insert(workSessions).values({ organizationId: actor.organizationId, membershipId: employee.membershipId,
      startAt: new Date(start), endAt: new Date(Date.parse(start) + hours * 3600000), timezone: "UTC", source: "manual",
      grossSeconds: hours * 3600, netSeconds: hours * 3600, content: "本期奖励边界", submissionStatus: "submitted", approvalStatus: "approved" });
  }
  expect((await service.listOwn(employee)).livePreview!.weeklyBonusSeconds).toBe(0);
  await db.update(payPeriods).set({ startsAt: new Date("2026-09-10Z"), endsAt: new Date("2026-09-25Z") }).where(eq(payPeriods.id, period.id));
  expect((await calculate()).item.grossAmount).toBe("80.000000");
});
