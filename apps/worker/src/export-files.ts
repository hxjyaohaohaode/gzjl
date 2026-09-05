import { createRequire } from "node:module";

import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { stringifyCsv } from "@workbench/shared";

export type BackgroundExportFormat = "csv" | "json" | "xlsx" | "pdf";

export interface WorkSessionExportRow {
  id: string;
  membershipId: string;
  member: string;
  startAt: string;
  endAt: string;
  timezone: string;
  grossSeconds: number;
  breakSeconds: number;
  netSeconds: number;
  billableSeconds: number | null;
  source: string;
  content: string;
  result: string;
  blockers: string;
  nextStep: string;
  projectName: string | null;
  projectNodeTitle: string | null;
  workTypeName: string | null;
  primaryProjectNodeId: string | null;
  workTypeId: string | null;
  visibility: string;
  parallelWork: boolean;
  submissionStatus: string;
  approvalStatus: string;
  anomalyFlags: unknown;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkSessionExportDocument {
  schemaVersion: 1;
  title: string;
  generatedAt: string;
  range: { from: string; to: string };
  fieldPolicyDescription: string;
  items: WorkSessionExportRow[];
}

export interface RenderedExport {
  body: Buffer;
  contentType: string;
  extension: BackgroundExportFormat;
  fileName: string;
}

const rawHeaders: Array<{ key: keyof WorkSessionExportRow; label: string; width: number }> = [
  { key: "id", label: "记录 ID", width: 38 },
  { key: "membershipId", label: "成员 ID", width: 38 },
  { key: "member", label: "成员", width: 18 },
  { key: "startAt", label: "开始时间", width: 25 },
  { key: "endAt", label: "结束时间", width: 25 },
  { key: "timezone", label: "时区", width: 18 },
  { key: "grossSeconds", label: "总时长（秒）", width: 16 },
  { key: "breakSeconds", label: "休息（秒）", width: 14 },
  { key: "netSeconds", label: "净时长（秒）", width: 16 },
  { key: "billableSeconds", label: "计薪时长（秒）", width: 17 },
  { key: "source", label: "来源", width: 14 },
  { key: "content", label: "工作内容", width: 44 },
  { key: "result", label: "工作结果", width: 40 },
  { key: "blockers", label: "阻塞事项", width: 32 },
  { key: "nextStep", label: "下一步", width: 32 },
  { key: "projectName", label: "项目", width: 22 },
  { key: "projectNodeTitle", label: "项目节点", width: 26 },
  { key: "workTypeName", label: "工作类型", width: 18 },
  { key: "primaryProjectNodeId", label: "主项目节点 ID", width: 38 },
  { key: "workTypeId", label: "工作类型 ID", width: 38 },
  { key: "visibility", label: "可见范围", width: 18 },
  { key: "parallelWork", label: "并行工作", width: 13 },
  { key: "submissionStatus", label: "提交状态", width: 16 },
  { key: "approvalStatus", label: "审批状态", width: 16 },
  { key: "anomalyFlags", label: "异常标记", width: 26 },
  { key: "version", label: "版本", width: 10 },
  { key: "createdAt", label: "创建时间", width: 25 },
  { key: "updatedAt", label: "更新时间", width: 25 },
];

const sourceLabels: Record<string, string> = { manual: "手动补录", timer: "计时器", import: "批量导入" };
const submissionLabels: Record<string, string> = { draft: "草稿", submitted: "已提交" };
const approvalLabels: Record<string, string> = {
  not_requested: "未申请",
  pending_review: "待审核",
  approved: "已批准",
  returned: "已退回",
  locked: "已锁定",
};
const visibilityLabels: Record<string, string> = {
  private: "仅本人",
  management_only: "审核与管理可见",
  project_visible: "关联项目可见",
};

export function neutralizeSpreadsheetFormula(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return /^[\t\r\n ]*[=+\-@]/u.test(value) ? `'${value}` : value;
}

function scalarValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return JSON.stringify(value);
}

function exportBaseName(document: WorkSessionExportDocument) {
  return `work-sessions-${document.generatedAt.slice(0, 10)}`;
}

