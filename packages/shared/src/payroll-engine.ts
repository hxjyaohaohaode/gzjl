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
  /** Allocated full seconds; factual boundaries remain millisecond-accurate. */
  payableSeconds?: number;
  firstPayableAt?: Date;
}

/** A person's second is payable once even when several factual records
 * describe it. Approved coverage wins over estimates; stable source ordering
 * keeps the financial trace deterministic without deleting original facts. */
export function mergePayableIntervals(input: readonly PayableInterval[]): PayableInterval[] {
  const events = new Map<number, { starts: number[]; ends: number[] }>();
  const eventAt = (time: number) => {
    const event = events.get(time) ?? { starts: [], ends: [] };
    events.set(time, event);
    return event;
  };
  input.forEach((interval, index) => {
    if (!Number.isFinite(interval.startAt.getTime()) || !Number.isFinite(interval.endAt.getTime()) || interval.endAt <= interval.startAt)
      throw new RangeError("Payroll intervals must have a positive duration");
    eventAt(interval.startAt.getTime()).starts.push(index);
    eventAt(interval.endAt.getTime()).ends.push(index);
  });
  const priority = (left: number, right: number) => {
    const a = input[left]!; const b = input[right]!;
    return Number(a.approvalStatus !== "approved") - Number(b.approvalStatus !== "approved") ||
      a.startAt.getTime() - b.startAt.getTime() || a.sourceId.localeCompare(b.sourceId) || left - right;
  };
  const heap: number[] = []; const active = new Set<number>();
  const push = (index: number) => {
    heap.push(index); let cursor = heap.length - 1;
    while (cursor > 0) {
      const parent = Math.floor((cursor - 1) / 2);
      if (priority(heap[parent]!, heap[cursor]!) <= 0) break;
      [heap[parent], heap[cursor]] = [heap[cursor]!, heap[parent]!]; cursor = parent;
    }
  };
  const removeTop = () => {
    const last = heap.pop(); if (!heap.length || last === undefined) return;
    heap[0] = last; let cursor = 0;
    while (cursor * 2 + 1 < heap.length) {
      let next = cursor * 2 + 1;
      if (next + 1 < heap.length && priority(heap[next + 1]!, heap[next]!) < 0) next += 1;
      if (priority(heap[cursor]!, heap[next]!) <= 0) break;
      [heap[cursor], heap[next]] = [heap[next]!, heap[cursor]!]; cursor = next;
    }
  };
  const times = [...events.keys()].sort((a, b) => a - b); const merged: PayableInterval[] = [];
  times.forEach((time, offset) => {
    const event = events.get(time)!;
    event.ends.forEach((index) => active.delete(index));
    event.starts.forEach((index) => { active.add(index); push(index); });
    while (heap.length && !active.has(heap[0]!)) removeTop();
    const end = times[offset + 1]; const winner = heap.length ? input[heap[0]!] : undefined;
    if (end === undefined || !winner) return;
    const previous = merged.at(-1);
    if (previous?.endAt.getTime() === time && previous.sourceId === winner.sourceId && previous.approvalStatus === winner.approvalStatus) {
      previous.endAt = new Date(end);
    } else merged.push({ ...winner, startAt: new Date(time), endAt: new Date(end) });
  });
  return merged;
}

/** Whole seconds belong to the source covering their start. The clock runs
 * only during effective work: breaks pause it, and source/status changes do
 * not reset it. Preserve factual boundaries even when one allocated second
 * spans two work fragments separated by a break. */
