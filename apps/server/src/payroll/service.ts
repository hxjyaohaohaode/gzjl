import { createHash } from "node:crypto";

import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
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
  forecastCalendarSeries,
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

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
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

function payrollCutoffMinute(settings: unknown): number {
  if (!settings || typeof settings !== "object") return 18 * 60;
  const value = (settings as Record<string, unknown>).payrollCutoffMinute;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1_439
    ? value
    : 18 * 60;
}

function zonedCutoffAt(
  timezone: string,
  cutoffDay: number,
  cutoffMinute: number,
): Date {
  const nowParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = Number(nowParts.find((part) => part.type === "year")?.value);
  const month = Number(nowParts.find((part) => part.type === "month")?.value);
  const targetAsUtc = new Date(
    Date.UTC(
      year,
      month,
      cutoffDay,
      Math.floor(cutoffMinute / 60),
      cutoffMinute % 60,
    ),
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

function localDateKey(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function localWeekStartDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, day));
  const daysSinceMonday = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - daysSinceMonday);
  return value.toISOString().slice(0, 10);
}

function workSecondsByLocalDate(
  intervals: readonly PayableInterval[],
  timezone: string,
): Map<string, { approvedSeconds: number; pendingSeconds: number }> {
  const result = new Map<string, { approvedSeconds: number; pendingSeconds: number }>();
  for (const interval of intervals) {
    let cursor = interval.startAt.getTime();
    const end = interval.endAt.getTime();
    while (cursor < end) {
      const date = localDateKey(new Date(cursor), timezone);
      let boundary = end;
      if (localDateKey(new Date(Math.max(cursor, end - 1)), timezone) !== date) {
        let low = cursor + 1;
        let high = end;
        while (low < high) {
          const middle = Math.floor((low + high) / 2);
          if (localDateKey(new Date(middle), timezone) === date) low = middle + 1;
          else high = middle;
        }
        boundary = low;
      }
      const seconds = Math.floor((boundary - cursor) / 1_000);
      const current = result.get(date) ?? { approvedSeconds: 0, pendingSeconds: 0 };
      if (interval.approvalStatus === "approved") current.approvedSeconds += seconds;
      else current.pendingSeconds += seconds;
      result.set(date, current);
      cursor = boundary;
    }
  }
  return result;
}

export class PayrollService {
  constructor(private readonly db: Database) {}

