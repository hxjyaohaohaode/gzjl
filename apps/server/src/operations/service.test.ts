import { describe, expect, it } from "vitest";

import { ImportValidationError, previewWorkSessionCsv } from "./service.js";

describe("work-session CSV preview", () => {
  it("parses a valid, quoted record into a strictly validated import payload", () => {
    const preview = previewWorkSessionCsv([
      "startAt,endAt,content,result,visibility",
      '2026-09-01T09:00:00.000Z,2026-09-01T10:00:00.000Z,"客户, 需求访谈","形成纪要",management_only',
    ].join("\n"));

    expect(preview).toMatchObject({ rowCount: 1, validCount: 1, errors: [] });
    expect(preview.records[0]).toMatchObject({
      source: "import",
      content: "客户, 需求访谈",
      result: "形成纪要",
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
});
