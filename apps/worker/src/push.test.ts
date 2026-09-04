import { describe, expect, it } from "vitest";

import {
  isPermanentWebPushFailure,
  isWithinQuietHours,
  parseQuietHours,
  pushRetryDelayMs,
} from "./push.js";

describe("web push delivery policy", () => {
  it("handles same-day and cross-midnight quiet hours in the saved time zone", () => {
    const daytime = {
      start: "09:00",
      end: "12:00",
      timeZone: "Asia/Shanghai",
    };
    const overnight = {
      start: "22:00",
      end: "07:00",
      timeZone: "Asia/Shanghai",
    };

    expect(isWithinQuietHours(daytime, new Date("2026-09-04T02:00:00Z"))).toBe(true);
    expect(isWithinQuietHours(daytime, new Date("2026-09-04T05:00:00Z"))).toBe(false);
    expect(isWithinQuietHours(overnight, new Date("2026-09-04T15:00:00Z"))).toBe(true);
    expect(isWithinQuietHours(overnight, new Date("2026-09-04T00:00:00Z"))).toBe(false);
  });

  it("fails open for malformed saved quiet-hour data", () => {
    expect(parseQuietHours({ start: "99:00", end: "07:00", timeZone: "UTC" })).toBeNull();
    expect(isWithinQuietHours({ start: "22:00", end: "22:00", timeZone: "UTC" })).toBe(false);
    expect(isWithinQuietHours({ start: "22:00", end: "07:00", timeZone: "Nowhere/Invalid" })).toBe(false);
  });

  it("retires only push endpoints the provider reports as gone", () => {
    expect(isPermanentWebPushFailure({ statusCode: 404 })).toBe(true);
    expect(isPermanentWebPushFailure({ statusCode: 410 })).toBe(true);
    expect(isPermanentWebPushFailure({ statusCode: 429 })).toBe(false);
    expect(isPermanentWebPushFailure(new Error("network"))).toBe(false);
  });

  it("uses bounded exponential retry intervals", () => {
    expect(pushRetryDelayMs(1)).toBe(30_000);
    expect(pushRetryDelayMs(2)).toBe(60_000);
    expect(pushRetryDelayMs(99)).toBe(1_920_000);
  });
});
