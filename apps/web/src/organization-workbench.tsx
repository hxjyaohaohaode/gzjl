import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BriefcaseBusiness,
  ChevronRight,
  Crown,
  FolderTree,
  Layers3,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  UserCog,
  UserRound,
  UsersRound,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Badge, Button, Card, cn } from "@workbench/ui";

import { api, type Me } from "./api.js";
import {
  ErrorMessage,
  fieldClass,
  Field,
  LoadingBlock,
  PageHeader,
  textAreaClass,
} from "./pages.js";

type OrganizationTab = "tree" | "members" | "layers";
type ScopeKind = "organization" | "org_unit" | "project" | "self";

interface OrganizationUnit {
  id: string;
  parentId: string | null;
  name: string;
  description: string | null;
  leaderMembershipId: string | null;
  sortOrder: number;
  version: number;
}

interface AccessRole {
  id: string;
  name: string;
  kind: string;
  description: string | null;
  isSystem: boolean;
}

interface ProfessionalIdentity {
  id: string;
  name: string;
  description: string | null;
  isCustom: boolean;
}

interface RoleGrant {
  membershipId: string;
  roleId: string;
  roleName: string;
  roleKind: string;
  scopeKind: ScopeKind;
  scopeId: string | null;
  expiresAt: string | null;
}

interface IdentityGrant {
  membershipId: string;
  identityId: string;
  identityName: string;
  source: string;
  verifiedAt: string | null;
}

interface OrganizationMember {
  membership: {
    id: string;
    status: string;
    positionTitle: string | null;
    orgUnitId: string | null;
  };
  user: { displayName: string };
  positionTitle: string | null;
  unitName: string | null;
  isOwner: boolean;
  accessRoles: RoleGrant[];
  professionalIdentities: IdentityGrant[];
}

interface OwnershipTransfer {
  id: string;
  fromMembershipId: string;
  toMembershipId: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  requestedAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
}

interface OrganizationOverview {
  organization: { id: string; name: string; timezone: string } | null;
  units: OrganizationUnit[];
  roles: AccessRole[];
  professionalIdentities: ProfessionalIdentity[];
  ownerMembershipId: string | null;
  ownershipTransfer: OwnershipTransfer | null;
  members: OrganizationMember[];
}

interface ProjectChoice {
  id: string;
  key: string;
  name: string;
}

interface IdentityChangeRequest {
  id: string;
  membershipId: string;
  memberName: string;
  action: "add" | "remove";
  requestedName: string;
  requestedIdentityId: string | null;
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reviewNote: string | null;
  createdAt: string;
}

function memberStatusTone(
  status: string,
): "positive" | "warning" | "danger" | "neutral" {
  if (status === "active") return "positive";
  if (status === "invited") return "warning";
  if (status === "inactive") return "danger";
  return "neutral";
}

function memberStatusLabel(status: string): string {
  return status === "active"
    ? "在职"
    : status === "invited"
      ? "待加入"
      : status === "inactive"
        ? "已停用"
        : status;
}

function scopeLabel(
  grant: Pick<RoleGrant, "scopeKind" | "scopeId">,
  units: OrganizationUnit[],
  projects: ProjectChoice[],
): string {
  if (grant.scopeKind === "organization") return "全组织范围";
  if (grant.scopeKind === "self") return "仅本人范围";
  if (grant.scopeKind === "org_unit")
    return units.find((unit) => unit.id === grant.scopeId)?.name
      ? `组织单元 · ${units.find((unit) => unit.id === grant.scopeId)?.name}`
      : "组织单元范围";
  return projects.find((project) => project.id === grant.scopeId)?.name
    ? `项目 · ${projects.find((project) => project.id === grant.scopeId)?.name}`
    : "项目范围";
}

function initials(name: string): string {
  return name.trim().slice(0, 1) || "?";
}

function CategoryLabel({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <p className="organization-category-label">
      {icon}
      {children}
    </p>
  );
}

function UnitTree({
  units,
  members,
  selectedUnitId,
  onSelect,
}: {
  units: OrganizationUnit[];
  members: OrganizationMember[];
  selectedUnitId: string | null;
  onSelect: (unitId: string) => void;
}) {
  const childMap = useMemo(() => {
    const map = new Map<string | null, OrganizationUnit[]>();
    units.forEach((unit) =>
      map.set(unit.parentId, [...(map.get(unit.parentId) ?? []), unit]),
    );
    return map;
  }, [units]);
  const membersInUnit = (unitId: string) =>
    members.filter((member) => member.membership.orgUnitId === unitId);
  const renderUnit = (unit: OrganizationUnit, depth: number): ReactNode => {
    const children = childMap.get(unit.id) ?? [];
    const unitMembers = membersInUnit(unit.id);
    return (
      <li className="organization-tree-item" key={unit.id}>
        <button
          aria-pressed={selectedUnitId === unit.id}
          className={cn(
            "organization-tree-node",
            selectedUnitId === unit.id && "is-selected",
          )}
          onClick={() => onSelect(unit.id)}
          type="button"
        >
          <span className="organization-tree-node-icon">
            <BriefcaseBusiness size={17} />
          </span>
          <span className="min-w-0 flex-1 text-left">
            <strong className="block truncate">{unit.name}</strong>
            <small>
              {unitMembers.length} 位成员 · 第 {depth + 1} 层
            </small>
          </span>
          <span
            className="organization-avatar-stack"
            aria-label={`${unitMembers.length} 位成员`}
          >
            {unitMembers.slice(0, 3).map((member) => (
              <span key={member.membership.id}>
                {initials(member.user.displayName)}
              </span>
            ))}
            {unitMembers.length > 3 ? (
              <span>+{unitMembers.length - 3}</span>
            ) : null}
          </span>
        </button>
        {children.length ? (
          <ul className="organization-tree-children">
            {children.map((child) => renderUnit(child, depth + 1))}
          </ul>
        ) : null}
      </li>
    );
  };
  const roots = childMap.get(null) ?? [];
  return (
    <div className="organization-tree-canvas">
      <div className="organization-tree-root">
        <span className="organization-tree-root-mark">
          <Layers3 size={18} />
        </span>
        <span>
          <strong>组织结构</strong>
          <small>组织单元与汇报层级</small>
        </span>
      </div>
      {roots.length ? (
        <ul className="organization-tree-roots">
          {roots.map((unit) => renderUnit(unit, 0))}
        </ul>
      ) : (
        <div className="organization-tree-empty">
          <FolderTree size={22} />
          <p>尚未建立组织单元。先在右侧添加顶层单元，再按需要建立子层级。</p>
        </div>
      )}
    </div>
  );
}

