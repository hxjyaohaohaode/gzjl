import { createHash } from "node:crypto";

import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
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
  organizations,
  organizationOwners,
  orgMemberships,
  users,
  workBreaks,
  workSessionProjectLinks,
  workSessions,
  workSessionVersions,
} from "@workbench/db/schema";
import {
  addDecimalAmounts,
  calculateHourlyPayroll,
  localDateKeysForIntervals,
  multiplyDecimalAmount,
  prorateDecimalAmount,
  type PayableInterval,
  type PayrollRateRule,
} from "@workbench/shared";

export interface PayrollActor {
  organizationId: string;
  membershipId: string;
}

export type CompensationPlanType =
  | "hourly"
  | "daily"
  | "monthly"
  | "fixed_period"
  | "project_based"
  | "hybrid";

export interface ConfigureCompensationPlanInput {
  membershipId: string;
  name: string;
  type: CompensationPlanType;
  currency: string;
  baseAmount: string;
  effectiveFrom: Date;
  pendingReviewCountsInEstimate: boolean;
  fixedAmount?: string | undefined;
  rules: Array<
    | {
        type: "weekly_bonus";
        priority: number;
        thresholdSeconds: number;
        rewardSeconds: number;
      }
    | {
        type: "weekday" | "weekend" | "holiday" | "night_window" | "overtime";
        priority: number;
        multiplier: string;
        startHour?: number | undefined;
        endHour?: number | undefined;
        thresholdSeconds?: number | undefined;
        holidayDates?: string[] | undefined;
      }
  >;
}

