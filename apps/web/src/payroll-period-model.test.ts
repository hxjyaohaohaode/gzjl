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
it("selects a restored snapshot by completion time without exposing an older stale run", () => {
  const restored = { id: "restored", runNumber: 1, status: "ready", completedAt: "2026-10-03T00:00:00Z" };
  const latest = latestPeriodRuns([
    { period, run: restored },
    { period, run: { id: "superseded", runNumber: 2, status: "cancelled", completedAt: "2026-10-02T00:00:00Z" } },
  ]).get(period.id);
  expect(latest).toEqual(restored);
});
it("shows the current month as accruing until its exclusive end boundary", () => {
  expect(settlementState({ ...period, endsAt: new Date(Date.now() + 60_000).toISOString() })).toBe("accruing");
  expect(settlementState({ ...period, endsAt: new Date(Date.now() - 60_000).toISOString() })).toBe("open");
});