function label(map: Record<string, string>, value: string): string {
  return map[value] ?? value;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (hours && minutes) return `${hours} 小时 ${minutes} 分钟`;
  if (hours) return `${hours} 小时`;
  if (minutes) return `${minutes} 分钟`;
  return `${seconds} 秒`;
}

function formatZoned(iso: string, timezone: string, kind: "date" | "time" | "datetime"): string {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    hour12: false,
    ...(kind !== "time" ? { year: "numeric", month: "2-digit", day: "2-digit" } : {}),
    ...(kind !== "date" ? { hour: "2-digit", minute: "2-digit" } : {}),
  };
  try {
    return new Intl.DateTimeFormat("zh-CN", options).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("zh-CN", { ...options, timeZone: "UTC" }).format(new Date(iso));
  }
}

function anomalyText(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.map(String).join("、") : "无";
  if (!value || (typeof value === "object" && Object.keys(value as object).length === 0)) return "无";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function summaryFor(document: WorkSessionExportDocument) {
  const totalSeconds = document.items.reduce((sum, item) => sum + item.netSeconds, 0);
  const billableSeconds = document.items.reduce((sum, item) => sum + (item.billableSeconds ?? 0), 0);
  const members = new Set(document.items.map((item) => item.membershipId)).size;
  const projects = new Set(document.items.map((item) => item.projectName).filter(Boolean)).size;
  const approvals = Object.fromEntries(
    Object.keys(approvalLabels).map((status) => [status, document.items.filter((item) => item.approvalStatus === status).length]),
  ) as Record<string, number>;
  return { rowCount: document.items.length, totalSeconds, billableSeconds, members, projects, approvals };
}

function asCsv(document: WorkSessionExportDocument): Buffer {
  const rows = [
    rawHeaders.map((header) => header.label),
    ...document.items.map((item) => rawHeaders.map((header) => neutralizeSpreadsheetFormula(scalarValue(item[header.key])))),
  ];
  return Buffer.from(`\uFEFF${stringifyCsv(rows)}`, "utf8");
}

function asJson(document: WorkSessionExportDocument): Buffer {
  return Buffer.from(JSON.stringify({ ...document, summary: summaryFor(document), rowCount: document.items.length }, null, 2), "utf8");
}

const border: Partial<ExcelJS.Borders> = {
  top: { style: "hair", color: { argb: "FFDDE3EE" } },
  left: { style: "hair", color: { argb: "FFDDE3EE" } },
  bottom: { style: "hair", color: { argb: "FFDDE3EE" } },
  right: { style: "hair", color: { argb: "FFDDE3EE" } },
};

function styleTableHeader(row: ExcelJS.Row) {
  row.height = 27;
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF263247" } };
  row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  row.eachCell((cell) => { cell.border = border; });
}

async function asXlsx(document: WorkSessionExportDocument): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "工作时间与工作智能管理平台";
  workbook.created = new Date(document.generatedAt);
  workbook.modified = new Date(document.generatedAt);
  const summary = summaryFor(document);

  const overview = workbook.addWorksheet("导出概览", {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 1 },
    views: [{ state: "frozen", ySplit: 3 }],
  });
  overview.columns = [18, 20, 18, 20, 18, 20, 18, 20].map((width) => ({ width }));
  overview.mergeCells("A1:H2");
  const title = overview.getCell("A1");
  title.value = document.title;
  title.font = { bold: true, size: 22, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF172033" } };
  title.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  overview.getRow(1).height = 28;
  overview.getRow(2).height = 22;
  overview.addRow([]);
  const metrics = [
    ["记录数量", `${summary.rowCount.toLocaleString("zh-CN")} 条`, "净工时合计", formatDuration(summary.totalSeconds), "计薪工时", formatDuration(summary.billableSeconds), "涉及成员", `${summary.members} 人`],
    ["涉及项目", `${summary.projects} 个`, "待审核", `${summary.approvals.pending_review ?? 0} 条`, "已批准", `${summary.approvals.approved ?? 0} 条`, "已退回", `${summary.approvals.returned ?? 0} 条`],
  ];
  for (const values of metrics) {
    const row = overview.addRow(values);
    row.height = 30;
    row.eachCell((cell, column) => {
      cell.border = border;
      cell.alignment = { vertical: "middle", horizontal: column % 2 ? "left" : "center", wrapText: true };
      if (column % 2) {
        cell.font = { bold: true, color: { argb: "FF59657A" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F7FB" } };
      } else cell.font = { bold: true, size: 12, color: { argb: "FF172033" } };
    });
  }
  overview.addRow([]);
  const metaHeader = overview.addRow(["导出说明"]);
  overview.mergeCells(metaHeader.number, 1, metaHeader.number, 8);
  styleTableHeader(metaHeader);
  const metaRows = [
    ["生成时间", formatZoned(document.generatedAt, "Asia/Shanghai", "datetime")],
    ["时间范围", `${formatZoned(document.range.from, "Asia/Shanghai", "datetime")} — ${formatZoned(document.range.to, "Asia/Shanghai", "datetime")}`],
    ["字段策略", document.fieldPolicyDescription],
    ["工作表说明", "“工作记录”用于阅读和汇报；“技术明细”保留 ID、秒数、ISO 时间和原始状态，便于系统对账。"],
  ];
  for (const [name, value] of metaRows) {
    const row = overview.addRow([name, value]);
    overview.mergeCells(row.number, 2, row.number, 8);
    row.height = name === "字段策略" || name === "工作表说明" ? 35 : 25;
    row.eachCell((cell, column) => {
      cell.border = border;
      cell.alignment = { vertical: "middle", wrapText: true };
      if (column === 1) {
        cell.font = { bold: true, color: { argb: "FF59657A" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F7FB" } };
      }
    });
  }
  overview.headerFooter.oddFooter = "&L工作时间与工作智能管理平台&C内部授权导出&R第 &P / &N 页";

  const readableHeaders = [
    ["member", "成员", 16], ["date", "日期", 13], ["start", "开始", 9], ["end", "结束", 9],
    ["duration", "净工时", 13], ["hours", "小时数", 11], ["project", "项目", 20], ["node", "项目节点", 24],
    ["workType", "工作类型", 16], ["source", "来源", 12], ["content", "工作内容", 38], ["result", "工作结果", 34],
    ["blockers", "阻塞事项", 28], ["nextStep", "下一步", 28], ["submission", "提交", 12], ["approval", "审核", 12],
    ["visibility", "可见范围", 18], ["anomaly", "异常标记", 22], ["updated", "更新时间", 20],
  ] as const;
  const records = workbook.addWorksheet("工作记录", {
    views: [{ state: "frozen", ySplit: 1, xSplit: 4 }],
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
  });
  records.columns = readableHeaders.map(([key, header, width]) => ({ key, header, width }));
  styleTableHeader(records.getRow(1));
  for (const [index, item] of document.items.entries()) {
    const row = records.addRow({
      member: neutralizeSpreadsheetFormula(item.member),
      date: formatZoned(item.startAt, item.timezone, "date"),
      start: formatZoned(item.startAt, item.timezone, "time"),
      end: formatZoned(item.endAt, item.timezone, "time"),
      duration: formatDuration(item.netSeconds),
      hours: item.netSeconds / 3_600,
      project: neutralizeSpreadsheetFormula(item.projectName ?? "未关联"),
      node: neutralizeSpreadsheetFormula(item.projectNodeTitle ?? "—"),
      workType: neutralizeSpreadsheetFormula(item.workTypeName ?? "未分类"),
      source: label(sourceLabels, item.source),
      content: neutralizeSpreadsheetFormula(item.content),
      result: neutralizeSpreadsheetFormula(item.result),
      blockers: neutralizeSpreadsheetFormula(item.blockers || "无"),
      nextStep: neutralizeSpreadsheetFormula(item.nextStep || "—"),
      submission: label(submissionLabels, item.submissionStatus),
      approval: label(approvalLabels, item.approvalStatus),
      visibility: label(visibilityLabels, item.visibility),
      anomaly: neutralizeSpreadsheetFormula(anomalyText(item.anomalyFlags)),
      updated: formatZoned(item.updatedAt, item.timezone, "datetime"),
    });
    const wrappedLines = Math.max(
      1,
      ...[
        [item.content, 28],
        [item.result, 25],
        [item.blockers || "无", 21],
        [item.nextStep || "—", 21],
        [item.projectNodeTitle || "—", 18],
      ].map(([value, charsPerLine]) => Math.ceil(String(value).length / Number(charsPerLine))),
    );
    row.height = Math.min(360, Math.max(38, 18 + wrappedLines * 13));
    row.alignment = { vertical: "top", wrapText: true };
    row.eachCell((cell) => {
      cell.border = border;
      if (index % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFD" } };
    });
    row.getCell("hours").numFmt = "0.00";
    const approvalCell = row.getCell("approval");
    if (item.approvalStatus === "approved") approvalCell.font = { bold: true, color: { argb: "FF16794B" } };
    if (item.approvalStatus === "pending_review") approvalCell.font = { bold: true, color: { argb: "FFB56900" } };
    if (item.approvalStatus === "returned") approvalCell.font = { bold: true, color: { argb: "FFB42318" } };
  }
  records.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: readableHeaders.length } };
  records.headerFooter.oddHeader = `&L${document.title}&R生成于 ${document.generatedAt.slice(0, 10)}`;
  records.headerFooter.oddFooter = "&L授权范围内工作事实&C第 &P / &N 页&R工作时间与工作智能管理平台";

  const technical = workbook.addWorksheet("技术明细", { views: [{ state: "frozen", ySplit: 1, xSplit: 3 }] });
  technical.columns = rawHeaders.map((header) => ({ key: header.key, header: header.label, width: header.width }));
  styleTableHeader(technical.getRow(1));
  for (const [index, item] of document.items.entries()) {
    const row = technical.addRow(Object.fromEntries(rawHeaders.map((header) => [header.key, neutralizeSpreadsheetFormula(scalarValue(item[header.key]))])));
    row.alignment = { vertical: "top", wrapText: true };
    row.eachCell((cell) => {
      cell.border = border;
      if (index % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFD" } };
    });
  }
  technical.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: rawHeaders.length } };
  technical.state = "hidden";
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function asPdf(document: WorkSessionExportDocument): Promise<Buffer> {
  const require = createRequire(import.meta.url);
  const fontPath = require.resolve("@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff2");
  const pdf = new PDFDocument({
    size: "A4",
    margins: { top: 42, bottom: 48, left: 42, right: 42 },
    bufferPages: true,
    info: { Title: document.title, Author: "工作时间与工作智能管理平台", Creator: "工作时间与工作智能管理平台后台导出", CreationDate: new Date(document.generatedAt) },
  });
  pdf.registerFont("NotoSansSC", fontPath);
  pdf.font("NotoSansSC");
  const chunks: Buffer[] = [];
  pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<Buffer>((resolve, reject) => {
    pdf.once("end", () => resolve(Buffer.concat(chunks)));
    pdf.once("error", reject);
  });
  const pageWidth = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
  const summary = summaryFor(document);

  pdf.roundedRect(pdf.page.margins.left, 36, pageWidth, 74, 10).fill("#172033");
  pdf.fillColor("#FFFFFF").fontSize(21).text(document.title, pdf.page.margins.left + 18, 53, { width: pageWidth - 36 });
  pdf.fillColor("#C9D2E3").fontSize(9).text(`${formatZoned(document.range.from, "Asia/Shanghai", "date")} — ${formatZoned(document.range.to, "Asia/Shanghai", "date")} · 生成于 ${formatZoned(document.generatedAt, "Asia/Shanghai", "datetime")}`, pdf.page.margins.left + 18, 84, { width: pageWidth - 36 });
  pdf.y = 126;
  const cards = [["记录", `${summary.rowCount} 条`], ["净工时", formatDuration(summary.totalSeconds)], ["成员", `${summary.members} 人`], ["待审核", `${summary.approvals.pending_review ?? 0} 条`]];
  const cardGap = 8;
  const cardWidth = (pageWidth - cardGap * 3) / 4;
  for (const [index, [name, value]] of cards.entries()) {
    const x = pdf.page.margins.left + index * (cardWidth + cardGap);
    pdf.roundedRect(x, pdf.y, cardWidth, 50, 7).fill("#F2F5FA");
    pdf.fillColor("#667085").fontSize(7.5).text(name!, x + 10, pdf.y + 9, { width: cardWidth - 20 });
    pdf.fillColor("#172033").fontSize(11).text(value!, x + 10, pdf.y + 25, { width: cardWidth - 20 });
  }
  pdf.y += 66;
  pdf.fillColor("#59657A").fontSize(8.5).text(`字段策略：${document.fieldPolicyDescription}`, { width: pageWidth, lineGap: 2 });
  pdf.moveDown(1);

  for (const [index, item] of document.items.entries()) {
    const details = [["工作内容", item.content], ["工作结果", item.result], ["阻塞事项", item.blockers], ["下一步", item.nextStep]].filter(([, value]) => Boolean(value));
    if (pdf.y + 70 > pdf.page.height - pdf.page.margins.bottom) pdf.addPage();
    const top = pdf.y;
    pdf.roundedRect(pdf.page.margins.left, top, pageWidth, 48, 8).fill("#F2F5FA");
    pdf.rect(pdf.page.margins.left, top, 4, 48).fill("#4A67D6");
    pdf.fillColor("#172033").fontSize(11).text(`${index + 1}. ${item.member} · ${formatZoned(item.startAt, item.timezone, "date")} ${formatZoned(item.startAt, item.timezone, "time")}—${formatZoned(item.endAt, item.timezone, "time")}`, pdf.page.margins.left + 12, top + 9, { width: pageWidth - 24, lineBreak: false, ellipsis: true });
    pdf.fillColor("#667085").fontSize(8).text(`${formatDuration(item.netSeconds)} · ${item.projectName ?? "未关联项目"}${item.projectNodeTitle ? ` / ${item.projectNodeTitle}` : ""} · ${item.workTypeName ?? "未分类"} · ${label(approvalLabels, item.approvalStatus)}`, pdf.page.margins.left + 12, top + 29, { width: pageWidth - 24, lineBreak: false, ellipsis: true });
    pdf.y = top + 58;
    for (const [name, value] of details) {
      if (pdf.y + 24 > pdf.page.height - pdf.page.margins.bottom) pdf.addPage();
      pdf.fillColor("#59657A").fontSize(8.5).text(`${name}：`, pdf.page.margins.left + 12, pdf.y, { width: 58, continued: true });
      pdf.fillColor("#344054").text(String(value), { width: pageWidth - 82, lineGap: 2 });
      pdf.moveDown(0.35);
    }
    pdf.strokeColor("#E1E6EF").lineWidth(0.6).moveTo(pdf.page.margins.left + 12, pdf.y + 3).lineTo(pdf.page.width - pdf.page.margins.right - 12, pdf.y + 3).stroke();
    pdf.y += 14;
  }

  const range = pdf.bufferedPageRange();
  for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
    pdf.switchToPage(pageIndex);
    const footerY = pdf.page.height - 30;
    pdf.strokeColor("#E1E6EF").lineWidth(0.5).moveTo(pdf.page.margins.left, footerY - 7).lineTo(pdf.page.width - pdf.page.margins.right, footerY - 7).stroke();
    pdf.fillColor("#8791A3").fontSize(7.5).text("工作时间与工作智能管理平台 · 授权范围内导出", pdf.page.margins.left, footerY, { width: pageWidth / 2, lineBreak: false });
    pdf.text(`第 ${pageIndex - range.start + 1} / ${range.count} 页`, pdf.page.width - pdf.page.margins.right - 90, footerY, { width: 90, align: "right", lineBreak: false });
  }
  pdf.end();
  return completed;
}

export async function renderWorkSessionExport(document: WorkSessionExportDocument, format: BackgroundExportFormat): Promise<RenderedExport> {
  const baseName = exportBaseName(document);
  switch (format) {
    case "csv": return { body: asCsv(document), contentType: "text/csv; charset=utf-8", extension: format, fileName: `${baseName}.csv` };
    case "json": return { body: asJson(document), contentType: "application/json; charset=utf-8", extension: format, fileName: `${baseName}.json` };
    case "xlsx": return { body: await asXlsx(document), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: format, fileName: `${baseName}.xlsx` };
    case "pdf": return { body: await asPdf(document), contentType: "application/pdf", extension: format, fileName: `${baseName}.pdf` };
  }
}
