import { expect, it } from "vitest";
import { payrollExportName } from "./export-name.js";

it("keeps a boundary emoji intact so download headers remain valid UTF-8", () => {
  const name = payrollExportName("结".repeat(99) + "🚀末");
  expect(name.endsWith("🚀")).toBe(true);
  expect(decodeURIComponent(encodeURIComponent(name))).toBe(name);
});
it("makes filename separators, controls, malformed unicode and empty stems downloadable", () => {
  expect(payrollExportName("九月/薪资\\依据:核对\n")).toBe("九月-薪资-依据-核对-");
  expect(() => encodeURIComponent(payrollExportName("旧数据\ud800周期"))).not.toThrow();
  expect(payrollExportName("... ")).toBe("薪资周期");
});
