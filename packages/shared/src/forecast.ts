export interface CalendarObservation {
  date: string;
  value: number;
}

export interface CalendarForecastPoint extends CalendarObservation {
  lowerValue: number;
  upperValue: number;
  confidence: "low" | "medium" | "high";
}

export interface CalendarForecastResult {
  points: CalendarForecastPoint[];
  method: "weekday_recent_robust_v2";
  sampleDays: number;
  nonZeroSampleDays: number;
}

function addDateKey(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekday(value: string): number {
  return new Date(`${value}T12:00:00.000Z`).getUTCDay();
}

function average(values: readonly number[]): number {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function weightedRecentAverage(values: readonly number[]): number {
  if (!values.length) return 0;
  let weighted = 0;
  let weights = 0;
  values.forEach((value, index) => {
    const weight = index + 1;
    weighted += value * weight;
    weights += weight;
  });
  return weights ? weighted / weights : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Produces an explanatory calendar-aware projection from daily observations.
 *
 * Zero-value days are deliberately retained because they carry the employee's
 * working-day pattern. The centre combines same-weekday history, weekday vs.
 * weekend behaviour, and a recency-weighted baseline. A bounded recent trend
 * prevents a short spike from growing without limit, while a robust MAD-based
 * interval makes sparse/noisy samples visibly less certain.
 */
export function forecastCalendarSeries(
  observed: readonly CalendarObservation[],
  horizonDays: number,
): CalendarForecastResult {
  const clean = observed
    .filter(
      (item) =>
        /^\d{4}-\d{2}-\d{2}$/.test(item.date) &&
        Number.isFinite(item.value) &&
        item.value >= 0,
    )
    .slice(-56);
  const horizon = Math.min(60, Math.max(0, Math.floor(horizonDays)));
  const nonZeroSampleDays = clean.filter((item) => item.value > 0).length;
  if (clean.length < 3 || nonZeroSampleDays < 2 || horizon === 0) {
    return {
      points: [],
      method: "weekday_recent_robust_v2",
      sampleDays: clean.length,
      nonZeroSampleDays,
    };
  }

  const values = clean.map((item) => item.value);
  const recent = values.slice(-Math.min(14, values.length));
  const lastSeven = values.slice(-Math.min(7, values.length));
  const previousSeven = values.slice(
    -Math.min(14, values.length),
    -Math.min(7, values.length),
  );
  const recentAverage = weightedRecentAverage(recent);
  const recentMedian = median(recent);
  const lastAverage = average(lastSeven);
  const previousAverage = average(previousSeven);
  const trendRatio = previousSeven.length && previousAverage > 0
    ? clamp(lastAverage / previousAverage, 0.7, 1.3)
    : 1;
  const globalAverage = average(values);
  const lastDate = clean.at(-1)!.date;

  const points = Array.from({ length: horizon }, (_, index) => {
    const date = addDateKey(lastDate, index + 1);
    const targetWeekday = weekday(date);
    const sameWeekday = clean
      .filter((item) => weekday(item.date) === targetWeekday)
      .map((item) => item.value)
      .slice(-8);
    const targetIsWeekend = targetWeekday === 0 || targetWeekday === 6;
    const sameDayType = clean
      .filter((item) => {
        const day = weekday(item.date);
        return (day === 0 || day === 6) === targetIsWeekend;
      })
      .map((item) => item.value)
      .slice(-28);

    const candidates: Array<{ value: number; weight: number }> = [
      { value: recentAverage, weight: 0.34 },
      { value: recentMedian, weight: 0.16 },
      { value: average(sameDayType), weight: sameDayType.length ? 0.18 : 0 },
      { value: globalAverage, weight: 0.08 },
      { value: average(sameWeekday), weight: sameWeekday.length ? 0.42 : 0 },
    ];
    const weightTotal = candidates.reduce((total, item) => total + item.weight, 0);
    const centre = candidates.reduce(
      (total, item) => total + item.value * item.weight,
      0,
    ) / Math.max(weightTotal, 1);
    const trendStrength = Math.min((index + 1) / 14, 1) * 0.45;
    const predicted = Math.max(
      0,
      centre * (1 + (trendRatio - 1) * trendStrength),
    );

    const variabilitySample = sameDayType.length >= 3 ? sameDayType : recent;
    const variabilityMedian = median(variabilitySample);
    const mad = median(
      variabilitySample.map((value) => Math.abs(value - variabilityMedian)),
    );
    const variance = average(
      variabilitySample.map((value) => (value - average(variabilitySample)) ** 2),
    );
    const robustDeviation = Math.max(
      mad * 1.4826,
      Math.sqrt(variance) * 0.65,
      predicted * 0.12,
    );
    const horizonExpansion = 1 + index * 0.055;
    const band = robustDeviation * 1.28 * horizonExpansion;
    const confidence: CalendarForecastPoint["confidence"] =
      clean.length >= 21 && sameWeekday.length >= 3
        ? "high"
        : clean.length >= 10 && sameWeekday.length >= 2
          ? "medium"
          : "low";
    return {
      date,
      value: Math.round(predicted),
      lowerValue: Math.round(Math.max(0, predicted - band)),
      upperValue: Math.round(predicted + band),
      confidence,
    };
  });

  return {
    points,
    method: "weekday_recent_robust_v2",
    sampleDays: clean.length,
    nonZeroSampleDays,
  };
}