function LayerChip({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "role" | "position" | "identity";
}) {
  return (
    <span className={`organization-layer-chip is-${tone}`}>{children}</span>
  );
}

function MemberLayerSummary({
  member,
  units,
  projects,
}: {
  member: OrganizationMember;
  units: OrganizationUnit[];
  projects: ProjectChoice[];
}) {
  return (
    <div className="organization-member-layers">
      <div>
        <CategoryLabel icon={<ShieldCheck size={13} />}>访问角色</CategoryLabel>
        <div className="organization-chip-row">
          {member.isOwner ? (
            <LayerChip tone="role">
              <Crown size={12} />
              Owner · 全组织
            </LayerChip>
          ) : member.accessRoles.length ? (
            member.accessRoles.map((grant) => (
              <LayerChip
                key={`${grant.roleId}-${grant.scopeKind}-${grant.scopeId ?? ""}`}
                tone="role"
              >
                {grant.roleName} · {scopeLabel(grant, units, projects)}
              </LayerChip>
            ))
          ) : (
            <span className="organization-empty-inline">未分配</span>
          )}
        </div>
      </div>
      <div>
        <CategoryLabel icon={<BriefcaseBusiness size={13} />}>
          组织岗位
        </CategoryLabel>
        <div className="organization-chip-row">
          {member.positionTitle ? (
            <LayerChip tone="position">{member.positionTitle}</LayerChip>
          ) : (
            <span className="organization-empty-inline">未设置</span>
          )}
          <span className="organization-unit-caption">
            {member.unitName || "未归属组织单元"}
          </span>
        </div>
      </div>
      <div>
        <CategoryLabel icon={<Sparkles size={13} />}>专业身份</CategoryLabel>
        <div className="organization-chip-row">
          {member.professionalIdentities.length ? (
            member.professionalIdentities.map((identity) => (
              <LayerChip key={identity.identityId} tone="identity">
                {identity.identityName}
              </LayerChip>
            ))
          ) : (
            <span className="organization-empty-inline">未分配</span>
          )}
        </div>
      </div>
    </div>
  );
}

