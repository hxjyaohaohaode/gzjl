import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { Card, CardContent } from "@workbench/ui";
import { api, hasGrant, hasOrganizationGrant, type Me } from "./api.js";
import { ErrorMessage, PageHeader } from "./workspace-primitives.js";

import { PayrollHandoffPanel } from "./lifecycle-workbench.js";
import { ReimbursementPanel } from "./reimbursement-panel.js";
import { WorkPolicyPanel } from "./submission-policy.js";
import { ApprovalNavigation, WorkspaceNavigation } from "./workspace-navigation.js";

export function AccessUnavailable() {
  return <Card><CardContent><h1 className="text-xl font-bold">暂无此页面的访问权限</h1>
    <p className="my-3 text-sm text-[var(--text-muted)]">请联系组织管理员确认你的授权范围。</p>
    <Link to="/">返回工作台</Link>
  </CardContent></Card>;
}

export function PersonalPayrollWorkspace({ me }: { me: Me }) {
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  const handoff = search.get("handoff");
  if (location.hash.startsWith("#reimbursement-")) return <Navigate replace to={`/reimbursements${location.hash}`} />;
  if (handoff) return <Navigate replace to={`/payroll-management/runs/${encodeURIComponent(handoff)}`} />;
  if (!hasGrant(me, "payroll.view_own")) return <AccessUnavailable />;
  if (location.pathname === "/payroll" && search.has("source")) {
    search.delete("view");
    return <Navigate replace to={`/payroll/history?${search}${location.hash}`} />;
  }
  return <>
    <PageHeader title="我的薪资" actions={<Link className="workspace-text-link" to="/reimbursements">我的报销 →</Link>} />
    <WorkspaceNavigation label="个人薪资导航" items={[
      { to: "/payroll", label: "本月薪资" },
      { to: "/payroll/history", label: "历史工资单" },
    ]} />
    <Outlet />
  </>;
}

export function PayrollManagementWorkspace({ me }: { me: Me }) {
  const { pathname } = useLocation();
  const handoff = pathname.startsWith("/payroll-management/runs/");
  const canConfigure = hasOrganizationGrant(me, "payroll.configure");
  if (!(handoff ? hasOrganizationGrant(me, "payroll.settle") : canConfigure)) return <AccessUnavailable />;
  return <>
    <PageHeader title="薪资管理" />
    {canConfigure && <WorkspaceNavigation label="薪资管理导航" items={[
      { to: "/payroll-management", label: "薪资总览" },
      { to: "/payroll-management/plans", label: "成员方案" },
      { to: "/payroll-management/periods", label: "周期结算" },
      { to: "/payroll-management/settings", label: "结算设置" },
    ]} />}
    <Outlet />
  </>;
}

export function PayrollHandoffPage({ me }: { me: Me }) {
  const { runId } = useParams();
  const { search } = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const calculate = useMutation({
    mutationFn: (periodId: string) => api<{ run: { id: string } }>(`/api/pay-periods/${periodId}/calculate`, { method: "POST" }),
    onSuccess: async ({ run }) => {
      await Promise.all([client.invalidateQueries({ queryKey: ["payroll-management"] }), client.invalidateQueries({ queryKey: ["payroll-me"] })]);
      navigate(`/payroll-management/runs/${run.id}${search}`, { replace: true });
    },
  });
  const canConfigure = hasOrganizationGrant(me, "payroll.configure");
  const back = canConfigure ? `/payroll-management/periods${search}` : "/approvals/reimbursements";
  return <>
    <Link className="workspace-text-link mb-4 inline-flex" to={back}>← {canConfigure ? "返回周期结算" : "返回报销审批"}</Link>
    <ErrorMessage error={calculate.error} />
    {runId && <PayrollHandoffPanel key={runId} runId={runId} onClose={() => navigate(back)}
      onRecalculate={(id) => { if (!calculate.isPending) calculate.mutate(id); }}
      recalculating={calculate.isPending} canConfigure={hasOrganizationGrant(me, "payroll.configure")}
      canExportWork={hasOrganizationGrant(me, "work.view_full_scope")} />}
  </>;
}

export function ReimbursementsPage({ me, reviewOnly = false, reviewHistory = false }: { me: Me; reviewOnly?: boolean; reviewHistory?: boolean }) {
  if (!(reviewOnly ? hasOrganizationGrant(me, "payroll.settle") : hasGrant(me, "payroll.view_own"))) return <AccessUnavailable />;
  return <>
    <PageHeader title={reviewOnly ? "审批" : "我的报销"}
      actions={!reviewOnly ? <Link className="workspace-text-link" to="/payroll">查看我的薪资 →</Link> : undefined} />
    {reviewOnly && <ApprovalNavigation me={me} />}
    {reviewOnly && <WorkspaceNavigation label="报销审批范围" items={[
      { to: "/approvals/reimbursements", label: "待审批" },
      { to: "/approvals/reimbursements/history", label: "审批记录" },
    ]} />}
    <ReimbursementPanel key={reviewHistory ? "review-history" : reviewOnly ? "review" : "own"} reviewOnly={reviewOnly} reviewHistory={reviewHistory} />
  </>;
}

export function WorkPolicyPage({ me }: { me: Me }) {
  if (!me.user.isOwner) return <AccessUnavailable />;
  return <>
    <PageHeader title="工时提交规则" />
    <p className="workspace-page-description">统一管理工时补录范围和每月提交期限。</p>
    <WorkPolicyPanel editable />
  </>;
}
