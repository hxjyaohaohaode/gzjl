export type PayrollRuleKind =
  | "weekday"
  | "weekend"
  | "holiday"
  | "night_window"
  | "overtime"
  | "weekly_bonus";

export type PayrollComponentType =
  | Exclude<PayrollRuleKind, "weekly_bonus">
  | "base"
  | "bonus";

export interface PayrollRateRule {
  id: string;
  type: PayrollRuleKind;
  priority: number;
  multiplier: string;
  stack?: boolean;
  startHour?: number;
  endHour?: number;
  thresholdSeconds?: number;
  rewardSeconds?: number;
  holidayDates?: string[];
}

export interface PayableInterval {
  sourceId: string;
  startAt: Date;
  endAt: Date;
  approvalStatus: "approved" | "pending_review";
}

export interface PayrollComponentResult {
  type: PayrollComponentType;
  label: string;
  sourceIds: string[];
  seconds: number;
  hourlyRate: string;
  multiplier: string;
  amount: string;
  estimate: boolean;
  trace: {
    ruleIds: string[];
    timezone: string;
    date: string;
    weekStartDate?: string;
    thresholdSeconds?: number;
    rewardSeconds?: number;
    earnedAt?: string;
    actualSeconds?: number;
  };
}

export interface PayrollCalculationResult {
  approvedSeconds: number;
  pendingSeconds: number;
  weeklyBonusSeconds: number;
  weeklyBonusEstimatedSeconds: number;
  weeklyBonusWeekStarts: string[];
  grossAmount: string;
  estimate: boolean;
  components: PayrollComponentResult[];
}

const SCALE = 1_000_000n;
const SECONDS_PER_HOUR = 3_600n;

function parseDecimal(value: string): bigint {
  const normalized = value.trim();
  if (!/^-?\d+(\.\d{1,6})?$/.test(normalized)) {
    throw new TypeError(`Invalid decimal value: ${value}`);
  }
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const scaled = BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, "0"));
  return negative ? -scaled : scaled;
}

function formatDecimal(value: bigint): string {
  const negative = value < 0;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE;
  const fraction = (absolute % SCALE).toString().padStart(6, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function addDecimalAmounts(...values: string[]): string {
  return formatDecimal(values.reduce((total, value) => total + parseDecimal(value), 0n));
}

export function multiplyDecimalAmount(value: string, quantity: number): string {
  if (!Number.isInteger(quantity)) throw new TypeError("Quantity must be an integer");
  return formatDecimal(parseDecimal(value) * BigInt(quantity));
}

export function prorateDecimalAmount(
  value: string,
  numerator: number,
  denominator: number,
): string {
  if (
    !Number.isInteger(numerator) ||
    !Number.isInteger(denominator) ||
    numerator < 0 ||
    denominator <= 0 ||
    numerator > denominator
  ) {
    throw new TypeError("Proration requires integer 0 <= numerator <= denominator");
  }
  return formatDecimal(
    divideRounded(parseDecimal(value) * BigInt(numerator), BigInt(denominator)),
  );
}

function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0;
  const absolute = negative ? -numerator : numerator;
  const rounded = (absolute + denominator / 2n) / denominator;
  return negative ? -rounded : rounded;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function localParts(at: Date, timezone: string) {
  let formatter = formatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    });
    formatterCache.set(timezone, formatter);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(at).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    weekday: parts.weekday,
  };
}

/**
 * Returns every local calendar date touched by positive, end-exclusive work
 * intervals. Six-hour sampling is shorter than the shortest civil day, so a
 * cross-midnight or daylight-saving transition cannot silently collapse into
 * the start date only.
 */
export function localDateKeysForIntervals(
  intervals: readonly Pick<PayableInterval, "startAt" | "endAt">[],
  timezone: string,
): string[] {
  // Validate the IANA zone even when no payable interval exists.
  localParts(new Date(0), timezone);
  const dates = new Set<string>();
  for (const interval of intervals) {
    if (interval.endAt <= interval.startAt) {
      throw new RangeError("Payroll intervals must have a positive duration");
    }
    const lastIncludedMs = interval.endAt.getTime() - 1;
    let cursorMs = interval.startAt.getTime();
    while (cursorMs <= lastIncludedMs) {
      dates.add(localParts(new Date(cursorMs), timezone).date);
      if (cursorMs === lastIncludedMs) break;
      cursorMs = Math.min(lastIncludedMs, cursorMs + 6 * 60 * 60 * 1_000);
    }
  }
  return [...dates];
}