  private async buildLivePreview(
    actor: PayrollActor,
    currentPlan: {
      plan: typeof compensationPlans.$inferSelect;
      version: typeof compensationPlanVersions.$inferSelect;
    },
    organization: {
      timezone: string;
      payrollCutoffDay: number;
      payrollCutoffMinute: number;
    },
  ) {
    const startsAt = zonedMonthBoundary(organization.timezone, 0);
    const endsAt = zonedMonthBoundary(organization.timezone, 1);
    // A payroll month is a hard reward boundary. A natural week that spans
    // two months is intentionally evaluated as two independent partial weeks
    // (for example Sep 28-30 and Oct 1-4).
    const weeklyContextStartsAt = startsAt;
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
    let weeklyBonusRule: { thresholdSeconds: number; rewardSeconds: number } | null = null;
    const liveComponents: Array<{
      date: string;
      amount: string;
      seconds: number;
      estimate: boolean;
      bonus: boolean;
      recurring: boolean;
    }> = [];
    const monthDates = localDateKeysForIntervals(
      [{ startAt: startsAt, endAt: endsAt }],
      organization.timezone,
    );
    if (version.type === "hourly" || version.type === "hybrid") {
      const currentRules = await this.db
        .select()
        .from(rateRules)
        .where(eq(rateRules.compensationPlanVersionId, version.id))
        .orderBy(asc(rateRules.priority));
      const parsedRules = currentRules
        .map(parseRule)
        .filter((rule): rule is PayrollRateRule => Boolean(rule));
      const configuredWeeklyBonus = parsedRules.find(
        (rule) => rule.type === "weekly_bonus",
      );
      weeklyBonusRule = configuredWeeklyBonus
        ? {
            thresholdSeconds: configuredWeeklyBonus.thresholdSeconds ?? 108_000,
            rewardSeconds: configuredWeeklyBonus.rewardSeconds ?? 18_000,
          }
        : null;
      const hourly = calculateHourlyPayroll({
        hourlyRate: version.baseAmount,
        timezone: organization.timezone,
        intervals,
        weeklyContextIntervals,
        // A rule configured during an open month must immediately evaluate the
        // month's already-recorded work. Base pay is already previewed for the
        // whole open month; weekly bonus eligibility follows the same live
        // policy so reaching the threshold before the setting was saved does
        // not leave the employee stuck at zero until the next week.
        weeklyBonusEligibilityIntervals: intervals,
        rules: parsedRules,
        includePendingAsEstimate: version.pendingReviewCountsInEstimate,
      });
      estimatedAmount = hourly.grossAmount;
      weeklyBonusSeconds = hourly.weeklyBonusSeconds;
      weeklyBonusEstimatedSeconds = hourly.weeklyBonusEstimatedSeconds;
      liveComponents.push(
        ...hourly.components.map((component) => ({
          date: String(component.trace.date),
          amount: component.amount,
          seconds: component.seconds,
          estimate: component.estimate,
          bonus: component.type === "bonus",
          recurring: false,
        })),
      );
      if (version.type === "hybrid") {
        const fixedAmount = (version.config as Record<string, unknown>)
          .fixedAmount;
        if (typeof fixedAmount === "string") {
          estimatedAmount = addDecimalAmounts(estimatedAmount, fixedAmount);
          const allocations = splitMicros(decimalMicros(fixedAmount), monthDates.length);
          monthDates.forEach((date, index) =>
            liveComponents.push({
              date,
              amount: formatMicros(allocations[index] ?? 0n),
              seconds: 0,
              estimate: false,
              bonus: false,
              recurring: true,
            }),
          );
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
      for (const date of payableDates) {
        const dateIntervals = intervals.filter((interval) =>
          localDateKeysForIntervals([interval], organization.timezone).includes(date),
        );
        liveComponents.push({
          date,
          amount: version.baseAmount,
          seconds: 0,
          estimate:
            !dateIntervals.some((interval) => interval.approvalStatus === "approved") &&
            dateIntervals.some((interval) => interval.approvalStatus === "pending_review"),
          bonus: false,
          recurring: false,
        });
      }
    } else {
      estimatedAmount = version.baseAmount;
      needsReview = version.type === "project_based";
      const allocations = splitMicros(decimalMicros(version.baseAmount), monthDates.length);
      monthDates.forEach((date, index) =>
        liveComponents.push({
          date,
          amount: formatMicros(allocations[index] ?? 0n),
          seconds: 0,
          estimate: needsReview,
          bonus: false,
          recurring: true,
        }),
      );
    }
    const daily = new Map<
      string,
      {
        approvedAmount: bigint;
        pendingAmount: bigint;
        approvedSeconds: number;
        pendingSeconds: number;
        weeklyBonusSeconds: number;
        weeklyBonusEstimatedSeconds: number;
        approvedBonusAmount: bigint;
        pendingBonusAmount: bigint;
        recurringAmount: bigint;
      }
    >(
      monthDates.map((date) => [
        date,
        {
          approvedAmount: 0n,
          pendingAmount: 0n,
          approvedSeconds: 0,
          pendingSeconds: 0,
          weeklyBonusSeconds: 0,
          weeklyBonusEstimatedSeconds: 0,
          approvedBonusAmount: 0n,
          pendingBonusAmount: 0n,
          recurringAmount: 0n,
        },
      ]),
    );
    for (const component of liveComponents) {
      const current = daily.get(component.date) ?? {
        approvedAmount: 0n,
        pendingAmount: 0n,
        approvedSeconds: 0,
        pendingSeconds: 0,
        weeklyBonusSeconds: 0,
        weeklyBonusEstimatedSeconds: 0,
        approvedBonusAmount: 0n,
        pendingBonusAmount: 0n,
        recurringAmount: 0n,
      };
      const amount = decimalMicros(component.amount);
      if (component.estimate) current.pendingAmount += amount;
      else current.approvedAmount += amount;
      if (component.bonus) {
        if (component.estimate) {
          current.weeklyBonusEstimatedSeconds += component.seconds;
          current.pendingBonusAmount += amount;
        } else {
          current.weeklyBonusSeconds += component.seconds;
          current.approvedBonusAmount += amount;
        }
      }
      if (component.recurring) current.recurringAmount += amount;
      daily.set(component.date, current);
    }
    for (const [date, seconds] of workSecondsByLocalDate(intervals, organization.timezone)) {
      const current = daily.get(date);
      if (!current) continue;
      current.approvedSeconds = seconds.approvedSeconds;
      current.pendingSeconds = seconds.pendingSeconds;
    }
    const calculationBreakdown = liveComponents.reduce(
      (total, component) => {
        const amount = decimalMicros(component.amount);
        if (component.bonus && component.estimate) total.estimatedBonusAmount += amount;
        else if (component.bonus) total.confirmedBonusAmount += amount;
        else if (component.estimate) total.pendingWorkAmount += amount;
        else total.confirmedWorkAmount += amount;
        return total;
      },
      {
        confirmedWorkAmount: 0n,
        pendingWorkAmount: 0n,
        confirmedBonusAmount: 0n,
        estimatedBonusAmount: 0n,
      },
    );
    const today = localDateKey(new Date(), organization.timezone);
    const elapsedDates = monthDates.filter((date) => date <= today);
    const futureDates = monthDates.filter((date) => date > today);
    const toSafeMicros = (value: number) =>
      BigInt(
        Math.max(
          0,
          Math.round(Math.min(Number.MAX_SAFE_INTEGER, Number.isFinite(value) ? value : 0)),
        ),
      );
    const variableAmountForecast = forecastCalendarSeries(
      elapsedDates.map((date) => {
        const amount = daily.get(date)!;
        const bonusAmount = amount.approvedBonusAmount + amount.pendingBonusAmount;
        const dailyTotal = amount.approvedAmount + amount.pendingAmount;
        return {
          date,
          value: Number(
            dailyTotal - bonusAmount - amount.recurringAmount > 0n
              ? dailyTotal - bonusAmount - amount.recurringAmount
              : 0n,
          ),
        };
      }),
      futureDates.length,
    );
    const eligibleSecondsForDate = (date: string) => {
      const amount = daily.get(date)!;
      return amount.approvedSeconds +
        (version.pendingReviewCountsInEstimate ? amount.pendingSeconds : 0);
    };
    const workForecast = forecastCalendarSeries(
      elapsedDates.map((date) => ({ date, value: eligibleSecondsForDate(date) })),
      futureDates.length,
    );
    const variableForecastByDate = new Map(
      variableAmountForecast.points.map((point) => [point.date, point]),
    );
    const workForecastByDate = new Map(
      workForecast.points.map((point) => [point.date, point]),
    );
    const projectedWeeklyBonuses = (
      mode: "lower" | "expected" | "upper",
    ): Map<string, number> => {
      const projected = new Map<string, number>();
      if (!weeklyBonusRule) return projected;
      const weeks = new Map<string, string[]>();
      for (const date of monthDates) {
        const weekStart = localWeekStartDate(date);
        weeks.set(weekStart, [...(weeks.get(weekStart) ?? []), date]);
      }
      for (const dates of weeks.values()) {
        const alreadyAwarded = dates.some((date) => {
          const amount = daily.get(date)!;
          return amount.weeklyBonusSeconds + amount.weeklyBonusEstimatedSeconds > 0;
        });
        if (alreadyAwarded) continue;
        let cumulativeSeconds = 0;
        for (const date of dates) {
          const amount = daily.get(date)!;
          const knownFuture =
            date <= today || amount.approvedSeconds + amount.pendingSeconds > 0;
          const forecast = workForecastByDate.get(date);
          cumulativeSeconds += knownFuture
            ? eligibleSecondsForDate(date)
            : mode === "lower"
              ? forecast?.lowerValue ?? 0
              : mode === "upper"
                ? forecast?.upperValue ?? 0
                : forecast?.value ?? 0;
          if (cumulativeSeconds >= weeklyBonusRule.thresholdSeconds) {
            projected.set(date, weeklyBonusRule.rewardSeconds);
            break;
          }
        }
      }
      return projected;
    };
    const expectedBonusByDate = projectedWeeklyBonuses("expected");
    const lowerBonusByDate = projectedWeeklyBonuses("lower");
    const upperBonusByDate = projectedWeeklyBonuses("upper");
    const bonusAmountForSeconds = (seconds: number) =>
      (decimalMicros(version.baseAmount) * BigInt(seconds)) / 3_600n;
    let actualCumulative = 0n;
    let projectedCumulative = 0n;
    let projectedLowerCumulative = 0n;
    let projectedUpperCumulative = 0n;
    const salaryTimeline = monthDates.map((date) => {
      const amount = daily.get(date)!;
      const dailyTotal = amount.approvedAmount + amount.pendingAmount;
      let projectedDaily = dailyTotal;
      let forecastSource: "actual" | "known_future" | "calendar_model" = "actual";
      if (date <= today) {
        actualCumulative += dailyTotal;
        projectedCumulative = actualCumulative;
        projectedLowerCumulative = actualCumulative;
        projectedUpperCumulative = actualCumulative;
      } else {
        const bonusAmount = amount.approvedBonusAmount + amount.pendingBonusAmount;
        const variableKnown = dailyTotal - amount.recurringAmount - bonusAmount;
        const hasKnownVariable =
          amount.approvedSeconds + amount.pendingSeconds > 0 || variableKnown !== 0n;
        const forecast = variableForecastByDate.get(date);
        const expectedVariable = hasKnownVariable
          ? variableKnown
          : toSafeMicros(forecast?.value ?? 0);
        const lowerVariable = hasKnownVariable
          ? variableKnown
          : toSafeMicros(forecast?.lowerValue ?? 0);
        const upperVariable = hasKnownVariable
          ? variableKnown
          : toSafeMicros(forecast?.upperValue ?? 0);
        projectedDaily =
          amount.recurringAmount +
          bonusAmount +
          expectedVariable +
          bonusAmountForSeconds(expectedBonusByDate.get(date) ?? 0);
        const projectedDailyLower =
          amount.recurringAmount +
          bonusAmount +
          lowerVariable +
          bonusAmountForSeconds(lowerBonusByDate.get(date) ?? 0);
        const projectedDailyUpper =
          amount.recurringAmount +
          bonusAmount +
          upperVariable +
          bonusAmountForSeconds(upperBonusByDate.get(date) ?? 0);
        projectedCumulative += projectedDaily;
        projectedLowerCumulative += projectedDailyLower;
        projectedUpperCumulative += projectedDailyUpper;
        forecastSource = hasKnownVariable ? "known_future" : "calendar_model";
      }
      return {
        date,
        approvedAmount: formatMicros(amount.approvedAmount),
        pendingAmount: formatMicros(amount.pendingAmount),
        totalAmount: formatMicros(dailyTotal),
        approvedSeconds: amount.approvedSeconds,
        pendingSeconds: amount.pendingSeconds,
        workedSeconds: amount.approvedSeconds + amount.pendingSeconds,
        bonusSeconds:
          amount.weeklyBonusSeconds + amount.weeklyBonusEstimatedSeconds,
        weeklyBonusSeconds: amount.weeklyBonusSeconds,
        weeklyBonusEstimatedSeconds: amount.weeklyBonusEstimatedSeconds,
        projectedBonusSeconds: expectedBonusByDate.get(date) ?? 0,
        projectedDailyAmount: formatMicros(projectedDaily),
        actualCumulativeAmount: date <= today ? formatMicros(actualCumulative) : null,
        projectedCumulativeAmount: formatMicros(projectedCumulative),
        projectedLowerCumulativeAmount: formatMicros(projectedLowerCumulative),
        projectedUpperCumulativeAmount: formatMicros(projectedUpperCumulative),
        forecastConfidence: variableForecastByDate.get(date)?.confidence ?? null,
        forecastSource,
        forecast: date > today,
      };
    });
    const weeklyBreakdown = [...salaryTimeline.reduce((groups, day) => {
      const weekStartDate = localWeekStartDate(day.date);
      const current = groups.get(weekStartDate) ?? {
        weekStartDate,
        startsOn: day.date,
        endsOn: day.date,
        approvedSeconds: 0,
        pendingSeconds: 0,
        weeklyBonusSeconds: 0,
        weeklyBonusEstimatedSeconds: 0,
      };
      current.endsOn = day.date;
      current.approvedSeconds += day.approvedSeconds;
      current.pendingSeconds += day.pendingSeconds;
      current.weeklyBonusSeconds += day.weeklyBonusSeconds;
      current.weeklyBonusEstimatedSeconds += day.weeklyBonusEstimatedSeconds;
      groups.set(weekStartDate, current);
      return groups;
    }, new Map<string, {
      weekStartDate: string;
      startsOn: string;
      endsOn: string;
      approvedSeconds: number;
      pendingSeconds: number;
      weeklyBonusSeconds: number;
      weeklyBonusEstimatedSeconds: number;
    }>()).values()];
    const currentWeek = weeklyBreakdown.find(
      (week) => week.weekStartDate === localWeekStartDate(today),
    ) ?? null;
    return {
      period: {
        startsAt,
        endsAt,
        cutoffAt: zonedCutoffAt(
          organization.timezone,
          organization.payrollCutoffDay,
          organization.payrollCutoffMinute,
        ),
      },
      currency: currentPlan.plan.currency,
      planType: version.type,
      baseAmount: version.baseAmount,
      approvedSeconds,
      pendingSeconds,
      weeklyBonusSeconds,
      weeklyBonusEstimatedSeconds,
      projectedWeeklyBonusSeconds: [...expectedBonusByDate.values()].reduce(
        (total, seconds) => total + seconds,
        0,
      ),
      weeklyBonusRule,
      estimatedAmount,
      projectedPeriodAmount: formatMicros(projectedCumulative),
      projection: {
        method: variableAmountForecast.method,
        sampleDays: variableAmountForecast.sampleDays,
        nonZeroSampleDays: variableAmountForecast.nonZeroSampleDays,
        horizonDays: futureDates.length,
        includesKnownFutureRecords: futureDates.some((date) => {
          const amount = daily.get(date)!;
          return amount.approvedSeconds + amount.pendingSeconds > 0;
        }),
      },
      calculationBreakdown: {
        confirmedWorkAmount: formatMicros(calculationBreakdown.confirmedWorkAmount),
        pendingWorkAmount: formatMicros(calculationBreakdown.pendingWorkAmount),
        confirmedBonusAmount: formatMicros(calculationBreakdown.confirmedBonusAmount),
        estimatedBonusAmount: formatMicros(calculationBreakdown.estimatedBonusAmount),
      },
      currentWeek: currentWeek
        ? {
            ...currentWeek,
            totalSeconds: currentWeek.approvedSeconds + currentWeek.pendingSeconds,
          }
        : null,
      weeklyBreakdown,
      salaryTimeline,
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
          settings: organizations.settings,
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
      if (record.run.status === "cancelled") continue;
      const key = `${record.period.id}:${record.item.membershipId}`;
      if (!latestPayrollItems.has(key)) latestPayrollItems.set(key, record);
    }
    const organizationSettings = organization[0] ?? {
      timezone: "Asia/Shanghai",
      payrollCutoffDay: 10,
      settings: {},
    };
    const normalizedOrganizationSettings = {
      timezone: organizationSettings.timezone,
      payrollCutoffDay: organizationSettings.payrollCutoffDay,
      payrollCutoffMinute: payrollCutoffMinute(organizationSettings.settings),
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
                normalizedOrganizationSettings,
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
      settings: normalizedOrganizationSettings,
    };
  }

  async updateSettings(
    actor: PayrollActor,
    payrollCutoffDay: number,
    payrollCutoffMinuteValue = 18 * 60,
  ) {
    const [before] = await this.db
      .select({
        payrollCutoffDay: organizations.payrollCutoffDay,
        settings: organizations.settings,
      })
      .from(organizations)
      .where(eq(organizations.id, actor.organizationId))
      .limit(1);
    if (!before) throw new PayrollNotFoundError();
    const [settings] = await this.db
      .update(organizations)
      .set({
        payrollCutoffDay,
        settings: {
          ...((before.settings ?? {}) as Record<string, unknown>),
          payrollCutoffMinute: payrollCutoffMinuteValue,
        },
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, actor.organizationId))
      .returning({
        timezone: organizations.timezone,
        payrollCutoffDay: organizations.payrollCutoffDay,
        settings: organizations.settings,
      });
    const normalizedSettings = settings
      ? {
          timezone: settings.timezone,
          payrollCutoffDay: settings.payrollCutoffDay,
          payrollCutoffMinute: payrollCutoffMinute(settings.settings),
        }
      : undefined;
    await this.db.insert(auditLogs).values({
      organizationId: actor.organizationId,
      actorMembershipId: actor.membershipId,
      action: "payroll.settings_updated",
      entityType: "organization",
      entityId: actor.organizationId,
      before,
      after: normalizedSettings,
    });
    return normalizedSettings;
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

  async deleteUncommittedPeriod(actor: PayrollActor, payPeriodId: string) {
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
    if (period.status !== "open" || period.settledAt || period.lockedAt) {
      throw new PayrollConflictError("请先撤销未锁定的计算批次；已导出锁定的周期不能删除。");
    }
    const [runs, adjustments] = await Promise.all([
      this.db.select().from(payrollRuns).where(eq(payrollRuns.payPeriodId, period.id)),
      this.db
        .select({ id: payrollAdjustments.id })
        .from(payrollAdjustments)
        .where(eq(payrollAdjustments.payPeriodId, period.id)),
    ]);
    if (runs.some((run) => run.settledAt)) {
      throw new PayrollConflictError("该周期曾经导出锁定，必须保留历史账单与审计，不能删除。");
    }
    if (runs.some((run) => !["cancelled", "failed"].includes(run.status))) {
      throw new PayrollConflictError("该周期仍有有效计算批次，请先点击“撤销本次计算”。");
    }
    if (adjustments.length > 0) {
      throw new PayrollConflictError("该周期已有人工薪资调整，为避免丢失审计事实，不能直接删除。");
    }
    return this.db.transaction(async (tx) => {
      const runIds = runs.map((run) => run.id);
      const itemRows = runIds.length
        ? await tx
            .select({ id: payrollItems.id })
            .from(payrollItems)
            .where(inArray(payrollItems.payrollRunId, runIds))
        : [];
      const itemIds = itemRows.map((item) => item.id);
      if (itemIds.length > 0) {
        await tx.delete(payslips).where(inArray(payslips.payrollItemId, itemIds));
        await tx
          .delete(payrollItemComponents)
          .where(inArray(payrollItemComponents.payrollItemId, itemIds));
        await tx.delete(payrollItems).where(inArray(payrollItems.id, itemIds));
      }
      if (runIds.length > 0) {
        await tx
          .delete(payrollSnapshots)
          .where(inArray(payrollSnapshots.payrollRunId, runIds));
        await tx.delete(payrollRuns).where(inArray(payrollRuns.id, runIds));
      }
      const [deleted] = await tx
        .delete(payPeriods)
        .where(
          and(
            eq(payPeriods.id, period.id),
            eq(payPeriods.organizationId, actor.organizationId),
            eq(payPeriods.status, "open"),
          ),
        )
        .returning({ id: payPeriods.id });
      if (!deleted) throw new PayrollConflictError("该周期已被其他操作处理，请刷新后重试。");
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "payroll.uncommitted_period_deleted",
        entityType: "pay_period",
        entityId: period.id,
        before: { period, removedCancelledRunCount: runs.length },
        after: { deleted: true },
      });
      return { id: period.id, deleted: true };
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

    const weeklyContextStartsAt = period.startsAt;
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
            // whole natural week; the period boundary still clips a week that
            // straddles two payroll months into two independent reward spans.
            weeklyContextIntervals,
            // Rule changes are versioned and auditable, but a newly enabled
            // weekly reward is allowed to recognise earlier work in the same
            // still-open payroll month. Limit eligibility to this version's
            // segment end so an older version cannot claim a threshold reached
            // later; the cross-version awarded set still prevents duplicates.
            weeklyBonusEligibilityIntervals: clipPayableIntervals(
              intervals,
              period.startsAt,
              segmentEnd,
            ),
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
      calculationVersion: "payroll-engine-v5-live-month-week-bonus",
      // Only immutable calculation inputs belong in the idempotency hash.
      // Runtime fields such as status/updatedAt change when a calculation is
      // cancelled, and must not turn an exact retry into a duplicate batch.
      period: {
        id: period.id,
        name: period.name,
        timezone: period.timezone,
        startsAt: period.startsAt,
        endsAt: period.endsAt,
        cutoffAt: period.cutoffAt,
      },
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
    if (existing) {
      if (existing.status !== "cancelled") return existing;
      const [reviewItem] = await this.db
        .select({ id: payrollItems.id })
        .from(payrollItems)
        .where(
          and(
            eq(payrollItems.payrollRunId, existing.id),
            eq(payrollItems.needsReview, true),
          ),
        )
        .limit(1);
      return this.db.transaction(async (tx) => {
        const restoredStatus = reviewItem ? "review_required" as const : "ready" as const;
        const [restored] = await tx
          .update(payrollRuns)
          .set({ status: restoredStatus, errorSummary: null, completedAt: new Date() })
          .where(
            and(
              eq(payrollRuns.id, existing.id),
              eq(payrollRuns.status, "cancelled"),
            ),
          )
          .returning();
        if (!restored) throw new PayrollConflictError("该批次已被其他操作处理。");
        await tx
          .update(payPeriods)
          .set({ status: "pending_confirmation", updatedAt: new Date() })
          .where(eq(payPeriods.id, period.id));
        await tx.insert(auditLogs).values({
          organizationId: actor.organizationId,
          actorMembershipId: actor.membershipId,
          action: "payroll.calculation_restored",
          entityType: "payroll_run",
          entityId: restored.id,
          after: { status: restored.status, inputHash },
        });
        return restored;
      });
    }

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
          calculationVersion: "payroll-engine-v5-live-month-week-bonus",
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

  async cancelCalculation(actor: PayrollActor, runId: string) {
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
    if (!["ready", "review_required"].includes(record.run.status)) {
      throw new PayrollConflictError("只有尚未导出锁定的计算批次可以撤销。");
    }
    return this.db.transaction(async (tx) => {
      const [cancelled] = await tx
        .update(payrollRuns)
        .set({
          status: "cancelled",
          errorSummary: "由薪资管理员撤销未锁定计算",
        })
        .where(
          and(
            eq(payrollRuns.id, runId),
            inArray(payrollRuns.status, ["ready", "review_required"]),
          ),
        )
        .returning();
      if (!cancelled) throw new PayrollConflictError("该批次已被其他操作处理。");
      const [otherActiveRun] = await tx
        .select({ id: payrollRuns.id })
        .from(payrollRuns)
        .where(
          and(
            eq(payrollRuns.payPeriodId, record.period.id),
            ne(payrollRuns.id, runId),
            inArray(payrollRuns.status, ["queued", "calculating", "review_required", "ready"]),
          ),
        )
        .limit(1);
      await tx
        .update(payPeriods)
        .set({
          status: otherActiveRun ? "pending_confirmation" : "open",
          updatedAt: new Date(),
        })
        .where(eq(payPeriods.id, record.period.id));
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "payroll.calculation_cancelled",
        entityType: "payroll_run",
        entityId: runId,
        before: { status: record.run.status },
        after: { status: "cancelled", periodStatus: otherActiveRun ? "pending_confirmation" : "open" },
      });
      return cancelled;
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

  async financeExport(actor: PayrollActor, runId: string) {
    const [record] = await this.db
      .select({ run: payrollRuns, period: payPeriods })
      .from(payrollRuns)
      .innerJoin(payPeriods, eq(payPeriods.id, payrollRuns.payPeriodId))
      .where(
        and(
          eq(payrollRuns.id, runId),
          eq(payPeriods.organizationId, actor.organizationId),
          ne(payrollRuns.status, "cancelled"),
        ),
      )
      .limit(1);
    if (!record) throw new PayrollNotFoundError();
    if (record.run.status !== "ready" && record.run.status !== "settled") {
      throw new PayrollConflictError("只有已就绪或已锁定的薪资批次可以导出财务账单。");
    }
    const rows = await this.db
      .select({ item: payrollItems, displayName: users.displayName })
      .from(payrollItems)
      .innerJoin(orgMemberships, eq(orgMemberships.id, payrollItems.membershipId))
      .innerJoin(users, eq(users.id, orgMemberships.userId))
      .where(eq(payrollItems.payrollRunId, runId))
      .orderBy(asc(users.displayName));
    const components = rows.length
      ? await this.db
          .select()
          .from(payrollItemComponents)
          .where(inArray(payrollItemComponents.payrollItemId, rows.map((row) => row.item.id)))
      : [];
    const bonusByItem = new Map<string, number>();
    for (const component of components) {
      if (component.type !== "bonus" || component.unit !== "second") continue;
      bonusByItem.set(
        component.payrollItemId,
        (bonusByItem.get(component.payrollItemId) ?? 0) + Number(component.quantity ?? 0),
      );
    }
    const header = [
      "员工",
      "薪资周期",
      "周期开始",
      "周期结束",
      "币种",
      "已批准工时",
      "待审核工时",
      "周奖励工时",
      "应计金额",
      "调整金额",
      "最终金额",
      "是否预估",
      "是否需复核",
      "批次号",
      "批次状态",
    ];
    const data = rows.map(({ item, displayName }) => [
      displayName,
      record.period.name,
      record.period.startsAt.toISOString(),
      record.period.endsAt.toISOString(),
      item.currency,
      (item.approvedSeconds / 3_600).toFixed(4),
      (item.pendingSeconds / 3_600).toFixed(4),
      ((bonusByItem.get(item.id) ?? 0) / 3_600).toFixed(4),
      item.grossAmount,
      item.adjustmentAmount,
      item.finalAmount,
      item.estimate ? "是" : "否",
      item.needsReview ? "是" : "否",
      record.run.runNumber,
      record.run.status === "settled" ? "已导出并锁定" : "待导出锁定",
    ]);
    const csv = `\uFEFF${[header, ...data]
      .map((row) => row.map((value) => csvCell(value)).join(","))
      .join("\r\n")}\r\n`;
    const safePeriod = record.period.name.replace(/[\\/:*?"<>|]+/g, "-");
    return {
      fileName: `${safePeriod}-财务薪资账单-批次${record.run.runNumber}.csv`,
      csv,
    };
  }

  async reopenSettlement(actor: PayrollActor, runId: string) {
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
    if (record.run.status !== "settled" || !record.run.settledAt) {
      throw new PayrollConflictError("只有已导出并锁定的批次可以撤销。");
    }
    const settledAt = record.run.settledAt;
    return this.db.transaction(async (tx) => {
      const [cancelled] = await tx
        .update(payrollRuns)
        .set({ status: "cancelled", errorSummary: "由薪资管理员撤销导出锁定" })
        .where(and(eq(payrollRuns.id, runId), eq(payrollRuns.status, "settled")))
        .returning();
      if (!cancelled) throw new PayrollConflictError("该批次已由其他操作处理。");
      const reopenedAt = new Date();
      await tx
        .update(payPeriods)
        .set({
          status: "open",
          settledAt: null,
          lockedAt: null,
          updatedAt: reopenedAt,
        })
        .where(eq(payPeriods.id, record.period.id));
      const unlockedSessions = await tx
        .update(workSessions)
        .set({
          approvalStatus: "approved",
          lockedAt: null,
          updatedAt: reopenedAt,
          version: sql`${workSessions.version} + 1`,
        })
        .where(
          and(
            eq(workSessions.organizationId, actor.organizationId),
            eq(workSessions.approvalStatus, "locked"),
            eq(workSessions.lockedAt, settledAt),
            lt(workSessions.startAt, record.period.endsAt),
            gt(workSessions.endAt, record.period.startsAt),
          ),
        )
        .returning();
      if (unlockedSessions.length > 0) {
        const sessionIds = unlockedSessions.map((session) => session.id);
        const [breaks, projectLinks] = await Promise.all([
          tx.select().from(workBreaks).where(inArray(workBreaks.workSessionId, sessionIds)),
          tx
            .select()
            .from(workSessionProjectLinks)
            .where(inArray(workSessionProjectLinks.workSessionId, sessionIds)),
        ]);
        await tx.insert(workSessionVersions).values(
          unlockedSessions.map((session) => ({
            workSessionId: session.id,
            version: session.version,
            snapshot: {
              ...session,
              breaks: breaks.filter((entry) => entry.workSessionId === session.id),
              projectLinks: projectLinks.filter((entry) => entry.workSessionId === session.id),
            },
            changeReason: "payroll_export_lock_reopened",
            changedBy: actor.membershipId,
          })),
        );
      }
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "payroll.export_lock_reopened",
        entityType: "payroll_run",
        entityId: runId,
        before: { status: "settled", settledAt: record.run.settledAt },
        after: {
          status: "cancelled",
          periodStatus: "open",
          unlockedWorkSessionCount: unlockedSessions.length,
          reopenedAt,
        },
      });
      return cancelled;
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
          ne(payrollRuns.status, "cancelled"),
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
          settings: organizations.settings,
        })
        .from(organizations)
        .where(eq(organizations.id, actor.organizationId))
        .limit(1),
    ]);
    const livePreview =
      currentPlan && organization
        ? await this.buildLivePreview(actor, currentPlan, {
            timezone: organization.timezone,
            payrollCutoffDay: organization.payrollCutoffDay,
            payrollCutoffMinute: payrollCutoffMinute(organization.settings),
          })
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
      throw new PayrollConflictError("薪资账单尚未导出并锁定，暂不能确认到账。");
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