export interface CreatePayPeriodInput {
  name: string;
  timezone: string;
  startsAt: Date;
  endsAt: Date;
  cutoffAt: Date;
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

function decimalMicros(value: string): bigint {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const result = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0").slice(0, 6));
  return negative ? -result : result;
}

function formatMicros(value: bigint): string {
  const negative = value < 0;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / 1_000_000n}.${(absolute % 1_000_000n)
    .toString()
    .padStart(6, "0")}`;
}

function splitMicros(value: bigint, count: number): bigint[] {
  if (count <= 0) return [];
  const divisor = BigInt(count);
  const quotient = value / divisor;
  let remainder = value % divisor;
  return Array.from({ length: count }, () => {
    if (remainder === 0n) return quotient;
    const extra = remainder > 0n ? 1n : -1n;
    remainder -= extra;
    return quotient + extra;
  });
}

function parseRule(row: typeof rateRules.$inferSelect): PayrollRateRule | null {
  const conditions = (row.conditions ?? {}) as Record<string, unknown>;
  if (
    row.type !== "bonus" &&
    !["weekday", "weekend", "holiday", "night_window", "overtime"].includes(row.type)
  ) {
    return null;
  }
  if (row.type === "bonus" && conditions.kind !== "weekly_hours_threshold") {
    return null;
  }
  const calculation = (row.calculation ?? {}) as Record<string, unknown>;
  const multiplier = String(calculation.multiplier ?? "1");
  const parseHour = (value: unknown, fallback: number) => {
    if (typeof value !== "string") return fallback;
    const hour = Number(value.split(":")[0]);
    return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : fallback;
  };
  return {
    id: row.id,
    type: row.type === "bonus" ? "weekly_bonus" : row.type as PayrollRateRule["type"],
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
    ...(row.type === "bonus"
      ? {
          thresholdSeconds:
            typeof conditions.thresholdSeconds === "number"
              ? conditions.thresholdSeconds
              : 108_000,
          rewardSeconds:
            typeof calculation.rewardSeconds === "number"
              ? calculation.rewardSeconds
              : 18_000,
        }
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
          session.approvalStatus === "approved" || session.approvalStatus === "locked"
            ? "approved"
            : "pending_review",
      });
      remaining -= seconds;
    }
  }
  if (remaining > 0) {
    throw new PayrollConflictError(`工时 ${session.id} 的净时长与休息区间不一致。`);
  }
  return result;
}

function clipPayableIntervals(
  intervals: PayableInterval[],
  startsAt: Date,
  endsAt: Date,
): PayableInterval[] {
  return intervals.flatMap((interval) => {
    const startAt = interval.startAt < startsAt ? startsAt : interval.startAt;
    const endAt = interval.endAt > endsAt ? endsAt : interval.endAt;
    return endAt > startAt ? [{ ...interval, startAt, endAt }] : [];
  });
}

function zonedMonthBoundary(timezone: string, monthOffset: number): Date {
  const nowParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = Number(nowParts.find((part) => part.type === "year")?.value);
  const month = Number(nowParts.find((part) => part.type === "month")?.value);
  const targetAsUtc = new Date(Date.UTC(year, month - 1 + monthOffset, 1));
  const offsetParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(targetAsUtc);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(offsetParts.find((part) => part.type === type)?.value ?? 0);
  const representedLocalAsUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second"),
  );
  return new Date(targetAsUtc.getTime() - (representedLocalAsUtc - targetAsUtc.getTime()));
}

function zonedCutoffAt(timezone: string, cutoffDay: number): Date {
  const nowParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = Number(nowParts.find((part) => part.type === "year")?.value);
  const month = Number(nowParts.find((part) => part.type === "month")?.value);
  const targetAsUtc = new Date(
    Date.UTC(year, month, cutoffDay, 18),
  );
  const offsetParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(targetAsUtc);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(offsetParts.find((part) => part.type === type)?.value ?? 0);
  const representedLocalAsUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second"),
  );
  return new Date(targetAsUtc.getTime() - (representedLocalAsUtc - targetAsUtc.getTime()));
}

export class PayrollService {
  constructor(private readonly db: Database) {}

  private async buildLivePreview(
    actor: PayrollActor,
    currentPlan: {
      plan: typeof compensationPlans.$inferSelect;
      version: typeof compensationPlanVersions.$inferSelect;
    },
    organization: { timezone: string; payrollCutoffDay: number },
  ) {
    const startsAt = zonedMonthBoundary(organization.timezone, 0);
    const endsAt = zonedMonthBoundary(organization.timezone, 1);
    const weeklyContextStartsAt = new Date(startsAt.getTime() - 7 * 24 * 60 * 60_000);
    const currentSessions = await this.db
      .select()
      .from(workSessions)
      .where(
        and(
          eq(workSessions.organizationId, actor.organizationId),
          eq(workSessions.membershipId, actor.membershipId),
          eq(workSessions.recordKind, "fact"),
          inArray(workSessions.approvalStatus, ["approved", "pending_review", "locked"]),
          isNull(workSessions.deletedAt),
          lt(workSessions.startAt, endsAt),
          gt(workSessions.endAt, weeklyContextStartsAt),
        ),
      );
    const currentSessionIds = currentSessions.map((session) => session.id);
    const currentBreaks = currentSessionIds.length
      ? await this.db
          .select()
          .from(workBreaks)
          .where(inArray(workBreaks.workSessionId, currentSessionIds))
      : [];
    const currentBreaksBySession = new Map<
      string,
      Array<typeof workBreaks.$inferSelect>
    >();
    for (const entry of currentBreaks) {
      currentBreaksBySession.set(entry.workSessionId, [
        ...(currentBreaksBySession.get(entry.workSessionId) ?? []),
        entry,
      ]);
    }
    const weeklyContextIntervals = clipPayableIntervals(
      currentSessions.flatMap((session) =>
        payableIntervals(session, currentBreaksBySession.get(session.id) ?? []),
      ),
      weeklyContextStartsAt,
      endsAt,
    );
    const intervals = clipPayableIntervals(
      weeklyContextIntervals,
      startsAt,
      endsAt,
    );
    const approvedSeconds = intervals
      .filter((interval) => interval.approvalStatus === "approved")
      .reduce(
        (total, interval) =>
          total +
          Math.floor(
            (interval.endAt.getTime() - interval.startAt.getTime()) / 1_000,
          ),
        0,
      );
    const pendingSeconds = intervals
      .filter((interval) => interval.approvalStatus === "pending_review")
      .reduce(
        (total, interval) =>
          total +
          Math.floor(
            (interval.endAt.getTime() - interval.startAt.getTime()) / 1_000,
          ),
        0,
      );
    const version = currentPlan.version;
    let estimatedAmount: string;
    let needsReview = false;
    let weeklyBonusSeconds = 0;
    let weeklyBonusEstimatedSeconds = 0;
    if (version.type === "hourly" || version.type === "hybrid") {
      const currentRules = await this.db
        .select()
        .from(rateRules)
        .where(eq(rateRules.compensationPlanVersionId, version.id))
        .orderBy(asc(rateRules.priority));
      const hourly = calculateHourlyPayroll({
        hourlyRate: version.baseAmount,
        timezone: organization.timezone,
        intervals,
        weeklyContextIntervals,
        weeklyBonusEligibilityIntervals: clipPayableIntervals(
          intervals,
          version.effectiveFrom > startsAt ? version.effectiveFrom : startsAt,
          endsAt,
        ),
        rules: currentRules
          .map(parseRule)
          .filter((rule): rule is PayrollRateRule => Boolean(rule)),
        includePendingAsEstimate: version.pendingReviewCountsInEstimate,
      });
      estimatedAmount = hourly.grossAmount;
      weeklyBonusSeconds = hourly.weeklyBonusSeconds;
      weeklyBonusEstimatedSeconds = hourly.weeklyBonusEstimatedSeconds;
      if (version.type === "hybrid") {
        const fixedAmount = (version.config as Record<string, unknown>)
          .fixedAmount;
        if (typeof fixedAmount === "string") {
          estimatedAmount = addDecimalAmounts(estimatedAmount, fixedAmount);
        }
      }
    } else if (version.type === "daily") {
      const payableDates = localDateKeysForIntervals(
        intervals.filter(
          (interval) =>
            interval.approvalStatus === "approved" ||
            version.pendingReviewCountsInEstimate,
        ),
        organization.timezone,
      );
      estimatedAmount = multiplyDecimalAmount(
        version.baseAmount,
        payableDates.length,
      );
    } else {
      estimatedAmount = version.baseAmount;
      needsReview = version.type === "project_based";
    }
    return {
      period: {
        startsAt,
        endsAt,
        cutoffAt: zonedCutoffAt(
          organization.timezone,
          organization.payrollCutoffDay,
        ),
      },
      currency: currentPlan.plan.currency,
      planType: version.type,
      baseAmount: version.baseAmount,
      approvedSeconds,
      pendingSeconds,
      weeklyBonusSeconds,
      weeklyBonusEstimatedSeconds,
      estimatedAmount,
      includesPending: version.pendingReviewCountsInEstimate,
      needsReview,
    };
  }

  async managementOverview(actor: PayrollActor) {
    const [members, planRows, periods, runs, organization, owner, payrollRecords] = await Promise.all([
      this.db
        .select({
          membershipId: orgMemberships.id,
          displayName: users.displayName,
          status: orgMemberships.status,
        })
        .from(orgMemberships)
        .innerJoin(users, eq(users.id, orgMemberships.userId))
        .where(eq(orgMemberships.organizationId, actor.organizationId))
        .orderBy(asc(users.displayName)),
      this.db
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
          ),
        )
        .orderBy(asc(compensationPlans.createdAt)),
      this.db
        .select()
        .from(payPeriods)
        .where(eq(payPeriods.organizationId, actor.organizationId))
        .orderBy(desc(payPeriods.startsAt)),
      this.db
        .select({ run: payrollRuns, period: payPeriods })
        .from(payrollRuns)
        .innerJoin(payPeriods, eq(payPeriods.id, payrollRuns.payPeriodId))
        .where(eq(payPeriods.organizationId, actor.organizationId))
        .orderBy(desc(payrollRuns.createdAt)),
      this.db
        .select({
          timezone: organizations.timezone,
          payrollCutoffDay: organizations.payrollCutoffDay,
        })
        .from(organizations)
        .where(eq(organizations.id, actor.organizationId))
        .limit(1),
      this.db
        .select({ membershipId: organizationOwners.membershipId })
        .from(organizationOwners)
        .where(eq(organizationOwners.organizationId, actor.organizationId))
        .limit(1),
      this.db
        .select({
          item: payrollItems,
          run: payrollRuns,
          period: payPeriods,
          displayName: users.displayName,
        })
        .from(payrollItems)
        .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.payrollRunId))
        .innerJoin(payPeriods, eq(payPeriods.id, payrollRuns.payPeriodId))
        .innerJoin(orgMemberships, eq(orgMemberships.id, payrollItems.membershipId))
        .innerJoin(users, eq(users.id, orgMemberships.userId))
        .where(eq(payPeriods.organizationId, actor.organizationId))
        .orderBy(desc(payPeriods.endsAt), desc(payrollRuns.runNumber)),
    ]);
    const activeVersionIds = planRows.map((row) => row.version.id);
    const activeRuleRows =
      activeVersionIds.length > 0
        ? await this.db
            .select()
            .from(rateRules)
            .where(inArray(rateRules.compensationPlanVersionId, activeVersionIds))
            .orderBy(asc(rateRules.priority))
        : [];
    const rulesByVersion = new Map<string, PayrollRateRule[]>();
    for (const row of activeRuleRows) {
      const rule = parseRule(row);
      if (!rule) continue;
      rulesByVersion.set(row.compensationPlanVersionId, [
        ...(rulesByVersion.get(row.compensationPlanVersionId) ?? []),
        rule,
      ]);
    }
    const plansByMember = new Map(
      planRows.map((row) => [
        row.plan.membershipId,
        { ...row, rules: rulesByVersion.get(row.version.id) ?? [] },
      ] as const),
    );
    const latestPayrollItems = new Map<string, (typeof payrollRecords)[number]>();
    for (const record of payrollRecords) {
      const key = `${record.period.id}:${record.item.membershipId}`;
      if (!latestPayrollItems.has(key)) latestPayrollItems.set(key, record);
    }
    const organizationSettings = organization[0] ?? {
      timezone: "Asia/Shanghai",
      payrollCutoffDay: 10,
    };
    const liveItems = (
      await Promise.all(
        members
          .filter(
            (member) =>
              member.status === "active" &&
              member.membershipId !== owner[0]?.membershipId,
          )
          .map(async (member) => {
            const plan = plansByMember.get(member.membershipId);
            if (!plan) return null;
            return {
              membershipId: member.membershipId,
              displayName: member.displayName,
              preview: await this.buildLivePreview(
                { ...actor, membershipId: member.membershipId },
                plan,
                organizationSettings,
              ),
            };
          }),
      )
    ).filter((item): item is NonNullable<typeof item> => item !== null);
    return {
      members: members.map((member) => ({
        ...member,
        isOwner: member.membershipId === owner[0]?.membershipId,
        plan: plansByMember.get(member.membershipId) ?? null,
      })),
      periods,
      runs,
      latestItems: [...latestPayrollItems.values()],
      liveItems,
      settings: organizationSettings,
    };
  }

  async updateSettings(actor: PayrollActor, payrollCutoffDay: number) {
    const [before] = await this.db
      .select({ payrollCutoffDay: organizations.payrollCutoffDay })
      .from(organizations)
      .where(eq(organizations.id, actor.organizationId))
      .limit(1);
    if (!before) throw new PayrollNotFoundError();
    const [settings] = await this.db
      .update(organizations)
      .set({ payrollCutoffDay, updatedAt: new Date() })
      .where(eq(organizations.id, actor.organizationId))
      .returning({
        timezone: organizations.timezone,
        payrollCutoffDay: organizations.payrollCutoffDay,
      });
    await this.db.insert(auditLogs).values({
      organizationId: actor.organizationId,
      actorMembershipId: actor.membershipId,
      action: "payroll.settings_updated",
      entityType: "organization",
      entityId: actor.organizationId,
      before,
      after: settings,
    });
    return settings;
  }

  async configurePlan(
    actor: PayrollActor,
    input: ConfigureCompensationPlanInput,
  ) {
    return this.db.transaction(async (tx) => {
      const [member] = await tx
        .select({ id: orgMemberships.id, status: orgMemberships.status })
        .from(orgMemberships)
        .where(
          and(
            eq(orgMemberships.id, input.membershipId),
            eq(orgMemberships.organizationId, actor.organizationId),
          ),
        )
        .for("update")
        .limit(1);
      if (!member || member.status === "invited") {
        throw new PayrollNotFoundError();
      }

      const existingPlans = await tx
        .select()
        .from(compensationPlans)
        .where(
          and(
            eq(compensationPlans.organizationId, actor.organizationId),
            eq(compensationPlans.membershipId, input.membershipId),
            isNull(compensationPlans.archivedAt),
          ),
        )
        .for("update");
      if (existingPlans.length > 1) {
        throw new PayrollConflictError(
          "该成员存在多份未归档薪资方案，请先由管理员清理历史冲突。",
        );
      }

      const baseUnit: Record<CompensationPlanType, string> = {
        hourly: "hour",
        daily: "day",
        monthly: "month",
        fixed_period: "period",
        project_based: "project",
        hybrid: "hour",
      };
      const versionConfig =
        input.type === "hybrid" && input.fixedAmount
          ? { fixedAmount: input.fixedAmount }
          : {};
      const existing = existingPlans[0];
      let plan: typeof compensationPlans.$inferSelect;
      let versionNumber = 1;
      let previousVersion: typeof compensationPlanVersions.$inferSelect | undefined;

      if (existing) {
        [previousVersion] = await tx
          .select()
          .from(compensationPlanVersions)
          .where(
            and(
              eq(compensationPlanVersions.compensationPlanId, existing.id),
              eq(compensationPlanVersions.version, existing.activeVersion),
            ),
          )
          .for("update")
          .limit(1);
        if (!previousVersion) throw new PayrollConflictError("当前薪资方案版本缺失。");
        if (input.effectiveFrom <= previousVersion.effectiveFrom) {
          throw new PayrollConflictError(
            "新版本生效时间必须晚于当前版本；历史错误请通过审计更正流程处理。",
          );
        }
        versionNumber = existing.activeVersion + 1;
        await tx
          .update(compensationPlanVersions)
          .set({ effectiveTo: input.effectiveFrom })
          .where(eq(compensationPlanVersions.id, previousVersion.id));
        const [updated] = await tx
          .update(compensationPlans)
          .set({
            name: input.name,
            type: input.type,
            currency: input.currency,
            activeVersion: versionNumber,
            updatedAt: new Date(),
          })
          .where(eq(compensationPlans.id, existing.id))
          .returning();
        if (!updated) throw new Error("Failed to update compensation plan");
        plan = updated;
      } else {
        const [created] = await tx
          .insert(compensationPlans)
          .values({
            organizationId: actor.organizationId,
            membershipId: input.membershipId,
            name: input.name,
            type: input.type,
            currency: input.currency,
            activeVersion: 1,
            createdBy: actor.membershipId,
          })
          .returning();
        if (!created) throw new Error("Failed to create compensation plan");
        plan = created;
      }

      const [version] = await tx
        .insert(compensationPlanVersions)
        .values({
          compensationPlanId: plan.id,
          version: versionNumber,
          type: input.type,
          baseAmount: input.baseAmount,
          baseUnit: baseUnit[input.type],
          config: versionConfig,
          pendingReviewCountsInEstimate: input.pendingReviewCountsInEstimate,
          effectiveFrom: input.effectiveFrom,
          createdBy: actor.membershipId,
        })
        .returning();
      if (!version) throw new Error("Failed to create compensation plan version");
      if (input.rules.length > 0) {
        await tx.insert(rateRules).values(
          input.rules.map((rule) => ({
            compensationPlanVersionId: version.id,
            type: rule.type === "weekly_bonus" ? ("bonus" as const) : rule.type,
            priority: rule.priority,
            conditions:
              rule.type === "night_window"
                ? { start: `${rule.startHour ?? 22}:00`, end: `${rule.endHour ?? 6}:00` }
                : rule.type === "overtime"
                  ? { thresholdSeconds: rule.thresholdSeconds ?? 28_800 }
                  : rule.type === "weekly_bonus"
                    ? {
                        kind: "weekly_hours_threshold",
                        thresholdSeconds: rule.thresholdSeconds ?? 108_000,
                      }
                  : rule.type === "holiday"
                    ? { dates: rule.holidayDates ?? [] }
                    : {},
            calculation:
              rule.type === "weekly_bonus"
                ? { rewardSeconds: rule.rewardSeconds ?? 18_000 }
                : { multiplier: rule.multiplier, stack: false },
          })),
        );
      }
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: existing ? "payroll.plan_version_created" : "payroll.plan_created",
        entityType: "compensation_plan",
        entityId: plan.id,
        before: previousVersion
          ? {
              version: previousVersion.version,
              type: previousVersion.type,
              baseAmount: previousVersion.baseAmount,
              effectiveFrom: previousVersion.effectiveFrom,
              effectiveTo: input.effectiveFrom,
            }
          : null,
        after: {
          version: version.version,
          type: version.type,
          baseAmount: version.baseAmount,
          effectiveFrom: version.effectiveFrom,
          ruleCount: input.rules.length,
        },
      });
      return { plan, version };
    });
  }

  async createPeriod(actor: PayrollActor, input: CreatePayPeriodInput) {
    if (input.endsAt <= input.startsAt) {
      throw new PayrollConflictError("结算周期结束时间必须晚于开始时间。");
    }
    const [overlap] = await this.db
      .select({ id: payPeriods.id })
      .from(payPeriods)
      .where(
        and(
          eq(payPeriods.organizationId, actor.organizationId),
          lt(payPeriods.startsAt, input.endsAt),
          gt(payPeriods.endsAt, input.startsAt),
        ),
      )
      .limit(1);
    if (overlap) throw new PayrollConflictError("该时间范围与已有薪资周期重叠。");
    return this.db.transaction(async (tx) => {
      const [period] = await tx
        .insert(payPeriods)
        .values({ organizationId: actor.organizationId, ...input })
        .returning();
      if (!period) throw new Error("Failed to create pay period");
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "payroll.period_created",
        entityType: "pay_period",
        entityId: period.id,
        after: period,
      });
      return period;
    });
  }

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
        eq(compensationPlanVersions.compensationPlanId, compensationPlans.id),
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
      )
      .orderBy(
        asc(compensationPlans.membershipId),
        asc(compensationPlanVersions.effectiveFrom),
      );
    if (planRows.length === 0) throw new PayrollConflictError("当前周期没有生效的薪资方案。")

    const weeklyContextStartsAt = new Date(
      period.startsAt.getTime() - 7 * 24 * 60 * 60_000,
    );
    const contextSessions = await this.db
      .select()
      .from(workSessions)
      .where(
        and(
          eq(workSessions.organizationId, actor.organizationId),
          lt(workSessions.startAt, period.endsAt),
          gt(workSessions.endAt, weeklyContextStartsAt),
          eq(workSessions.recordKind, "fact"),
          inArray(workSessions.approvalStatus, ["approved", "pending_review", "locked"]),
          isNull(workSessions.deletedAt),
        ),
      )
      .orderBy(workSessions.membershipId, workSessions.startAt);
    const sessions = contextSessions.filter(
      (session) => session.startAt < period.endsAt && session.endAt > period.startsAt,
    );
    const sessionIds = contextSessions.map((session) => session.id);
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

    const groupedPlans = new Map<
      string,
      {
        plan: (typeof planRows)[number]["plan"];
        versions: Array<(typeof planRows)[number]["version"]>;
      }
    >();
    for (const row of planRows) {
      const group = groupedPlans.get(row.plan.id) ?? {
        plan: row.plan,
        versions: [],
      };
      group.versions.push(row.version);
      groupedPlans.set(row.plan.id, group);
    }
    const planByMember = new Map<string, string>();
    for (const { plan } of groupedPlans.values()) {
      const existingPlanId = planByMember.get(plan.membershipId);
      if (existingPlanId && existingPlanId !== plan.id) {
        throw new PayrollConflictError(
          `成员 ${plan.membershipId} 在当前周期存在多份生效薪资方案。`,
        );
      }
      planByMember.set(plan.membershipId, plan.id);
    }

    const calculatedItems = [...groupedPlans.values()].map(({ plan, versions }) => {
      const memberSessions = contextSessions.filter(
        (session) => session.membershipId === plan.membershipId,
      );
      const weeklyContextIntervals = clipPayableIntervals(
        memberSessions.flatMap((session) =>
          payableIntervals(session, breaksBySession.get(session.id) ?? []),
        ),
        weeklyContextStartsAt,
        period.endsAt,
      );
      const intervals = clipPayableIntervals(
        weeklyContextIntervals,
        period.startsAt,
        period.endsAt,
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

      let grossAmount = "0.000000";
      let estimate = false;
      let needsReview = false;
      const components: Array<{
        type: "base" | "weekday" | "weekend" | "holiday" | "night" | "overtime" | "project" | "bonus";
        label: string;
        amount: string;
        planVersionId: string;
        planVersion: number;
        quantity?: string;
        unit?: string;
        rate?: string;
        multiplier?: string;
        trace: unknown;
      }> = [];
      const orderedVersions = [...versions].sort(
        (left, right) => left.effectiveFrom.getTime() - right.effectiveFrom.getTime(),
      );
      const latestVersion = orderedVersions.at(-1)!;
      const periodSeconds = Math.floor(
        (period.endsAt.getTime() - period.startsAt.getTime()) / 1_000,
      );
      const awardedWeeklyBonusWeeks = new Set<string>();

      for (const version of orderedVersions) {
        const segmentStart =
          version.effectiveFrom > period.startsAt
            ? version.effectiveFrom
            : period.startsAt;
        const segmentEnd =
          version.effectiveTo && version.effectiveTo < period.endsAt
            ? version.effectiveTo
            : period.endsAt;
        if (segmentEnd <= segmentStart) continue;
        const versionIntervals = clipPayableIntervals(
          intervals,
          segmentStart,
          segmentEnd,
        );

        if (version.type === "hourly" || version.type === "hybrid") {
          const hourly = calculateHourlyPayroll({
            hourlyRate: version.baseAmount,
            timezone: period.timezone,
            intervals: versionIntervals,
            // Every version sees the final approved/pending state for the
            // whole natural week. Eligibility is still constrained by
            // `versionIntervals`, so a rule cannot award before it became
            // effective, while an early estimated crossing cannot mask a
            // later fully-approved crossing in another version segment.
            weeklyContextIntervals,
            excludedWeeklyBonusWeekStarts: [...awardedWeeklyBonusWeeks],
            rules: rulesByVersion.get(version.id) ?? [],
            includePendingAsEstimate: version.pendingReviewCountsInEstimate,
          });
          grossAmount = addDecimalAmounts(grossAmount, hourly.grossAmount);
          hourly.weeklyBonusWeekStarts.forEach((week) => awardedWeeklyBonusWeeks.add(week));
          estimate ||= hourly.estimate;
          components.push(
            ...hourly.components.map((component) => ({
              type: component.type === "night_window" ? "night" as const : component.type,
              label: component.label,
              amount: component.amount,
              planVersionId: version.id,
              planVersion: version.version,
              quantity: String(component.seconds),
              unit: "second",
              rate: component.hourlyRate,
              multiplier: component.multiplier,
              trace: {
                ...component.trace,
                sourceIds: component.sourceIds,
                estimate: component.estimate,
                effectiveFrom: segmentStart,
                effectiveTo: segmentEnd,
              },
            })),
          );
          if (version.type === "hybrid") {
            const config = version.config as Record<string, unknown>;
            if (typeof config.fixedAmount === "string") {
              const segmentSeconds = Math.floor(
                (segmentEnd.getTime() - segmentStart.getTime()) / 1_000,
              );
              const fixedAmount = prorateDecimalAmount(
                config.fixedAmount,
                segmentSeconds,
                periodSeconds,
              );
              grossAmount = addDecimalAmounts(grossAmount, fixedAmount);
              components.push({
                type: "base",
                label: "混合方案固定部分（按生效区间折算）",
                amount: fixedAmount,
                planVersionId: version.id,
                planVersion: version.version,
                quantity: String(segmentSeconds),
                unit: "period_second",
                trace: { effectiveFrom: segmentStart, effectiveTo: segmentEnd },
              });
            }
          }
        } else if (version.type === "daily") {
          const dates = localDateKeysForIntervals(
            versionIntervals.filter(
              (interval) =>
                interval.approvalStatus === "approved" ||
                version.pendingReviewCountsInEstimate,
            ),
            period.timezone,
          );
          const amount = multiplyDecimalAmount(version.baseAmount, dates.length);
          grossAmount = addDecimalAmounts(grossAmount, amount);
          estimate ||=
            versionIntervals.some(
              (interval) => interval.approvalStatus === "pending_review",
            ) && version.pendingReviewCountsInEstimate;
          components.push({
            type: "base",
            label: "按工作日计薪",
            amount,
            planVersionId: version.id,
            planVersion: version.version,
            quantity: String(dates.length),
            unit: "day",
            rate: version.baseAmount,
            trace: { dates, effectiveFrom: segmentStart, effectiveTo: segmentEnd },
          });
        } else if (version.type === "project_based") {
          // A project amount is not time-proportional. Only the newest version
          // in the period is proposed and it always requires human review.
          if (version.id !== latestVersion.id) continue;
          grossAmount = addDecimalAmounts(grossAmount, version.baseAmount);
          needsReview = true;
          components.push({
            type: "project",
            label: "项目制金额（待人工确认项目范围）",
            amount: version.baseAmount,
            planVersionId: version.id,
            planVersion: version.version,
            quantity: "1",
            unit: version.baseUnit,
            trace: { effectiveFrom: segmentStart, effectiveTo: segmentEnd },
          });
        } else {
          const segmentSeconds = Math.floor(
            (segmentEnd.getTime() - segmentStart.getTime()) / 1_000,
          );
          const amount = prorateDecimalAmount(
            version.baseAmount,
            segmentSeconds,
            periodSeconds,
          );
          grossAmount = addDecimalAmounts(grossAmount, amount);
          components.push({
            type: "base",
            label:
              version.type === "monthly"
                ? "月度固定薪资（按生效区间折算）"
                : "周期固定薪资（按生效区间折算）",
            amount,
            planVersionId: version.id,
            planVersion: version.version,
            quantity: String(segmentSeconds),
            unit: "period_second",
            trace: { effectiveFrom: segmentStart, effectiveTo: segmentEnd },
          });
        }
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
        planVersionId: latestVersion.id,
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
      calculationVersion: "payroll-engine-v3-weekly-bonus",
      period,
      plans: planRows,
      rules,
      sessions,
      weeklyContextStartsAt,
      weeklyContextSessions: contextSessions,
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
          calculationVersion: "payroll-engine-v3-weekly-bonus",
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
              sourceEntityType: "compensation_plan_version",
              sourceEntityId: component.planVersionId,
              sourceVersion: String(component.planVersion),
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
      const lockedSessions = await tx
        .update(workSessions)
        .set({
          approvalStatus: "locked",
          lockedAt: settledAt,
          updatedAt: settledAt,
          version: sql`${workSessions.version} + 1`,
        })
        .where(
          and(
            eq(workSessions.organizationId, actor.organizationId),
            eq(workSessions.approvalStatus, "approved"),
            eq(workSessions.recordKind, "fact"),
            lt(workSessions.startAt, record.period.endsAt),
            gt(workSessions.endAt, record.period.startsAt),
          ),
        )
        .returning();
      if (lockedSessions.length > 0) {
        const sessionIds = lockedSessions.map((session) => session.id);
        const [breaks, projectLinks] = await Promise.all([
          tx
            .select()
            .from(workBreaks)
            .where(inArray(workBreaks.workSessionId, sessionIds)),
          tx
            .select()
            .from(workSessionProjectLinks)
            .where(inArray(workSessionProjectLinks.workSessionId, sessionIds)),
        ]);
        const breaksBySession = new Map<string, typeof breaks>();
        for (const entry of breaks) {
          breaksBySession.set(entry.workSessionId, [
            ...(breaksBySession.get(entry.workSessionId) ?? []),
            entry,
          ]);
        }
        const linksBySession = new Map<string, typeof projectLinks>();
        for (const entry of projectLinks) {
          linksBySession.set(entry.workSessionId, [
            ...(linksBySession.get(entry.workSessionId) ?? []),
            entry,
          ]);
        }
        await tx.insert(workSessionVersions).values(
          lockedSessions.map((session) => ({
            workSessionId: session.id,
            version: session.version,
            snapshot: {
              ...session,
              breaks: breaksBySession.get(session.id) ?? [],
              projectLinks: linksBySession.get(session.id) ?? [],
            },
            changeReason: "payroll_settled_locked",
            changedBy: actor.membershipId,
          })),
        );
      }
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
        after: {
          settledAt,
          itemCount: items.length,
          lockedWorkSessionCount: lockedSessions.length,
        },
      });
      return run;
    });
  }

  async listOwn(
    actor: PayrollActor,
    range?: { from: Date; to: Date },
  ) {
    const records = await this.db
      .select({
        item: payrollItems,
        run: payrollRuns,
        period: payPeriods,
        payslip: payslips,
      })
      .from(payrollItems)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.payrollRunId))
      .innerJoin(payPeriods, eq(payPeriods.id, payrollRuns.payPeriodId))
      .leftJoin(payslips, eq(payslips.payrollItemId, payrollItems.id))
      .where(
        and(
          eq(payrollItems.membershipId, actor.membershipId),
          eq(payPeriods.organizationId, actor.organizationId),
          range ? lt(payPeriods.startsAt, range.to) : undefined,
          range ? gt(payPeriods.endsAt, range.from) : undefined,
        ),
      )
      .orderBy(desc(payPeriods.endsAt), desc(payrollRuns.runNumber));

    // A period may be recalculated many times before settlement. Only its
    // newest immutable run is payable; showing every historical run would
    // double-count an employee's accumulated pay.
    const latestByPeriod = new Map<string, (typeof records)[number]>();
    for (const record of records) {
      if (!latestByPeriod.has(record.period.id)) {
        latestByPeriod.set(record.period.id, record);
      }
    }
    const latest = [...latestByPeriod.values()];
    const componentRows = latest.length
      ? await this.db
          .select()
          .from(payrollItemComponents)
          .where(inArray(payrollItemComponents.payrollItemId, latest.map((record) => record.item.id)))
          .orderBy(asc(payrollItemComponents.createdAt))
      : [];
    const componentsByItem = new Map<string, Array<(typeof componentRows)[number]>>();
    for (const component of componentRows) {
      componentsByItem.set(component.payrollItemId, [
        ...(componentsByItem.get(component.payrollItemId) ?? []),
        component,
      ]);
    }

    const items = latest.map((record) => {
      const components = componentsByItem.get(record.item.id) ?? [];
      const periodDates = localDateKeysForIntervals(
        [{ startAt: record.period.startsAt, endAt: record.period.endsAt }],
        record.period.timezone,
      );
      const daily = new Map<string, { amount: bigint; estimatedAmount: bigint }>();
      const addDaily = (date: string, amount: bigint, estimated: boolean) => {
        const current = daily.get(date) ?? { amount: 0n, estimatedAmount: 0n };
        current.amount += amount;
        if (estimated) current.estimatedAmount += amount;
        daily.set(date, current);
      };
      for (const component of components) {
        const trace = (component.calculationTrace ?? {}) as {
          date?: unknown;
          dates?: unknown;
          estimate?: unknown;
        };
        const tracedDates =
          typeof trace.date === "string"
            ? [trace.date]
            : Array.isArray(trace.dates)
              ? trace.dates.filter((date): date is string => typeof date === "string")
              : [];
        const dates = tracedDates.length
          ? tracedDates
          : component.sourceEntityType === "payroll_adjustment"
            ? periodDates.slice(-1)
            : periodDates;
        const allocations = splitMicros(decimalMicros(component.amount), dates.length || 1);
        (dates.length ? dates : [periodDates.at(-1)!]).forEach(
          (date, index) => addDaily(date, allocations[index] ?? 0n, trace.estimate === true),
        );
      }
      return {
        ...record,
        components,
        dailyBreakdown: [...daily]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([date, amount]) => ({
            date,
            amount: formatMicros(amount.amount),
            estimatedAmount: formatMicros(amount.estimatedAmount),
          })),
      };
    });

    const totals = new Map<
      string,
      { settledAmount: bigint; pendingAmount: bigint; totalAmount: bigint }
    >();
    for (const record of items) {
      const current = totals.get(record.item.currency) ?? {
        settledAmount: 0n,
        pendingAmount: 0n,
        totalAmount: 0n,
      };
      const amount = decimalMicros(record.item.finalAmount);
      current.totalAmount += amount;
      if (record.run.status === "settled") current.settledAmount += amount;
      else current.pendingAmount += amount;
      totals.set(record.item.currency, current);
    }
    const [[currentPlan], [organization]] = await Promise.all([
      this.db
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
          eq(compensationPlans.membershipId, actor.membershipId),
          isNull(compensationPlans.archivedAt),
        ),
      )
      .limit(1),
      this.db
        .select({
          timezone: organizations.timezone,
          payrollCutoffDay: organizations.payrollCutoffDay,
        })
        .from(organizations)
        .where(eq(organizations.id, actor.organizationId))
        .limit(1),
    ]);
    const livePreview =
      currentPlan && organization
        ? await this.buildLivePreview(actor, currentPlan, organization)
        : null;
    return {
      items,
      currentPlan: currentPlan ?? null,
      livePreview,
      summary: [...totals].map(([currency, amount]) => ({
        currency,
        settledAmount: formatMicros(amount.settledAmount),
        pendingAmount: formatMicros(amount.pendingAmount),
        totalAmount: formatMicros(amount.totalAmount),
      })),
    };
  }

  async acknowledgePayslip(actor: PayrollActor, payslipId: string) {
    const [record] = await this.db
      .select({ payslip: payslips, item: payrollItems, run: payrollRuns, period: payPeriods })
      .from(payslips)
      .innerJoin(payrollItems, eq(payrollItems.id, payslips.payrollItemId))
      .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.payrollRunId))
      .innerJoin(payPeriods, eq(payPeriods.id, payrollRuns.payPeriodId))
      .where(
        and(
          eq(payslips.id, payslipId),
          eq(payrollItems.membershipId, actor.membershipId),
          eq(payPeriods.organizationId, actor.organizationId),
        ),
      )
      .limit(1);
    if (!record) throw new PayrollNotFoundError();
    if (record.run.status !== "settled") {
      throw new PayrollConflictError("薪资尚未由发放方确认结算，暂不能确认收款。");
    }
    if (record.payslip.acknowledgedAt) return record.payslip;
    const acknowledgedAt = new Date();
    const [acknowledged] = await this.db
      .update(payslips)
      .set({ acknowledgedAt })
      .where(and(eq(payslips.id, payslipId), isNull(payslips.acknowledgedAt)))
      .returning();
    if (!acknowledged) throw new PayrollConflictError("该工资单已由其他设备确认，请刷新查看。");
    await this.db.insert(auditLogs).values({
      organizationId: actor.organizationId,
      actorMembershipId: actor.membershipId,
      action: "payroll.payslip_acknowledged",
      entityType: "payslip",
      entityId: acknowledged.id,
      after: { acknowledgedAt },
    });
    return acknowledged;
  }
}
