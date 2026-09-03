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

/**
 * Canonical system roles are deliberately kept alongside the permission
 * vocabulary.  Both initial organization setup and the repair path for
 * organizations created by older releases consume this exact source of
 * truth, so a fresh organization can never end up with only the non-
 * assignable Owner role.
 *
 * These presets are additive for an existing system role: the server restores
 * missing permissions but does not remove a permission an Owner has explicitly
 * retained in a previous release.  Custom roles are never rewritten.
 */
export interface SystemAccessRolePreset {
  readonly name: string;
  readonly kind: AccessRoleKind;
  readonly description: string;
  readonly permissions: readonly Permission[];
}

export const systemAccessRolePresets = [
  {
    name: "Owner",
    kind: "owner",
    description: "唯一组织所有者，拥有组织级完整权限。",
    permissions,
  },
  {
    name: "Manager",
    kind: "manager",
    description:
      "可在被授予的组织、组织单元或项目范围内协调项目、审核工作与查看团队洞察；不包含薪资结算、角色治理和 Owner 权限。",
    permissions: [
      "project.create",
      "project.manage",
      "project.view_all",
      "work.view_own",
      "work.view_project_public",
      "work.view_full_scope",
      "work.review",
      "evidence.view_management",
      "payroll.view_own",
      "analytics.view_team",
      "ai.team_analysis",
      "import.scope",
      "export.scope",
    ],
  },
  {
    name: "Member",
    kind: "member",
    description:
      "默认成员角色：维护本人工作与工资，并按项目授权查看同项目成员公开的工作动态。",
    permissions: [
      "work.view_own",
      "work.view_project_public",
      "payroll.view_own",
    ],
  },
] as const satisfies readonly SystemAccessRolePreset[];

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
