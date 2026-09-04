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

    expect(result.method).toBe("weekday_recent_robust_v2");
    expect(result.points).toHaveLength(7);
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
          { date: "2026-09-01", value: 1 },
          { date: "2026-09-02", value: 2 },
          { date: "2026-09-03", value: 3 },
        ],
        100,
      ).points,
    ).toHaveLength(60);
  });
});
