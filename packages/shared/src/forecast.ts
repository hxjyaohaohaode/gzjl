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
  method: "adaptive_weekday_backtest_v3";
  sampleDays: number;
  nonZeroSampleDays: number;
  validationPoints: number;
  validationWape: number | null;
  intervalCoverage: number | null;
  seasonalityStrength: number;
  trendPerDay: number;
}

type ModelName = "weekday" | "day_type" | "recent" | "trend";

const MODEL_NAMES: readonly ModelName[] = [
  "weekday",
  "day_type",
  "recent",
  "trend",
];

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

function quantile(values: readonly number[], probability: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil(probability * sorted.length) - 1),
  );
  return sorted[index]!;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function exponentiallyWeightedAverage(
  values: readonly number[],
  decay = 0.82,
): number {
  if (!values.length) return 0;
  let weighted = 0;
  let weights = 0;
  values.forEach((value, index) => {
    const weight = decay ** (values.length - index - 1);
    weighted += value * weight;
    weights += weight;
  });
  return weights ? weighted / weights : 0;
}

function expectedIntermittentValue(
  values: readonly number[],
  priorActiveRate: number,
): number {
  if (!values.length) return 0;
  const positive = values.filter((value) => value > 0);
  // Beta-binomial shrinkage avoids turning one isolated zero/non-zero day into
  // a permanent calendar rule. Positive magnitude is robust to outliers.
  const priorStrength = Math.min(3, Math.max(1, Math.sqrt(values.length) / 2));
  const activeProbability =
    (positive.length + priorStrength * priorActiveRate) /
    (values.length + priorStrength);
  if (!positive.length) return 0;
  const robustMagnitude =
    0.65 * median(positive) + 0.35 * exponentiallyWeightedAverage(positive);
  return activeProbability * robustMagnitude;
}

function robustTrendPerDay(history: readonly CalendarObservation[]): number {
  if (history.length < 14) return 0;
  const weeklyMeans: number[] = [];
  for (let end = history.length; end > 0; end -= 7) {
    const start = Math.max(0, end - 7);
    weeklyMeans.unshift(
      average(history.slice(start, end).map((item) => item.value)),
    );
  }
  if (weeklyMeans.length < 2) return 0;
  const slopes: number[] = [];
  for (let left = 0; left < weeklyMeans.length; left += 1) {
    for (let right = left + 1; right < weeklyMeans.length; right += 1) {
      slopes.push(
        (weeklyMeans[right]! - weeklyMeans[left]!) /
          ((right - left) * 7),
      );
    }
  }
  const raw = median(slopes);
  const values = history.map((item) => item.value);
  const scale = Math.max(median(values), average(values) * 0.35, 1);
  // Keep short-lived spikes from being extrapolated without limit while the
  // estimate itself remains the outlier-resistant Theil-Sen median slope.
  return clamp(raw, -scale * 0.025, scale * 0.025);
}

function candidatePredictions(
  history: readonly CalendarObservation[],
  targetDate: string,
  horizon: number,
): Record<ModelName, number> {
  const values = history.map((item) => item.value);
  const positiveRate =
    values.filter((value) => value > 0).length / Math.max(values.length, 1);
  const targetWeekday = weekday(targetDate);
  const targetWeekend = targetWeekday === 0 || targetWeekday === 6;
  const sameWeekday = history
    .filter((item) => weekday(item.date) === targetWeekday)
    .map((item) => item.value)
    .slice(-12);
  const sameDayType = history
    .filter((item) => {
      const day = weekday(item.date);
      return (day === 0 || day === 6) === targetWeekend;
    })
    .map((item) => item.value)
    .slice(-42);
  const recent = values.slice(-Math.min(21, values.length));
  const recentLevel = exponentiallyWeightedAverage(recent);
  const trend = robustTrendPerDay(history);
  return {
    weekday: expectedIntermittentValue(sameWeekday, positiveRate),
    day_type: expectedIntermittentValue(sameDayType, positiveRate),
    recent: recentLevel,
    trend: Math.max(0, recentLevel + trend * horizon),
  };
}

function normalizedInverseErrorWeights(
  errors: Record<ModelName, number[]>,
  scale: number,
): Record<ModelName, number> {
  const scores = MODEL_NAMES.map((name) => {
    const modelErrors = errors[name];
    if (!modelErrors.length) return [name, 1] as const;
    const mae = average(modelErrors);
    return [name, 1 / Math.max(mae, scale * 0.05, 1e-9)] as const;
  });
  const total = scores.reduce((sum, [, score]) => sum + score, 0);
  return Object.fromEntries(
    scores.map(([name, score]) => [name, score / Math.max(total, 1e-9)]),
  ) as Record<ModelName, number>;
}

function ensembleValue(
  candidates: Record<ModelName, number>,
  weights: Record<ModelName, number>,
): number {
  return MODEL_NAMES.reduce(
    (total, name) => total + candidates[name] * weights[name],
    0,
  );
}

function weekdaySeasonalityStrength(
  history: readonly CalendarObservation[],
): number {
  const values = history.map((item) => item.value);
  const globalMean = average(values);
  const totalVariance = average(
    values.map((value) => (value - globalMean) ** 2),
  );
  if (totalVariance <= 0) return 0;
  const means = Array.from({ length: 7 }, (_, day) => {
    const group = history.filter((item) => weekday(item.date) === day);
    return group.length
      ? average(group.map((item) => item.value))
      : globalMean;
  });
  const withinVariance = average(
    history.map((item) => (item.value - means[weekday(item.date)]!) ** 2),
  );
  return clamp(1 - withinVariance / totalVariance, 0, 1);
}

