import { createHash } from "node:crypto";

import { and, desc, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import type { Database } from "@workbench/db";
import {
  auditLogs,
  compensationPlans,
  compensationPlanVersions,
  payrollAdjustments,
  payrollItemComponents,
  payrollItems,
  payrollRuns,
  payrollSnapshots,
  payPeriods,
  payslips,
  rateRules,
  workBreaks,
  workSessions,
} from "@workbench/db/schema";
import {
  addDecimalAmounts,
  calculateHourlyPayroll,
  multiplyDecimalAmount,
  type PayableInterval,
  type PayrollRateRule,
} from "@workbench/shared";

export interface PayrollActor {
  organizationId: string;
  membershipId: string;
}

export class PayrollNotFoundError extends Error {
  constructor() {
    super("薪资周期或计算批次不存在。")
    this.name = "PayrollNotFoundError";
  }
}

export class PayrollConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayrollConflictError";
  }
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function localDate(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function parseRule(row: typeof rateRules.$inferSelect): PayrollRateRule | null {
  if (!["weekday", "weekend", "holiday", "night_window", "overtime"].includes(row.type)) {
    return null;
  }
  const conditions = (row.conditions ?? {}) as Record<string, unknown>;
  const calculation = (row.calculation ?? {}) as Record<string, unknown>;
  const multiplier = String(calculation.multiplier ?? "1");
  const parseHour = (value: unknown, fallback: number) => {
    if (typeof value !== "string") return fallback;
    const hour = Number(value.split(":")[0]);
    return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : fallback;
  };
  return {
    id: row.id,
    type: row.type as PayrollRateRule["type"],
    priority: row.priority,
    multiplier,
    stack: calculation.stack === true,
    ...(row.type === "night_window"
      ? {
          startHour: parseHour(conditions.start, 22),
          endHour: parseHour(conditions.end, 6),
        }
      : {}),
    ...(row.type === "overtime" && typeof conditions.thresholdSeconds === "number"
      ? { thresholdSeconds: conditions.thresholdSeconds }
      : {}),
    ...(row.type === "holiday" && Array.isArray(conditions.dates)
      ? { holidayDates: conditions.dates.filter((item): item is string => typeof item === "string") }
      : {}),
  };
}

function payableIntervals(
  session: typeof workSessions.$inferSelect,
  breaks: Array<typeof workBreaks.$inferSelect>,
): PayableInterval[] {
  const clippedBreaks = breaks
    .map((entry) => ({
      startAt: entry.startAt < session.startAt ? session.startAt : entry.startAt,
      endAt: entry.endAt > session.endAt ? session.endAt : entry.endAt,
    }))
    .filter((entry) => entry.endAt > entry.startAt)
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const raw: Array<{ startAt: Date; endAt: Date }> = [];
  let cursor = session.startAt;
  for (const entry of clippedBreaks) {
    if (entry.startAt > cursor) raw.push({ startAt: cursor, endAt: entry.startAt });
    if (entry.endAt > cursor) cursor = entry.endAt;
  }
  if (cursor < session.endAt) raw.push({ startAt: cursor, endAt: session.endAt });

  let remaining = session.netSeconds;
  const result: PayableInterval[] = [];
  for (const interval of raw) {
    if (remaining <= 0) break;
    const available = Math.floor(
      (interval.endAt.getTime() - interval.startAt.getTime()) / 1_000,
    );
    const seconds = Math.min(available, remaining);
    if (seconds > 0) {
      result.push({
        sourceId: session.id,
        startAt: interval.startAt,
        endAt: new Date(interval.startAt.getTime() + seconds * 1_000),
        approvalStatus:
          session.approvalStatus === "approved" ? "approved" : "pending_review",
      });
      remaining -= seconds;
    }
  }
  if (remaining > 0) {
    throw new PayrollConflictError(`工时 ${session.id} 的净时长与休息区间不一致。`);
  }
  return result;
}

export class PayrollService {
  constructor(private readonly db: Database) {}

  async calculate(actor: PayrollActor, payPeriodId: string) {
    const [period] = await this.db
      .select()
      .from(payPeriods)
      .where(
        and(
          eq(payPeriods.id, payPeriodId),
          eq(payPeriods.organizationId, actor.organizationId),
        ),
      )
      .limit(1);
    if (!period) throw new PayrollNotFoundError();
    if (["settled", "locked"].includes(period.status)) {
      throw new PayrollConflictError("已结算或锁定的周期不能重新计算。")
    }

    const planRows = await this.db
      .select({ plan: compensationPlans, version: compensationPlanVersions })
      .from(compensationPlans)
      .innerJoin(
        compensationPlanVersions,
        and(
          eq(compensationPlanVersions.compensationPlanId, compensationPlans.id),
          eq(compensationPlanVersions.version, compensationPlans.activeVersion),
        ),
      )
      .where(
        and(
          eq(compensationPlans.organizationId, actor.organizationId),
          isNull(compensationPlans.archivedAt),
          lt(compensationPlanVersions.effectiveFrom, period.endsAt),
          or(
            isNull(compensationPlanVersions.effectiveTo),
            gt(compensationPlanVersions.effectiveTo, period.startsAt),
          ),
        ),
      );
    if (planRows.length === 0) throw new PayrollConflictError("当前周期没有生效的薪资方案。")

    const sessions = await this.db
      .select()
      .from(workSessions)
      .where(
        and(
          eq(workSessions.organizationId, actor.organizationId),
          lt(workSessions.startAt, period.endsAt),
          gt(workSessions.endAt, period.startsAt),
          inArray(workSessions.approvalStatus, ["approved", "pending_review"]),
          isNull(workSessions.deletedAt),
        ),
      )
      .orderBy(workSessions.membershipId, workSessions.startAt);
    const sessionIds = sessions.map((session) => session.id);
    const breaks =
      sessionIds.length > 0
        ? await this.db
            .select()
            .from(workBreaks)
            .where(inArray(workBreaks.workSessionId, sessionIds))
        : [];
    const breaksBySession = new Map<string, Array<typeof workBreaks.$inferSelect>>();
    for (const entry of breaks) {
      const list = breaksBySession.get(entry.workSessionId) ?? [];
      list.push(entry);
      breaksBySession.set(entry.workSessionId, list);
    }

    const versionIds = planRows.map((row) => row.version.id);
    const rules = await this.db
      .select()
      .from(rateRules)
      .where(inArray(rateRules.compensationPlanVersionId, versionIds))
      .orderBy(rateRules.priority);
    const rulesByVersion = new Map<string, PayrollRateRule[]>();
    for (const row of rules) {
      const parsed = parseRule(row);
      if (!parsed) continue;
      const list = rulesByVersion.get(row.compensationPlanVersionId) ?? [];
      list.push(parsed);
      rulesByVersion.set(row.compensationPlanVersionId, list);
    }
    const adjustments = await this.db
      .select()
      .from(payrollAdjustments)
      .where(
        and(
          eq(payrollAdjustments.organizationId, actor.organizationId),
          eq(payrollAdjustments.payPeriodId, period.id),
        ),
      );

    const calculatedItems = planRows.map(({ plan, version }) => {
      const memberSessions = sessions.filter(
        (session) => session.membershipId === plan.membershipId,
      );
      const intervals = memberSessions.flatMap((session) =>
        payableIntervals(session, breaksBySession.get(session.id) ?? []),
      );
      const approvedSeconds = intervals
        .filter((interval) => interval.approvalStatus === "approved")
        .reduce(
          (total, interval) =>
            total + Math.floor((interval.endAt.getTime() - interval.startAt.getTime()) / 1_000),
          0,
        );
      const pendingSeconds = intervals
        .filter((interval) => interval.approvalStatus === "pending_review")
        .reduce(
          (total, interval) =>
            total + Math.floor((interval.endAt.getTime() - interval.startAt.getTime()) / 1_000),
          0,
        );

      let grossAmount: string;
      let estimate = false;
      let needsReview = false;
      let components: Array<{
        type: "base" | "weekday" | "weekend" | "holiday" | "night" | "overtime" | "project";
        label: string;
        amount: string;
        quantity?: string;
        unit?: string;
        rate?: string;
        multiplier?: string;
        trace: unknown;
      }>;

      if (version.type === "hourly" || version.type === "hybrid") {
        const hourly = calculateHourlyPayroll({
          hourlyRate: version.baseAmount,
          timezone: period.timezone,
          intervals,
          rules: rulesByVersion.get(version.id) ?? [],
          includePendingAsEstimate: version.pendingReviewCountsInEstimate,
        });
        grossAmount = hourly.grossAmount;
        estimate = hourly.estimate;
        components = hourly.components.map((component) => ({
          type: component.type === "night_window" ? "night" : component.type,
          label: component.label,
          amount: component.amount,
          quantity: String(component.seconds),
          unit: "second",
          rate: component.hourlyRate,
          multiplier: component.multiplier,
          trace: { ...component.trace, sourceIds: component.sourceIds, estimate: component.estimate },
        }));
        if (version.type === "hybrid") {
          const config = version.config as Record<string, unknown>;
          if (typeof config.fixedAmount === "string") {
            grossAmount = addDecimalAmounts(grossAmount, config.fixedAmount);
            components.push({
              type: "base",
              label: "混合方案固定部分",
              amount: config.fixedAmount,
              quantity: "1",
              unit: "period",
              trace: { planVersionId: version.id },
            });
          }
        }
      } else if (version.type === "daily") {
        const dates = new Set(
          intervals
            .filter(
              (interval) =>
                interval.approvalStatus === "approved" ||
                version.pendingReviewCountsInEstimate,
            )
            .map((interval) => localDate(interval.startAt, period.timezone)),
        );
        grossAmount = multiplyDecimalAmount(version.baseAmount, dates.size);
        estimate = pendingSeconds > 0 && version.pendingReviewCountsInEstimate;
        components = [{
          type: "base",
          label: "按工作日计薪",
          amount: grossAmount,
          quantity: String(dates.size),
          unit: "day",
          rate: version.baseAmount,
          trace: { dates: [...dates] },
        }];
      } else {
        grossAmount = version.baseAmount;
        needsReview = version.type === "project_based";
        components = [{
          type: version.type === "project_based" ? "project" : "base",
          label: version.type === "monthly" ? "月度固定薪资" : version.type === "fixed_period" ? "周期固定薪资" : "项目制金额",
          amount: grossAmount,
          quantity: "1",
          unit: version.baseUnit,
          trace: { planVersionId: version.id },
        }];
      }

      const memberAdjustments = adjustments.filter(
        (adjustment) =>
          adjustment.membershipId === plan.membershipId && adjustment.approvedAt !== null,
      );
      const adjustmentAmount = addDecimalAmounts(
        ...memberAdjustments.map((adjustment) => adjustment.amount),
      );
      return {
        membershipId: plan.membershipId,
        planVersionId: version.id,
        currency: plan.currency,
        approvedSeconds,
        pendingSeconds,
        grossAmount,
        adjustmentAmount,
        finalAmount: addDecimalAmounts(grossAmount, adjustmentAmount),
        estimate,
        needsReview,
        components,
        adjustments: memberAdjustments,
      };
    });

    const snapshotPayload = {
      calculationVersion: "payroll-engine-v1",
      period,
      plans: planRows,
      rules,
      sessions,
      breaks,
      adjustments,
      calculatedItems,
    };
    const inputHash = sha256(snapshotPayload);
    const [existing] = await this.db
      .select()
      .from(payrollRuns)
      .where(
        and(eq(payrollRuns.payPeriodId, period.id), eq(payrollRuns.inputHash, inputHash)),
      )
      .limit(1);
    if (existing) return existing;

    return this.db.transaction(async (tx) => {
      const [lastRun] = await tx
        .select({ runNumber: payrollRuns.runNumber })
        .from(payrollRuns)
        .where(eq(payrollRuns.payPeriodId, period.id))
        .orderBy(desc(payrollRuns.runNumber))
        .limit(1);
      const [run] = await tx
        .insert(payrollRuns)
        .values({
          payPeriodId: period.id,
          runNumber: (lastRun?.runNumber ?? 0) + 1,
          status: calculatedItems.some((item) => item.needsReview)
            ? "review_required"
            : "ready",
          calculationVersion: "payroll-engine-v1",
          requestedBy: actor.membershipId,
          inputHash,
          startedAt: new Date(),
          completedAt: new Date(),
        })
        .returning();
      if (!run) throw new Error("Failed to create payroll run");

      for (const item of calculatedItems) {
        const [payrollItem] = await tx
          .insert(payrollItems)
          .values({
            payrollRunId: run.id,
            membershipId: item.membershipId,
            compensationPlanVersionId: item.planVersionId,
            currency: item.currency,
            approvedSeconds: item.approvedSeconds,
            pendingSeconds: item.pendingSeconds,
            grossAmount: item.grossAmount,
            adjustmentAmount: item.adjustmentAmount,
            finalAmount: item.finalAmount,
            estimate: item.estimate,
            needsReview: item.needsReview,
          })
          .returning({ id: payrollItems.id });
        if (!payrollItem) throw new Error("Failed to create payroll item");
        if (item.components.length > 0) {
          await tx.insert(payrollItemComponents).values(
            item.components.map((component) => ({
              payrollItemId: payrollItem.id,
              type: component.type,
              label: component.label,
              quantity: component.quantity,
              unit: component.unit,
              rate: component.rate,
              multiplier: component.multiplier,
              amount: component.amount,
              calculationTrace: component.trace,
            })),
          );
        }
        if (item.adjustments.length > 0) {
          await tx.insert(payrollItemComponents).values(
            item.adjustments.map((adjustment) => {
              const type: "deduction" | "allowance" = adjustment.amount.startsWith("-")
                ? "deduction"
                : "allowance";
              return {
                payrollItemId: payrollItem.id,
                type,
                label: adjustment.reason,
                sourceEntityType: "payroll_adjustment",
                sourceEntityId: adjustment.id,
                amount: adjustment.amount,
                calculationTrace: { approvedBy: adjustment.approvedBy },
              };
            }),
          );
        }
      }
      await tx.insert(payrollSnapshots).values({
        payrollRunId: run.id,
        snapshotHash: sha256(snapshotPayload),
        payload: snapshotPayload,
      });
      await tx
        .update(payPeriods)
        .set({ status: "pending_confirmation", updatedAt: new Date() })
        .where(eq(payPeriods.id, period.id));
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "payroll.calculated",
        entityType: "payroll_run",
        entityId: run.id,
        after: { runNumber: run.runNumber, inputHash, itemCount: calculatedItems.length },
      });
      return run;
    });
  }

  async settle(actor: PayrollActor, runId: string) {
    const [record] = await this.db
      .select({ run: payrollRuns, period: payPeriods })
      .from(payrollRuns)
      .innerJoin(payPeriods, eq(payPeriods.id, payrollRuns.payPeriodId))
      .where(
        and(
          eq(payrollRuns.id, runId),
          eq(payPeriods.organizationId, actor.organizationId),
        ),
      )
      .limit(1);
    if (!record) throw new PayrollNotFoundError();
    if (record.run.status !== "ready") {
      throw new PayrollConflictError("只有已就绪且无待复核项的批次可以结算。")
    }
    return this.db.transaction(async (tx) => {
      const settledAt = new Date();
      const [run] = await tx
        .update(payrollRuns)
        .set({ status: "settled", settledAt })
        .where(and(eq(payrollRuns.id, runId), eq(payrollRuns.status, "ready")))
        .returning();
      if (!run) throw new PayrollConflictError("该批次已被其他操作处理。")
      await tx
        .update(payPeriods)
        .set({ status: "locked", settledAt, lockedAt: settledAt, updatedAt: settledAt })
        .where(eq(payPeriods.id, record.period.id));
      await tx
        .update(workSessions)
        .set({ approvalStatus: "locked", lockedAt: settledAt, updatedAt: settledAt })
        .where(
          and(
            eq(workSessions.organizationId, actor.organizationId),
            eq(workSessions.approvalStatus, "approved"),
            lt(workSessions.startAt, record.period.endsAt),
            gt(workSessions.endAt, record.period.startsAt),
          ),
        );
      const items = await tx
        .select()
        .from(payrollItems)
        .where(eq(payrollItems.payrollRunId, run.id));
      if (items.length > 0) {
        await tx.insert(payslips).values(
          items.map((item) => ({
            payrollItemId: item.id,
            documentHash: sha256({
              payrollItemId: item.id,
              finalAmount: item.finalAmount,
              currency: item.currency,
              settledAt,
            }),
          })),
        );
      }
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "payroll.settled",
        entityType: "payroll_run",
        entityId: run.id,
        after: { settledAt, itemCount: items.length },
      });
      return run;
    });
  }

  async listOwn(actor: PayrollActor) {
    return this.db
      .select({ item: payrollItems, run: payrollRuns, period: payPeriods })
      .from(payrollItems)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.payrollRunId))
      .innerJoin(payPeriods, eq(payPeriods.id, payrollRuns.payPeriodId))
      .where(
        and(
          eq(payrollItems.membershipId, actor.membershipId),
          eq(payPeriods.organizationId, actor.organizationId),
        ),
      )
      .orderBy(desc(payPeriods.endsAt), desc(payrollRuns.runNumber));
  }
}
