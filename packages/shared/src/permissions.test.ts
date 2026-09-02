import { describe, expect, it } from "vitest";

import { hasPermission, type PermissionGrant } from "./permissions.js";

describe("hasPermission", () => {
  const grants: PermissionGrant[] = [
    { permission: "project.manage", scopeKind: "project", scopeId: "a" },
    { permission: "work.view_full_scope", scopeKind: "organization", scopeId: null },
  ];

  it("matches exact scoped grants", () => {
    expect(hasPermission(grants, "project.manage", { scopeKind: "project", scopeId: "a" })).toBe(true);
  });

  it("rejects a scope without an id and a mismatched id", () => {
    expect(hasPermission(grants, "project.manage", { scopeKind: "project" })).toBe(false);
    expect(hasPermission(grants, "project.manage", { scopeKind: "project", scopeId: "b" })).toBe(false);
  });

  it("applies organization grants to subordinate resource scopes", () => {
    expect(hasPermission(grants, "work.view_full_scope", { scopeKind: "org_unit", scopeId: "u" })).toBe(true);
  });
});