export function wholeSecondPayableIntervals(input: readonly PayableInterval[]): PayableInterval[] {
  const ordered = [...input].sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
  if (ordered.every((entry, index) => Number.isInteger(entry.payableSeconds) && entry.payableSeconds! >= 0 &&
    entry.firstPayableAt && (index === 0 || ordered[index - 1]!.endAt <= entry.startAt))) {
    return ordered.map((entry) => ({ ...entry }));
  }
  const merged = mergePayableIntervals(input);
  const result: PayableInterval[] = [];
  const duration = (entry: PayableInterval) => entry.endAt.getTime() - entry.startAt.getTime();
  const approvedBudget = Math.floor(merged.filter((entry) => entry.approvalStatus === "approved").reduce((sum, entry) => sum + duration(entry), 0) / 1_000);
  const totalBudget = Math.floor(merged.reduce((sum, entry) => sum + duration(entry), 0) / 1_000);
  const elapsedByStatus = { approved: 0, pending_review: 0 };
  for (const interval of merged) {
    // Pending facts cannot lower already approved seconds or shift confirmed
    // pay into estimates. Confirmed coverage owns its independent full budget;
    // pending coverage receives only the remaining union budget.
    const budget = interval.approvalStatus === "approved" ? approvedBudget : totalBudget - approvedBudget;
    const elapsedMs = elapsedByStatus[interval.approvalStatus];
    const start = Math.min(budget, Math.ceil(elapsedMs / 1_000));
    const endMs = elapsedMs + duration(interval);
    const end = Math.min(budget, Math.ceil(endMs / 1_000));
    result.push({ ...interval, payableSeconds: end - start,
      firstPayableAt: new Date(interval.startAt.getTime() + start * 1_000 - elapsedMs) });
    elapsedByStatus[interval.approvalStatus] = endMs;
  }
  return result;
}

export function payableIntervalSeconds(interval: PayableInterval): number {
  return interval.payableSeconds ?? Math.floor((interval.endAt.getTime() - interval.startAt.getTime()) / 1_000);
}

/** Divide already allocated seconds between rate windows by their start;
 * applying a new rate must not reset the person's fractional-second clock. */
export function clipWholeSecondPayableIntervals(
  intervals: readonly PayableInterval[], startsAt: Date, endsAt: Date,
): PayableInterval[] {
  return wholeSecondPayableIntervals(intervals).flatMap((interval) => {
    const origin = (interval.firstPayableAt ?? interval.startAt).getTime();
    const budget = payableIntervalSeconds(interval);
    const start = Math.min(budget, Math.max(0, Math.ceil((startsAt.getTime() - origin) / 1_000)));
    const end = Math.min(budget, Math.max(0, Math.ceil((endsAt.getTime() - origin) / 1_000)));
    return end > start ? [{ ...interval,
      startAt: interval.startAt < startsAt ? startsAt : interval.startAt,
      endAt: interval.endAt > endsAt ? endsAt : interval.endAt,
      firstPayableAt: new Date(origin + start * 1_000), payableSeconds: end - start,
    }] : [];
  });
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

const payrollComponentLabels: Record<Exclude<PayrollComponentType, "bonus">, string> = {
  base: "基础工时",
  weekday: "工作日工时",
  weekend: "周末工时",
  holiday: "节假日工时",
  night_window: "夜间工时",
  overtime: "超时工时",
};

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

function* payableMinuteSegments(interval: PayableInterval) {
  let cursor = (interval.firstPayableAt ?? interval.startAt).getTime();
  let remaining = payableIntervalSeconds(interval);
  while (remaining > 0) {
    const boundary = Math.floor(cursor / 60_000) * 60_000 + 60_000;
    const seconds = Math.min(remaining, Math.ceil((boundary - cursor) / 1_000));
    yield { startAt: new Date(cursor), seconds };
    remaining -= seconds;
    cursor += seconds * 1_000;
  }
}

function dailyContextCounter(intervals: readonly PayableInterval[], timezone: string) {
  const byDate = new Map<string, Array<{ start: number; seconds: number; before: number }>>();
  for (const interval of intervals) {
    for (const segment of payableMinuteSegments(interval)) {
      const date = localParts(segment.startAt, timezone).date;
      const entries = byDate.get(date) ?? [];
      const previous = entries.at(-1);
      entries.push({ start: segment.startAt.getTime(), seconds: segment.seconds, before: previous ? previous.before + previous.seconds : 0 });
      byDate.set(date, entries);
    }
  }
  return (at: Date, date: string) => {
    const entries = byDate.get(date) ?? [];
    let low = 0; let high = entries.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (entries[middle]!.start <= at.getTime()) low = middle + 1;
      else high = middle;
    }
    const entry = entries[low - 1];
    return entry ? entry.before + Math.min(entry.seconds, Math.max(0, Math.floor((at.getTime() - entry.start) / 1_000))) : 0;
  };
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
    for (const { startAt: cursor, seconds } of payableMinuteSegments(interval)) {
      const parts = localParts(cursor, timezone);
      const week = weekStartDate(parts.date);
      const cumulative = cumulativeByWeek.get(week) ?? 0;
      const sourceIds = sourceIdsByWeek.get(week) ?? new Set<string>();
      sourceIds.add(interval.sourceId);
      sourceIdsByWeek.set(week, sourceIds);
      if (!crossings.has(week) && cumulative + seconds >= thresholdSeconds) {
        // Intervals are end-exclusive. Attribute the reward to the first
        // second that completes the threshold so an exact 30:00:00 total is
        // inside the source interval instead of landing on its end boundary.
        const earnedAt = new Date(
          cursor.getTime() +
            Math.max(0, thresholdSeconds - cumulative - 1) * 1_000,
        );
        crossings.set(week, {
          weekStartDate: week,
          date: localParts(earnedAt, timezone).date,
          earnedAt,
          sourceId: interval.sourceId,
          sourceIds: new Set(sourceIds),
          actualSeconds: thresholdSeconds,
        });
      }
      cumulativeByWeek.set(week, cumulative + seconds);
    }
  }
  return crossings;
}

