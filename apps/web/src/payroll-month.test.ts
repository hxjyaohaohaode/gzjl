import { afterEach, expect, it } from "vitest";
import { setOrganizationTimezone, zonedInputToDate } from "./timezone.js";
import { isSalaryMonth, previousSalaryMonth, salaryMonthForm, salaryPeriodMatchesMonth, suggestedPeriodCutoff } from "./payroll-month.js";

afterEach(() => setOrganizationTimezone(null));
it("selects the last complete organization-local month across New Year", () => {
  setOrganizationTimezone("Asia/Shanghai");
  expect(previousSalaryMonth(new Date("2026-12-31T17:34:53Z"))).toBe("2026-12");
  expect(salaryMonthForm("2026-12")).toMatchObject({ startsAt: "2026-12-01T00:00:00", endsAt: "2027-01-01T00:00:00" });
});
it("creates a full leap month and uses exclusive end when filtering export batches", () => {
  setOrganizationTimezone("Asia/Shanghai");
  const month = salaryMonthForm("2028-02");
  const period = { startsAt: zonedInputToDate(month.startsAt).toISOString(), endsAt: zonedInputToDate(month.endsAt).toISOString(), timezone: "Asia/Shanghai" };
  expect(period).toMatchObject({ startsAt: "2028-01-31T16:00:00.000Z", endsAt: "2028-02-29T16:00:00.000Z" });
  expect(salaryPeriodMatchesMonth(period, "2028-02")).toBe(true);
  expect(salaryPeriodMatchesMonth(period, "2028-03")).toBe(false);
  expect(salaryPeriodMatchesMonth(period, "")).toBe(true);
  expect(() => salaryMonthForm("2028-13")).toThrow("有效结算月份");
  expect(isSalaryMonth("2026-")).toBe(false); expect(isSalaryMonth("0001-02")).toBe(false);
  expect(isSalaryMonth("9999-12")).toBe(false); expect(isSalaryMonth("2026-09")).toBe(true);
});
it("accounts for DST when creating an organization calendar month", () => {
  setOrganizationTimezone("America/New_York"); const month = salaryMonthForm("2026-03");
  expect((zonedInputToDate(month.endsAt).getTime() - zonedInputToDate(month.startsAt).getTime()) / 3600000).toBe(31 * 24 - 1);
});

it("suggests handoff after a boss-defined cross-month range without changing its boundaries", () => {
  expect(suggestedPeriodCutoff("2026-10-19T18:00:00", 10, 570)).toBe("2026-11-10T09:30:00");
  expect(suggestedPeriodCutoff("2026-10-01T00:00:00", 10, 570)).toBe("2026-10-10T09:30:00");
  expect(suggestedPeriodCutoff("2026-12-20T18:00:00", 10, 570)).toBe("2027-01-10T09:30:00");
});
