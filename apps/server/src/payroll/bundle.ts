import ExcelJS from "exceljs";
import { and, asc, eq, gt, isNull, lt, ne } from "drizzle-orm";
import type { Database } from "@workbench/db";
import { attachments, attachmentLinks, orgMemberships, payrollItems, payrollItemComponents, projectNodes, projects, reimbursementRequests, users, workSessions } from "@workbench/db/schema";
import { PayrollConflictError, type PayrollActor } from "./service.js";
import { createHash } from "node:crypto";

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
export async function renderPayrollWorkbook(sheets: BundleSheet[], createdAt = new Date()) {
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
    sheet.eachRow((row, index) => { row.alignment = { vertical: "top", wrapText: true }; if (index > 1) { row.height = 64; row.eachCell((cell) => { if (typeof cell.value === "number") cell.numFmt = "0.######"; }); } });
    sheet.headerFooter.oddFooter = "&L工时统计平台 · 外部发薪交接依据&R第 &P / &N 页";
  }
  if (overflow.length) {
    const sheet = book.addWorksheet("长文本续页", { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.addRow(["原表", "原行号", "字段", "续段序号", "完整内容分段（按序拼接）"]); overflow.forEach((r) => sheet.addRow(r));
    sheet.columns = [{ width: 20 }, { width: 14 }, { width: 20 }, { width: 14 }, { width: 100 }];
    sheet.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true }; row.height = 80; });
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

