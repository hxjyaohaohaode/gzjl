import { describe, expect, it } from "vitest";

import { ImportValidationError, previewWorkSessionCsv } from "./service.js";

describe("work-session CSV preview", () => {
  it("reports malformed CSV as actionable validation instead of silently truncating or shifting facts", () => {
    expect(previewWorkSessionCsv('\uFEFF"startAt","endAt","content"\n2026-09-01T09:00:00Z,2026-09-01T10:00:00Z,内容').validCount).toBe(1);
    expect(() => previewWorkSessionCsv('startAt,endAt,content\n"unterminated')).toThrow(ImportValidationError);
    expect(() => previewWorkSessionCsv("startAt,endAt,content,content")).toThrow("重复");
    const wrongColumns = previewWorkSessionCsv("startAt,endAt,content\n2026-09-01T09:00:00Z,2026-09-01T10:00:00Z,unquoted,comma");
    expect(wrongColumns.validCount).toBe(0);
    expect(wrongColumns.errors[0]).toMatchObject({ row: 2, field: "row" });
    const wrongBoolean = previewWorkSessionCsv("startAt,endAt,content,parallelWork\n2026-09-01T09:00:00Z,2026-09-01T10:00:00Z,内容,ture");
    expect(wrongBoolean.validCount).toBe(0);
    expect(wrongBoolean.errors[0]).toMatchObject({ row: 2, field: "parallelWork" });
  });
  it("parses a valid, quoted record into a strictly validated import payload", () => {
    const preview = previewWorkSessionCsv([
      "membershipId,startAt,endAt,content,result,visibility",
      '550e8400-e29b-41d4-a716-446655440000,2026-09-01T09:00:00.000Z,2026-09-01T10:00:00.000Z,"客户, 需求访谈","形成纪要",management_only',
    ].join("\n"));

    expect(preview).toMatchObject({ rowCount: 1, validCount: 1, errors: [] });
    expect(preview.records[0]).toMatchObject({
      membershipId: "550e8400-e29b-41d4-a716-446655440000",
      input: {
        source: "import",
        content: "客户, 需求访谈",
        result: "形成纪要",
      },
    });
    expect(preview.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps row-level validation errors visible and rejects missing required columns", () => {
    const invalidRow = previewWorkSessionCsv([
      "startAt,endAt,content",
      "2026-09-01T10:00:00.000Z,2026-09-01T09:00:00.000Z,时间倒置",
    ].join("\n"));
    expect(invalidRow.validCount).toBe(0);
    expect(invalidRow.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ row: 2 })]),
    );
    expect(() => previewWorkSessionCsv("startAt,endAt\n2026-09-01T09:00:00.000Z,2026-09-01T10:00:00.000Z")).toThrow(
      ImportValidationError,
    );
  });

  it("rejects a malformed optional target membership instead of silently importing to the operator", () => {
    const preview = previewWorkSessionCsv([
      "membershipId,startAt,endAt,content",
      "not-a-uuid,2026-09-01T09:00:00.000Z,2026-09-01T10:00:00.000Z,归属不能猜测",
    ].join("\n"));
    expect(preview.validCount).toBe(0);
    expect(preview.errors).toContainEqual(
      expect.objectContaining({ field: "membershipId" }),
    );
  });
});
