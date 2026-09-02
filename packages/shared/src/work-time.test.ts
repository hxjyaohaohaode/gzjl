import { describe, expect, it } from "vitest";

import {
  calculateWorkDuration,
  findOverlappingIntervals,
  intervalsOverlap,
} from "./work-time.js";

describe("calculateWorkDuration", () => {
  it("subtracts multiple legal breaks without changing gross duration", () => {
    const result = calculateWorkDuration(
      {
        startAt: new Date("2026-09-01T00:00:00.000Z"),
        endAt: new Date("2026-09-01T09:00:00.000Z"),
      },
      [
        {
          startAt: new Date("2026-09-01T02:00:00.000Z"),
          endAt: new Date("2026-09-01T02:30:00.000Z"),
        },
        {
          startAt: new Date("2026-09-01T05:00:00.000Z"),
          endAt: new Date("2026-09-01T06:00:00.000Z"),
        },
      ],
    );

    expect(result).toEqual({
      grossSeconds: 32_400,
      breakSeconds: 5_400,
      netSeconds: 27_000,
    });
  });

  it("supports a work session that crosses midnight", () => {
    const result = calculateWorkDuration(
      {
        startAt: new Date("2026-09-01T14:00:00.000Z"),
        endAt: new Date("2026-09-01T18:30:00.000Z"),
      },
      [],
    );

    expect(result.netSeconds).toBe(16_200);
  });

  it("rejects a break outside the session", () => {
    expect(() =>
      calculateWorkDuration(
        {
          startAt: new Date("2026-09-01T01:00:00.000Z"),
          endAt: new Date("2026-09-01T02:00:00.000Z"),
        },
        [
          {
            startAt: new Date("2026-09-01T00:50:00.000Z"),
            endAt: new Date("2026-09-01T01:10:00.000Z"),
          },
        ],
      ),
    ).toThrow(RangeError);
  });

  it("rejects overlapping breaks to prevent double subtraction", () => {
    expect(() =>
      calculateWorkDuration(
        {
          startAt: new Date("2026-09-01T01:00:00.000Z"),
          endAt: new Date("2026-09-01T04:00:00.000Z"),
        },
        [
          {
            startAt: new Date("2026-09-01T02:00:00.000Z"),
            endAt: new Date("2026-09-01T02:30:00.000Z"),
          },
          {
            startAt: new Date("2026-09-01T02:20:00.000Z"),
            endAt: new Date("2026-09-01T02:40:00.000Z"),
          },
        ],
      ),
    ).toThrow(RangeError);
  });
});

describe("interval overlap", () => {
  it("treats touching half-open intervals as non-overlapping", () => {
    expect(
      intervalsOverlap(
        {
          startAt: new Date("2026-09-01T01:00:00.000Z"),
          endAt: new Date("2026-09-01T02:00:00.000Z"),
        },
        {
          startAt: new Date("2026-09-01T02:00:00.000Z"),
          endAt: new Date("2026-09-01T03:00:00.000Z"),
        },
      ),
    ).toBe(false);
  });

  it("finds every overlapping pair", () => {
    expect(
      findOverlappingIntervals([
        {
          id: "a",
          startAt: new Date("2026-09-01T01:00:00.000Z"),
          endAt: new Date("2026-09-01T03:00:00.000Z"),
        },
        {
          id: "b",
          startAt: new Date("2026-09-01T02:00:00.000Z"),
          endAt: new Date("2026-09-01T04:00:00.000Z"),
        },
        {
          id: "c",
          startAt: new Date("2026-09-01T05:00:00.000Z"),
          endAt: new Date("2026-09-01T06:00:00.000Z"),
        },
      ]),
    ).toEqual([["a", "b"]]);
  });
});
