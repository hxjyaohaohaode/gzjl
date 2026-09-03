import { describe, expect, it } from "vitest";

import { ImportValidationError, previewWorkSessionCsv } from "./service.js";

describe("work-session CSV preview", () => {
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
