import { describe, expect, it } from "vitest";

import {
  hasPermission,
  permissions,
  systemAccessRolePresets,
  type PermissionGrant,
} from "./permissions.js";

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

  it("ships assignable Manager and Member presets with least-privilege boundaries", () => {
    expect(systemAccessRolePresets.map((role) => role.kind)).toEqual([
      "owner",
      "manager",
      "member",
    ]);
    expect(systemAccessRolePresets.find((role) => role.kind === "owner")?.permissions).toEqual(
      permissions,
    );
    expect(systemAccessRolePresets.find((role) => role.kind === "member")?.permissions).toEqual([
      "work.view_own",
      "work.view_project_public",
      "payroll.view_own",
    ]);
    const managerPermissions =
      systemAccessRolePresets.find((role) => role.kind === "manager")?.permissions ?? [];
    expect(managerPermissions).not.toContain("roles.manage");
    expect(managerPermissions).not.toContain("payroll.settle");
    expect(managerPermissions).not.toContain("org.manage");
  });
});
