import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  neutralizeSpreadsheetFormula,
  renderWorkSessionExport,
  type WorkSessionExportDocument,
} from "./export-files.js";

const document: WorkSessionExportDocument = {
  schemaVersion: 1,
  title: "工作记录导出",
  generatedAt: "2026-09-04T08:00:00.000Z",
  range: {
    from: "2026-09-01T00:00:00.000Z",
    to: "2026-09-05T00:00:00.000Z",
  },
  fieldPolicyDescription: "测试字段策略",
  items: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      membershipId: "00000000-0000-4000-8000-000000000002",
      member: "测试成员",
      startAt: "2026-09-04T01:00:00.000Z",
      endAt: "2026-09-04T02:30:00.000Z",
      timezone: "Asia/Shanghai",
      grossSeconds: 5_400,
      breakSeconds: 600,
      netSeconds: 4_800,
      billableSeconds: 4_800,
      source: "manual",
      content: "=HYPERLINK(\"https://invalid.example\",\"危险公式\")",
      result: "完成中文结果",
      blockers: "",
      nextStep: "继续验证",
      primaryProjectNodeId: null,
      workTypeId: null,
      visibility: "management_only",
      parallelWork: false,
      submissionStatus: "submitted",
      approvalStatus: "approved",
      anomalyFlags: [],
      version: 2,
      createdAt: "2026-09-04T02:31:00.000Z",
      updatedAt: "2026-09-04T02:32:00.000Z",
    },
  ],
};

describe("background export renderers", () => {
  it("neutralizes spreadsheet formula prefixes without altering ordinary text", () => {
    expect(neutralizeSpreadsheetFormula("=1+1")).toBe("'=1+1");
    expect(neutralizeSpreadsheetFormula("  @SUM(A1:A2)")).toBe("'  @SUM(A1:A2)");
    expect(neutralizeSpreadsheetFormula("正常内容")).toBe("正常内容");
    expect(neutralizeSpreadsheetFormula(123)).toBe(123);
  });

  it("renders UTF-8 CSV with formula-injection protection", async () => {
    const rendered = await renderWorkSessionExport(document, "csv");
    const text = rendered.body.toString("utf8");
    expect(text.startsWith("\uFEFF记录 ID,成员 ID,成员")).toBe(true);
    expect(text).toContain("测试成员");
    expect(text).toContain("'=HYPERLINK");
    expect(rendered.contentType).toBe("text/csv; charset=utf-8");
  });

  it("renders a readable XLSX workbook with frozen headers and protected cells", async () => {
    const rendered = await renderWorkSessionExport(document, "xlsx");
    expect(rendered.body.subarray(0, 2).toString("ascii")).toBe("PK");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      rendered.body as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    const sheet = workbook.getWorksheet("工作记录");
    expect(sheet).toBeDefined();
    expect(sheet!.getCell("A1").value).toBe("工作记录导出");
    expect(sheet!.getCell("C6").value).toBe("测试成员");
    expect(sheet!.getCell("L6").value).toBe(
      "'=HYPERLINK(\"https://invalid.example\",\"危险公式\")",
    );
    expect(sheet!.views[0]?.state).toBe("frozen");
  });

  it("renders a non-empty PDF with an embedded Chinese-capable font", async () => {
    const rendered = await renderWorkSessionExport(document, "pdf");
    expect(rendered.body.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(rendered.body.byteLength).toBeGreaterThan(5_000);
    expect(rendered.contentType).toBe("application/pdf");
  });

  it("renders JSON without applying spreadsheet-only escaping", async () => {
    const rendered = await renderWorkSessionExport(document, "json");
    const parsed = JSON.parse(rendered.body.toString("utf8")) as {
      rowCount: number;
      items: Array<{ content: string }>;
    };
    expect(parsed.rowCount).toBe(1);
    expect(parsed.items[0]?.content.startsWith("=HYPERLINK")).toBe(true);
  });
});
