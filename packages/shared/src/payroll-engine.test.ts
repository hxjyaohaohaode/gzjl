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

  it("awards five virtual hours as soon as weekly work reaches thirty hours", () => {
    const rule = {
      id: "weekly-reward",
      type: "weekly_bonus" as const,
      priority: 400,
      multiplier: "1",
      thresholdSeconds: 30 * 3_600,
      rewardSeconds: 5 * 3_600,
    };
    const exactThreshold = calculateHourlyPayroll({
      hourlyRate: "100",
      timezone: "UTC",
      intervals: [{
        sourceId: "exact",
        startAt: new Date("2026-09-07T00:00:00.000Z"),
        endAt: new Date("2026-09-08T06:00:00.000Z"),
        approvalStatus: "approved",
      }],
      rules: [rule],
      includePendingAsEstimate: false,
    });
    expect(exactThreshold.weeklyBonusSeconds).toBe(18_000);
    expect(exactThreshold.grossAmount).toBe("3500.000000");

    const belowThreshold = calculateHourlyPayroll({
      hourlyRate: "100",
      timezone: "UTC",
      intervals: [{
        sourceId: "below-threshold",
        startAt: new Date("2026-09-07T00:00:00.000Z"),
        endAt: new Date("2026-09-08T05:59:59.000Z"),
        approvalStatus: "approved",
      }],
      rules: [rule],
      includePendingAsEstimate: false,
    });
    expect(belowThreshold.weeklyBonusSeconds).toBe(0);
    expect(belowThreshold.grossAmount).toBe("2999.972222");
    expect(exactThreshold.weeklyBonusEstimatedSeconds).toBe(0);
    expect(exactThreshold.weeklyBonusWeekStarts).toEqual(["2026-09-07"]);
    expect(exactThreshold.components.find((component) => component.type === "bonus")).toMatchObject({
      label: "周超时奖励",
      seconds: 18_000,
      amount: "500.000000",
      estimate: false,
      trace: {
        weekStartDate: "2026-09-07",
        thresholdSeconds: 108_000,
        rewardSeconds: 18_000,
      },
    });
  });

  it("resets weekly reward by organization-local Monday and awards at most once per week", () => {
    const result = calculateHourlyPayroll({
      hourlyRate: "60",
      timezone: "Asia/Shanghai",
      intervals: [
        {
          sourceId: "sunday",
          startAt: new Date("2026-09-06T09:59:59.000Z"),
          endAt: new Date("2026-09-06T16:00:00.000Z"),
          approvalStatus: "approved",
        },
        {
          sourceId: "monday-first",
          startAt: new Date("2026-09-07T00:00:00.000Z"),
          endAt: new Date("2026-09-07T06:00:01.000Z"),
          approvalStatus: "approved",
        },
        {
          sourceId: "monday-extra",
          startAt: new Date("2026-09-08T00:00:00.000Z"),
          endAt: new Date("2026-09-08T02:00:00.000Z"),
          approvalStatus: "approved",
        },
      ],
      rules: [{
        id: "weekly-reward",
        type: "weekly_bonus",
        priority: 400,
        multiplier: "1",
        thresholdSeconds: 6 * 3_600,
        rewardSeconds: 3_600,
      }],
      includePendingAsEstimate: false,
    });
    expect(result.weeklyBonusWeekStarts).toEqual(["2026-08-31", "2026-09-07"]);
    expect(result.weeklyBonusSeconds).toBe(7_200);
    expect(result.components.filter((component) => component.type === "bonus")).toHaveLength(2);
  });

  it("treats each payroll month as a hard boundary inside a natural week", () => {
    const rule = [{
      id: "weekly-reward",
      type: "weekly_bonus" as const,
      priority: 400,
      multiplier: "1",
      thresholdSeconds: 30 * 3_600,
      rewardSeconds: 5 * 3_600,
    }];
    const september = calculateHourlyPayroll({
      hourlyRate: "100",
      timezone: "UTC",
      intervals: [{
        sourceId: "september-partial-week",
        startAt: new Date("2026-09-28T00:00:00.000Z"),
        endAt: new Date("2026-09-29T06:00:00.000Z"),
        approvalStatus: "approved",
      }],
      rules: rule,
      includePendingAsEstimate: false,
    });
    const october = calculateHourlyPayroll({
      hourlyRate: "100",
      timezone: "UTC",
      intervals: [{
        sourceId: "october-partial-week",
        startAt: new Date("2026-10-01T00:00:00.000Z"),
        endAt: new Date("2026-10-02T06:00:00.000Z"),
        approvalStatus: "approved",
      }],
      rules: rule,
      includePendingAsEstimate: false,
    });

    expect(september.weeklyBonusWeekStarts).toEqual(["2026-09-28"]);
    expect(october.weeklyBonusWeekStarts).toEqual(["2026-09-28"]);
    expect(september.weeklyBonusSeconds).toBe(18_000);
    expect(october.weeklyBonusSeconds).toBe(18_000);
  });

  it("marks a weekly reward as estimated only when pending work is needed to pass the threshold", () => {
    const input = {
      hourlyRate: "80",
      timezone: "UTC",
      intervals: [
        {
          sourceId: "approved",
          startAt: new Date("2026-09-07T00:00:00.000Z"),
          endAt: new Date("2026-09-08T05:00:00.000Z"),
          approvalStatus: "approved" as const,
        },
        {
          sourceId: "pending",
          startAt: new Date("2026-09-08T05:00:00.000Z"),
          endAt: new Date("2026-09-08T07:00:00.000Z"),
          approvalStatus: "pending_review" as const,
        },
      ],
      rules: [{
        id: "weekly-reward",
        type: "weekly_bonus" as const,
        priority: 400,
        multiplier: "1",
        thresholdSeconds: 30 * 3_600,
        rewardSeconds: 5 * 3_600,
      }],
    };
    const approvedOnly = calculateHourlyPayroll({
      ...input,
      includePendingAsEstimate: false,
    });
    expect(approvedOnly.weeklyBonusSeconds).toBe(0);
    expect(approvedOnly.weeklyBonusEstimatedSeconds).toBe(0);

    const estimate = calculateHourlyPayroll({
      ...input,
      includePendingAsEstimate: true,
    });
    expect(estimate.weeklyBonusSeconds).toBe(0);
    expect(estimate.weeklyBonusEstimatedSeconds).toBe(18_000);
    expect(estimate.components.find((component) => component.type === "bonus")?.estimate).toBe(true);
  });

  it("uses prior-period weekly context without awarding outside the current calculation segment", () => {
    const context = [
      {
        sourceId: "prior-period",
        startAt: new Date("2026-08-31T00:00:00.000Z"),
        endAt: new Date("2026-09-01T05:00:00.000Z"),
        approvalStatus: "approved" as const,
      },
      {
        sourceId: "current-period",
        startAt: new Date("2026-09-01T05:00:00.000Z"),
        endAt: new Date("2026-09-01T07:00:00.000Z"),
        approvalStatus: "approved" as const,
      },
    ];
    const rule = [{
      id: "weekly-reward",
      type: "weekly_bonus" as const,
      priority: 400,
      multiplier: "1",
      thresholdSeconds: 30 * 3_600,
      rewardSeconds: 5 * 3_600,
    }];
    const current = calculateHourlyPayroll({
      hourlyRate: "100",
      timezone: "UTC",
      intervals: [context[1]!],
      weeklyContextIntervals: context,
      rules: rule,
      includePendingAsEstimate: false,
    });
    expect(current.weeklyBonusSeconds).toBe(18_000);
    expect(current.grossAmount).toBe("700.000000");

    const excluded = calculateHourlyPayroll({
      hourlyRate: "100",
      timezone: "UTC",
      intervals: [context[1]!],
      weeklyContextIntervals: context,
      excludedWeeklyBonusWeekStarts: ["2026-08-31"],
      rules: rule,
      includePendingAsEstimate: false,
    });
    expect(excluded.weeklyBonusSeconds).toBe(0);
    expect(excluded.grossAmount).toBe("200.000000");

    const enabledAfterCrossing = calculateHourlyPayroll({
      hourlyRate: "100",
      timezone: "UTC",
      intervals: [context[1]!],
      weeklyContextIntervals: context,
      weeklyBonusEligibilityIntervals: [{
        ...context[1]!,
        startAt: new Date("2026-09-01T06:30:00.000Z"),
      }],
      rules: rule,
      includePendingAsEstimate: false,
    });
    expect(enabledAfterCrossing.weeklyBonusSeconds).toBe(0);
    expect(enabledAfterCrossing.grossAmount).toBe("200.000000");

    const afterCrossing = calculateHourlyPayroll({
      hourlyRate: "100",
      timezone: "UTC",
      intervals: [{
        sourceId: "later",
        startAt: new Date("2026-09-01T08:00:00.000Z"),
        endAt: new Date("2026-09-01T09:00:00.000Z"),
        approvalStatus: "approved",
      }],
      weeklyContextIntervals: [
        ...context,
        {
          sourceId: "later",
          startAt: new Date("2026-09-01T08:00:00.000Z"),
          endAt: new Date("2026-09-01T09:00:00.000Z"),
          approvalStatus: "approved",
        },
      ],
      rules: rule,
      includePendingAsEstimate: false,
    });
    expect(afterCrossing.weeklyBonusSeconds).toBe(0);
    expect(afterCrossing.grossAmount).toBe("100.000000");
  });
});
