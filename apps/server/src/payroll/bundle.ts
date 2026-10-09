import ExcelJS from "exceljs";
import { and, asc, eq, gt, inArray, isNull, lt } from "drizzle-orm";
import type { Database } from "@workbench/db";
import { workBreaks, orgMemberships, payrollItems, payrollItemComponents, projectNodes, projects, reimbursementRequests, users, workSessions } from "@workbench/db/schema";
import { PayrollConflictError, type PayrollActor } from "./service.js";
import { createHash } from "node:crypto";
import { roundMoney, addDecimalAmounts, calculateWorkDuration } from "@workbench/shared";

import { payrollLocalTime, payrollSummarySheet } from "./export-summary.js";

type BundleRow = Array<string | number | null>;
interface BundleSheet { name: string; headers: string[]; rows: BundleRow[] }
const states: Record<string, string> = { not_requested: "未提交", pending_review: "待审核", approved: "已批准", returned: "退回修改", locked: "依据已导出", draft: "草稿", pending: "待审", rejected: "驳回", cancelled: "已撤销" };
// OOXML's UTF-16 escapes preserve emoji at the ZIP encoder's string-chunk
// boundary and preserve otherwise invalid XML control characters. Escape a
// literal escape-looking string first so user text remains literal text.
function excelText(value: string) {
  // eslint-disable-next-line no-control-regex -- XML-invalid controls are intentionally encoded without loss.
  return value.replace(/_x[0-9a-f]{4}_/gi, (literal) => `_x005F_${literal.slice(1)}`).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF]/g, (char) => `_x${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}_`);
}

// Every source and every long text segment is retained. Excel cannot represent
// more than 32767 UTF-16 code units in one cell; overflow gets numbered rows.
export async function renderPayrollWorkbook(sheets: BundleSheet[], createdAt = new Date(), report = false) {
  const book = new ExcelJS.Workbook(); book.creator = "工时统计平台"; book.created = createdAt; book.modified = createdAt;
  const overflow: BundleRow[] = [];
  for (const spec of sheets) {
    const sheet = book.addWorksheet(spec.name, { views: [{ state: "frozen", ySplit: 1 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
    sheet.addRow(spec.headers);
    sheet.columns = spec.headers.map((header) => ({ width: /内容|说明|结果|阻塞|下一步|追踪/.test(header) ? 48 : /编号|来源|版本|时间/.test(header) ? 30 : 20 }));
    for (const [index, row] of spec.rows.entries()) {
      sheet.addRow(row.map((value, column) => {
        if (typeof value !== "string") return value;
        if (value.length <= 32000) return excelText(value);
        let part = 1;
        for (let offset = 0; offset < value.length;) {
          let end = Math.min(value.length, offset + 32000);
          if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1]!)) end--;
          overflow.push([spec.name, index + 2, spec.headers[column]!, part++, excelText(value.slice(offset, end))]);
          offset = end;
        }
        return `完整内容见“长文本续页”：${spec.name} 第 ${index + 2} 行 ${spec.headers[column]}。`;
      }));
    }
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: spec.headers.length } };
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF243F57" } };
    sheet.getRow(1).height = 32;
    sheet.eachRow((row, index) => { row.alignment = { vertical: "top", wrapText: true }; if (index > 1) { row.height = 64; row.eachCell((cell) => { if (typeof cell.value === "number") cell.numFmt = Number.isInteger(cell.value) ? "0" : "0.00"; }); } });
    sheet.headerFooter.oddFooter = report ? "&L工时统计平台 · 未确认统计表 · 非正式发薪依据&R第 &P / &N 页" : "&L工时统计平台 · 外部发薪交接依据&R第 &P / &N 页";
  }
  if (overflow.length) {
    const sheet = book.addWorksheet("长文本续页", { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.addRow(["原表", "原行号", "字段", "续段序号", "完整内容分段（按序拼接）"]); overflow.forEach((r) => sheet.addRow(r));
    sheet.columns = [{ width: 20 }, { width: 14 }, { width: 20 }, { width: 14 }, { width: 100 }];
    sheet.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true }; row.height = 80; });
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