function isNight(hour: number, startHour: number, endHour: number): boolean {
  return startHour < endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour;
}

function highestPriority(
  rules: readonly PayrollRateRule[],
  predicate: (rule: PayrollRateRule) => boolean,
): PayrollRateRule | undefined {
  return rules.filter(predicate).sort((a, b) => b.priority - a.priority)[0];
}

interface MutableComponent {
  date: string;
  type: PayrollComponentResult["type"];
  label: string;
  sourceIds: Set<string>;
  seconds: number;
  hourlyRate: string;
  multiplierMicros: bigint;
  amountNumerator: bigint;
  estimate: boolean;
  ruleIds: string[];
}

interface WeeklyThresholdCrossing {
  weekStartDate: string;
  date: string;
  earnedAt: Date;
  sourceId: string;
  sourceIds: Set<string>;
  actualSeconds: number;
}

function weekStartDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, day));
  const daysSinceMonday = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - daysSinceMonday);
  return value.toISOString().slice(0, 10);
}

function weeklyThresholdCrossings(
  intervals: readonly PayableInterval[],
  timezone: string,
  thresholdSeconds: number,
): Map<string, WeeklyThresholdCrossing> {
  const cumulativeByWeek = new Map<string, number>();
  const sourceIdsByWeek = new Map<string, Set<string>>();
  const crossings = new Map<string, WeeklyThresholdCrossing>();
  for (const interval of [...intervals].sort(
    (left, right) => left.startAt.getTime() - right.startAt.getTime(),
  )) {
    if (interval.endAt <= interval.startAt) {
      throw new RangeError("Payroll intervals must have a positive duration");
    }
    let cursor = new Date(interval.startAt);
    while (cursor < interval.endAt) {
      const nextMinute = new Date(
        Math.min(
          interval.endAt.getTime(),
          Math.floor(cursor.getTime() / 60_000) * 60_000 + 60_000,
        ),
      );
      const seconds = Math.ceil((nextMinute.getTime() - cursor.getTime()) / 1_000);
      if (seconds <= 0) break;
      const parts = localParts(cursor, timezone);
      const week = weekStartDate(parts.date);
      const cumulative = cumulativeByWeek.get(week) ?? 0;
      const sourceIds = sourceIdsByWeek.get(week) ?? new Set<string>();
      sourceIds.add(interval.sourceId);
      sourceIdsByWeek.set(week, sourceIds);
      if (!crossings.has(week) && cumulative + seconds > thresholdSeconds) {
        const earnedAt = new Date(
          cursor.getTime() + Math.max(0, thresholdSeconds - cumulative) * 1_000,
        );
        crossings.set(week, {
          weekStartDate: week,
          date: localParts(earnedAt, timezone).date,
          earnedAt,
          sourceId: interval.sourceId,
          sourceIds: new Set(sourceIds),
          actualSeconds: cumulative + seconds,
        });
      }
      cumulativeByWeek.set(week, cumulative + seconds);
      cursor = nextMinute;
    }
  }
  return crossings;
}

