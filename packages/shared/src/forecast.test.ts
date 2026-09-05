import { describe, expect, it } from "vitest";

import { forecastCalendarSeries } from "./forecast.js";

describe("forecastCalendarSeries", () => {
  it("preserves weekday patterns instead of spreading work over every day equally", () => {
    const observed = Array.from({ length: 21 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 7, 3 + index, 12));
      const day = date.getUTCDay();
      return {
        date: date.toISOString().slice(0, 10),
        value: day === 0 || day === 6 ? 0 : 28_800,
      };
    });

    const result = forecastCalendarSeries(observed, 7);

    expect(result.method).toBe("adaptive_weekday_backtest_v3");
    expect(result.points).toHaveLength(7);
    expect(result.validationPoints).toBeGreaterThanOrEqual(14);
    expect(result.validationWape).not.toBeNull();
    expect(result.intervalCoverage).toBeGreaterThanOrEqual(0.8);
    expect(result.seasonalityStrength).toBeGreaterThan(0.5);
    const weekend = result.points.filter((point) => {
      const day = new Date(`${point.date}T12:00:00.000Z`).getUTCDay();
      return day === 0 || day === 6;
    });
    const weekdays = result.points.filter((point) => !weekend.includes(point));
    expect(Math.max(...weekend.map((point) => point.value))).toBeLessThan(
      Math.min(...weekdays.map((point) => point.value)),
    );
  });

  it("bounds noisy trends, widens uncertainty, and never predicts negative values", () => {
    const observed = [0, 7_200, 0, 14_400, 3_600, 18_000, 0, 28_800].map(
      (value, index) => ({
        date: `2026-09-${String(index + 1).padStart(2, "0")}`,
        value,
      }),
    );

    const result = forecastCalendarSeries(observed, 14);

    expect(result.points).toHaveLength(14);
    expect(result.points.every((point) => point.lowerValue >= 0)).toBe(true);
    expect(
      result.points.every(
        (point) => point.lowerValue <= point.value && point.value <= point.upperValue,
      ),
    ).toBe(true);
    expect(
      result.points.at(-1)!.upperValue - result.points.at(-1)!.lowerValue,
    ).toBeGreaterThanOrEqual(
      result.points[0]!.upperValue - result.points[0]!.lowerValue,
    );
  });

  it("rejects insufficient history and caps the requested horizon", () => {
    expect(
      forecastCalendarSeries(
        [
          { date: "2026-09-01", value: 1 },
          { date: "2026-09-02", value: 2 },
        ],
        7,
      ).points,
    ).toEqual([]);
    expect(
      forecastCalendarSeries(
        [
          { date: "2026-08-25", value: 1 },
          { date: "2026-08-26", value: 2 },
          { date: "2026-08-27", value: 3 },
          { date: "2026-08-28", value: 4 },
          { date: "2026-08-29", value: 0 },
          { date: "2026-08-30", value: 0 },
          { date: "2026-08-31", value: 5 },
        ],
        100,
      ).points,
    ).toHaveLength(60);
  });

  it("calibrates the ensemble from rolling backtests and reports honest uncertainty", () => {
    const observed = Array.from({ length: 56 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 6, 6 + index, 12));
      const day = date.getUTCDay();
      const weeklyGrowth = Math.floor(index / 7) * 900;
      return {
        date: date.toISOString().slice(0, 10),
        value: day === 0 || day === 6 ? 0 : 20_000 + weeklyGrowth + day * 240,
      };
    });

    const result = forecastCalendarSeries(observed, 21);

    expect(result.validationPoints).toBe(28);
    expect(result.validationWape).toBeLessThan(0.35);
    expect(result.intervalCoverage).toBeGreaterThanOrEqual(0.8);
    expect(result.trendPerDay).toBeGreaterThan(0);
    expect(result.points.every((point) => point.lowerValue <= point.value)).toBe(true);
    expect(result.points.every((point) => point.value <= point.upperValue)).toBe(true);
    expect(
      result.points.at(-1)!.upperValue - result.points.at(-1)!.lowerValue,
    ).toBeGreaterThanOrEqual(
      result.points[0]!.upperValue - result.points[0]!.lowerValue,
    );
  });
});
