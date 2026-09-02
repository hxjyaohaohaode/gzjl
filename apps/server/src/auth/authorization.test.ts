import { describe, expect, it } from "vitest";
import type { PermissionGrant } from "@workbench/shared";

import { isAuthorized } from "./authorization.js";

const grants: PermissionGrant[] = [
  { permission: "work.view_own", scopeKind: "self", scopeId: "member-a" },
  { permission: "project.manage", scopeKind: "project", scopeId: "project-a" },
  { permission: "audit.view", scopeKind: "organization", scopeId: null },
];

describe("isAuthorized", () => {
  it("allows only an exact self grant", () => {
    expect(isAuthorized(grants, "work.view_own", { scopeKind: "self", scopeId: "member-a" })).toBe(true);
    expect(isAuthorized(grants, "work.view_own", { scopeKind: "self", scopeId: "member-b" })).toBe(false);
  });

  it("does not let a project grant leak into another project", () => {
    expect(isAuthorized(grants, "project.manage", { scopeKind: "project", scopeId: "project-a" })).toBe(true);
    expect(isAuthorized(grants, "project.manage", { scopeKind: "project", scopeId: "project-b" })).toBe(false);
  });

  it("lets an organization grant cover subordinate scopes inside the authenticated organization", () => {
    expect(isAuthorized(grants, "audit.view", { scopeKind: "project", scopeId: "project-b" })).toBe(true);
  });

  it("denies a different permission even when scope matches", () => {
    expect(isAuthorized(grants, "payroll.configure", { scopeKind: "organization" })).toBe(false);
  });
});
