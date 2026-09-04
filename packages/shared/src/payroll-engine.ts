export type PayrollRuleKind =
  | "weekday"
  | "weekend"
  | "holiday"
  | "night_window"
  | "overtime";

export interface PayrollRateRule {
  id: string;
  type: PayrollRuleKind;
  priority: number;
  multiplier: string;
  stack?: boolean;
  startHour?: number;
  endHour?: number;
  thresholdSeconds?: number;
  holidayDates?: string[];
}

export interface PayableInterval {
  sourceId: string;
  startAt: Date;
  endAt: Date;
  approvalStatus: "approved" | "pending_review";
}

export interface PayrollComponentResult {
  type: PayrollRuleKind | "base";
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
  };
}

export interface PayrollCalculationResult {
  approvedSeconds: number;
  pendingSeconds: number;
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

export function calculateHourlyPayroll(input: {
  hourlyRate: string;
  timezone: string;
  intervals: readonly PayableInterval[];
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
      let segmentSeconds = Math.floor((nextMinute.getTime() - cursor.getTime()) / 1_000);
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
          (rule): rule is PayrollRateRule => Boolean(rule),
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
        cursor = new Date(cursor.getTime() + pieceSeconds * 1_000);
      }
    }
  }

  const resultComponents = [...components.values()].map((component) => ({
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
  const grossAmount = resultComponents.reduce(
    (total, component) => total + parseDecimal(component.amount),
    0n,
  );
  return {
    approvedSeconds,
    pendingSeconds,
    grossAmount: formatDecimal(grossAmount),
    estimate: pendingSeconds > 0,
    components: resultComponents,
  };
}
