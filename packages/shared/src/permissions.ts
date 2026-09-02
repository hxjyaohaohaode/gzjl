export const permissions = [
  "org.manage",
  "members.manage",
  "roles.manage",
  "project.create",
  "project.manage",
  "project.view_all",
  "work.view_own",
  "work.view_project_public",
  "work.view_full_scope",
  "work.review",
  "evidence.view_management",
  "payroll.view_own",
  "payroll.view_scope",
  "payroll.configure",
  "payroll.settle",
  "analytics.view_team",
  "ai.team_analysis",
  "audit.view",
  "import.scope",
  "export.scope",
] as const;

export type Permission = (typeof permissions)[number];

export const accessRoleKinds = ["owner", "manager", "member"] as const;
export type AccessRoleKind = (typeof accessRoleKinds)[number];

export const scopeKinds = [
  "organization",
  "org_unit",
  "project",
  "self",
] as const;
export type ScopeKind = (typeof scopeKinds)[number];

export interface PermissionGrant {
  permission: Permission;
  scopeKind: ScopeKind;
  scopeId: string | null;
}

export function hasPermission(
  grants: readonly PermissionGrant[],
  permission: Permission,
  target: { scopeKind: ScopeKind; scopeId?: string | null },
): boolean {
  return grants.some((grant) => {
    if (grant.permission !== permission) return false;
    if (grant.scopeKind === "organization") return true;
    if (grant.scopeKind !== target.scopeKind) return false;
    return grant.scopeId !== null && grant.scopeId === (target.scopeId ?? null);
  });
}
