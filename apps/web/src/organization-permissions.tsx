import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@workbench/ui";
import { api } from "./api.js";
import { ErrorMessage, LoadingBlock } from "./workspace-primitives.js";
import { OrbitExplorer, type OrbitGroup } from "./reference-charts.js";

interface PermissionMember { membership: { id: string; status: string }; user: { displayName: string }; accessRoles: Array<{ roleId: string; roleName: string; scopeKind: string; scopeId: string | null; expiresAt: string | null }> }
interface PermissionRole { id: string; name: string; description: string | null }
interface PermissionBinding { roleId: string; permission: string; description: string }
const questions = [["谁能审核工时？", "work.review"], ["谁能配置薪资？", "payroll.configure"], ["谁能管理成员？", "members.manage"], ["哪些角色未分配？", "unused"]] as const;
const scopeLabels: Record<string, string> = { organization: "全组织范围", self: "本人范围", project: "指定项目范围", org_unit: "指定组织单元范围" };
const permissionLabels: Record<string, string> = { "org.manage": "管理组织", "members.manage": "管理成员", "roles.manage": "管理访问角色", "project.create": "创建项目", "project.manage": "管理项目", "project.view_all": "查看全部项目", "work.view_own": "查看本人工时", "work.view_project_public": "查看项目公开动态", "work.view_full_scope": "查看授权范围内的完整工作", "work.review": "审核工时", "evidence.view_management": "查看审核证据", "payroll.view_own": "查看本人薪资", "payroll.view_scope": "查看授权范围的薪资", "payroll.configure": "配置薪资", "payroll.settle": "结算薪资", "analytics.view_team": "查看团队分析", "ai.team_analysis": "使用团队 AI 分析", "audit.view": "查看审计记录", "import.scope": "导入授权范围的数据", "export.scope": "导出授权范围的数据" };
const permissionName = (definition: PermissionBinding) => definition.description === definition.permission ? permissionLabels[definition.permission] ?? definition.permission : definition.description;
export function OrganizationPermissions({ members, roles, onMember }: { members: PermissionMember[]; roles: PermissionRole[]; onMember: (id: string) => void }) {
  const data = useQuery({ queryKey: ["organization", "permission-overview"], queryFn: () => api<{ organizationId: string; bindings: PermissionBinding[] }>("/api/organization/permission-overview") });
  const [question, setQuestion] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [selectedPermission, setSelectedPermission] = useState<string | null>(null);
  const bindings = data.data?.bindings ?? [];
  const validGrants = (member: PermissionMember) => member.membership.status === "active" ? member.accessRoles.filter((grant) => !grant.expiresAt || Date.parse(grant.expiresAt) > Date.now()) : [];
  const definitions = [...new Map(bindings.map((binding) => [binding.permission, binding])).values()];
  const held = new Set(members.flatMap((member) => validGrants(member).map((grant) => grant.roleId)));
  const groups: OrbitGroup[] = [
    { id: "members", label: "成员", count: members.length, ratio: members.filter((member) => validGrants(member).length).length / Math.max(1, members.length), items: members.map((member) => ({ id: member.membership.id, label: member.user.displayName, sub: `${member.membership.status === "active" ? "已激活" : "尚未激活或已停用"} · ${validGrants(member).map((grant) => grant.roleName).join("、") || "未分配访问角色"}`, onSelect: () => onMember(member.membership.id) })) },
    { id: "roles", label: "访问角色", count: roles.length, ratio: held.size / Math.max(1, roles.length), items: roles.map((role) => ({ id: role.id, label: role.name, sub: `${members.filter((member) => validGrants(member).some((grant) => grant.roleId === role.id)).length} 位持有人 · ${bindings.filter((binding) => binding.roleId === role.id).length} 项权限`, onSelect: () => { setQuestion(role.name); setSubmitted(role.name); setSelectedPermission(null); } })) },
    { id: "permissions", label: "权限能力", count: definitions.length, ratio: 1, items: definitions.map((definition) => ({ id: definition.permission, label: permissionName(definition), sub: definition.permission, onSelect: () => { setSelectedPermission(definition.permission); setQuestion(permissionName(definition)); setSubmitted(permissionName(definition)); } })) },
  ];
  const answer = (() => {
    if (!submitted.trim()) return null;
    const preset = questions.find(([text]) => submitted === text)?.[1];
    if (preset === "unused" || /未分配|没人.*角色|闲置角色/.test(submitted)) return { title: "当前没有有效持有人的访问角色", rows: roles.filter((role) => !held.has(role.id)).map((role) => ({ id: role.id, label: role.name, detail: role.description ?? "暂无有效持有人", member: false })) };
    const permission = selectedPermission ?? preset ?? definitions.find((definition) => definition.permission === submitted.trim() || permissionName(definition) === submitted.trim())?.permission ?? (/(审核|审批).*工时|工时.*(审核|审批)/.test(submitted) ? "work.review" : /配置.*薪资|薪资.*配置/.test(submitted) ? "payroll.configure" : /管理.*成员|成员.*管理/.test(submitted) ? "members.manage" : null);
    if (permission) {
      const allowedRoleIds = new Set(bindings.filter((binding) => binding.permission === permission).map((binding) => binding.roleId));
      const definition = definitions.find((item) => item.permission === permission);
      return { title: `${definition ? permissionName(definition) : permissionLabels[permission] ?? permission} · 当前有效成员授权`, rows: members.filter((member) => member.membership.status === "active").flatMap((member) => {
        const grants = validGrants(member).filter((grant) => allowedRoleIds.has(grant.roleId));
        return grants.length ? [{ id: member.membership.id, label: member.user.displayName, detail: grants.map((grant) => `${grant.roleName} · ${scopeLabels[grant.scopeKind] ?? grant.scopeKind}${grant.scopeId && grant.scopeKind !== "self" ? ` (${grant.scopeId})` : ""}`).join("；"), member: true }] : [];
      }) };
    }
    const term = submitted.trim().toLowerCase();
    return { title: "按真实成员与角色匹配", rows: members.filter((member) => `${member.user.displayName} ${member.accessRoles.map((grant) => grant.roleName).join(" ")}`.toLowerCase().includes(term)).map((member) => ({ id: member.membership.id, label: member.user.displayName, detail: validGrants(member).map((grant) => `${grant.roleName} · ${scopeLabels[grant.scopeKind]}`).join("；") || "未分配有效访问角色", member: true })) };
  })();
  return <>{data.isPending ? <LoadingBlock /> : data.data && <OrbitExplorer title="权限全景" groups={groups} rootCount={members.reduce((sum, member) => sum + validGrants(member).length, 0)} help="刻度表示角色持有与成员分配占比 · 点节点逐层查看实际授权" placeholder="搜索成员、角色名、权限名称或权限代码" />}
    <ErrorMessage error={data.error} onRetry={() => void data.refetch()} retrying={data.isFetching} />
    <section className="fx-permission-answer" aria-label="真实权限查询"><h3>查看当前授权</h3><form className="fx-orbit-query" onSubmit={(event) => { event.preventDefault(); setSelectedPermission(null); setSubmitted(question); }}><input aria-label="权限问题" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="例如：谁能审核工时？或输入成员、角色名称" /><Button type="submit" size="compact" disabled={data.isPending || !question.trim()}>查询</Button></form>
      <div className="fx-ai-actions">{questions.map(([text]) => <button type="button" key={text} onClick={() => { setQuestion(text); setSubmitted(text); setSelectedPermission(null); }}>{text}</button>)}</div>
      {answer && <div aria-live="polite"><strong>{answer.title}</strong>{answer.rows.length ? <ul>{answer.rows.map((row) => <li key={row.id}>{row.member ? <button className="fx-back-link" type="button" onClick={() => onMember(row.id)}>{row.label} →</button> : <b>{row.label}</b>}<small>{row.detail}</small></li>)}</ul> : <p className="fx-chart-empty">没有匹配的授权或成员。</p>}</div>}
      <p className="fx-detail-meta">查询来自当前组织的实际角色权限，已停用成员和过期授权不会作为有效权限候选；具体资源仍按服务端归属与范围核验。</p>
    </section>
  </>;
}
