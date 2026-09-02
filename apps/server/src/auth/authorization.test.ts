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

  it("does not allow a self-scoped bulk import or export grant to satisfy an organization operation", () => {
    const selfScoped: PermissionGrant[] = [
      { permission: "import.scope", scopeKind: "self", scopeId: "member-a" },
      { permission: "export.scope", scopeKind: "project", scopeId: "project-a" },
    ];
    expect(isAuthorized(selfScoped, "import.scope", { scopeKind: "organization" })).toBe(false);
    expect(isAuthorized(selfScoped, "export.scope", { scopeKind: "organization" })).toBe(false);
  });

  it("requires organization scope before a team AI capability can analyze organization data", () => {
    expect(isAuthorized([{ permission: "ai.team_analysis", scopeKind: "project", scopeId: "project-a" }], "ai.team_analysis", { scopeKind: "organization" })).toBe(false);
    expect(isAuthorized([{ permission: "ai.team_analysis", scopeKind: "organization", scopeId: null }], "ai.team_analysis", { scopeKind: "organization" })).toBe(true);
  });
});
