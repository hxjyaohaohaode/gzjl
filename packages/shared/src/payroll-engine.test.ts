import { describe, expect, it } from "vitest";

import { calculateHourlyPayroll } from "./payroll-engine.js";

describe("calculateHourlyPayroll", () => {
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
