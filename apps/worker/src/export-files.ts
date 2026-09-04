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

const headers: Array<{ key: keyof WorkSessionExportRow; label: string; width: number }> = [
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
  const day = document.generatedAt.slice(0, 10);
  return `work-sessions-${day}`;
}

function asCsv(document: WorkSessionExportDocument): Buffer {
  const rows = [
    headers.map((header) => header.label),
    ...document.items.map((item) =>
      headers.map((header) => neutralizeSpreadsheetFormula(scalarValue(item[header.key]))),
    ),
  ];
  return Buffer.from(`\uFEFF${stringifyCsv(rows)}`, "utf8");
}

function asJson(document: WorkSessionExportDocument): Buffer {
  return Buffer.from(
    JSON.stringify({ ...document, rowCount: document.items.length }, null, 2),
    "utf8",
  );
}

async function asXlsx(document: WorkSessionExportDocument): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "工作时间与工作智能管理平台";
  workbook.created = new Date(document.generatedAt);
  workbook.modified = new Date(document.generatedAt);
  const worksheet = workbook.addWorksheet("工作记录", {
    views: [{ state: "frozen", ySplit: 5, xSplit: 3 }],
  });
  worksheet.addRow([document.title]);
  worksheet.mergeCells(1, 1, 1, headers.length);
  worksheet.getCell(1, 1).font = { bold: true, size: 16, color: { argb: "FF172033" } };
  worksheet.addRow(["生成时间", document.generatedAt, "时间范围", `${document.range.from} — ${document.range.to}`]);
  worksheet.addRow(["字段策略", document.fieldPolicyDescription, "记录数量", document.items.length]);
  worksheet.addRow([]);
  const headerRow = worksheet.addRow(headers.map((header) => header.label));
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF263247" } };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.height = 24;

  for (const item of document.items) {
    const row = worksheet.addRow(
      headers.map((header) => neutralizeSpreadsheetFormula(scalarValue(item[header.key]))),
    );
    row.alignment = { vertical: "top", wrapText: true };
  }
  worksheet.columns = headers.map((header) => ({ key: header.key, width: header.width }));
  worksheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: headers.length } };
  worksheet.getColumn(headers.findIndex((header) => header.key === "grossSeconds") + 1).numFmt = "0";
  worksheet.getColumn(headers.findIndex((header) => header.key === "breakSeconds") + 1).numFmt = "0";
  worksheet.getColumn(headers.findIndex((header) => header.key === "netSeconds") + 1).numFmt = "0";
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

async function asPdf(document: WorkSessionExportDocument): Promise<Buffer> {
  const require = createRequire(import.meta.url);
  const fontPath = require.resolve(
    "@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff2",
  );
  const pdf = new PDFDocument({
    size: "A4",
    margins: { top: 36, bottom: 36, left: 42, right: 42 },
    bufferPages: true,
    info: {
      Title: document.title,
      Author: "工作时间与工作智能管理平台",
      Creator: "工作时间与工作智能管理平台后台导出",
      CreationDate: new Date(document.generatedAt),
    },
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
  pdf.fontSize(18).fillColor("#172033").text(document.title, { width: pageWidth });
  pdf.moveDown(0.35).fontSize(9).fillColor("#59657A");
  pdf.text(`生成时间：${document.generatedAt}`);
  pdf.text(`时间范围：${document.range.from} — ${document.range.to}`);
  pdf.text(`字段策略：${document.fieldPolicyDescription}`);
  pdf.text(`记录数量：${document.items.length}`);
  pdf.moveDown(0.8);

  for (const [index, item] of document.items.entries()) {
    if (pdf.y > pdf.page.height - 150) pdf.addPage();
    pdf.fontSize(11).fillColor("#172033").text(`${index + 1}. ${item.member} · ${item.startAt} — ${item.endAt}`);
    pdf.fontSize(8.5).fillColor("#667085").text(
      `净时长 ${item.netSeconds} 秒 · 休息 ${item.breakSeconds} 秒 · 来源 ${item.source} · 提交 ${item.submissionStatus} · 审批 ${item.approvalStatus}`,
      { width: pageWidth },
    );
    const details = [
      ["工作内容", item.content],
      ["工作结果", item.result],
      ["阻塞事项", item.blockers],
      ["下一步", item.nextStep],
      ["记录标识", item.id],
    ] as const;
    for (const [label, value] of details) {
      if (!value) continue;
      pdf.fontSize(9).fillColor("#344054").text(`${label}：${value}`, { width: pageWidth });
    }
    pdf.moveDown(0.45).strokeColor("#E7EAF0").lineWidth(0.5).moveTo(pdf.page.margins.left, pdf.y).lineTo(pdf.page.width - pdf.page.margins.right, pdf.y).stroke();
    pdf.moveDown(0.55);
  }
  pdf.end();
  return completed;
}

export async function renderWorkSessionExport(
  document: WorkSessionExportDocument,
  format: BackgroundExportFormat,
): Promise<RenderedExport> {
  const baseName = exportBaseName(document);
  switch (format) {
    case "csv":
      return { body: asCsv(document), contentType: "text/csv; charset=utf-8", extension: format, fileName: `${baseName}.csv` };
    case "json":
      return { body: asJson(document), contentType: "application/json; charset=utf-8", extension: format, fileName: `${baseName}.json` };
    case "xlsx":
      return { body: await asXlsx(document), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: format, fileName: `${baseName}.xlsx` };
    case "pdf":
      return { body: await asPdf(document), contentType: "application/pdf", extension: format, fileName: `${baseName}.pdf` };
  }
}
