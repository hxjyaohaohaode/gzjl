import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "@workbench/db";
import {
  compensationPlans,
  compensationPlanVersions,
  organizations,
  orgMemberships,
  payrollItemComponents,
  payrollItems,
  payrollRuns,
  payPeriods,
  users,
} from "@workbench/db/schema";

import { AnalyticsService, type AnalyticsActor } from "../analytics/service.js";
import { PayrollService } from "../payroll/service.js";
import type { AiConfigurationService } from "./configuration.js";
import { AiPayrollAccessError, AiService } from "./service.js";

const clients: PGlite[] = [];

async function createTestDatabase(): Promise<Database> {
  const client = new PGlite();
  clients.push(client);
  const migrationsDir = resolve(
    import.meta.dirname,
    "../../../../packages/db/drizzle",
  );
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

function configuredAi(): AiConfigurationService {
  return {
    resolveEffective: async () => ({
      source: "deployment_default",
      baseUrl: "https://provider.example/v1",
      apiKey: "not-persisted-by-ai-job",
      model: "safe-model",
      maxOutputTokens: 1_200,
      maxAttempts: 2,
    }),
    assertQuota: async () => undefined,
  } as unknown as AiConfigurationService;
}

async function seedPayroll(db: Database) {
  const [organization] = await db
    .insert(organizations)
    .values({ name: "工资解释测试组织", timezone: "Asia/Shanghai" })
    .returning();
  const [user] = await db
    .insert(users)
    .values({ displayName: "测试员工" })
    .returning();
  const [membership] = await db
    .insert(orgMemberships)
    .values({
      organizationId: organization!.id,
      userId: user!.id,
      status: "active",
      joinedAt: new Date("2026-01-01T00:00:00.000Z"),
    })
    .returning();
  const [plan] = await db
    .insert(compensationPlans)
    .values({
      organizationId: organization!.id,
      membershipId: membership!.id,
      name: "本人小时工资",
      type: "hourly",
      currency: "CNY",
      createdBy: membership!.id,
    })
    .returning();
  const [version] = await db
    .insert(compensationPlanVersions)
    .values({
      compensationPlanId: plan!.id,
      version: 1,
      type: "hourly",
      baseAmount: "80.000000",
      baseUnit: "hour",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      createdBy: membership!.id,
    })
    .returning();
  const [period] = await db
    .insert(payPeriods)
    .values({
      organizationId: organization!.id,
      name: "2026 年 9 月",
      timezone: "Asia/Shanghai",
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      endsAt: new Date("2026-10-01T00:00:00.000Z"),
      cutoffAt: new Date("2026-10-05T00:00:00.000Z"),
      status: "pending_confirmation",
    })
    .returning();
  const [run] = await db
    .insert(payrollRuns)
    .values({
      payPeriodId: period!.id,
      runNumber: 1,
      status: "ready",
      calculationVersion: "payroll-engine-v2-daily-trace",
      requestedBy: membership!.id,
      inputHash: "salary-explanation-input-hash",
      completedAt: new Date("2026-09-30T12:00:00.000Z"),
    })
    .returning();
  const [item] = await db
    .insert(payrollItems)
    .values({
      payrollRunId: run!.id,
      membershipId: membership!.id,
      compensationPlanVersionId: version!.id,
      currency: "CNY",
      approvedSeconds: 54_000,
      pendingSeconds: 3_600,
      grossAmount: "1200.000000",
      adjustmentAmount: "80.000000",
      finalAmount: "1280.000000",
      estimate: true,
      needsReview: true,
    })
    .returning();
  const [component] = await db
    .insert(payrollItemComponents)
    .values({
      payrollItemId: item!.id,
      type: "base",
      label: "工作日基础计薪",
      sourceEntityType: "compensation_plan_version",
      sourceEntityId: version!.id,
      sourceVersion: "1",
      quantity: "54000.000000",
      unit: "second",
      rate: "80.000000",
      multiplier: "1.000000",
      amount: "1200.000000",
      calculationTrace: {
        date: "2026-09-04",
        estimate: true,
        sourceIds: Array.from({ length: 100 }, (_, index) => `work-${index}`),
        ignoredProviderPayload: "must-not-enter-the-ai-context",
      },
    })
    .returning();
  return { organization: organization!, membership: membership!, period: period!, item: item!, component: component! };
}

describe("AI payroll provenance", () => {
  it("copies only the requester's latest payroll facts into a salary explanation job", async () => {
    const db = await createTestDatabase();
    const seeded = await seedPayroll(db);
    const actor: AnalyticsActor = {
      organizationId: seeded.organization.id,
      membershipId: seeded.membership.id,
      grants: [
        {
          permission: "work.view_own",
          scopeKind: "self",
          scopeId: seeded.membership.id,
        },
        {
          permission: "payroll.view_own",
          scopeKind: "self",
          scopeId: seeded.membership.id,
        },
      ],
    };
    const service = new AiService(
      db,
      new AnalyticsService(db),
      configuredAi(),
      new PayrollService(db),
    );

    const job = await service.requestReport(actor, {
      taskType: "salary_explanation",
      scope: "self",
      from: new Date("2026-08-01T00:00:00.000Z"),
      to: new Date("2026-11-01T00:00:00.000Z"),
    });
    const summary = job.sourceSummary as {
      payroll?: {
        privacyScope?: string;
        items?: Array<{
          period: { id: string; name: string };
          item: { id: string; finalAmount: string; estimate: boolean; needsReview: boolean };
          components: Array<{
            id: string;
            amount: string;
            rate: string | null;
            calculationTrace: { sourceIds?: string[]; ignoredProviderPayload?: string };
          }>;
        }>;
      };
      sources?: Array<{ entityType: string; entityId: string; label: string }>;
    };

    expect(job.promptTemplateVersion).toBe("structured-work-intelligence-v5-payroll");
    expect(summary.payroll?.privacyScope).toBe("self_only");
    expect(summary.payroll?.items).toEqual([
      expect.objectContaining({
        period: expect.objectContaining({
          id: seeded.period.id,
          name: "2026 年 9 月",
        }),
        item: expect.objectContaining({
          id: seeded.item.id,
          finalAmount: "1280.000000",
          estimate: true,
          needsReview: true,
        }),
        components: [
          expect.objectContaining({
            id: seeded.component.id,
            amount: "1200.000000",
            rate: "80.000000",
          }),
        ],
      }),
    ]);
    expect(summary.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "payroll_item",
          entityId: seeded.item.id,
        }),
        expect.objectContaining({
          entityType: "payroll_component",
          entityId: seeded.component.id,
        }),
      ]),
    );
    expect(summary.payroll?.items?.[0]?.components[0]?.calculationTrace.sourceIds).toHaveLength(60);
    expect(JSON.stringify(summary)).not.toContain("must-not-enter-the-ai-context");
    expect(JSON.stringify(summary).length).toBeLessThanOrEqual(48_000);
    expect(JSON.stringify(summary)).not.toContain("not-persisted-by-ai-job");
  });

  it("rejects salary explanation without an own-payroll grant or in team scope", async () => {
    const db = await createTestDatabase();
    const seeded = await seedPayroll(db);
    const service = new AiService(
      db,
      new AnalyticsService(db),
      configuredAi(),
      new PayrollService(db),
    );
    const baseActor: AnalyticsActor = {
      organizationId: seeded.organization.id,
      membershipId: seeded.membership.id,
      grants: [],
    };
    const request = {
      taskType: "salary_explanation" as const,
      from: new Date("2026-08-01T00:00:00.000Z"),
      to: new Date("2026-11-01T00:00:00.000Z"),
    };

    await expect(
      service.requestReport(baseActor, { ...request, scope: "self" }),
    ).rejects.toBeInstanceOf(AiPayrollAccessError);
    await expect(
      service.requestReport(
        {
          ...baseActor,
          grants: [
            {
              permission: "payroll.view_own",
              scopeKind: "self",
              scopeId: seeded.membership.id,
            },
          ],
        },
        { ...request, scope: "team" },
      ),
    ).rejects.toBeInstanceOf(AiPayrollAccessError);
  });
});
