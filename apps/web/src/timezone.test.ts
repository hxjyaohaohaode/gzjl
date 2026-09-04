import { afterEach, describe, expect, it } from "vitest";

import {
  setOrganizationTimezone,
  toZonedInputValue,
  zonedInputToDate,
} from "./timezone.js";

afterEach(() => setOrganizationTimezone(null));

describe("organization timezone conversion", () => {
  it("round-trips organization wall time independently of device timezone", () => {
    setOrganizationTimezone("Asia/Shanghai");
    const instant = new Date("2026-09-04T10:30:45.000Z");
    expect(toZonedInputValue(instant)).toBe("2026-09-04T18:30:45");
    expect(zonedInputToDate("2026-09-04T18:30:45").toISOString()).toBe(
      instant.toISOString(),
    );
  });

  it("rejects a nonexistent daylight-saving wall time", () => {
    expect(() =>
      zonedInputToDate("2026-03-08T02:30:00", "America/New_York"),
    ).toThrow("不存在");
  });
});