export async function capturePayrollWorkbook(db: Database, actor: PayrollActor, preview: { period: { id: string; name: string; startsAt: Date; endsAt: Date; timezone: string }; run: { id: string; runNumber: number; calculationVersion: string; inputHash: string }; rows: Array<{ membershipId: string; displayName: string; externalId: string; currency: string; approvedSeconds: number; pendingSeconds: number; grossAmount: string; adjustmentAmount: string; finalAmount: string; planVersionId: string; estimate?: boolean; needsReview?: boolean; amounts?: { wages: string; bonus: string; subsidies: string; reimbursements: string; other: string } }>; missingPlans?: Array<{ id: string; displayName: string }> }, csvName: string, options?: { report: boolean; blockers: string[] }) {
  const [components, reimbursements, records] = await Promise.all([
    db.select({ memberId: payrollItems.membershipId, currency: payrollItems.currency, component: payrollItemComponents }).from(payrollItems).innerJoin(payrollItemComponents, eq(payrollItemComponents.payrollItemId, payrollItems.id)).where(eq(payrollItems.payrollRunId, preview.run.id)).orderBy(asc(payrollItems.membershipId), asc(payrollItemComponents.id)),
    db.select().from(reimbursementRequests).where(and(eq(reimbursementRequests.organizationId, actor.organizationId), eq(reimbursementRequests.payPeriodId, preview.period.id))).orderBy(asc(reimbursementRequests.membershipId), asc(reimbursementRequests.id)),
    db.select({ session: workSessions, name: users.displayName, project: projects.name, node: projectNodes.title }).from(workSessions).innerJoin(orgMemberships, eq(orgMemberships.id, workSessions.membershipId)).innerJoin(users, eq(users.id, orgMemberships.userId)).leftJoin(projectNodes, eq(projectNodes.id, workSessions.primaryProjectNodeId)).leftJoin(projects, eq(projects.id, projectNodes.projectId)).where(and(eq(workSessions.organizationId, actor.organizationId), eq(workSessions.recordKind, "fact"), isNull(workSessions.deletedAt), lt(workSessions.startAt, preview.period.endsAt), gt(workSessions.endAt, preview.period.startsAt))).orderBy(asc(workSessions.membershipId), asc(workSessions.startAt), asc(workSessions.id)),
  ]);
  const names = new Map(preview.rows.map((r) => [r.membershipId, r.displayName]));
  const totals = new Map<string, { wages: string; bonus: string; subsidies: string; reimbursements: string }>();
  for (const row of preview.rows) totals.set(row.membershipId, { wages: "0.000000", bonus: "0.000000", subsidies: "0.000000", reimbursements: "0.000000" });
  for (const { memberId, component } of components) {
    const total = totals.get(memberId); if (!total || component.sourceEntityType === "payroll_adjustment") continue;
    const key = component.type === "allowance" ? "subsidies" : component.type === "bonus" ? "bonus" : "wages";
    total[key] = addDecimalAmounts(total[key], component.amount);
  }
  for (const request of reimbursements) {
    const total = totals.get(request.membershipId);
    if (total && request.status === "approved") total.reimbursements = addDecimalAmounts(total.reimbursements, roundMoney(request.amount));
  }
  const localDateTime = (at: Date) => payrollLocalTime(at, preview.period.timezone);
  const breaks = records.length ? await db.select().from(workBreaks)
    .where(inArray(workBreaks.workSessionId, records.map(({ session }) => session.id))) : [];
  const units: Record<string, string> = { second: "小时", hour: "小时", day: "天", month: "月", period: "周期", period_second: "周期", project: "项" };
  const summary = payrollSummarySheet({ ...preview, rows: preview.rows.map((row) => {
    const amount = row.amounts ?? totals.get(row.membershipId)!;
    return { ...row, amounts: { ...amount, other: roundMoney(addDecimalAmounts(row.adjustmentAmount, `-${amount.reimbursements}`)) } };
  }) }, options?.report);
  const sheets: BundleSheet[] = [summary,
    { name: "周期工作记录", headers: ["员工", "开始时间", "结束时间", "本期净工时（小时）", "审批状态", "项目", "工作内容", "工作结果", "阻塞", "下一步"],
      rows: records.map(({ session, name, project }) => {
        const startAt = new Date(Math.max(session.startAt.getTime(), preview.period.startsAt.getTime()));
        const endAt = new Date(Math.min(session.endAt.getTime(), preview.period.endsAt.getTime()));
        const clippedBreaks = breaks.filter((entry) => entry.workSessionId === session.id && entry.startAt < endAt && entry.endAt > startAt)
          .map((entry) => ({ startAt: new Date(Math.max(entry.startAt.getTime(), startAt.getTime())), endAt: new Date(Math.min(entry.endAt.getTime(), endAt.getTime())) }));
        const duration = calculateWorkDuration({ startAt, endAt }, clippedBreaks);
        return [name, localDateTime(startAt), localDateTime(endAt), duration.netSeconds / 3600, states[session.approvalStatus] ?? session.approvalStatus,
          project, session.content, session.result, session.blockers, session.nextStep];
      }) },
    { name: "工资组成", headers: ["员工", "明细名称", "数量", "单位", "单价", "倍率", "金额"], rows: components.map(({ memberId, component: c }) =>
      [names.get(memberId) ?? "未命名成员", c.label, c.unit === "second" ? Number(c.quantity ?? 0) / 3600 : c.unit === "period_second" ? null : c.quantity,
        units[c.unit ?? ""] ?? "", c.rate ? roundMoney(c.rate) : null, c.multiplier, roundMoney(c.amount)]) },
    { name: "报销明细", headers: ["员工", "费用日期", "报销项目", "费用说明", "金额", "审批状态", "审批说明"], rows: reimbursements.map((r) =>
      [names.get(r.membershipId) ?? "未命名成员", r.expenseDate, r.title, r.description, roundMoney(r.amount), states[r.status] ?? r.status, r.reviewNote]) },
  ];
  const body = await renderPayrollWorkbook(sheets, new Date(), options?.report);
  if (body.byteLength > 32 * 1024 * 1024) throw new PayrollConflictError("完整薪资工作簿超过 32 MiB，请缩短结算周期后重新计算；未保存不完整文件，也未锁定本批次。");
  return { workbookBase64: body.toString("base64"), workbookSha256: createHash("sha256").update(body).digest("hex"), workbookFileName: csvName.replace(/\.csv$/, ".xlsx"), workbookBytes: body.byteLength, worksheetOrder: sheets.map((sheet) => sheet.name), workRowCount: records.length, componentRowCount: components.length, reimbursementRowCount: reimbursements.length, evidenceRowCount: 0 };
}