export function calculateHourlyPayroll(input: {
  hourlyRate: string;
  timezone: string;
  intervals: readonly PayableInterval[];
  dailyContextIntervals?: readonly PayableInterval[];
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

  const intervals = wholeSecondPayableIntervals(input.intervals)
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
  const approvedSecondsByDate = new Map<string, number>();
  const dailyContext = input.dailyContextIntervals
    ? wholeSecondPayableIntervals([...input.dailyContextIntervals, ...input.intervals])
        .filter((interval) => interval.approvalStatus === "approved" || input.includePendingAsEstimate)
    : undefined;
  const contextSecondsBefore = dailyContext ? dailyContextCounter(dailyContext, input.timezone) : undefined;
  const approvedContextSecondsBefore = dailyContext
    ? dailyContextCounter(dailyContext.filter((interval) => interval.approvalStatus === "approved"), input.timezone) : undefined;
  const components = new Map<string, MutableComponent>();

  for (const interval of intervals) {
    if (interval.endAt <= interval.startAt) {
      throw new RangeError("Payroll intervals must have a positive duration");
    }
    for (const segment of payableMinuteSegments(interval)) {
      let cursor = segment.startAt;
      let segmentSeconds = segment.seconds;

      while (segmentSeconds > 0) {
        const parts = localParts(cursor, input.timezone);
        const cumulativeSeconds = contextSecondsBefore?.(cursor, parts.date) ?? cumulativeSecondsByDate.get(parts.date) ?? 0;
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

        const pending = interval.approvalStatus === "pending_review";
        const approvedBefore = approvedContextSecondsBefore?.(cursor, parts.date) ?? approvedSecondsByDate.get(parts.date) ?? 0;
        const estimate = pending || Boolean(overtimeRule && ruleIds.includes(overtimeRule.id) &&
          approvedBefore < (overtimeRule.thresholdSeconds ?? Number.MAX_SAFE_INTEGER));
        // A date-scoped component is intentionally preserved in the immutable
        // payroll trace. The employee dashboard can therefore render exact
        // daily pay without recalculating money in the browser.
        const componentKey = `${parts.date}:${selectedType}:${multiplierMicros}:${estimate}:${ruleIds.join(",")}`;
        let component = components.get(componentKey);
        if (!component) {
          component = {
            date: parts.date,
            type: selectedType,
            label: payrollComponentLabels[selectedType],
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
        if (pending) pendingSeconds += pieceSeconds;
        else {
          approvedSeconds += pieceSeconds;
          approvedSecondsByDate.set(parts.date, approvedBefore + pieceSeconds);
        }
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
  const weeklyContext = wholeSecondPayableIntervals(input.weeklyContextIntervals ?? input.intervals);
  const weeklyBonusEligibility =
    wholeSecondPayableIntervals(input.weeklyBonusEligibilityIntervals ?? input.intervals);
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
    estimate: resultComponents.some((component) => component.estimate),
    components: resultComponents,
  };
}
