import { describe, expect, it } from "vitest";
import { parseCsv, stringifyCsv } from "./csv.js";

describe("CSV helpers", () => {
  it("round trips commas, quotes and newlines", () => {
    const rows = [["name", "note"], ["张三", "完成, 已验收"], ["李四", "第一行\n第二行 \"引用\""]];
    expect(parseCsv(stringifyCsv(rows))).toEqual(rows);
  });
  it("rejects unterminated quoted fields", () => {
    expect(() => parseCsv('a,"broken')).toThrow(SyntaxError);
  });
});
