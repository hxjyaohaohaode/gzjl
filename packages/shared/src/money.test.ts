import { expect, it } from "vitest";
import { addDecimalAmounts } from "./payroll-engine.js";
import { allocateRoundedMoney, formatCurrencyMoney, formatMoney, roundMoney } from "./money.js";

it.each([
  ["2866.920833", "2866.92"], ["168.189999", "168.19"], ["177.533370", "177.53"],
  ["1.005", "1.01"], ["-1.005", "-1.01"], ["-0.004999", "0.00"],
  ["1.0049999999", "1.00"], ["99999999999999.995", "100000000000000.00"],
])("rounds %s to %s with exact decimal half-up", (value, expected) => {
  expect(roundMoney(value)).toBe(expected);
});

it("allocates slice cents while preserving the once-rounded group total", () => {
  expect(allocateRoundedMoney(["0.003333", "0.003333", "0.003334"])).toEqual(["0.00", "0.00", "0.01"]);
  expect(allocateRoundedMoney(["-0.003333", "-0.003333", "-0.003334"])).toEqual(["0.00", "0.00", "-0.01"]);
  expect(allocateRoundedMoney(["0.009", "-0.008", "0.004"])).toEqual(["0.01", "0.00", "0.00"]);
  expect(allocateRoundedMoney([])).toEqual([]);
  for (let seed = 1; seed <= 200; seed++) {
    const values = Array.from({ length: seed % 23 + 1 }, (_, index) =>
      `${(seed + index) % 2 ? "-" : ""}${seed % 3}.${((seed * 977 + index * 3337) % 1_000_000).toString().padStart(6, "0")}`);
    const allocated = allocateRoundedMoney(values);
    expect(roundMoney(addDecimalAmounts(...allocated))).toBe(roundMoney(addDecimalAmounts(...values)));
    expect(allocated.every((value) => /^-?\d+\.\d{2}$/.test(value))).toBe(true);
  }
});

it("formats large money without passing the integer or fraction through Number", () => {
  expect(formatMoney("CNY", "99999999999999.123456")).toBe("CNY 99,999,999,999,999.12");
  expect(() => roundMoney("NaN")).toThrow();
});

it("keeps currency symbols, exact cents and signed subunit deductions", () => {
  expect(formatCurrencyMoney("CNY", "100")).toBe("¥100.00");
  expect(formatCurrencyMoney("CNY", "99999999999999.123456")).toBe("¥99,999,999,999,999.12");
  expect(formatCurrencyMoney("CNY", "-0.005")).toBe("-¥0.01");
  expect(formatCurrencyMoney("CNY", "-0.004999")).toBe("¥0.00");
  expect(formatCurrencyMoney("USD", "1.005", "en-US")).toBe("$1.01");
  expect(formatCurrencyMoney("invalid", "168.19")).toBe("invalid 168.19");
});
