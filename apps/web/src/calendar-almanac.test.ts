import { describe, expect, it } from "vitest";

import { getCalendarAlmanac } from "./calendar-almanac.js";

describe("getCalendarAlmanac", () => {
  it("shows lunar date and a known solar term", () => {
    const day = getCalendarAlmanac(new Date(2026, 8, 23));
    expect(day.lunarMonth).toMatch(/月$/);
    expect(day.lunarDay).toBeTruthy();
    expect(day.solarTerm).toBe("秋分");
    expect(day.lunarLabel).toBe("秋分");
  });

  it("continues to calculate dates more than eighteen months ahead", () => {
    const day = getCalendarAlmanac(new Date(2028, 2, 20));
    expect(day.solarTerm).toBe("春分");
    expect(day.detail).toContain("农历");
    expect(day.officialSchedule).toBeNull();
  });

  it("distinguishes published statutory leave from a makeup workday", () => {
    expect(getCalendarAlmanac(new Date(2026, 9, 1)).officialSchedule).toEqual({
      status: "off",
      name: "国庆节",
    });
    expect(getCalendarAlmanac(new Date(2026, 9, 10)).officialSchedule).toEqual({
      status: "workday",
      name: "国庆节调休",
    });
  });
});