export function calculateHourlyPayroll(input: {
  hourlyRate: string;
  timezone: string;
  intervals: readonly PayableInterval[];
  weeklyContextIntervals?: readonly PayableInterval[];
  weeklyBonusEligibilityIntervals?: readonly PayableInterval[];
  excludedWeeklyBonusWeekStarts?: readonly string[];
  rules: readonly PayrollRateRule[];
  includePendingAsEstimate: boolean;
}): PayrollCalculationResult {
  const rateMicros = parseDecimal(input.hourlyRate);
  if (rateMicros < 0) throw new RangeError("Hourly rate must not be negative");
  // Forces IANA timezone validation before calculations begin.
  localParts(new Date(0), input.timezone);

  const intervals = [...input.intervals]
    .filter(
      (interval) =>
        interval.approvalStatus === "approved" || input.includePendingAsEstimate,
    )
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  let approvedSeconds = 0;
  let pendingSeconds = 0;
  // Overtime thresholds are civil-day rules. Keep a separate accumulator for
  // every organization-local date so a multi-day pay period cannot make all
  // work after day one look like overtime.
  const cumulativeSecondsByDate = new Map<string, number>();
  const components = new Map<string, MutableComponent>();

  for (const interval of intervals) {
    if (interval.endAt <= interval.startAt) {
      throw new RangeError("Payroll intervals must have a positive duration");
    }
    let cursor = new Date(interval.startAt);
    while (cursor < interval.endAt) {
      const nextMinute = new Date(
        Math.min(
          interval.endAt.getTime(),
          Math.floor(cursor.getTime() / 60_000) * 60_000 + 60_000,
        ),
      );
      // Timer events carry millisecond precision. Rounding down the first
      // partial minute left the cursor just before the same minute boundary;
      // the next pass then had zero whole seconds and could discard the rest
      // of an otherwise valid hour. Ceiling advances to the boundary while
      // the interval's integer-second total remains exact.
      let segmentSeconds = Math.ceil((nextMinute.getTime() - cursor.getTime()) / 1_000);
      if (segmentSeconds <= 0) break;

      while (segmentSeconds > 0) {
        const parts = localParts(cursor, input.timezone);
        const cumulativeSeconds = cumulativeSecondsByDate.get(parts.date) ?? 0;
        const isWeekendDay = parts.weekday === "Sat" || parts.weekday === "Sun";
        const holidayRule = highestPriority(
          input.rules,
          (rule) => rule.type === "holiday" && (rule.holidayDates ?? []).includes(parts.date),
        );
        const calendarRule =
          holidayRule ??
          highestPriority(
            input.rules,
            (rule) => rule.type === (isWeekendDay ? "weekend" : "weekday"),
          );
        const nightRule = highestPriority(
          input.rules,
          (rule) =>
            rule.type === "night_window" &&
            isNight(parts.hour, rule.startHour ?? 22, rule.endHour ?? 6),
        );
        const overtimeRule = highestPriority(
          input.rules,
          (rule) =>
            rule.type === "overtime" &&
            cumulativeSeconds >= (rule.thresholdSeconds ?? Number.MAX_SAFE_INTEGER),
        );
        const nextThreshold = input.rules
          .filter(
            (rule) =>
              rule.type === "overtime" &&
              (rule.thresholdSeconds ?? Number.MAX_SAFE_INTEGER) > cumulativeSeconds,
          )
          .map((rule) => rule.thresholdSeconds ?? Number.MAX_SAFE_INTEGER)
          .sort((a, b) => a - b)[0];
        const pieceSeconds = nextThreshold
          ? Math.min(segmentSeconds, nextThreshold - cumulativeSeconds)
          : segmentSeconds;

        const appliedRules = [calendarRule, nightRule, overtimeRule].filter(
          (
            rule,
          ): rule is PayrollRateRule & { type: Exclude<PayrollRuleKind, "weekly_bonus"> } =>
            Boolean(rule) && rule?.type !== "weekly_bonus",
        );
        let selectedType: PayrollComponentResult["type"] = "base";
        let multiplierMicros = SCALE;
        let selectedPriority = -1;
        const ruleIds: string[] = [];
        for (const rule of appliedRules.sort((a, b) => a.priority - b.priority)) {
          const ruleMultiplier = parseDecimal(rule.multiplier);
          if (rule.stack) {
            multiplierMicros = divideRounded(multiplierMicros * ruleMultiplier, SCALE);
            selectedType = rule.type;
            ruleIds.push(rule.id);
          } else if (rule.priority >= selectedPriority) {
            multiplierMicros = ruleMultiplier;
            selectedPriority = rule.priority;
            selectedType = rule.type;
            ruleIds.length = 0;
            ruleIds.push(rule.id);
          }
        }

        const estimate = interval.approvalStatus === "pending_review";
        // A date-scoped component is intentionally preserved in the immutable
        // payroll trace. The employee dashboard can therefore render exact
        // daily pay without recalculating money in the browser.
        const componentKey = `${parts.date}:${selectedType}:${multiplierMicros}:${estimate}:${ruleIds.join(",")}`;
        let component = components.get(componentKey);
        if (!component) {
          component = {
            date: parts.date,
            type: selectedType,
            label: selectedType === "base" ? "基础工时" : selectedType,
            sourceIds: new Set(),
            seconds: 0,
            hourlyRate: input.hourlyRate,
            multiplierMicros,
            amountNumerator: 0n,
            estimate,
            ruleIds,
          };
          components.set(componentKey, component);
        }
        component.sourceIds.add(interval.sourceId);
        component.seconds += pieceSeconds;
        component.amountNumerator +=
          rateMicros * multiplierMicros * BigInt(pieceSeconds);
        if (estimate) pendingSeconds += pieceSeconds;
        else approvedSeconds += pieceSeconds;
        cumulativeSecondsByDate.set(parts.date, cumulativeSeconds + pieceSeconds);
        segmentSeconds -= pieceSeconds;
        cursor = new Date(
          Math.min(interval.endAt.getTime(), cursor.getTime() + pieceSeconds * 1_000),
        );
      }
    }
  }

  const resultComponents: PayrollComponentResult[] = [...components.values()].map((component) => ({
    type: component.type,
    label: component.label,
    sourceIds: [...component.sourceIds],
    seconds: component.seconds,
    hourlyRate: component.hourlyRate,
    multiplier: formatDecimal(component.multiplierMicros),
    amount: formatDecimal(
      divideRounded(component.amountNumerator, SCALE * SECONDS_PER_HOUR),
    ),
    estimate: component.estimate,
    trace: {
      ruleIds: component.ruleIds,
      timezone: input.timezone,
      date: component.date,
    },
  }));
  let weeklyBonusSeconds = 0;
  let weeklyBonusEstimatedSeconds = 0;
  const weeklyBonusWeekStarts: string[] = [];
  const excludedWeeks = new Set(input.excludedWeeklyBonusWeekStarts ?? []);
  const weeklyContext = input.weeklyContextIntervals ?? input.intervals;
  const weeklyBonusEligibility =
    input.weeklyBonusEligibilityIntervals ?? input.intervals;
  const approvedContext = weeklyContext.filter(
    (interval) => interval.approvalStatus === "approved",
  );
  const combinedContext = weeklyContext.filter(
    (interval) =>
      interval.approvalStatus === "approved" || input.includePendingAsEstimate,
  );
  for (const rule of input.rules
    .filter((candidate) => candidate.type === "weekly_bonus")
    .sort((left, right) => right.priority - left.priority)
    .slice(0, 1)) {
    const thresholdSeconds = rule.thresholdSeconds ?? 108_000;
    const rewardSeconds = rule.rewardSeconds ?? 18_000;
    if (thresholdSeconds <= 0 || rewardSeconds <= 0) continue;
    const approvedCrossings = weeklyThresholdCrossings(
      approvedContext,
      input.timezone,
      thresholdSeconds,
    );
    const combinedCrossings = input.includePendingAsEstimate
      ? weeklyThresholdCrossings(combinedContext, input.timezone, thresholdSeconds)
      : new Map<string, WeeklyThresholdCrossing>();
    const weeks = new Set([...approvedCrossings.keys(), ...combinedCrossings.keys()]);
    for (const week of [...weeks].sort()) {
      if (excludedWeeks.has(week)) continue;
      const approvedCrossing = approvedCrossings.get(week);
      const crossing = approvedCrossing ?? combinedCrossings.get(week);
      if (!crossing) continue;
      const belongsToCalculation = weeklyBonusEligibility.some(
        (interval) =>
          interval.sourceId === crossing.sourceId &&
          crossing.earnedAt >= interval.startAt &&
          crossing.earnedAt < interval.endAt &&
          (approvedCrossing !== undefined || input.includePendingAsEstimate),
      );
      if (!belongsToCalculation) continue;
      const estimate = approvedCrossing === undefined;
      const amount = formatDecimal(
        divideRounded(
          rateMicros * SCALE * BigInt(rewardSeconds),
          SCALE * SECONDS_PER_HOUR,
        ),
      );
      resultComponents.push({
        type: "bonus",
        label: "周超时奖励",
        sourceIds: [...crossing.sourceIds],
        seconds: rewardSeconds,
        hourlyRate: input.hourlyRate,
        multiplier: "1.000000",
        amount,
        estimate,
        trace: {
          ruleIds: [rule.id],
          timezone: input.timezone,
          date: crossing.date,
          weekStartDate: crossing.weekStartDate,
          thresholdSeconds,
          rewardSeconds,
          earnedAt: crossing.earnedAt.toISOString(),
          actualSeconds: crossing.actualSeconds,
        },
      });
      weeklyBonusWeekStarts.push(week);
      if (estimate) weeklyBonusEstimatedSeconds += rewardSeconds;
      else weeklyBonusSeconds += rewardSeconds;
    }
  }
  const grossAmount = resultComponents.reduce(
    (total, component) => total + parseDecimal(component.amount),
    0n,
  );
  return {
    approvedSeconds,
    pendingSeconds,
    weeklyBonusSeconds,
    weeklyBonusEstimatedSeconds,
    weeklyBonusWeekStarts,
    grossAmount: formatDecimal(grossAmount),
    estimate: pendingSeconds > 0 || weeklyBonusEstimatedSeconds > 0,
    components: resultComponents,
  };
}
