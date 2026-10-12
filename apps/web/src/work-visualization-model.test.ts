import { describe, expect, it } from "vitest";
import { pageSlice, swimDomain, swimRows, workHeatCells } from "./work-visualization-model.js";

describe("work heatmap facts and local hour boundaries", () => {
  it("splits a cross-midnight record into the actual covered hours without counting the exact end boundary", () => {
    const cells = workHeatCells([{ id: "cross", content: "跨日工作", startAt: "2026-10-11T23:50:00+08:00", endAt: "2026-10-12T01:00:00+08:00", netSeconds: 4200 }], "2026-10-12", "Asia/Shanghai");
    expect(cells.filter((cell) => cell.count).map(({ date, hour }) => [date, hour])).toEqual([["2026-10-11", 23], ["2026-10-12", 0]]);
  });
  it("does not invent a time interval from a privacy-limited team activity or include a future plan", () => {
    const cells = workHeatCells([{ id: "limited", content: "仅公开动态", activityAt: "2026-10-12T10:00:00+08:00", startAt: null, endAt: null },
      { id: "plan", content: "计划", recordKind: "plan", startAt: "2026-10-12T09:00:00+08:00", endAt: "2026-10-12T11:00:00+08:00" }], "2026-10-12", "Asia/Shanghai");
    expect(cells.every((cell) => cell.count === 0)).toBe(true);
  });
  it("clips long records to seven visible dates and retains exact source records for drilldown", () => {
    const record = { id: "long", content: "跨周期", startAt: "2026-09-01T09:00:00+08:00", endAt: "2026-10-12T11:00:00+08:00" };
    const cells = workHeatCells([record], "2026-10-12", "Asia/Shanghai");
    expect(cells.length).toBe(168);
    expect(cells.filter((cell) => cell.count)).toHaveLength(155);
    expect(cells.find((cell) => cell.date === "2026-10-12" && cell.hour === 10)?.records).toEqual([record]);
  });
  it("does not duplicate a source during the repeated local hour at daylight-saving fall back", () => {
    const cells = workHeatCells([{ id: "dst", content: "重复小时", startAt: "2026-11-01T00:30:00-04:00", endAt: "2026-11-01T02:30:00-05:00" }], "2026-11-01", "America/New_York");
    expect(cells.find((cell) => cell.date === "2026-11-01" && cell.hour === 1)?.count).toBe(1);
  });
});
describe("bounded collection pages", () => {
  it("clamps a page after a filter reduces the result set", () => { expect(pageSlice([1, 2, 3], 9, 2)).toEqual([3]); });
  it("handles an empty filtered collection", () => { expect(pageSlice([], 2, 8)).toEqual([]); });
});

it("keeps overlapping swimlane facts reachable and leaves privacy-limited activity as a point", () => {
  const from = Date.parse("2026-10-12T00:00:00+08:00"), to = from + 86_400_000;
  const rows = swimRows([{ id: "first", content: "工作一", startAt: "2026-10-12T09:00:00+08:00", endAt: "2026-10-12T11:00:00+08:00" }, { id: "second", content: "工作二", startAt: "2026-10-12T10:00:00+08:00", endAt: "2026-10-12T12:00:00+08:00" }, { id: "public", content: "公开事件", activityAt: "2026-10-12T10:00:00+08:00" }, { id: "after", content: "后续工作", startAt: "2026-10-12T12:00:00+08:00", endAt: "2026-10-12T13:00:00+08:00" }], from, to);
  expect(rows.find((row) => row.record.id === "first")?.row).not.toBe(rows.find((row) => row.record.id === "second")?.row);
  expect(rows.find((row) => row.record.id === "public")).toMatchObject({ precise: false, hours: 10, hoursEnd: 10 });
  expect(rows.find((row) => row.record.id === "after")?.row).toBe(0);
});

it("aligns fractional swimlane intervals to whole-hour ticks without losing the late-day boundary", () => {
  const focus = swimDomain([{ hours: 9.25, hoursEnd: 10.75 }], 24, false, false);
  expect(focus.ticks.every(Number.isInteger)).toBe(true);
  expect(focus.start).toBeLessThanOrEqual(9.25); expect(focus.end).toBeGreaterThanOrEqual(10.75);
  const late = swimDomain([{ hours: 23.95, hoursEnd: 24 }], 24, false, true);
  expect(late.end).toBe(24); expect(late.end - late.start).toBeGreaterThanOrEqual(6);
});
it("keeps 23/25-hour swimlane rulers within the actual local day", () => {
  for (const length of [23, 25]) {
    const domain = swimDomain([], length, true, false);
    expect(domain.ticks[0]).toBe(0); expect(domain.ticks.at(-1)).toBe(length);
    expect(domain.ticks.every((tick) => tick >= 0 && tick <= length)).toBe(true);
    expect(new Set(domain.ticks).size).toBe(domain.ticks.length);
  }
});
