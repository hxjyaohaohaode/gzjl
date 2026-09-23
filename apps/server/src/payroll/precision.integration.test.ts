import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, expect, it } from "vitest";
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
import { PayrollService } from "./service.js";
import { WorkSessionService } from "../work/service.js";

const clients: PGlite[] = [];
afterEach(async () => {
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
  expect(run.calculationVersion).toBe("payroll-engine-v8-effective-millisecond-budget");
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
  expect(exported.csv).toContain("3600.000000,0.000000,3600.000000");
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