/**
 * Adaptive calendar forecast for non-negative daily work/pay observations.
 *
 * The model keeps real zero days, models both activity probability and
 * positive magnitude, and ensembles weekday seasonality, workday/weekend
 * behaviour, an exponentially weighted level, and a robust Theil-Sen trend.
 * Ensemble weights come from rolling-origin backtesting on the caller's own
 * history. Prediction intervals use the empirical 90th percentile of those
 * out-of-sample residuals plus model disagreement, then widen with horizon.
 */
export function forecastCalendarSeries(
  observed: readonly CalendarObservation[],
  horizonDays: number,
): CalendarForecastResult {
  const byDate = new Map<string, CalendarObservation>();
  observed.forEach((item) => {
    if (
      /^\d{4}-\d{2}-\d{2}$/.test(item.date) &&
      Number.isFinite(item.value) &&
      item.value >= 0
    ) {
      byDate.set(item.date, { date: item.date, value: item.value });
    }
  });
  const clean = [...byDate.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-84);
  const horizon = Math.min(60, Math.max(0, Math.floor(horizonDays)));
  const nonZeroSampleDays = clean.filter((item) => item.value > 0).length;
  const emptyResult = {
    points: [],
    method: "adaptive_weekday_backtest_v3" as const,
    sampleDays: clean.length,
    nonZeroSampleDays,
    validationPoints: 0,
    validationWape: null,
    intervalCoverage: null,
    seasonalityStrength: weekdaySeasonalityStrength(clean),
    trendPerDay: robustTrendPerDay(clean),
  };
  if (clean.length < 7 || nonZeroSampleDays < 2 || horizon === 0) {
    return emptyResult;
  }

  const validationStart = Math.max(7, clean.length - 28);
  const modelErrors: Record<ModelName, number[]> = {
    weekday: [],
    day_type: [],
    recent: [],
    trend: [],
  };
  const validationRows: Array<{
    actual: number;
    candidates: Record<ModelName, number>;
  }> = [];
  for (let index = validationStart; index < clean.length; index += 1) {
    const history = clean.slice(0, index);
    if (history.filter((item) => item.value > 0).length < 2) continue;
    const actual = clean[index]!;
    const candidates = candidatePredictions(history, actual.date, 1);
    MODEL_NAMES.forEach((name) => {
      modelErrors[name].push(Math.abs(actual.value - candidates[name]));
    });
    validationRows.push({ actual: actual.value, candidates });
  }

  const scale = Math.max(average(clean.map((item) => item.value)), 1);
  const weights = normalizedInverseErrorWeights(modelErrors, scale);
  const residuals = validationRows.map((row) =>
    Math.abs(row.actual - ensembleValue(row.candidates, weights)),
  );
  const validationActualTotal = validationRows.reduce(
    (total, row) => total + row.actual,
    0,
  );
  const validationWape = validationRows.length
    ? residuals.reduce((total, residual) => total + residual, 0) /
      Math.max(validationActualTotal, scale)
    : null;
  const conformalProbability = Math.min(
    1,
    Math.ceil((residuals.length + 1) * 0.9) /
      Math.max(residuals.length, 1),
  );
  const conformalError = quantile(residuals, conformalProbability);
  const covered = validationRows.filter((row) => {
    const prediction = ensembleValue(row.candidates, weights);
    return Math.abs(row.actual - prediction) <= conformalError;
  }).length;
  const intervalCoverage = validationRows.length
    ? covered / validationRows.length
    : null;
  const seasonalityStrength = weekdaySeasonalityStrength(clean);
  const trendPerDay = robustTrendPerDay(clean);
  const lastDate = clean.at(-1)!.date;

  const points = Array.from({ length: horizon }, (_, index) => {
    const date = addDateKey(lastDate, index + 1);
    const candidates = candidatePredictions(clean, date, index + 1);
    const predicted = Math.max(0, ensembleValue(candidates, weights));
    const candidateValues = MODEL_NAMES.map((name) => candidates[name]);
    const disagreement =
      quantile(candidateValues, 0.75) - quantile(candidateValues, 0.25);
    const empiricalBand = Math.max(
      conformalError,
      disagreement,
      predicted * (validationRows.length >= 14 ? 0.06 : 0.12),
    );
    const band = empiricalBand * Math.sqrt(1 + index / 7);
    const sameWeekdaySupport = clean.filter(
      (item) => weekday(item.date) === weekday(date),
    ).length;
    const confidence: CalendarForecastPoint["confidence"] =
      clean.length >= 28 &&
      sameWeekdaySupport >= 4 &&
      validationWape !== null &&
      validationWape <= 0.35 &&
      (intervalCoverage ?? 0) >= 0.8
        ? "high"
        : clean.length >= 14 &&
            sameWeekdaySupport >= 2 &&
            validationWape !== null &&
            validationWape <= 0.7
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
    method: "adaptive_weekday_backtest_v3",
    sampleDays: clean.length,
    nonZeroSampleDays,
    validationPoints: validationRows.length,
    validationWape,
    intervalCoverage,
    seasonalityStrength,
    trendPerDay,
  };
}
