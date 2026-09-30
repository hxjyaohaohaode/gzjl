import ExcelJS from "exceljs";
import { expect, it } from "vitest";
import { renderPayrollWorkbook } from "./bundle.js";

it("retains exact large decimals, formula-like text and every segment beyond Excel's cell limit", async () => {
  const text = "完整内容🚀".repeat(7000) + "_x000A_\u0001";
  const body = await renderPayrollWorkbook([{ name: "工作提交单", headers: ["成员编号", "金额", "工作内容"], rows: [["=external-id", "99999999999999.123456", text]] }]);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(body as unknown as Parameters<typeof book.xlsx.load>[0]);
  expect(book.getWorksheet("工作提交单")!.getCell("A2").value).toBe("=external-id");
  expect(book.getWorksheet("工作提交单")!.getCell("B2").value).toBe("99999999999999.123456");
  const continuation = book.getWorksheet("长文本续页")!; let recovered = "";
  for (let row = 2; row <= continuation.rowCount; row++) recovered += continuation.getCell(row, 5).value;
  const difference = [...Array(Math.max(text.length, recovered.length)).keys()].find((i) => text[i] !== recovered[i]);
  expect({ length: recovered.length, difference, fragment: difference === undefined ? "equal" : recovered.slice(Math.max(0, difference - 5), difference + 12) }).toEqual({ length: text.length, difference: undefined, fragment: "equal" });
  expect(book.getWorksheet("工作提交单")!.views[0]!.state).toBe("frozen");
});
