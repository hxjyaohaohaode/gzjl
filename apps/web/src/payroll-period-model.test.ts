import { expect, it } from "vitest";
import { latestPeriodRuns, settlementState } from "./payroll-period-model.js";
const period = { id: "p", name: "September", status: "open", startsAt: "", endsAt: "", cutoffAt: "" };
it("does not resurrect an older ready batch after a newer calculation was cancelled", () => {
  const runs = [
    { period, run: { id: "new", runNumber: 3, status: "cancelled" } },
    { period, run: { id: "old", runNumber: 1, status: "ready" } },
  ];
  const latest = latestPeriodRuns(runs).get("p");
  expect(latest?.id).toBe("new"); expect(settlementState(period, latest)).toBe("open");
});
it("uses the authoritative lock, and distinguishes review, ready and failed states", () => {
  const run = { id: "r", runNumber: 1, status: "review_required" };
  expect(settlementState({ ...period, status: "locked" }, run)).toBe("settled");
  expect(settlementState(period, run)).toBe("review");
  expect(settlementState(period, { ...run, status: "ready" })).toBe("ready");
  expect(settlementState(period, { ...run, status: "failed" })).toBe("failed");
});
