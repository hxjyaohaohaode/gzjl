import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api.js";
import { calendarDayBoundary, calendarDayDifference, calendarPeriodSeconds, loadCalendarRecords, shiftCalendarMonth, splitCalendarInterval } from "./calendar-model.js";

vi.mock("./api.js", () => ({ api: vi.fn() }));
afterEach(() => vi.clearAllMocks());

describe("calendar navigation and complete records", () => {
  it("keeps month-end navigation within the adjacent month including leap years", () => {
    const january = new Date(2026, 0, 31, 12);
    expect(shiftCalendarMonth(january, 1)).toEqual(new Date(2026, 1, 28, 12));
    expect(shiftCalendarMonth(new Date(2028, 2, 31), -1)).toEqual(new Date(2028, 1, 29));
    expect(shiftCalendarMonth(new Date(2026, 11, 31), 1)).toEqual(new Date(2027, 0, 31));
    expect(january).toEqual(new Date(2026, 0, 31, 12));
  });
  it("counts date fields rather than rounded elapsed time", () => {
    expect(calendarDayDifference(new Date(2026, 2, 7, 23), new Date(2026, 2, 9, 1))).toBe(2);
    expect(calendarDayDifference(new Date(2026, 9, 1), new Date(2026, 8, 30))).toBe(-1);
  });
  it("loads every page with opaque cursors and keeps one copy of repeated records", async () => {
    const cursor = "2026-09-20T01:00:00.000Z|00000000-0000-4000-8000-000000000123";
    vi.mocked(api).mockResolvedValueOnce({ items: [{ id: "a" }, { id: "b" }], nextCursor: cursor })
      .mockResolvedValueOnce({ items: [{ id: "b" }, { id: "c" }], nextCursor: null });
    const signal = new AbortController().signal;
    expect(await loadCalendarRecords("2026-09-01", "2026-10-01", signal)).toEqual({ items: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    const next = new URL(String(vi.mocked(api).mock.calls[1]![0]), "https://example.test");
    expect(next.searchParams.get("before")).toBe(cursor);
    expect(next.searchParams.get("from")).toBe("2026-09-01");
    expect(vi.mocked(api).mock.calls.every(([, options]) => options?.signal === signal)).toBe(true);
  });
  it("rejects incomplete results when a page fails, instead of reporting a partial total", async () => {
    vi.mocked(api).mockResolvedValueOnce({ items: [{ id: "a" }], nextCursor: "next" }).mockRejectedValueOnce(new Error("offline"));
    await expect(loadCalendarRecords("from", "to")).rejects.toThrow("offline");
  });
  it("stops a repeated cursor with actionable feedback", async () => {
    vi.mocked(api).mockResolvedValue({ items: [], nextCursor: "loop" });
    await expect(loadCalendarRecords("from", "to")).rejects.toThrow("分页未能继续");
    expect(api).toHaveBeenCalledTimes(2);
  });
  it("uses authoritative period duration and never guesses how a break crosses midnight", () => {
    const from = new Date("2026-09-21T16:00:00Z");
    const to = new Date("2026-09-22T16:00:00Z");
    const crossing = { startAt: "2026-09-21T14:00:00Z", endAt: "2026-09-21T18:00:00Z", netSeconds: 10_800 };
    expect(calendarPeriodSeconds({ ...crossing, periodNetSeconds: 3600 }, from, to)).toBe(3600);
    expect(calendarPeriodSeconds({ ...crossing, periodNetSeconds: 0 }, from, to)).toBe(0);
    expect(calendarPeriodSeconds(crossing, from, to)).toBeNull();
    expect(calendarPeriodSeconds({ ...crossing, startAt: "2026-09-21T17:00:00Z", netSeconds: 3600 }, from, to)).toBe(3600);
  });
  it("rejects invalid or non-overlapping instants without an extra midnight segment", () => {
    const from = new Date("2026-09-21T16:00:00Z");
    const to = new Date("2026-09-22T16:00:00Z");
    expect(splitCalendarInterval(new Date("invalid"), to, from, to, "Asia/Shanghai")).toEqual([]);
    expect(splitCalendarInterval(to, from, from, to, "Asia/Shanghai")).toEqual([]);
    expect(splitCalendarInterval(from, from, from, to, "Asia/Shanghai")).toEqual([]);
    expect(splitCalendarInterval(new Date(from.getTime() - 1000), from, from, to, "Asia/Shanghai")).toEqual([]);
    const last = splitCalendarInterval(new Date(to.getTime() - 1000), to, from, new Date(to.getTime() + 86400000), "Asia/Shanghai");
    expect(last).toHaveLength(1);
    expect(last[0]).toMatchObject({ elapsedSeconds: 1, range: { endLabel: "24:00:00", endPercent: 100 } });
    expect(last[0]!.range.widthPercent).toBeCloseTo(1 / 864, 10);
  });
  it("keeps New York fall-back instants even when the displayed wall-clock end precedes the start", () => {
    const segments = splitCalendarInterval(new Date("2026-11-01T05:50:00Z"), new Date("2026-11-01T06:10:00Z"), new Date("2026-11-01T04:00:00Z"), new Date("2026-11-02T05:00:00Z"), "America/New_York");
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ day: "2026-11-01", elapsedSeconds: 1200, range: { clockShift: true, widthPercent: null, startLabel: "01:50:00", endLabel: "01:10:00", startOffset: "GMT-04:00", endOffset: "GMT-05:00" } });
    expect(segments[0]!.range.startPercent).toBeGreaterThan(segments[0]!.range.endPercent);
  });
  it("does not display a spring-forward clock gap as extra elapsed work", () => {
    const segments = splitCalendarInterval(new Date("2026-03-08T06:50:00Z"), new Date("2026-03-08T07:10:00Z"), new Date("2026-03-08T05:00:00Z"), new Date("2026-03-09T04:00:00Z"), "America/New_York");
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ elapsedSeconds: 1200, range: { clockShift: true, widthPercent: null, startLabel: "01:50:00", endLabel: "03:10:00", startOffset: "GMT-05:00", endOffset: "GMT-04:00" } });
  });
  it("clips long records at real 23-hour and 25-hour day boundaries without losing or duplicating instants", () => {
    for (const [from, to, seconds] of [["2026-03-08T05:00:00Z", "2026-03-09T04:00:00Z", 82800], ["2026-11-01T04:00:00Z", "2026-11-02T05:00:00Z", 90000]] as const) {
      const segments = splitCalendarInterval(new Date(Date.parse(from) - 3600000), new Date(Date.parse(to) + 3600000), new Date(from), new Date(to), "America/New_York");
      expect(segments).toHaveLength(1);
      expect(segments[0]).toMatchObject({ startAt: new Date(from).toISOString(), endAt: new Date(to).toISOString(), elapsedSeconds: seconds, range: { startPercent: 0, endPercent: 100, startLabel: "00:00:00", endLabel: "24:00:00", clockShift: true, widthPercent: null } });
    }
  });
  it("preserves positive subsecond records and keeps exact normal-day geometry", () => {
    const from = new Date("2026-09-21T16:00:00Z");
    const to = new Date("2026-09-22T16:00:00Z");
    const [segment] = splitCalendarInterval(new Date("2026-09-22T07:00:00.100Z"), new Date("2026-09-22T07:00:00.300Z"), from, to, "Asia/Shanghai");
    expect(segment).toMatchObject({ elapsedSeconds: 0.2, range: { clockShift: false, startLabel: "15:00:00.100", endLabel: "15:00:00.300" } });
    expect(segment!.range.widthPercent).toBeCloseTo(0.2 / 864, 12);
    const [hour] = splitCalendarInterval(new Date("2026-09-22T07:00:00Z"), new Date("2026-09-22T08:00:00Z"), from, to, "Asia/Shanghai");
    expect(hour!.range.startPercent).toBe(62.5);
    expect(hour!.range.widthPercent).toBeCloseTo(100 / 24, 10);
  });
  it("uses the first real instant when Santiago skips midnight rather than crashing the calendar", () => {
    const from = calendarDayBoundary("2026-09-06", "America/Santiago");
    const to = calendarDayBoundary("2026-09-07", "America/Santiago");
    expect(from.toISOString()).toBe("2026-09-06T04:00:00.000Z");
    expect(to.toISOString()).toBe("2026-09-07T03:00:00.000Z");
    const segments = splitCalendarInterval(new Date("2026-09-06T03:50:00Z"), new Date("2026-09-06T04:10:00Z"), from, to, "America/Santiago");
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ day: "2026-09-06", elapsedSeconds: 600, startAt: "2026-09-06T04:00:00.000Z", range: { startLabel: "01:00:00", endLabel: "01:10:00" } });
    from.setFullYear(2020);
    expect(calendarDayBoundary("2026-09-06", "America/Santiago").toISOString()).toBe("2026-09-06T04:00:00.000Z");
  });
});
