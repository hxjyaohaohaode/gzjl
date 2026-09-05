import { describe, expect, it } from "vitest";

import {
  clipIntervalsToRange,
  fillDailySeries,
  forecastDailySeries,
  splitByLocalHour,
  subtractBreaks,
} from "./service.js";

function seconds(startAt: Date, endAt: Date): number {
  return (endAt.getTime() - startAt.getTime()) / 1_000;
}

describe("analytics local-time allocation", () => {
  it("splits a cross-midnight session by local day and removes the real break interval", () => {
    const productive = subtractBreaks(
      new Date("2026-09-01T15:30:00.000Z"),
      new Date("2026-09-01T17:30:00.000Z"),
      [
        {
          startAt: new Date("2026-09-01T16:00:00.000Z"),
          endAt: new Date("2026-09-01T16:15:00.000Z"),
        },
      ],
    );
    const buckets = productive.flatMap((interval) =>
      splitByLocalHour(interval, "Asia/Shanghai"),
    );

    expect(
      buckets.map((bucket) => ({
        date: bucket.date,
        hour: bucket.hour,
        seconds: seconds(bucket.startAt, bucket.endAt),
      })),
    ).toEqual([
      { date: "2026-09-01", hour: 23, seconds: 1_800 },
      { date: "2026-09-02", hour: 0, seconds: 2_700 },
      { date: "2026-09-02", hour: 1, seconds: 1_800 },
    ]);
    expect(buckets.reduce((total, bucket) => total + seconds(bucket.startAt, bucket.endAt), 0)).toBe(6_300);
  });

  it("does not assume that a time-zone offset is a whole number of hours", () => {
    const buckets = splitByLocalHour(
      {
        startAt: new Date("2026-09-01T00:00:00.000Z"),
        endAt: new Date("2026-09-01T01:00:00.000Z"),
      },
      "Asia/Kathmandu",
    );

    expect(
      buckets.map((bucket) => ({
        hour: bucket.hour,
        seconds: seconds(bucket.startAt, bucket.endAt),
      })),
    ).toEqual([
      { hour: 5, seconds: 900 },
      { hour: 6, seconds: 2_700 },
    ]);
  });

  it("clips overlapping work to the exact requested half-open range", () => {
    const clipped = clipIntervalsToRange(
      [
        {
          startAt: new Date("2026-09-01T23:30:00.000Z"),
          endAt: new Date("2026-09-02T01:30:00.000Z"),
        },
        {
          startAt: new Date("2026-09-02T02:00:00.000Z"),
          endAt: new Date("2026-09-02T03:00:00.000Z"),
        },
      ],
      new Date("2026-09-02T00:00:00.000Z"),
      new Date("2026-09-02T01:00:00.000Z"),
    );

    expect(clipped).toEqual([
      {
        startAt: new Date("2026-09-02T00:00:00.000Z"),
        endAt: new Date("2026-09-02T01:00:00.000Z"),
      },
    ]);
    expect(
      clipped.reduce(
        (total, item) => total + seconds(item.startAt, item.endAt),
        0,
      ),
    ).toBe(3_600);
  });

  it("does not count an overlap that exists only inside a break", () => {
    const productive = subtractBreaks(
      new Date("2026-09-02T00:00:00.000Z"),
      new Date("2026-09-02T04:00:00.000Z"),
      [
        {
          startAt: new Date("2026-09-02T01:00:00.000Z"),
          endAt: new Date("2026-09-02T03:00:00.000Z"),
        },
      ],
    );

    expect(
      clipIntervalsToRange(
        productive,
        new Date("2026-09-02T01:30:00.000Z"),
        new Date("2026-09-02T02:30:00.000Z"),
      ),
    ).toEqual([]);
  });

  it("fills missing organization-local dates without inventing worked seconds", () => {
    const series = fillDailySeries(
      new Date("2026-09-01T16:00:00.000Z"),
      new Date("2026-09-04T16:00:00.000Z"),
      "Asia/Shanghai",
      new Map([
        ["2026-09-02", 3_600],
        ["2026-09-04", 7_200],
      ]),
    );

    expect(series).toEqual([
      { date: "2026-09-02", seconds: 3_600 },
      { date: "2026-09-03", seconds: 0 },
      { date: "2026-09-04", seconds: 7_200 },
    ]);
  });

  it("keeps deterministic forecasts nonnegative and visually separable as a band", () => {
    expect(
      forecastDailySeries([
        { date: "2026-09-01", seconds: 3_600 },
        { date: "2026-09-02", seconds: 7_200 },
        { date: "2026-09-03", seconds: 0 },
        { date: "2026-09-04", seconds: 10_800 },
      ]),
    ).toEqual([]);
    const forecast = forecastDailySeries(
      Array.from({ length: 14 }, (_, index) => {
        const date = new Date(Date.UTC(2026, 7, 22 + index, 12));
        const day = date.getUTCDay();
        return {
          date: date.toISOString().slice(0, 10),
          seconds: day === 0 || day === 6 ? 0 : 3_600 + index * 240,
        };
      }),
    );

    expect(forecast).toHaveLength(7);
    expect(forecast[0]?.date).toBe("2026-09-05");
    expect(forecast.at(-1)?.date).toBe("2026-09-11");
    expect(forecast.every((item) => item.lowerSeconds >= 0)).toBe(true);
    expect(
      forecast.every(
        (item) =>
          item.lowerSeconds <= item.seconds && item.seconds <= item.upperSeconds,
      ),
    ).toBe(true);
  });
});
