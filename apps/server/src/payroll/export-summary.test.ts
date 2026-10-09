import { expect, it } from "vitest";
import { parseCsv } from "@workbench/shared";
import { payrollSummaryCsv, payrollSummarySheet, type SalarySummary } from "./export-summary.js";

it("shares the minimal columns across CSV and Excel and preserves exact cents and safe user text", () => {
  const preview: SalarySummary = { period: { name: "九月", startsAt: new Date("2026-08-31T16:00Z"), endsAt: new Date("2026-09-30T16:00Z"), timezone: "Asia/Shanghai" },
    rows: [{ displayName: "=员工", approvedSeconds: 5400, pendingSeconds: 0, finalAmount: "99999999999999.99",
      amounts: { wages: "99999999999999.99", bonus: "0", subsidies: "10", reimbursements: "0", other: "-10" } }],
    missingPlans: [{ displayName: "待配置员工" }] };
  const sheet = payrollSummarySheet(preview);
  const csv = parseCsv(payrollSummaryCsv(preview));
  expect(csv[0]).toEqual(sheet.headers);
  expect(sheet.headers.join(" ")).not.toMatch(/编号|版本|时区|币种|追踪|SHA/);
  expect(csv[1]).toEqual(["'=员工", "九月", "2026/09/01 00:00:00", "2026/10/01 00:00:00", "1.50", "0.00",
    "99999999999999.99", "0.00", "10.00", "0.00", "-10.00", "99999999999999.99", "已确认"]);
  expect(sheet.rows[0]![0]).toBe("=员工");
  expect(csv[2]).toHaveLength(sheet.headers.length);
  expect(csv[2]!.at(-1)).toBe("缺计薪方案");
});
