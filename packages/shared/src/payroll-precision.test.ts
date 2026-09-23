import { describe, expect, it } from "vitest";
import { calculateHourlyPayroll, clipWholeSecondPayableIntervals, wholeSecondPayableIntervals, type PayableInterval, type PayrollRateRule } from "./payroll-engine.js";

const interval = (id: string, start: string, end: string, approvalStatus: PayableInterval["approvalStatus"] = "approved"): PayableInterval => ({
  sourceId: id, startAt: new Date(`2026-09-22T${start}Z`), endAt: new Date(`2026-09-22T${end}Z`), approvalStatus,
});
const overtime: PayrollRateRule[] = [{ id: "daily", type: "overtime", priority: 100, multiplier: "2", thresholdSeconds: 8 * 3600 }];

describe("payroll whole-second budgets and civil-day context", () => {
  it("does not pay a fractional tail twice after approved/pending overlap", () => {
    const result = calculateHourlyPayroll({ hourlyRate: "3600", timezone: "UTC", intervals: [
      interval("approved", "08:00:00.100", "10:00:00.100"),
      interval("pending", "09:00:00.600", "11:00:00.600", "pending_review"),
    ], rules: [{ id: "weekly", type: "weekly_bonus", priority: 1, multiplier: "1", thresholdSeconds: 10801, rewardSeconds: 3600 }], includePendingAsEstimate: true });
    expect(result).toMatchObject({ approvedSeconds: 7200, pendingSeconds: 3600, grossAmount: "10800.000000", weeklyBonusSeconds: 0, weeklyBonusEstimatedSeconds: 0 });
    expect(result.components.reduce((sum, item) => sum + item.seconds, 0)).toBe(10800);
  });

  it("carries a continuous union's fractional remainder across source changes", () => {
    const intervals = [interval("a", "08:00:00.100", "09:00:00.600"), interval("b", "08:30:00.200", "10:00:00.200")];
    const result = calculateHourlyPayroll({ hourlyRate: "3600", timezone: "UTC", intervals, rules: [], includePendingAsEstimate: false });
    expect(result).toMatchObject({ approvedSeconds: 7200, grossAmount: "7200.000000" });
    expect(wholeSecondPayableIntervals(intervals)).toEqual(wholeSecondPayableIntervals([...intervals].reverse()));
    expect(wholeSecondPayableIntervals(wholeSecondPayableIntervals(intervals))).toEqual(wholeSecondPayableIntervals(intervals));
  });

  it("carries effective-work milliseconds across breaks without extending factual bounds", () => {
    const result = calculateHourlyPayroll({ hourlyRate: "3600", timezone: "UTC", intervals: [
      interval("a", "08:00:00.100", "08:00:00.700"), interval("b", "08:00:01.100", "08:00:01.700"),
    ], rules: [], includePendingAsEstimate: false });
    // The two genuine 0.6-second work fragments total 1.2 effective seconds.
    // The intervening 0.4-second gap is never added to the work interval.
    expect(result).toMatchObject({ approvedSeconds: 1, grossAmount: "1.000000" });
    const factual = [interval("a", "08:00:00.100", "08:00:00.700"), interval("b", "08:00:01.100", "08:00:01.700")];
    expect(wholeSecondPayableIntervals(factual).map(({ startAt, endAt }) => ({ startAt, endAt }))).toEqual(factual.map(({ startAt, endAt }) => ({ startAt, endAt })));
  });

  it.each([false, true])("keeps all confirmed seconds when an earlier fractional pending overlap exists: %s", (includePendingAsEstimate) => {
    const result = calculateHourlyPayroll({ hourlyRate: "3600", timezone: "UTC", intervals: [
      interval("pending", "08:00:00.000", "08:00:01.000", "pending_review"),
      interval("approved", "08:00:00.500", "09:00:00.500"),
    ], rules: [], includePendingAsEstimate });
    expect(result).toMatchObject({ approvedSeconds: 3600, pendingSeconds: 0, grossAmount: "3600.000000", estimate: false });
  });

  it("keeps break-separated milliseconds within the budget at a night rule boundary", () => {
    const result = calculateHourlyPayroll({ hourlyRate: "3600", timezone: "UTC", intervals: [
      interval("before-break", "21:59:59.600", "22:00:00.600"),
      interval("after-break", "22:00:00.800", "22:00:02.300"),
    ], rules: [{ id: "night", type: "night_window", priority: 100, multiplier: "2", startHour: 22, endHour: 6 }], includePendingAsEstimate: false });
    expect(result).toMatchObject({ approvedSeconds: 2, grossAmount: "3.000000" });
    expect(result.components.map((item) => ({ type: item.type, seconds: item.seconds, amount: item.amount }))).toEqual([
      { type: "base", seconds: 1, amount: "1.000000" }, { type: "night_window", seconds: 1, amount: "2.000000" },
    ]);
  });

  it("preserves all whole seconds when a new rate takes effect between second ticks", () => {
    const context = [interval("fact", "08:00:00.100", "10:00:00.100")];
    const boundary = new Date("2026-09-22T09:00:00.600Z");
    const first = calculateHourlyPayroll({ hourlyRate: "3600", timezone: "UTC", intervals: clipWholeSecondPayableIntervals(context, context[0]!.startAt, boundary), rules: [], includePendingAsEstimate: false });
    const second = calculateHourlyPayroll({ hourlyRate: "7200", timezone: "UTC", intervals: clipWholeSecondPayableIntervals(context, boundary, context[0]!.endAt), rules: [], includePendingAsEstimate: false });
    expect(first).toMatchObject({ approvedSeconds: 3601, grossAmount: "3601.000000" });
    expect(second).toMatchObject({ approvedSeconds: 3599, grossAmount: "7198.000000" });
    expect(first.approvedSeconds + second.approvedSeconds).toBe(7200);
  });

  it("retains prior-version hours for a day's overtime without paying that context again", () => {
    const first = interval("old", "08:00:00", "14:00:00");
    const second = interval("new", "14:00:00", "20:00:00");
    const result = calculateHourlyPayroll({ hourlyRate: "200", timezone: "UTC", intervals: [second], dailyContextIntervals: [first, second], rules: overtime, includePendingAsEstimate: false });
    expect(result).toMatchObject({ approvedSeconds: 21600, grossAmount: "2000.000000" });
    expect(result.components.map((component) => ({ type: component.type, seconds: component.seconds, amount: component.amount }))).toEqual([
      { type: "base", seconds: 7200, amount: "400.000000" }, { type: "overtime", seconds: 14400, amount: "1600.000000" },
    ]);
    expect(result.components.every((component) => component.sourceIds.every((id) => id === "new"))).toBe(true);
  });

  it.each([{ includePending: false, amount: "1200.000000" }, { includePending: true, amount: "2000.000000" }])("uses the current pending policy in daily context: $includePending", ({ includePending, amount }) => {
    const before = interval("pending", "08:00:00", "14:00:00", "pending_review");
    const current = interval("approved", "14:00:00", "20:00:00");
    const result = calculateHourlyPayroll({ hourlyRate: "200", timezone: "UTC", intervals: [current], dailyContextIntervals: [before, current], rules: overtime, includePendingAsEstimate: includePending });
    expect(result).toMatchObject({ approvedSeconds: 21600, pendingSeconds: 0, grossAmount: amount, estimate: includePending });
  });

  it("resets the carried context at local midnight", () => {
    const previous = interval("previous", "08:00:00", "20:00:00");
    const current = { ...interval("current", "00:00:00", "06:00:00"), startAt: new Date("2026-09-23T00:00:00Z"), endAt: new Date("2026-09-23T06:00:00Z") };
    const result = calculateHourlyPayroll({ hourlyRate: "200", timezone: "UTC", intervals: [current], dailyContextIntervals: [previous, current], rules: overtime, includePendingAsEstimate: false });
    expect(result.grossAmount).toBe("1200.000000");
    expect(result.components.some((component) => component.type === "overtime")).toBe(false);
  });
});
