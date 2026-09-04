import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "@workbench/db";
import {
  compensationPlans,
  compensationPlanVersions,
  organizationOwners,
  organizations,
  orgMemberships,
  payPeriods,
  payrollItems,
  payrollItemComponents,
  payrollRuns,
  payslips,
  users,
  workSessions,
} from "@workbench/db/schema";

import { PayrollService } from "./service.js";

const clients: PGlite[] = [];

async function createTestDatabase(): Promise<Database> {
  const client = new PGlite();
  clients.push(client);
  const migrationsDir = resolve(import.meta.dirname, "../../../../packages/db/drizzle");
  const migrations = (await readdir(migrationsDir))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
  for (const file of migrations) {
    const migration = await readFile(resolve(migrationsDir, file), "utf8");
    for (const statement of migration
      .split("--> statement-breakpoint")
      .map((value) => value.trim())
      .filter(Boolean)) {
      await client.exec(statement);
    }
  }
  return drizzle(client) as unknown as Database;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("employee payroll view and receipt acknowledgement", () => {
  it("returns a live authorized estimate and records receipt exactly once", async () => {
    const db = await createTestDatabase();
    const [organization] = await db
      .insert(organizations)
      .values({ name: "薪资链路测试", timezone: "Asia/Shanghai", payrollCutoffDay: 10 })
      .returning();
    const [ownerUser] = await db.insert(users).values({ displayName: "Owner" }).returning();
    const [ownerMembership] = await db
      .insert(orgMemberships)
      .values({
        organizationId: organization!.id,
        userId: ownerUser!.id,
        status: "active",
        joinedAt: new Date("2025-01-01T00:00:00.000Z"),
      })
      .returning();
    await db.insert(organizationOwners).values({
      organizationId: organization!.id,
      membershipId: ownerMembership!.id,
    });
    const [user] = await db.insert(users).values({ displayName: "员工" }).returning();
    const [membership] = await db
      .insert(orgMemberships)
      .values({
        organizationId: organization!.id,
        userId: user!.id,
        status: "active",
        joinedAt: new Date("2025-01-01T00:00:00.000Z"),
      })
      .returning();
    const employeeActor = {
      organizationId: organization!.id,
      membershipId: membership!.id,
    };
    const ownerActor = {
      organizationId: organization!.id,
      membershipId: ownerMembership!.id,
    };
    const [plan] = await db
      .insert(compensationPlans)
      .values({
        organizationId: organization!.id,
        membershipId: membership!.id,
        name: "标准时薪",
        type: "hourly",
        currency: "CNY",
        activeVersion: 1,
        createdBy: ownerMembership!.id,
      })
      .returning();
    const [version] = await db
      .insert(compensationPlanVersions)
      .values({
        compensationPlanId: plan!.id,
        version: 1,
        type: "hourly",
        baseAmount: "100.000000",
        baseUnit: "hour",
        pendingReviewCountsInEstimate: true,
        effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
        createdBy: ownerMembership!.id,
      })
      .returning();
    const now = Date.now();
    await db.insert(workSessions).values({
      organizationId: organization!.id,
      membershipId: membership!.id,
      startAt: new Date(now - 2 * 60 * 60_000),
      endAt: new Date(now - 60 * 60_000),
      timezone: "Asia/Shanghai",
      grossSeconds: 3_600,
      netSeconds: 3_600,
      source: "manual",
      content: "已批准工作",
      result: "完成",
      submissionStatus: "submitted",
      approvalStatus: "approved",
      visibility: "management_only",
    });

    const [period] = await db
      .insert(payPeriods)
      .values({
        organizationId: organization!.id,
        name: "历史周期",
        timezone: "Asia/Shanghai",
        startsAt: new Date("2026-07-01T00:00:00.000Z"),
        endsAt: new Date("2026-08-01T00:00:00.000Z"),
        cutoffAt: new Date("2026-08-10T10:00:00.000Z"),
        status: "locked",
        settledAt: new Date("2026-08-10T10:00:00.000Z"),
        lockedAt: new Date("2026-08-10T10:00:00.000Z"),
      })
      .returning();
    const [run] = await db
      .insert(payrollRuns)
      .values({
        payPeriodId: period!.id,
        runNumber: 1,
        status: "settled",
        calculationVersion: "test",
        requestedBy: ownerMembership!.id,
        inputHash: "receipt-test",
        settledAt: new Date("2026-08-10T10:00:00.000Z"),
      })
      .returning();
    const [item] = await db
      .insert(payrollItems)
      .values({
        payrollRunId: run!.id,
        membershipId: membership!.id,
        compensationPlanVersionId: version!.id,
        currency: "CNY",
        approvedSeconds: 3_600,
        pendingSeconds: 0,
        grossAmount: "100.000000",
        finalAmount: "100.000000",
      })
      .returning();
    const [payslip] = await db
      .insert(payslips)
      .values({ payrollItemId: item!.id, documentHash: "receipt-document" })
      .returning();

    const service = new PayrollService(db);
    const before = await service.listOwn(employeeActor);
    expect(before.currentPlan?.version).toMatchObject({
      type: "hourly",
      baseAmount: "100.000000",
    });
    expect(before.livePreview).toMatchObject({
      currency: "CNY",
      approvedSeconds: 3_600,
      estimatedAmount: "100.000000",
    });
    const ownerOverview = await service.managementOverview(ownerActor);
    expect(ownerOverview.liveItems).toHaveLength(1);
    expect(ownerOverview.liveItems[0]).toMatchObject({
      membershipId: membership!.id,
      displayName: "员工",
      preview: {
        approvedSeconds: 3_600,
        estimatedAmount: "100.000000",
      },
    });
    expect(
      ownerOverview.liveItems.some(
        (entry) => entry.membershipId === ownerMembership!.id,
      ),
    ).toBe(false);
    expect(before.items[0]?.payslip?.acknowledgedAt).toBeNull();

    const acknowledged = await service.acknowledgePayslip(employeeActor, payslip!.id);
    expect(acknowledged.acknowledgedAt).toBeInstanceOf(Date);
    const repeated = await service.acknowledgePayslip(employeeActor, payslip!.id);
    expect(repeated.acknowledgedAt?.toISOString()).toBe(
      acknowledged.acknowledgedAt?.toISOString(),
    );

    const financeFile = await service.financeExport(ownerActor, run!.id);
    expect(financeFile.fileName).toContain("财务薪资账单");
    expect(financeFile.csv.startsWith("\uFEFF员工,薪资周期")).toBe(true);
    expect(financeFile.csv).toContain("员工,历史周期");

    const reopened = await service.reopenSettlement(ownerActor, run!.id);
    expect(reopened).toMatchObject({ status: "cancelled" });
    const [cancelledRun] = await db
      .select()
      .from(payrollRuns)
      .where(eq(payrollRuns.id, run!.id));
    expect(cancelledRun?.status).toBe("cancelled");
    const [reopenedPeriod] = await db
      .select()
      .from(payPeriods)
      .where(eq(payPeriods.id, period!.id));
    expect(reopenedPeriod).toMatchObject({ status: "open", settledAt: null, lockedAt: null });

    await service.updateSettings(ownerActor, 15, 9 * 60 + 30);
    const after = await service.listOwn(employeeActor);
    expect(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        day: "2-digit",
      }).format(new Date(after.livePreview!.period.cutoffAt)),
    ).toBe("15");
    expect(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(after.livePreview!.period.cutoffAt)),
    ).toBe("09:30");
    expect(after.items).toHaveLength(0);
  });

  it("keeps weekly rewards inside the payroll month boundary", async () => {
    const db = await createTestDatabase();
    const [organization] = await db
      .insert(organizations)
      .values({ name: "周奖励测试", timezone: "UTC", payrollCutoffDay: 10 })
      .returning();
    const [ownerUser] = await db.insert(users).values({ displayName: "Owner" }).returning();
    const [ownerMembership] = await db
      .insert(orgMemberships)
      .values({
        organizationId: organization!.id,
        userId: ownerUser!.id,
        status: "active",
        joinedAt: new Date("2025-01-01T00:00:00.000Z"),
      })
      .returning();
    await db.insert(organizationOwners).values({
      organizationId: organization!.id,
      membershipId: ownerMembership!.id,
    });
    const [employeeUser] = await db.insert(users).values({ displayName: "员工" }).returning();
    const [employeeMembership] = await db
      .insert(orgMemberships)
      .values({
        organizationId: organization!.id,
        userId: employeeUser!.id,
        status: "active",
        joinedAt: new Date("2025-01-01T00:00:00.000Z"),
      })
      .returning();
    const ownerActor = {
      organizationId: organization!.id,
      membershipId: ownerMembership!.id,
    };
    const service = new PayrollService(db);
    await service.configurePlan(ownerActor, {
      membershipId: employeeMembership!.id,
      name: "含周奖励的时薪",
      type: "hourly",
      currency: "CNY",
      baseAmount: "100",
      effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
      pendingReviewCountsInEstimate: true,
      rules: [{
        type: "weekly_bonus",
        priority: 400,
        thresholdSeconds: 30 * 3_600,
        rewardSeconds: 5 * 3_600,
      }],
    });
    const overview = await service.managementOverview(ownerActor);
    expect(overview.members.find(
      (member) => member.membershipId === employeeMembership!.id,
    )?.plan?.rules).toEqual([
      expect.objectContaining({
        type: "weekly_bonus",
        thresholdSeconds: 108_000,
        rewardSeconds: 18_000,
      }),
    ]);

    await db.insert(workSessions).values([
      {
        organizationId: organization!.id,
        membershipId: employeeMembership!.id,
        startAt: new Date("2026-08-31T00:00:00.000Z"),
        endAt: new Date("2026-09-01T00:00:00.000Z"),
        timezone: "UTC",
        grossSeconds: 24 * 3_600,
        netSeconds: 24 * 3_600,
        source: "manual",
        content: "上一周期已锁定工作",
        result: "完成",
        submissionStatus: "submitted",
        approvalStatus: "locked",
        visibility: "management_only",
      },
      {
        organizationId: organization!.id,
        membershipId: employeeMembership!.id,
        startAt: new Date("2026-09-01T00:00:00.000Z"),
        endAt: new Date("2026-09-01T07:00:00.000Z"),
        timezone: "UTC",
        grossSeconds: 7 * 3_600,
        netSeconds: 7 * 3_600,
        source: "manual",
        content: "本周期工作",
        result: "完成",
        submissionStatus: "submitted",
        approvalStatus: "approved",
        visibility: "management_only",
      },
    ]);
    const [period] = await db
      .insert(payPeriods)
      .values({
        organizationId: organization!.id,
        name: "2026 年 9 月",
        timezone: "UTC",
        startsAt: new Date("2026-09-01T00:00:00.000Z"),
        endsAt: new Date("2026-10-01T00:00:00.000Z"),
        cutoffAt: new Date("2026-10-10T10:00:00.000Z"),
      })
      .returning();
    const run = await service.calculate(ownerActor, period!.id);
    expect(run.calculationVersion).toBe("payroll-engine-v4-period-week-bonus");
    const [item] = await db
      .select()
      .from(payrollItems)
      .where(eq(payrollItems.payrollRunId, run.id));
    expect(item).toMatchObject({
      approvedSeconds: 25_200,
      pendingSeconds: 0,
      grossAmount: "700.000000",
      finalAmount: "700.000000",
      estimate: false,
    });
    const components = await db
      .select()
      .from(payrollItemComponents)
      .where(eq(payrollItemComponents.payrollItemId, item!.id));
    expect(components.filter((component) => component.type === "bonus")).toHaveLength(0);
  });
});
