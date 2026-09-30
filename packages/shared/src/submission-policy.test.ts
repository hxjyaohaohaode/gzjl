import { describe, expect, it } from "vitest";
import { workSubmissionDeadline, workSubmissionPolicySchema, zonedCalendarTime } from "./submission-policy.js";
import { recordRangeNetSeconds } from "./record-range.js";

describe("organization submission deadlines and factual date ranges", () => {
  const policy = workSubmissionPolicySchema.parse({ monthlyDeadlineEnabled: true });
  it("uses the record's organization-local month, clamps short months and handles year rollover", () => {
    expect(workSubmissionDeadline(policy, new Date("2026-09-30T17:00:00Z"), "Asia/Shanghai")?.toISOString()).toBe("2026-10-31T15:30:00.000Z");
    expect(workSubmissionDeadline({ ...policy, deadlineDay: 31 }, new Date("2024-02-01"), "Asia/Shanghai")?.toISOString()).toBe("2024-02-29T15:30:00.000Z");
    expect(workSubmissionDeadline({ ...policy, followingMonth: true }, new Date("2026-12-15"), "Asia/Shanghai")?.toISOString()).toBe("2027-01-31T15:30:00.000Z");
    expect(workSubmissionDeadline({ ...policy, monthlyDeadlineEnabled: false }, new Date(), "Asia/Shanghai")).toBeNull();
  });
  it("rejects invalid rules and nonexistent local daylight-saving cutoff times", () => {
    for (const input of [{ manualEntryLookbackDays: -1 }, { manualEntryLookbackDays: 367 }, { deadlineTime: "24:00" }, { deadlineDay: 0 }]) expect(workSubmissionPolicySchema.safeParse(input).success).toBe(false);
    expect(() => zonedCalendarTime(2026, 3, 8, 2, 30, "America/New_York")).toThrow("不存在");
    expect(zonedCalendarTime(2026, 3, 8, 3, 30, "America/New_York").toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });
  it("counts only intersecting productive seconds and merges overlapping breaks", () => {
    const date = (hour: number) => new Date(Date.UTC(2026, 8, 30, hour));
    const breaks = [{ startAt: date(22), endAt: date(23) }, { startAt: new Date(date(22).getTime() + 30 * 60_000), endAt: new Date(date(23).getTime() + 30 * 60_000) }];
    expect(recordRangeNetSeconds("x", date(21), date(26), breaks, date(24), date(27))).toBe(7200);
    expect(recordRangeNetSeconds("x", date(21), date(26), breaks, date(21), date(24))).toBe(5400);
    expect(recordRangeNetSeconds("x", date(21), date(26), breaks, date(26), date(27))).toBe(0);
    expect(recordRangeNetSeconds("x", date(21), date(26), [{ startAt: date(0), endAt: date(1) }], date(24), date(26))).toBe(7200);
  });
});