function MemberInspector({
  member,
  overview,
  projects,
  currentMembershipId,
  onClose,
}: {
  member: OrganizationMember;
  overview: OrganizationOverview;
  projects: ProjectChoice[];
  currentMembershipId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const mfaStatus = useQuery({
    queryKey: ["totp-status"],
    queryFn: () => api<{ enabled: boolean; pending: boolean }>("/api/auth/mfa/totp"),
  });
  const [profile, setProfile] = useState({
    positionTitle: member.positionTitle ?? "",
    orgUnitId: member.membership.orgUnitId ?? "",
  });
  const [identityIds, setIdentityIds] = useState<string[]>(
    member.professionalIdentities.map((identity) => identity.identityId),
  );
  const [grants, setGrants] = useState<
    Array<{ roleId: string; scopeKind: ScopeKind; scopeId: string | null }>
  >(
    member.accessRoles.map((grant) => ({
      roleId: grant.roleId,
      scopeKind: grant.scopeKind,
      scopeId: grant.scopeId,
    })),
  );
  const [newOwnerMembershipId, setNewOwnerMembershipId] = useState("");
  const [ownershipPassword, setOwnershipPassword] = useState("");
  const [ownershipTotpCode, setOwnershipTotpCode] = useState("");
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["organization"] });
  const profileMutation = useMutation({
    mutationFn: () =>
      api(`/api/organization/members/${member.membership.id}`, {
        method: "PATCH",
        body: {
          positionTitle: profile.positionTitle.trim() || null,
          orgUnitId: profile.orgUnitId || null,
        },
      }),
    onSuccess: refresh,
  });
  const identityMutation = useMutation({
    mutationFn: () =>
      api(`/api/organization/members/${member.membership.id}/identities`, {
        method: "PUT",
        body: { identityIds },
      }),
    onSuccess: refresh,
  });
  const rolesMutation = useMutation({
    mutationFn: () =>
      api(`/api/organization/members/${member.membership.id}/roles`, {
        method: "PUT",
        body: { grants },
      }),
    onSuccess: refresh,
  });
  const statusMutation = useMutation({
    mutationFn: (status: "active" | "inactive") =>
      api(`/api/organization/members/${member.membership.id}/status`, {
        method: "PATCH",
        body: { status },
      }),
    onSuccess: refresh,
  });
  const resendInvitation = useMutation({
    mutationFn: () =>
      api(
        `/api/organization/invitations/${member.membership.id}/resend`,
        { method: "POST" },
      ),
    onSuccess: refresh,
  });
  const requestOwnershipTransfer = useMutation({
    mutationFn: () => {
      if (!newOwnerMembershipId)
        throw new Error("请选择一位组织级 Manager 作为新 Owner。");
      if (!ownershipPassword)
        throw new Error("请先输入当前密码以完成二次验证。");
      return api("/api/organization/ownership-transfers", {
        method: "POST",
        body: {
          toMembershipId: newOwnerMembershipId,
          password: ownershipPassword,
          ...(ownershipTotpCode ? { totpCode: ownershipTotpCode } : {}),
        },
      });
    },
    onSuccess: async () => {
      setNewOwnerMembershipId("");
      setOwnershipPassword("");
      setOwnershipTotpCode("");
      await refresh();
    },
  });
  const confirmOwnershipTransfer = useMutation({
    mutationFn: (transferId: string) =>
      api(`/api/organization/ownership-transfers/${transferId}/confirm`, {
        method: "POST",
        body: {
          password: ownershipPassword,
          ...(ownershipTotpCode ? { totpCode: ownershipTotpCode } : {}),
        },
      }),
    onSuccess: async () => {
      setOwnershipPassword("");
      setOwnershipTotpCode("");
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: ["me"] }),
      ]);
    },
  });
  const cancelOwnershipTransfer = useMutation({
    mutationFn: (transferId: string) =>
      api(`/api/organization/ownership-transfers/${transferId}/cancel`, {
        method: "POST",
      }),
    onSuccess: refresh,
  });
  const updateGrant = (
    roleId: string,
    patch: Partial<{ scopeKind: ScopeKind; scopeId: string | null }>,
  ) =>
    setGrants((current) =>
      current.map((grant) =>
        grant.roleId === roleId ? { ...grant, ...patch } : grant,
      ),
    );
  const toggleRole = (role: AccessRole) =>
    setGrants((current) => {
      const exists = current.some((grant) => grant.roleId === role.id);
      if (exists) return current.filter((grant) => grant.roleId !== role.id);
      const scopeKind: ScopeKind =
        role.kind === "member"
          ? "self"
          : profile.orgUnitId
            ? "org_unit"
            : "organization";
      return [
        ...current,
        {
          roleId: role.id,
          scopeKind,
          scopeId:
            scopeKind === "self"
              ? member.membership.id
              : scopeKind === "org_unit"
                ? profile.orgUnitId
                : null,
        },
      ];
    });
  const toggleIdentity = (identityId: string) =>
    setIdentityIds((current) =>
      current.includes(identityId)
        ? current.filter((id) => id !== identityId)
        : [...current, identityId],
    );
  const ownershipTransfer = overview.ownershipTransfer;
  const transferRecipient = ownershipTransfer
    ? overview.members.find(
        (candidate) =>
          candidate.membership.id === ownershipTransfer.toMembershipId,
      )
    : null;
  const transferInitiator = ownershipTransfer
    ? overview.members.find(
        (candidate) =>
          candidate.membership.id === ownershipTransfer.fromMembershipId,
      )
    : null;
  const transferCandidates = overview.members.filter(
    (candidate) =>
      candidate.membership.id !== member.membership.id &&
      candidate.membership.status === "active" &&
      candidate.accessRoles.some(
        (grant) =>
          grant.roleKind === "manager" && grant.scopeKind === "organization",
      ),
  );
  const isCurrentOwner =
    member.isOwner && member.membership.id === currentMembershipId;
  const isTransferRecipient =
    ownershipTransfer?.toMembershipId === currentMembershipId &&
    member.membership.id === currentMembershipId;
  const ownershipVerificationReady =
    !mfaStatus.isLoading &&
    !mfaStatus.isError &&
    Boolean(ownershipPassword) &&
    (!mfaStatus.data?.enabled || /^\d{6}$/.test(ownershipTotpCode));

  return (
    <aside
      aria-label={`${member.user.displayName} 的成员详情`}
      className="organization-inspector"
    >
      <div className="organization-inspector-head">
        <div className="flex min-w-0 items-center gap-3">
          <span className="organization-member-avatar is-large">
            {initials(member.user.displayName)}
          </span>
          <div className="min-w-0">
            <p className="truncate font-extrabold tracking-[-0.03em]">
              {member.user.displayName}
            </p>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              成员详情与分层配置
            </p>
          </div>
        </div>
        <Button
          aria-label="关闭成员详情"
          onClick={onClose}
          size="compact"
          variant="ghost"
        >
          关闭
        </Button>
      </div>
      <div className="organization-inspector-scroll">
        <section className="organization-inspector-section">
          <CategoryLabel icon={<BriefcaseBusiness size={14} />}>
            组织岗位
          </CategoryLabel>
          <p className="organization-inspector-description">
            岗位描述“组织中的职责”，不决定系统权限，也不等同于专业身份。
          </p>
          <div className="mt-3 grid gap-3">
            <Field label="岗位名称">
              <input
                className={fieldClass}
                maxLength={120}
                onChange={(event) =>
                  setProfile({ ...profile, positionTitle: event.target.value })
                }
                placeholder="例如：产品负责人"
                value={profile.positionTitle}
              />
            </Field>
            <Field label="所属组织单元">
              <select
                className={fieldClass}
                onChange={(event) =>
                  setProfile({ ...profile, orgUnitId: event.target.value })
                }
                value={profile.orgUnitId}
              >
                <option value="">未归属组织单元</option>
                {overview.units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </Field>
            <Button
              disabled={profileMutation.isPending}
              onClick={() => profileMutation.mutate()}
              size="compact"
              variant="secondary"
            >
              <Save size={14} />
              保存岗位与归属
            </Button>
          </div>
        </section>
        <section className="organization-inspector-section">
          <CategoryLabel icon={<Sparkles size={14} />}>专业身份</CategoryLabel>
          <p className="organization-inspector-description">
            专业身份用于工作标签、筛选与匹配，不会自动扩大任何数据访问范围。
          </p>
          <div className="organization-choice-list">
            {overview.professionalIdentities.map((identity) => (
              <label className="organization-check-row" key={identity.id}>
                <input
                  checked={identityIds.includes(identity.id)}
                  onChange={() => toggleIdentity(identity.id)}
                  type="checkbox"
                />
                <span>
                  <strong>{identity.name}</strong>
                  {identity.description ? (
                    <small>{identity.description}</small>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
          <Button
            disabled={identityMutation.isPending}
            onClick={() => identityMutation.mutate()}
            size="compact"
            variant="secondary"
          >
            <Save size={14} />
            保存专业身份
          </Button>
        </section>
        <section className="organization-inspector-section">
          <CategoryLabel icon={<ShieldCheck size={14} />}>
            访问角色与范围
          </CategoryLabel>
          <p className="organization-inspector-description">
            访问角色严格决定可执行的动作；范围决定这些动作能作用到哪些事实。Owner
            不可在此修改。
          </p>
          {member.isOwner ? (
            <div className="organization-owner-lock">
              <Crown size={16} />
              <span>
                当前成员是唯一 Owner。所有权转移必须走独立的双向确认流程。
              </span>
            </div>
          ) : (
            <div className="organization-choice-list">
              {overview.roles
                .filter((role) => role.kind !== "owner")
                .map((role) => {
                  const grant = grants.find((item) => item.roleId === role.id);
                  return (
                    <div className="organization-role-editor" key={role.id}>
                      <label className="organization-check-row">
                        <input
                          checked={Boolean(grant)}
                          onChange={() => toggleRole(role)}
                          type="checkbox"
                        />
                        <span>
                          <strong>{role.name}</strong>
                          <small>
                            {role.description ||
                              (role.kind === "manager"
                                ? "可按授权范围管理团队或项目"
                                : "维护本人工作事实")}
                          </small>
                        </span>
                      </label>
                      {grant ? (
                        <div className="organization-grant-controls">
                          <select
                            className={fieldClass}
                            disabled={role.kind === "member"}
                            onChange={(event) => {
                              const scopeKind = event.target.value as ScopeKind;
                              updateGrant(role.id, {
                                scopeKind,
                                scopeId:
                                  scopeKind === "self"
                                    ? member.membership.id
                                    : scopeKind === "org_unit"
                                      ? profile.orgUnitId ||
                                        overview.units[0]?.id ||
                                        null
                                      : scopeKind === "project"
                                        ? projects[0]?.id || null
                                        : null,
                              });
                            }}
                            value={grant.scopeKind}
                          >
                            <option value="organization">全组织范围</option>
                            <option value="org_unit">组织单元范围</option>
                            <option value="project">项目范围</option>
                            <option value="self">仅本人范围</option>
                          </select>
                          {grant.scopeKind === "org_unit" ? (
                            <select
                              className={fieldClass}
                              onChange={(event) =>
                                updateGrant(role.id, {
                                  scopeId: event.target.value || null,
                                })
                              }
                              value={grant.scopeId ?? ""}
                            >
                              <option value="">选择组织单元</option>
                              {overview.units.map((unit) => (
                                <option key={unit.id} value={unit.id}>
                                  {unit.name}
                                </option>
                              ))}
                            </select>
                          ) : null}
                          {grant.scopeKind === "project" ? (
                            <select
                              className={fieldClass}
                              onChange={(event) =>
                                updateGrant(role.id, {
                                  scopeId: event.target.value || null,
                                })
                              }
                              value={grant.scopeId ?? ""}
                            >
                              <option value="">选择项目</option>
                              {projects.map((project) => (
                                <option key={project.id} value={project.id}>
                                  {project.key} · {project.name}
                                </option>
                              ))}
                            </select>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
            </div>
          )}{" "}
          {!member.isOwner ? (
            <Button
              disabled={rolesMutation.isPending}
              onClick={() => rolesMutation.mutate()}
              size="compact"
              variant="secondary"
            >
              <Save size={14} />
              保存访问角色
            </Button>
          ) : null}
        </section>
        {isCurrentOwner ? (
          <section className="organization-inspector-section">
            <CategoryLabel icon={<Crown size={14} />}>所有权转移</CategoryLabel>
            <p className="organization-inspector-description">
              只有当前 Owner 能发起；接收人必须是拥有组织级 Manager
              权限的在职成员。发起与接收都会在各自会话中用当前密码重新验证；已启用动态验证码时，还必须验证动态码。
            </p>
            {ownershipTransfer ? (
              <div className="mt-3">
                <div className="organization-owner-lock">
                  <Crown size={16} />
                  <span>
                    已向 {transferRecipient?.user.displayName || "指定成员"}{" "}
                    发起所有权转移。确认前，当前 Owner 与权限保持不变。
                  </span>
                </div>
                <Button
                  className="mt-3"
                  disabled={cancelOwnershipTransfer.isPending}
                  onClick={() => {
                    if (window.confirm("确定取消这笔待确认的所有权转移吗？"))
                      cancelOwnershipTransfer.mutate(ownershipTransfer.id);
                  }}
                  size="compact"
                  variant="secondary"
                >
                  取消待确认转移
                </Button>
              </div>
            ) : (
              <div className="mt-3 grid gap-3">
                <Field label="新 Owner（组织级 Manager）">
                  <select
                    aria-label="新 Owner（组织级 Manager）"
                    className={fieldClass}
                    onChange={(event) =>
                      setNewOwnerMembershipId(event.target.value)
                    }
                    value={newOwnerMembershipId}
                  >
                    <option value="">选择接收人</option>
                    {transferCandidates.map((candidate) => (
                      <option
                        key={candidate.membership.id}
                        value={candidate.membership.id}
                      >
                        {candidate.user.displayName} ·{" "}
                        {candidate.positionTitle || "未设置岗位"}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="当前密码（发起转移二次验证）">
                  <input
                    autoComplete="current-password"
                    className={fieldClass}
                    onChange={(event) => setOwnershipPassword(event.target.value)}
                    type="password"
                    value={ownershipPassword}
                  />
                </Field>
                {mfaStatus.data?.enabled ? (
                  <Field label="动态验证码（发起转移，6 位）">
                    <input
                      autoComplete="one-time-code"
                      className={fieldClass}
                      inputMode="numeric"
                      maxLength={6}
                      onChange={(event) =>
                        setOwnershipTotpCode(
                          event.target.value.replace(/\D/g, "").slice(0, 6),
                        )
                      }
                      pattern="[0-9]*"
                      value={ownershipTotpCode}
                    />
                  </Field>
                ) : null}
                {transferCandidates.length ? (
                  <Button
                    disabled={
                      requestOwnershipTransfer.isPending ||
                      !newOwnerMembershipId ||
                      !ownershipVerificationReady
                    }
                    onClick={() => {
                      if (
                        window.confirm(
                          "发起后，接收人需在自己的会话中确认才能生效。确定继续吗？",
                        )
                      )
                        requestOwnershipTransfer.mutate();
                    }}
                    size="compact"
                    variant="secondary"
                  >
                    <Crown size={14} />
                    发起双向确认转移
                  </Button>
                ) : (
                  <p className="text-xs leading-5 text-[var(--text-muted)]">
                    暂无拥有组织级 Manager 权限的在职成员可作为接收人。
                  </p>
                )}
              </div>
            )}
          </section>
        ) : null}
        {isTransferRecipient && ownershipTransfer ? (
          <section className="organization-inspector-section">
            <CategoryLabel icon={<Crown size={14} />}>
              待确认所有权转移
            </CategoryLabel>
            <p className="organization-inspector-description">
              {transferInitiator?.user.displayName || "当前 Owner"} 希望将唯一
              Owner 身份转移给你。确认后权限会立即原子切换，原 Owner
              会保留组织级 Manager 身份。请先完成本人二次验证。
            </p>
            <div className="mt-3 grid gap-3">
              <Field label="当前密码（确认接任二次验证）">
                <input
                  autoComplete="current-password"
                  className={fieldClass}
                  onChange={(event) => setOwnershipPassword(event.target.value)}
                  type="password"
                  value={ownershipPassword}
                />
              </Field>
              {mfaStatus.data?.enabled ? (
                <Field label="动态验证码（确认接任，6 位）">
                  <input
                    autoComplete="one-time-code"
                    className={fieldClass}
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(event) =>
                      setOwnershipTotpCode(
                        event.target.value.replace(/\D/g, "").slice(0, 6),
                      )
                    }
                    pattern="[0-9]*"
                    value={ownershipTotpCode}
                  />
                </Field>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                disabled={
                  confirmOwnershipTransfer.isPending ||
                  !ownershipVerificationReady
                }
                onClick={() => {
                  if (
                    window.confirm(
                      "确认接任唯一 Owner 吗？该操作会立即切换组织所有权。",
                    )
                  )
                    confirmOwnershipTransfer.mutate(ownershipTransfer.id);
                }}
                size="compact"
              >
                <Crown size={14} />
                确认接任 Owner
              </Button>
              <Button
                disabled={cancelOwnershipTransfer.isPending}
                onClick={() =>
                  cancelOwnershipTransfer.mutate(ownershipTransfer.id)
                }
                size="compact"
                variant="secondary"
              >
                拒绝转移
              </Button>
            </div>
          </section>
        ) : null}
        <section className="organization-inspector-section">
          <CategoryLabel icon={<UserCog size={14} />}>成员状态</CategoryLabel>
          <div className="flex items-center justify-between gap-3">
            <Badge tone={memberStatusTone(member.membership.status)}>
              {memberStatusLabel(member.membership.status)}
            </Badge>
            {member.membership.status === "invited" ? (
              <Button
                aria-label={`重新发送 ${member.user.displayName} 的白名单邀请`}
                disabled={resendInvitation.isPending}
                onClick={() => resendInvitation.mutate()}
                size="compact"
                variant="secondary"
              >
                {resendInvitation.isPending ? "正在发送…" : "重新发送邀请"}
              </Button>
            ) : member.membership.status !== "invited" && !member.isOwner ? (
              <Button
                disabled={statusMutation.isPending}
                onClick={() =>
                  statusMutation.mutate(
                    member.membership.status === "active"
                      ? "inactive"
                      : "active",
                  )
                }
                size="compact"
                variant="secondary"
              >
                {member.membership.status === "active"
                  ? "停用成员"
                  : "恢复成员"}
              </Button>
            ) : null}
          </div>
        </section>
        <ErrorMessage
          error={
            profileMutation.error ??
            identityMutation.error ??
            rolesMutation.error ??
            statusMutation.error ??
            resendInvitation.error ??
            requestOwnershipTransfer.error ??
            confirmOwnershipTransfer.error ??
            cancelOwnershipTransfer.error ??
            mfaStatus.error
          }
        />
      </div>
    </aside>
  );
}

function UnitInspector({
  unit,
  overview,
  onClose,
}: {
  unit: OrganizationUnit;
  overview: OrganizationOverview;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: unit.name,
    description: unit.description ?? "",
    parentId: unit.parentId ?? "",
    leaderMembershipId: unit.leaderMembershipId ?? "",
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["organization"] });
  const update = useMutation({
    mutationFn: () =>
      api(`/api/organization/units/${unit.id}`, {
        method: "PATCH",
        body: {
          expectedVersion: unit.version,
          name: form.name,
          description: form.description.trim() || null,
          parentId: form.parentId || null,
          leaderMembershipId: form.leaderMembershipId || null,
        },
      }),
    onSuccess: refresh,
  });
  const archive = useMutation({
    mutationFn: () =>
      api(`/api/organization/units/${unit.id}/archive`, {
        method: "POST",
        body: { expectedVersion: unit.version },
      }),
    onSuccess: () => {
      void refresh();
      onClose();
    },
  });
  return (
    <aside
      aria-label={`${unit.name} 的组织单元详情`}
      className="organization-inspector"
    >
      <div className="organization-inspector-head">
        <div className="flex min-w-0 items-center gap-3">
          <span className="organization-unit-avatar">
            <BriefcaseBusiness size={18} />
          </span>
          <div className="min-w-0">
            <p className="truncate font-extrabold tracking-[-0.03em]">
              {unit.name}
            </p>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              组织单元 · v{unit.version}
            </p>
          </div>
        </div>
        <Button
          aria-label="关闭组织单元详情"
          onClick={onClose}
          size="compact"
          variant="ghost"
        >
          关闭
        </Button>
      </div>
      <div className="organization-inspector-scroll">
        <section className="organization-inspector-section">
          <CategoryLabel icon={<FolderTree size={14} />}>
            结构与负责人
          </CategoryLabel>
          <p className="organization-inspector-description">
            移动单元会先校验环路；归档前需先处理子单元与在岗成员。
          </p>
          <div className="mt-3 grid gap-3">
            <Field label="单元名称">
              <input
                className={fieldClass}
                maxLength={120}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
                required
                value={form.name}
              />
            </Field>
            <Field label="上级单元">
              <select
                className={fieldClass}
                onChange={(event) =>
                  setForm({ ...form, parentId: event.target.value })
                }
                value={form.parentId}
              >
                <option value="">顶层单元</option>
                {overview.units
                  .filter((candidate) => candidate.id !== unit.id)
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="负责人">
              <select
                className={fieldClass}
                onChange={(event) =>
                  setForm({ ...form, leaderMembershipId: event.target.value })
                }
                value={form.leaderMembershipId}
              >
                <option value="">暂不指定</option>
                {overview.members
                  .filter((member) => member.membership.status !== "inactive")
                  .map((member) => (
                    <option
                      key={member.membership.id}
                      value={member.membership.id}
                    >
                      {member.user.displayName}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="说明">
              <textarea
                className={textAreaClass}
                maxLength={2000}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
                value={form.description}
              />
            </Field>
            <Button
              disabled={update.isPending || !form.name.trim()}
              onClick={() => update.mutate()}
              variant="secondary"
            >
              <Save size={16} />
              保存组织单元
            </Button>
            <Button
              disabled={archive.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `确定归档“${unit.name}”吗？子单元和在岗成员必须已经处理。`,
                  )
                )
                  archive.mutate();
              }}
              size="compact"
              variant="ghost"
            >
              归档该单元
            </Button>
          </div>
        </section>
        <ErrorMessage error={update.error ?? archive.error} />
      </div>
    </aside>
  );
}

function OrganizationSidebar({
  overview,
  selectedUnit,
  onSelectUnit,
  onSelectMember,
}: {
  overview: OrganizationOverview;
  selectedUnit: OrganizationUnit | null;
  onSelectUnit: (unit: OrganizationUnit | null) => void;
  onSelectMember: (member: OrganizationMember | null) => void;
}) {
  const queryClient = useQueryClient();
  const [newUnitName, setNewUnitName] = useState("");
  const [identityName, setIdentityName] = useState("");
  const [identityDescription, setIdentityDescription] = useState("");
  const [invite, setInvite] = useState({
    displayName: "",
    identifier: "",
    kind: "email" as "email" | "phone",
    positionTitle: "",
    orgUnitId: "",
    roleId: "",
  });
  const [deliveryFeedback, setDeliveryFeedback] = useState<{
    kind: "email" | "phone";
    expiresAt: string;
  } | null>(null);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["organization"] });
  const createUnit = useMutation({
    mutationFn: () =>
      api("/api/organization/units", {
        method: "POST",
        body: { name: newUnitName, parentId: selectedUnit?.id ?? null },
      }),
    onSuccess: async () => {
      setNewUnitName("");
      await refresh();
    },
  });
  const createIdentity = useMutation({
    mutationFn: () =>
      api("/api/organization/professional-identities", {
        method: "POST",
        body: {
          name: identityName,
          description: identityDescription.trim() || undefined,
        },
      }),
    onSuccess: async () => {
      setIdentityName("");
      setIdentityDescription("");
      await refresh();
    },
  });
  const inviteMember = useMutation({
    mutationFn: () =>
      api<{
        delivery: { kind: "email" | "phone"; expiresAt: string };
      }>("/api/organization/invitations", {
        method: "POST",
        body: {
          displayName: invite.displayName,
          identifier: invite.identifier,
          kind: invite.kind,
          positionTitle: invite.positionTitle || undefined,
          orgUnitId: invite.orgUnitId || null,
          roleId: invite.roleId,
        },
      }),
    onSuccess: async (result) => {
      setDeliveryFeedback(result.delivery);
      setInvite({
        displayName: "",
        identifier: "",
        kind: "email",
        positionTitle: "",
        orgUnitId: "",
        roleId: "",
      });
      await refresh();
    },
    // A transient provider outage happens after the server has safely created
    // a pending white-list entry. Refresh even on an error so the Owner sees
    // that entry and can use the explicit resend action instead of attempting
    // to create the same person a second time.
    onError: async () => {
      await refresh();
    },
  });
  const identityRequests = useQuery({
    queryKey: ["identity-change-requests"],
    queryFn: () =>
      api<{ items: IdentityChangeRequest[] }>(
        "/api/organization/identity-change-requests",
      ),
  });
  const reviewIdentityRequest = useMutation({
    mutationFn: ({
      requestId,
      decision,
    }: {
      requestId: string;
      decision: "approved" | "rejected";
    }) =>
      api(`/api/organization/identity-change-requests/${requestId}/review`, {
        method: "POST",
        body: { decision },
      }),
    onSuccess: async () => {
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({
          queryKey: ["identity-change-requests"],
        }),
      ]);
    },
  });
  return (
    <aside className="organization-side-rail">
      <section className="organization-rail-section">
        <p className="app-section-label">分层规则</p>
        <div className="organization-layer-legend">
          <div>
            <span className="organization-legend-icon is-role">
              <ShieldCheck size={15} />
            </span>
            <span>
              <strong>访问角色</strong>
              <small>决定能做什么与数据范围</small>
            </span>
          </div>
          <div>
            <span className="organization-legend-icon is-position">
              <BriefcaseBusiness size={15} />
            </span>
            <span>
              <strong>组织岗位</strong>
              <small>描述组织中的职责归属</small>
            </span>
          </div>
          <div>
            <span className="organization-legend-icon is-identity">
              <Sparkles size={15} />
            </span>
            <span>
              <strong>专业身份</strong>
              <small>用于业务标签与协作匹配</small>
            </span>
          </div>
        </div>
      </section>
      <section className="organization-rail-section">
        <p className="app-section-label">组织单元</p>
        <details className="organization-rail-disclosure">
          <summary>新建组织单元</summary>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              createUnit.mutate();
            }}
          >
            <input
              className={fieldClass}
              onChange={(event) => setNewUnitName(event.target.value)}
              placeholder={
                selectedUnit ? `在 ${selectedUnit.name} 下新增` : "新增顶层单元"
              }
              required
              value={newUnitName}
            />
            <Button
              aria-label="新增组织单元"
              disabled={createUnit.isPending}
              size="compact"
              type="submit"
            >
              <Plus size={16} />
            </Button>
          </form>
        </details>
        <div className="organization-rail-list">
          {overview.units.map((unit) => (
            <button
              className={cn(selectedUnit?.id === unit.id && "is-selected")}
              key={unit.id}
              onClick={() => {
                onSelectUnit(unit);
                onSelectMember(null);
              }}
              type="button"
            >
              <BriefcaseBusiness size={14} />
              <span>{unit.name}</span>
              <ChevronRight size={13} />
            </button>
          ))}
        </div>
      </section>
      <section className="organization-rail-section">
        <p className="app-section-label">专业身份目录</p>
        <details className="organization-rail-disclosure">
          <summary>添加专业身份</summary>
          <form
            className="mt-2 grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              createIdentity.mutate();
            }}
          >
            <input
              className={fieldClass}
              maxLength={120}
              onChange={(event) => setIdentityName(event.target.value)}
              placeholder="新增专业身份"
              required
              value={identityName}
            />
            <input
              className={fieldClass}
              maxLength={2000}
              onChange={(event) => setIdentityDescription(event.target.value)}
              placeholder="一句话说明（可选）"
              value={identityDescription}
            />
            <Button
              disabled={createIdentity.isPending}
              size="compact"
              type="submit"
            >
              <Plus size={15} />
              添加身份
            </Button>
          </form>
        </details>
        <div className="organization-identity-catalog">
          {overview.professionalIdentities.map((identity) => (
            <span key={identity.id}>{identity.name}</span>
          ))}
        </div>
      </section>
      <section className="organization-rail-section">
        <p className="app-section-label">待审身份申请</p>
        {identityRequests.isPending ? (
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            正在读取待审申请…
          </p>
        ) : identityRequests.data?.items.length ? (
          <div className="organization-identity-request-list">
            {identityRequests.data.items.map((request) => (
              <div key={request.id}>
                <span>
                  <strong>
                    {request.memberName} ·{" "}
                    {request.action === "add" ? "新增" : "移除"}{" "}
                    {request.requestedName}
                  </strong>
                  <small>{request.reason || "未填写申请说明"}</small>
                </span>
                <div>
                  <Button
                    aria-label={`批准身份申请 ${request.requestedName}`}
                    disabled={reviewIdentityRequest.isPending}
                    onClick={() =>
                      reviewIdentityRequest.mutate({
                        requestId: request.id,
                        decision: "approved",
                      })
                    }
                    size="compact"
                  >
                    批准
                  </Button>
                  <Button
                    aria-label={`拒绝身份申请 ${request.requestedName}`}
                    disabled={reviewIdentityRequest.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          `拒绝“${request.memberName}”关于“${request.requestedName}”的身份申请吗？`,
                        )
                      )
                        reviewIdentityRequest.mutate({
                          requestId: request.id,
                          decision: "rejected",
                        });
                    }}
                    size="compact"
                    variant="ghost"
                  >
                    拒绝
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
            暂无待审核的专业身份申请。
          </p>
        )}
      </section>
      <section className="organization-rail-section">
        <p className="app-section-label">白名单邀请</p>
        <details className="organization-rail-disclosure">
          <summary>添加成员并发送加入链接</summary>
          <form
            className="mt-2 grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              inviteMember.mutate();
            }}
          >
            <input
              className={fieldClass}
              onChange={(event) =>
                setInvite({ ...invite, displayName: event.target.value })
              }
              placeholder="姓名"
              required
              value={invite.displayName}
            />
            <select
              aria-label="白名单渠道"
              className={fieldClass}
              onChange={(event) =>
                setInvite({
                  ...invite,
                  kind: event.target.value as "email" | "phone",
                  identifier: "",
                })
              }
              value={invite.kind}
            >
              <option value="email">邮箱白名单</option>
              <option value="phone">手机号白名单</option>
            </select>
            <input
              aria-label={invite.kind === "email" ? "白名单邮箱" : "白名单手机号"}
              className={fieldClass}
              inputMode={invite.kind === "phone" ? "tel" : "email"}
              onChange={(event) =>
                setInvite({ ...invite, identifier: event.target.value })
              }
              placeholder={
                invite.kind === "email"
                  ? "成员邮箱"
                  : "手机号，例如 +8613812345678"
              }
              required
              type={invite.kind === "email" ? "email" : "tel"}
              value={invite.identifier}
            />
            <input
              className={fieldClass}
              onChange={(event) =>
                setInvite({ ...invite, positionTitle: event.target.value })
              }
              placeholder="岗位（可选）"
              value={invite.positionTitle}
            />
            <select
              className={fieldClass}
              onChange={(event) =>
                setInvite({ ...invite, orgUnitId: event.target.value })
              }
              value={invite.orgUnitId}
            >
              <option value="">暂不分配组织单元</option>
              {overview.units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
            <select
              aria-label="初始访问角色"
              className={fieldClass}
              onChange={(event) =>
                setInvite({ ...invite, roleId: event.target.value })
              }
              required
              value={invite.roleId}
            >
              <option value="">选择初始访问角色</option>
              {overview.roles
                .filter((role) => role.kind !== "owner")
                .map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
            </select>
            <Button
              disabled={inviteMember.isPending}
              size="compact"
              type="submit"
            >
              <UserRound size={15} />
              加入白名单并发送
            </Button>
          </form>
        </details>
        <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
          只有这里加入白名单的邮箱或手机号才能激活账号。一次性链接不会在管理端显示；邮件或短信服务未配置时会明确报错，避免伪造“已发送”。
        </p>
        {deliveryFeedback ? (
          <div className="organization-delivery-feedback" role="status">
            <strong>投递已提交</strong>
            <small>
              已将成员加入
              {deliveryFeedback.kind === "email" ? "邮箱" : "手机号"}
              白名单，并向该渠道发送一次性加入链接；链接将于
              {new Date(deliveryFeedback.expiresAt).toLocaleString("zh-CN")}
              失效。管理端不显示任何令牌。
            </small>
          </div>
        ) : null}
      </section>
      <ErrorMessage
        error={
          createUnit.error ??
          createIdentity.error ??
          inviteMember.error ??
          identityRequests.error ??
          reviewIdentityRequest.error
        }
      />
    </aside>
  );
}

export function OrganizationPage({ me }: { me: Me }) {
  const organization = useQuery({
    queryKey: ["organization"],
    queryFn: () => api<OrganizationOverview>("/api/organization"),
  });
  const projects = useQuery({
    queryKey: ["organization-projects"],
    queryFn: () => api<{ items: ProjectChoice[] }>("/api/projects"),
    enabled: Boolean(organization.data),
  });
  const [tab, setTab] = useState<OrganizationTab>("tree");
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const overview = organization.data;
  const selectedUnit =
    overview?.units.find((unit) => unit.id === selectedUnitId) ?? null;
  const selectedMember =
    overview?.members.find(
      (member) => member.membership.id === selectedMemberId,
    ) ?? null;
  const visibleMembers = useMemo(
    () =>
      selectedUnitId && tab === "tree"
        ? (overview?.members.filter(
            (member) => member.membership.orgUnitId === selectedUnitId,
          ) ?? [])
        : (overview?.members ?? []),
    [overview?.members, selectedUnitId, tab],
  );
  const selectedInspector = selectedMember ? (
    <MemberInspector
      currentMembershipId={me.user.membershipId}
      key={`${selectedMember.membership.id}-${selectedMember.membership.status}`}
      member={selectedMember}
      onClose={() => setSelectedMemberId(null)}
      overview={overview!}
      projects={projects.data?.items ?? []}
    />
  ) : selectedUnit ? (
    <UnitInspector
      key={`${selectedUnit.id}-${selectedUnit.version}`}
      onClose={() => setSelectedUnitId(null)}
      overview={overview!}
      unit={selectedUnit}
    />
  ) : null;

  return (
    <>
      <PageHeader
        title="组织与人员"
        description="角色、岗位与专业身份分层维护：角色决定权限，岗位描述组织职责，身份服务业务协作；三者不会互相越权。"
        actions={
          <div
            className="organization-view-switch"
            role="tablist"
            aria-label="组织视图"
          >
            {(
              [
                ["tree", "组织树", FolderTree],
                ["members", "成员", UsersRound],
                ["layers", "分层说明", Layers3],
              ] as const
            ).map(([value, label, Icon]) => (
              <Button
                aria-selected={tab === value}
                key={value}
                onClick={() => setTab(value)}
                role="tab"
                size="compact"
                variant={tab === value ? "primary" : "secondary"}
              >
                <Icon size={14} />
                {label}
              </Button>
            ))}
          </div>
        }
      />
      {organization.isPending ? (
        <Card>
          <LoadingBlock />
        </Card>
      ) : overview ? (
        <div
          className={cn(
            "organization-workbench",
            selectedInspector && "has-inspector",
          )}
        >
          <div className="organization-layer-index">
            <span>01</span>
            <span>组织结构</span>
            <span>02</span>
            <span>成员与岗位</span>
            <span>03</span>
            <span>角色与身份</span>
          </div>
          <main className="organization-main-panel">
            {tab === "tree" ? (
              <>
                <div className="organization-panel-toolbar">
                  <div>
                    <p className="app-section-label">组织树</p>
                    <h2>让汇报结构保持清晰，而不是把权限塞进组织图。</h2>
                  </div>
                  <span className="organization-live-count">
                    <span />
                    {overview.units.length} 个组织单元 ·{" "}
                    {overview.members.length} 位成员
                  </span>
                </div>
                <UnitTree
                  members={overview.members}
                  onSelect={(unitId) => {
                    setSelectedUnitId(unitId);
                    setSelectedMemberId(null);
                  }}
                  selectedUnitId={selectedUnitId}
                  units={overview.units}
                />
                <section className="organization-member-strip">
                  <div className="organization-member-strip-head">
                    <div>
                      <p className="app-section-label">当前单元成员</p>
                      <h3>{selectedUnit?.name || "全部成员"}</h3>
                    </div>
                    <span>{visibleMembers.length} 位</span>
                  </div>
                  {visibleMembers.length ? (
                    <div className="organization-member-mini-grid">
                      {visibleMembers.map((member) => (
                        <button
                          className="organization-member-mini"
                          key={member.membership.id}
                          onClick={() => {
                            setSelectedMemberId(member.membership.id);
                          }}
                          type="button"
                        >
                          <span className="organization-member-avatar">
                            {initials(member.user.displayName)}
                          </span>
                          <span className="min-w-0 flex-1 text-left">
                            <strong className="block truncate">
                              {member.user.displayName}
                            </strong>
                            <small>
                              {member.positionTitle || "未设置岗位"}
                            </small>
                          </span>
                          <ChevronRight size={15} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="organization-no-members">
                      此组织单元还没有成员，可以从右侧邀请成员，或在成员详情中调整归属。
                    </p>
                  )}
                </section>
              </>
            ) : null}
            {tab === "members" ? (
              <>
                <div className="organization-panel-toolbar">
                  <div>
                    <p className="app-section-label">成员总览</p>
                    <h2>每个人的三类属性在同一行对齐展示。</h2>
                  </div>
                  <span className="organization-live-count">
                    <span />
                    {overview.members.length} 位成员
                  </span>
                </div>
                <div className="organization-members-table">
                  <div className="organization-member-table-head">
                    <span>成员</span>
                    <span>访问角色</span>
                    <span>组织岗位</span>
                    <span>专业身份</span>
                    <span>状态</span>
                  </div>
                  {overview.members.map((member) => (
                    <button
                      className={cn(
                        "organization-member-row",
                        selectedMember?.membership.id ===
                          member.membership.id && "is-selected",
                      )}
                      key={member.membership.id}
                      onClick={() => {
                        setSelectedMemberId(member.membership.id);
                        setSelectedUnitId(null);
                      }}
                      type="button"
                    >
                      <span className="organization-member-person">
                        <span className="organization-member-avatar">
                          {initials(member.user.displayName)}
                        </span>
                        <span className="min-w-0">
                          <strong className="block truncate">
                            {member.user.displayName}
                          </strong>
                          <small>
                            {member.isOwner
                              ? "唯一 Owner"
                              : member.unitName || "未归属单元"}
                          </small>
                        </span>
                      </span>
                      <MemberLayerSummary
                        member={member}
                        projects={projects.data?.items ?? []}
                        units={overview.units}
                      />
                      <Badge tone={memberStatusTone(member.membership.status)}>
                        {memberStatusLabel(member.membership.status)}
                      </Badge>
                      <ChevronRight
                        className="organization-row-arrow"
                        size={16}
                      />
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            {tab === "layers" ? (
              <>
                <div className="organization-panel-toolbar">
                  <div>
                    <p className="app-section-label">三层边界</p>
                    <h2>
                      同一位成员可以有三种不同的业务描述，但每种描述只有一个职责。
                    </h2>
                  </div>
                </div>
                <div className="organization-layer-board">
                  <article className="organization-layer-card is-role">
                    <span className="organization-layer-card-icon">
                      <ShieldCheck size={22} />
                    </span>
                    <p className="app-section-label">Layer 01</p>
                    <h3>访问角色</h3>
                    <p>
                      决定“能做什么”与“对哪些事实生效”。角色通过范围授权，不由岗位或专业标签隐式推断。
                    </p>
                    <div>
                      {overview.roles.map((role) => (
                        <span key={role.id}>
                          {role.name}
                          <small>
                            {role.kind === "owner"
                              ? "唯一组织所有者"
                              : role.description || "可按范围授权"}
                          </small>
                        </span>
                      ))}
                    </div>
                  </article>
                  <article className="organization-layer-card is-position">
                    <span className="organization-layer-card-icon">
                      <BriefcaseBusiness size={22} />
                    </span>
                    <p className="app-section-label">Layer 02</p>
                    <h3>组织岗位</h3>
                    <p>
                      描述成员在组织中的职责、隶属关系与汇报结构；修改岗位不应自动改变任何权限。
                    </p>
                    <div>
                      {overview.units.map((unit) => (
                        <span key={unit.id}>
                          {unit.name}
                          <small>
                            {
                              overview.members.filter(
                                (member) =>
                                  member.membership.orgUnitId === unit.id,
                              ).length
                            }{" "}
                            位成员
                          </small>
                        </span>
                      ))}
                    </div>
                  </article>
                  <article className="organization-layer-card is-identity">
                    <span className="organization-layer-card-icon">
                      <Sparkles size={22} />
                    </span>
                    <p className="app-section-label">Layer 03</p>
                    <h3>专业身份</h3>
                    <p>
                      用于工作类型、协作匹配和分析标签；它不会打开审批、薪资或成员数据权限。
                    </p>
                    <div>
                      {overview.professionalIdentities.map((identity) => (
                        <span key={identity.id}>
                          {identity.name}
                          <small>{identity.description || "业务标签"}</small>
                        </span>
                      ))}
                    </div>
                  </article>
                </div>
                <section className="organization-provenance-note">
                  <ShieldCheck size={18} />
                  <p>
                    <strong>权限数据边界：</strong>
                    组织页仅返回有“成员管理”权限的组织范围数据。每次成员角色、身份、单元或状态变更都会在服务端执行组织归属校验并写入审计日志。
                  </p>
                </section>
              </>
            ) : null}
          </main>
          <OrganizationSidebar
            onSelectMember={(member) =>
              setSelectedMemberId(member?.membership.id ?? null)
            }
            onSelectUnit={(unit) => setSelectedUnitId(unit?.id ?? null)}
            overview={overview}
            selectedUnit={selectedUnit}
          />
          {selectedInspector}
        </div>
      ) : null}
      <ErrorMessage error={organization.error ?? projects.error} />
    </>
  );
}
