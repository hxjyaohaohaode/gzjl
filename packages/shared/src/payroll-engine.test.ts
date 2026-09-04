import { describe, expect, it } from "vitest";

import {
  calculateHourlyPayroll,
  localDateKeysForIntervals,
  prorateDecimalAmount,
} from "./payroll-engine.js";

describe("calculateHourlyPayroll", () => {
  it("prorates fixed money with deterministic six-decimal rounding", () => {
    expect(prorateDecimalAmount("10000", 10, 30)).toBe("3333.333333");
    expect(prorateDecimalAmount("10000", 20, 30)).toBe("6666.666667");
  });

  it("counts every local work date for a cross-midnight daily plan", () => {
    expect(
      localDateKeysForIntervals(
        [
          {
            startAt: new Date("2026-09-04T15:30:00.000Z"),
            endAt: new Date("2026-09-05T01:30:00.000Z"),
          },
        ],
        "Asia/Shanghai",
      ),
    ).toEqual(["2026-09-04", "2026-09-05"]);
  });

  it("treats interval ends as exclusive at local midnight", () => {
    expect(
      localDateKeysForIntervals(
        [
          {
            startAt: new Date("2026-09-04T14:00:00.000Z"),
            endAt: new Date("2026-09-04T16:00:00.000Z"),
          },
        ],
        "Asia/Shanghai",
      ),
    ).toEqual(["2026-09-04"]);
  });
  it("calculates ordinary approved hourly work with fixed six-decimal precision", () => {
    const result = calculateHourlyPayroll({
      hourlyRate: "100.00",
      timezone: "Asia/Shanghai",
      intervals: [
        {
          sourceId: "s1",
          startAt: new Date("2026-09-01T01:00:00.000Z"),
          endAt: new Date("2026-09-01T02:30:00.000Z"),
          approvalStatus: "approved",
        },
      ],
      rules: [],
      includePendingAsEstimate: false,
    });
    expect(result.approvedSeconds).toBe(5_400);
    expect(result.grossAmount).toBe("150.000000");
    expect(result.estimate).toBe(false);
  });

  it("keeps a full hour when timer timestamps include milliseconds", () => {
    const startAt = new Date("2026-09-01T01:00:30.527Z");
    const result = calculateHourlyPayroll({
      hourlyRate: "100.00",
      timezone: "Asia/Shanghai",
      intervals: [
        {
          sourceId: "timer-with-milliseconds",
          startAt,
          endAt: new Date(startAt.getTime() + 3_600_000),
          approvalStatus: "approved",
        },
      ],
      rules: [],
      includePendingAsEstimate: false,
    });
    expect(result.approvedSeconds).toBe(3_600);
    expect(result.grossAmount).toBe("100.000000");
  });

  it("uses holiday priority and stacks a night multiplier", () => {
    const result = calculateHourlyPayroll({
      hourlyRate: "80",
      timezone: "Asia/Shanghai",
      intervals: [
        {
          sourceId: "s2",
          startAt: new Date("2026-10-01T14:00:00.000Z"),
          endAt: new Date("2026-10-01T15:00:00.000Z"),
          approvalStatus: "approved",
        },
      ],
      rules: [
        { id: "holiday", type: "holiday", priority: 200, multiplier: "3", holidayDates: ["2026-10-01"] },
        { id: "night", type: "night_window", priority: 300, multiplier: "1.5", stack: true, startHour: 22, endHour: 6 },
      ],
      includePendingAsEstimate: false,
    });
    expect(result.grossAmount).toBe("360.000000");
    expect(result.components[0]?.trace.ruleIds).toEqual(["holiday", "night"]);
  });

  it("splits exactly at an overtime threshold", () => {
    const result = calculateHourlyPayroll({
      hourlyRate: "60",
      timezone: "UTC",
      intervals: [
        {
          sourceId: "s3",
          startAt: new Date("2026-09-01T00:00:00.000Z"),
          endAt: new Date("2026-09-01T02:00:00.000Z"),
          approvalStatus: "approved",
        },
      ],
      rules: [{ id: "ot", type: "overtime", priority: 500, multiplier: "2", thresholdSeconds: 3_600 }],
      includePendingAsEstimate: false,
    });
    expect(result.grossAmount).toBe("180.000000");
    expect(result.components.map((component) => component.seconds).sort()).toEqual([3_600, 3_600]);
    expect(result.components.every((component) => component.trace.date === "2026-09-01")).toBe(true);
  });

  it("resets overtime thresholds for each organization-local calendar day", () => {
    const result = calculateHourlyPayroll({
      hourlyRate: "60",
      timezone: "Asia/Shanghai",
      intervals: [
        {
          sourceId: "day-1",
          startAt: new Date("2026-09-01T01:00:00.000Z"),
          endAt: new Date("2026-09-01T03:00:00.000Z"),
          approvalStatus: "approved",
        },
        {
          sourceId: "day-2",
          startAt: new Date("2026-09-02T01:00:00.000Z"),
          endAt: new Date("2026-09-02T03:00:00.000Z"),
          approvalStatus: "approved",
        },
      ],
      rules: [
        {
          id: "daily-overtime",
          type: "overtime",
          priority: 500,
          multiplier: "2",
          thresholdSeconds: 3_600,
        },
      ],
      includePendingAsEstimate: false,
    });
    expect(result.grossAmount).toBe("360.000000");
    expect(result.components.map((component) => component.trace.date).sort()).toEqual([
      "2026-09-01",
      "2026-09-01",
      "2026-09-02",
      "2026-09-02",
    ]);
  });

  it("excludes pending work unless estimates are enabled", () => {
    const interval = {
      sourceId: "s4",
      startAt: new Date("2026-09-01T00:00:00.000Z"),
      endAt: new Date("2026-09-01T01:00:00.000Z"),
      approvalStatus: "pending_review" as const,
    };
    expect(calculateHourlyPayroll({ hourlyRate: "50", timezone: "UTC", intervals: [interval], rules: [], includePendingAsEstimate: false }).grossAmount).toBe("0.000000");
    const estimate = calculateHourlyPayroll({ hourlyRate: "50", timezone: "UTC", intervals: [interval], rules: [], includePendingAsEstimate: true });
    expect(estimate.pendingSeconds).toBe(3_600);
    expect(estimate.estimate).toBe(true);
  });
});
