import { describe, expect, it } from "vitest";
import { calculateHourlyPayroll, mergePayableIntervals, payableIntervalSeconds, wholeSecondPayableIntervals, type PayableInterval } from "./payroll-engine.js";

describe("payable interval conservation", () => {
  it("preserves the independent second-by-second union across 200 shuffled overlap scenarios", () => {
    let seed = 220926;
    const random = (max: number) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % max; };
    const origin = Date.parse("2026-09-21T00:00:00Z");
    for (let scenario = 0; scenario < 200; scenario += 1) {
      const input: PayableInterval[] = Array.from({ length: 1 + random(20) }, (_, index) => {
        const start = random(100);
        return { sourceId: `source-${index}`, startAt: new Date(origin + start * 1000), endAt: new Date(origin + (start + 1 + random(100)) * 1000), approvalStatus: random(2) === 0 ? "approved" : "pending_review" };
      });
      const expected = new Map<number, string>();
      for (const interval of input) {
        for (let time = interval.startAt.getTime(); time < interval.endAt.getTime(); time += 1000) {
          if (interval.approvalStatus === "approved" || !expected.has(time)) expected.set(time, interval.approvalStatus);
        }
      }
      const actual = new Map<number, string>();
      const result = mergePayableIntervals(input);
      for (const interval of result) {
        expect(interval.endAt.getTime()).toBeGreaterThan(interval.startAt.getTime());
        for (let time = interval.startAt.getTime(); time < interval.endAt.getTime(); time += 1000) {
          expect(actual.has(time)).toBe(false);
          actual.set(time, interval.approvalStatus);
        }
      }
      expect([...actual].sort()).toEqual([...expected].sort());
      expect(mergePayableIntervals([...input].reverse())).toEqual(result);
    }
  });

  it("conserves independent millisecond coverage and confirmed pay in 200 fragmented scenarios", () => {
    let seed = 220928;
    const random = (max: number) => { seed = (seed * 1664525 + 1013904223) >>> 0; return (seed >>> 8) % max; };
    const origin = Date.parse("2026-09-21T00:00:00Z");
    for (let scenario = 0; scenario < 200; scenario += 1) {
      // An independent millisecond bitmap avoids sharing the production
      // sweep, source selection or whole-second allocation algorithm.
      const covered = new Uint8Array(25000);
      const input: PayableInterval[] = Array.from({ length: 1 + random(20) }, (_, index) => {
        const start = random(20000);
        const end = start + 1 + random(5000);
        const approved = random(2) === 0;
        for (let time = start; time < end; time += 1) covered[time] = covered[time]! | (approved ? 2 : 1);
        return { sourceId: `fractional-${index}`, startAt: new Date(origin + start), endAt: new Date(origin + end), approvalStatus: approved ? "approved" : "pending_review" };
      });
      const total = Math.floor(covered.reduce((sum, status) => sum + Number(status > 0), 0) / 1000);
      const approved = Math.floor(covered.reduce((sum, status) => sum + Number((status & 2) > 0), 0) / 1000);
      const normalized = wholeSecondPayableIntervals(input);
      expect(normalized.reduce((sum, interval) => sum + payableIntervalSeconds(interval), 0)).toBe(total);
      expect(wholeSecondPayableIntervals(normalized)).toEqual(normalized);
      expect(wholeSecondPayableIntervals([...input].reverse())).toEqual(normalized);
      for (const interval of normalized) {
        if (payableIntervalSeconds(interval) === 0) continue;
        expect(interval.firstPayableAt!.getTime()).toBeGreaterThanOrEqual(interval.startAt.getTime());
        expect(interval.firstPayableAt!.getTime()).toBeLessThan(interval.endAt.getTime());
      }
      for (const includePendingAsEstimate of [false, true]) {
        const result = calculateHourlyPayroll({ hourlyRate: "3600", timezone: "UTC", intervals: input, rules: [], includePendingAsEstimate });
        expect(result.approvedSeconds).toBe(approved);
        expect(result.pendingSeconds).toBe(includePendingAsEstimate ? total - approved : 0);
        expect(result.grossAmount).toBe(`${includePendingAsEstimate ? total : approved}.000000`);
      }
    }
  });
});
