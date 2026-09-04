import { describe, expect, it } from "vitest";

import { splitByLocalHour, subtractBreaks } from "./service.js";

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
});
