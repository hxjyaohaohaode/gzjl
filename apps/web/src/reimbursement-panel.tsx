import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent } from "@workbench/ui";
import { api } from "./api.js";
import { EvidencePanel, ReadOnlyEvidenceList } from "./pages.js";

interface Claim {
  id: string; title: string; description: string; expenseDate: string; amount: string; currency: string;
  status: "draft" | "pending" | "approved" | "rejected" | "cancelled";
  version: number; membershipId: string; memberName: string; reviewNote: string | null; payPeriodId: string | null;
  periodName?: string | null; periodStatus?: string | null;
}
interface ClaimsResponse {
  items: Claim[]; periods: Array<{ id: string; name: string }>; canReview: boolean; membershipId: string;
}
const statusLabel = { draft: "草稿", pending: "待审批", approved: "已批准 · 待按周期结算", rejected: "已驳回", cancelled: "已撤回" };
const field = "reimbursement-input";
const amountLabel = (claim: Claim) => new Intl.NumberFormat("zh-CN", { style: "currency", currency: claim.currency }).format(Number(claim.amount));

export function ReimbursementPanel({ reviewOnly = false }: { reviewOnly?: boolean }) {
  const client = useQueryClient();
  const claims = useQuery({ queryKey: ["reimbursements"], queryFn: () => api<ClaimsResponse>("/api/reimbursements") });
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(() => window.location.hash.startsWith("#reimbursement-") ? window.location.hash.slice(15) : null);
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    if (!claims.data || !expanded || revealed.current === expanded || !window.location.hash.startsWith("#reimbursement-")) return;
    revealed.current = expanded;
    document.getElementById(`reimbursement-${expanded}`)?.scrollIntoView({ block: "start" });
  }, [claims.data, expanded]);
  const [form, setForm] = useState({ title: "", description: "", expenseDate: "", amount: "", currency: "CNY" });
  const [reviews, setReviews] = useState<Record<string, { note: string; payPeriodId: string }>>({});
  const refresh = async () => {
    await Promise.all([client.invalidateQueries({ queryKey: ["reimbursements"] }),
      client.invalidateQueries({ queryKey: ["payroll-me"] }), client.invalidateQueries({ queryKey: ["payroll-management"] })]);
  };
  const create = useMutation({ mutationFn: () => api<{ request: Claim }>("/api/reimbursements", { method: "POST", body: form }),
    onSuccess: async ({ request }) => { setCreating(false); setExpanded(request.id); setForm({ title: "", description: "", expenseDate: "", amount: "", currency: "CNY" }); await refresh(); } });
  const action = useMutation({ mutationFn: ({ claim, action }: { claim: Claim; action: "submit" | "cancel" | "approve" | "reject" }) =>
    api(`/api/reimbursements/${claim.id}/actions`, { method: "POST", body: { action, expectedVersion: claim.version,
      ...(reviews[claim.id]?.note ? { note: reviews[claim.id]!.note } : {}),
      ...(reviews[claim.id]?.payPeriodId ? { payPeriodId: reviews[claim.id]!.payPeriodId } : {}) } }), onSuccess: refresh });
  if (reviewOnly && !claims.data?.canReview) return null;
  const items = (claims.data?.items ?? []).filter((claim) => !reviewOnly || claim.status === "pending");
  return <Card className="reimbursement-panel">
    <CardContent>
      <div className="reimbursement-heading"><div><h2>{reviewOnly ? "报销审批" : "报销申请与进度"}</h2>
        <p>凭证核验后提交，由其他有薪资结算权限的人员审批，通过后计入选定周期的薪资调整。</p></div>
        {!reviewOnly && <Button onClick={() => setCreating(!creating)} variant="secondary" type="button">{creating ? "收起申请" : "申请报销"}</Button>}
      </div>
      {creating && <form className="reimbursement-form" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
        <label>报销事项<input className={field} required minLength={2} maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <label>发生日期<input className={field} required type="date" value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} /></label>
        <label>报销金额<input className={field} required type="number" min="0.000001" step="0.000001" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
        <label>币种<select className={field} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>{["CNY", "USD", "EUR", "HKD"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="reimbursement-wide">用途说明<textarea className={field} required minLength={2} maxLength={4000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <Button disabled={create.isPending} type="submit">{create.isPending ? "正在保存…" : "保存草稿并添加凭证"}</Button>
      </form>}
      {(create.error || action.error || claims.error) && <p role="alert" className="reimbursement-error">{(create.error || action.error || claims.error)?.message}</p>}
      {claims.isPending ? <p role="status">正在读取报销记录…</p> : !items.length ? <p className="reimbursement-empty">{reviewOnly ? "暂无待审批报销。" : "暂无报销申请，可先填写事项，再上传发票或添加凭证链接。"}</p> : null}
      <div className="reimbursement-list">{items.map((claim) => {
        const own = claim.membershipId === claims.data?.membershipId;
        const review = reviews[claim.id] ?? { note: "", payPeriodId: "" };
        return <article key={claim.id} id={`reimbursement-${claim.id}`}>
          <button className="reimbursement-summary" type="button" aria-expanded={expanded === claim.id} onClick={() => setExpanded(expanded === claim.id ? null : claim.id)}>
            <span><strong>{claim.title}</strong><small>{claim.memberName} · {claim.expenseDate} · {claim.status === "approved" && ["locked", "settled"].includes(claim.periodStatus ?? "") ? "已结算" : statusLabel[claim.status]}{claim.periodName ? ` · ${claim.periodName}` : ""}</small></span><b>{amountLabel(claim)}</b>
          </button>
          {expanded === claim.id && <div className="reimbursement-detail">
            <p>{claim.description}</p>{claim.reviewNote && <p>审批说明：{claim.reviewNote}</p>}
            {own && claim.status === "draft" ? <EvidencePanel sessionId={claim.id} resource="reimbursements" defaultOpen /> : <ReadOnlyEvidenceList sessionId={claim.id} resource="reimbursements" />}
            {own && <div className="reimbursement-actions">
              {claim.status === "draft" && <Button disabled={action.isPending} onClick={() => action.mutate({ claim, action: "submit" })}>提交报销审批</Button>}
              {["draft", "pending"].includes(claim.status) && <Button variant="secondary" disabled={action.isPending} onClick={() => action.mutate({ claim, action: "cancel" })}>撤回申请</Button>}
            </div>}
            {!own && claims.data?.canReview && claim.status === "pending" && <div className="reimbursement-form">
              <label>计入薪资周期<select className={field} value={review.payPeriodId} onChange={(e) => setReviews({ ...reviews, [claim.id]: { ...review, payPeriodId: e.target.value } })}><option value="">请选择开放周期</option>{claims.data.periods.map((period) => <option key={period.id} value={period.id}>{period.name}</option>)}</select></label>
              <label>审批说明<input className={field} placeholder="驳回时必填" maxLength={2000} value={review.note} onChange={(e) => setReviews({ ...reviews, [claim.id]: { ...review, note: e.target.value } })} /></label>
              <div className="reimbursement-actions"><Button disabled={action.isPending || !review.payPeriodId} onClick={() => action.mutate({ claim, action: "approve" })}>批准并计入薪资</Button><Button variant="secondary" disabled={action.isPending || !review.note.trim()} onClick={() => action.mutate({ claim, action: "reject" })}>驳回申请</Button></div>
              {!claims.data.periods.length && <p>暂无开放周期，请先在薪资管理创建周期或取消未结算的计算批次。</p>}
            </div>}
          </div>}
        </article>;
      })}</div>
    </CardContent>
  </Card>;
}
