import { expect, it } from "vitest";
import { adminWorkBackfillSchema, canAdminBackfill } from "./admin-backfill.js";

const input = { membershipIds: ["00000000-0000-4000-8000-000000000001"], startAt: "2026-09-01T08:00:00Z", endAt: "2026-09-01T10:00:00Z", timezone: "Asia/Shanghai", content: "已完成工作" };
it("rejects empty selections, duplicate people, blank work, invalid intervals and injected bypass flags", () => {
  for (const change of [{ membershipIds: [] }, { membershipIds: [...input.membershipIds, ...input.membershipIds] }, { content: "  " },
    { endAt: input.startAt }, { startAt: "2026-09-02T08:00:00Z" }, { timezone: "invalid" }, { parallelWork: true }, { source: "import" }]) {
    expect(adminWorkBackfillSchema.safeParse({ ...input, ...change }).success).toBe(false);
  }
  expect(adminWorkBackfillSchema.safeParse(input).success).toBe(true);
});
it("requires review authority for an organization or a concrete department", () => {
  for (const scopeKind of ["project", "self", "org_unit"]) expect(canAdminBackfill([{ permission: "work.review", scopeKind, scopeId: null }])).toBe(false);
  expect(canAdminBackfill([{ permission: "work.review", scopeKind: "org_unit", scopeId: "department" }])).toBe(true);
  expect(canAdminBackfill([{ permission: "work.review", scopeKind: "organization", scopeId: null }])).toBe(true);
  expect(canAdminBackfill([{ permission: "work.view_own", scopeKind: "organization", scopeId: null }])).toBe(false);
});
