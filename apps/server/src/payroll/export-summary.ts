import { roundMoney } from "@workbench/shared";

export interface SalarySummary {
  period: { name: string; startsAt: Date; endsAt: Date; timezone: string };
  rows: Array<{ displayName: string; approvedSeconds: number; pendingSeconds: number;
    finalAmount: string; estimate?: boolean; needsReview?: boolean;
    amounts: { wages: string; bonus: string; subsidies: string; reimbursements: string; other: string } }>;
  missingPlans?: Array<{ displayName: string }>;
}

export function payrollLocalTime(at: Date, timezone: string) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(at);
}

export function payrollSummarySheet(preview: SalarySummary, report = false) {
  const period = [preview.period.name, payrollLocalTime(preview.period.startsAt, preview.period.timezone),
    payrollLocalTime(preview.period.endsAt, preview.period.timezone)];
  return { name: "薪资总览",
    headers: ["员工", "薪资周期", "周期开始（含）", "周期结束（不含）", "已批准工时（小时）", "待审工时（小时）",
      "工作工资", "奖励工资", "补贴", "已批准报销", "其他调整", "最终金额", "金额状态"],
    rows: [...preview.rows.map((row) => [row.displayName, ...period,
      (row.approvedSeconds / 3600).toFixed(2), (row.pendingSeconds / 3600).toFixed(2),
      ...(["wages", "bonus", "subsidies", "reimbursements", "other"] as const).map((key) => roundMoney(row.amounts[key])),
      roundMoney(row.finalAmount), report ? row.needsReview ? "待复核" : row.estimate ? "含待审预估" : "未确认" : "已确认"]),
    ...(preview.missingPlans ?? []).map((member) => [member.displayName, ...period, ...Array<string>(8).fill(""), "缺计薪方案"])] };
}

export function payrollSummaryCsv(preview: SalarySummary) {
  const sheet = payrollSummarySheet(preview);
  return `${[sheet.headers, ...sheet.rows].map((row, rowIndex) => row.map((value, column) => {
    const numeric = rowIndex > 0 && column >= 4 && column <= 11 && /^-?\d+(?:\.\d+)?$/.test(value);
    const safe = !numeric && /^[\s\uFEFF]*[=+@\-\t\r]/.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(",")).join("\r\n")}\r\n`;
}