export async function capturePayrollWorkbook(db: Database, actor: PayrollActor, preview: { period: { id: string; name: string; startsAt: Date; endsAt: Date; timezone: string }; run: { id: string; runNumber: number; calculationVersion: string; inputHash: string }; rows: Array<{ membershipId: string; displayName: string; externalId: string; currency: string; approvedSeconds: number; pendingSeconds: number; grossAmount: string; adjustmentAmount: string; finalAmount: string; planVersionId: string }> }, csvName: string) {
  const [components, reimbursements, records, evidence] = await Promise.all([
    db.select({ memberId: payrollItems.membershipId, currency: payrollItems.currency, component: payrollItemComponents }).from(payrollItems).innerJoin(payrollItemComponents, eq(payrollItemComponents.payrollItemId, payrollItems.id)).where(eq(payrollItems.payrollRunId, preview.run.id)).orderBy(asc(payrollItems.membershipId), asc(payrollItemComponents.id)),
    db.select().from(reimbursementRequests).where(and(eq(reimbursementRequests.organizationId, actor.organizationId), eq(reimbursementRequests.payPeriodId, preview.period.id))).orderBy(asc(reimbursementRequests.membershipId), asc(reimbursementRequests.id)),
    db.select({ session: workSessions, name: users.displayName, project: projects.name, node: projectNodes.title }).from(workSessions).innerJoin(orgMemberships, eq(orgMemberships.id, workSessions.membershipId)).innerJoin(users, eq(users.id, orgMemberships.userId)).leftJoin(projectNodes, eq(projectNodes.id, workSessions.primaryProjectNodeId)).leftJoin(projects, eq(projects.id, projectNodes.projectId)).where(and(eq(workSessions.organizationId, actor.organizationId), eq(workSessions.recordKind, "fact"), isNull(workSessions.deletedAt), lt(workSessions.startAt, preview.period.endsAt), gt(workSessions.endAt, preview.period.startsAt))).orderBy(asc(workSessions.membershipId), asc(workSessions.startAt), asc(workSessions.id)),
    db.select({ memberId: workSessions.membershipId, workId: workSessions.id, evidence: attachments }).from(workSessions).innerJoin(attachmentLinks, and(eq(attachmentLinks.entityId, workSessions.id), eq(attachmentLinks.entityType, "work_session"))).innerJoin(attachments, eq(attachments.id, attachmentLinks.attachmentId)).where(and(eq(workSessions.organizationId, actor.organizationId), eq(attachments.organizationId, actor.organizationId), isNull(workSessions.deletedAt), isNull(attachments.deletedAt), ne(attachments.visibility, "private"), lt(workSessions.startAt, preview.period.endsAt), gt(workSessions.endAt, preview.period.startsAt))).orderBy(asc(workSessions.id), asc(attachments.id)),
  ]);
  const names = new Map(preview.rows.map((r) => [r.membershipId, r.displayName]));
  const sheets: BundleSheet[] = [
    { name: "薪资汇总", headers: ["成员唯一编号", "外部人员编号", "员工", "币种", "已批准工时（小时）", "待审工时（小时）", "应计工资及补贴", "报销及其他调整", "最终金额", "方案版本"], rows: preview.rows.map((r) => [r.membershipId, r.externalId, r.displayName, r.currency, r.approvedSeconds / 3600, r.pendingSeconds / 3600, r.grossAmount, r.adjustmentAmount, r.finalAmount, r.planVersionId]) },
    { name: "工资组成", headers: ["成员唯一编号", "员工", "币种", "组成类型", "明细名称", "数量", "单位", "单价", "倍率", "金额（精确十进制）", "来源类型", "来源编号", "来源版本", "完整计算追踪"], rows: components.map(({ memberId, currency, component: c }) => [memberId, names.get(memberId) ?? memberId, currency, c.type, c.label, c.quantity, c.unit, c.rate, c.multiplier, c.amount, c.sourceEntityType, c.sourceEntityId, c.sourceVersion, JSON.stringify(c.calculationTrace)]) },
    { name: "报销明细", headers: ["成员唯一编号", "员工", "报销单编号", "版本", "费用日期", "标题", "费用说明", "币种", "金额", "审批状态", "审批说明", "提交时间", "审批时间"], rows: reimbursements.map((r) => [r.membershipId, names.get(r.membershipId) ?? r.membershipId, r.id, r.version, r.expenseDate, r.title, r.description, r.currency, r.amount, states[r.status] ?? r.status, r.reviewNote, r.submittedAt?.toISOString() ?? null, r.reviewedAt?.toISOString() ?? null]) },
    { name: "工作提交单", headers: ["成员唯一编号", "员工", "记录编号", "版本", "开始时间（UTC）", "结束时间（UTC）", "记录时区", "整条净工时（秒）", "审批状态", "提交状态", "项目", "节点", "工作内容", "工作结果", "阻塞", "下一步", "异常说明", "来源入口"], rows: records.map(({ session: r, name, project, node }) => [r.membershipId, name, r.id, r.version, r.startAt.toISOString(), r.endAt.toISOString(), r.timezone, r.netSeconds, states[r.approvalStatus] ?? r.approvalStatus, r.submissionStatus, project, node, r.content, r.result, r.blockers, r.nextStep, JSON.stringify(r.anomalyFlags), `/work?record=${r.id}&version=${r.version}`]) },
    { name: "工作证据目录", headers: ["成员唯一编号", "员工", "工作记录编号", "证据编号", "证据版本", "类型", "名称", "核验状态", "字节数", "文件 SHA-256", "文字证据", "外部链接", "备注"], rows: evidence.map(({ memberId, workId, evidence: e }) => [memberId, names.get(memberId) ?? memberId, workId, e.id, e.version, e.kind, e.originalName, e.status, e.sizeBytes, e.sha256, e.textContent, e.externalUrl, e.note]) },
    { name: "规则与来源", headers: ["事项", "内容"], rows: [["周期", preview.period.name], ["周期开始（含）", preview.period.startsAt.toISOString()], ["周期结束（不含）", preview.period.endsAt.toISOString()], ["周期时区", preview.period.timezone], ["批次唯一编号", preview.run.id], ["批次号", preview.run.runNumber], ["计算规则版本", preview.run.calculationVersion], ["计算输入 SHA-256", preview.run.inputHash], ["工时解释", "工作提交单保留与周期相交的完整事实及全部审批状态。整条净工时不能直接跨周期相加；已批准计薪量和金额以薪资汇总及工资组成中的计算来源为准。"], ["金额解释", "金额列保留精确十进制文字，避免 Excel 浮点改变大额金额。工资组成包含工资、补贴、奖励、扣减、更正及报销调整；汇总的调整栏包含报销，不重复相加。"], ["付款责任", "本平台提供薪资依据并保留工作记录，实际付款在外部平台办理。"], ["人员匹配", "同名员工使用成员唯一编号与确认时的外部人员编号匹配。"], ["长文本", "超过 Excel 单元格上限的文字分段保存在长文本续页，按原表、行号、字段和序号完整拼接。"]] },
  ];
  const body = await renderPayrollWorkbook(sheets);
  if (body.byteLength > 32 * 1024 * 1024) throw new PayrollConflictError("完整薪资工作簿超过 32 MiB，请缩短结算周期后重新计算；未保存不完整文件，也未锁定本批次。");
  return { workbookBase64: body.toString("base64"), workbookSha256: createHash("sha256").update(body).digest("hex"), workbookFileName: csvName.replace(/\.csv$/, "-完整工作单.xlsx"), workbookBytes: body.byteLength, workRowCount: records.length, componentRowCount: components.length, reimbursementRowCount: reimbursements.length, evidenceRowCount: evidence.length };
}
