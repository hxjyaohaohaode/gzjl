import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { Button, Card, CardContent } from "@workbench/ui";
import { api } from "./api.js";
import { ErrorMessage, EvidencePanel, ReadOnlyEvidenceList } from "./pages.js";
import { HistoricalRangePicker, type HistoricalRange } from "./history-range.js";
import { toZonedInputValue } from "./timezone.js";

interface Claim {
  id: string; title: string; description: string; expenseDate: string; amount: string; currency: string;
  status: "draft" | "pending" | "approved" | "rejected" | "cancelled";
  version: number; membershipId: string; memberName: string; reviewNote: string | null; payPeriodId: string | null;
  periodName?: string | null; periodStatus?: string | null;
}
interface ClaimsResponse {
  items: Claim[]; periods: Array<{ id: string; name: string }>; canReview: boolean; membershipId: string;
  nextCursor?: string | null; range?: { from: string; to: string; timezone: string };
}
const statusLabel = { draft: "草稿", pending: "待审批", approved: "已批准 · 待按周期结算", rejected: "已驳回", cancelled: "已撤回" };
const field = "reimbursement-input";
const amountLabel = (claim: Claim) => new Intl.NumberFormat("zh-CN", { style: "currency", currency: claim.currency }).format(Number(claim.amount));

export function ReimbursementPanel({ reviewOnly = false }: { reviewOnly?: boolean }) {
  const client = useQueryClient();
  const location = useLocation(), navigate = useNavigate();
  const hashId = /^#reimbursement-([a-f0-9-]{36})$/i.exec(location.hash)?.[1] ?? null;
  const [history, setHistory] = useState<HistoricalRange | null>(null);
  const locatedId = hashId;
  const params = new URLSearchParams();
  if (reviewOnly) params.set("pendingOnly", "true");
  else if (locatedId) params.set("id", locatedId);
  else if (history) { params.set("from", toZonedInputValue(history.from).slice(0, 10)); params.set("to", toZonedInputValue(history.to).slice(0, 10)); }
  const query = params.toString();
  const claims = useInfiniteQuery({ queryKey: ["reimbursements", query], initialPageParam: "", queryFn: ({ pageParam, signal }) => {
    const requestParams = new URLSearchParams(query); if (pageParam) requestParams.set("before", pageParam);
    return api<ClaimsResponse>(`/api/reimbursements${requestParams.size ? `?${requestParams}` : ""}`, { signal });
  }, getNextPageParam: (page) => page.nextCursor ?? undefined });
  const data = claims.data?.pages[0];
  const [creating, setCreating] = useState(false);
  const [expandedSelection, setExpandedSelection] = useState({ hashId, id: hashId });
  const expanded = expandedSelection.hashId === hashId ? expandedSelection.id : hashId;
  const setExpanded = (id: string | null) => setExpandedSelection({ hashId, id });
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
    onSuccess: async ({ request }) => { setCreating(false); setExpanded(request.id); navigate(`${location.pathname}${location.search}#reimbursement-${request.id}`, { replace: true }); setForm({ title: "", description: "", expenseDate: "", amount: "", currency: "CNY" }); await refresh(); } });
  const action = useMutation({ mutationFn: ({ claim, action }: { claim: Claim; action: "submit" | "cancel" | "approve" | "reject" }) =>
    api(`/api/reimbursements/${claim.id}/actions`, { method: "POST", body: { action, expectedVersion: claim.version,
      ...(reviews[claim.id]?.note ? { note: reviews[claim.id]!.note } : {}),
      ...(reviews[claim.id]?.payPeriodId ? { payPeriodId: reviews[claim.id]!.payPeriodId } : {}) } }), onSuccess: refresh });
  if (reviewOnly && data && !data.canReview) return null;
  const items = (claims.data?.pages.flatMap((page) => page.items) ?? []).filter((claim) => !reviewOnly || claim.status === "pending");
  const chooseHistory = (range: HistoricalRange | null) => { setHistory(range); setExpanded(null); if (hashId) navigate(`${location.pathname}${location.search}`, { replace: true }); };
  return <Card className="reimbursement-panel">
    <CardContent>
      <div className="reimbursement-heading"><div><h2>{reviewOnly ? "报销审批" : "报销申请与进度"}</h2>
        <p>凭证核验后提交，由其他有薪资结算权限的人员审批，通过后计入选定周期的薪资调整。</p></div>
        {!reviewOnly && <Button aria-expanded={creating} disabled={create.isPending} onClick={() => setCreating(!creating)} variant="secondary" type="button">{creating ? "收起申请" : "申请报销"}</Button>}
      </div>
      {!reviewOnly && <>
        <p className="lifecycle-caption">{locatedId ? "当前定位指定报销单，可切换日期查看其他记录。" : `当前报销范围：${history ? toZonedInputValue(history.from).slice(0, 10) : data?.range?.from ?? toZonedInputValue(new Date()).slice(0, 7)} 至 ${history ? toZonedInputValue(history.to).slice(0, 10) : data?.range?.to ?? "下月月初"}（结束不含）。`}
          已批准报销按归属薪资周期的开始月份展示，未批准申请按费用日期展示；历史批准金额不会自动移入下个月。</p>
        <details className="reimbursement-history"><summary>选择报销历史月份或日期范围</summary><HistoricalRangePicker onChange={chooseHistory} description="只改变报销列表的查看范围，不会更改批准归属或已确认的导出文件。" /></details>
        {locatedId && <Button variant="ghost" onClick={() => chooseHistory(null)}>返回本月报销</Button>}
      </>}
      {reviewOnly && <p className="lifecycle-caption">待审批队列包含历月尚未处理的申请，已批准记录不进入待办。</p>}
      {creating && <form onSubmit={(event) => { event.preventDefault(); if (!create.isPending) create.mutate(); }}><fieldset disabled={create.isPending} className="reimbursement-form" style={{ minWidth: 0 }}>
        <label>报销事项<input className={field} required minLength={2} maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <label>发生日期<input className={field} required type="date" value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} /></label>
        <label>报销金额<input className={field} required type="number" min="0.000001" step="0.000001" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
        <label>币种<select className={field} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>{["CNY", "USD", "EUR", "HKD"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="reimbursement-wide">用途说明<textarea className={field} required minLength={2} maxLength={4000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <Button disabled={create.isPending} type="submit">{create.isPending ? "正在保存…" : "保存草稿并添加凭证"}</Button>
      </fieldset></form>}
      {(create.error || action.error) && <p role="alert" className="reimbursement-error">{(create.error || action.error)?.message}</p>}
      <ErrorMessage error={claims.error} onRetry={() => void claims.refetch()} retrying={claims.isFetching} />
      {claims.isPending ? <p role="status">正在读取报销记录…</p> : !claims.isError && !items.length ? <p className="reimbursement-empty">{reviewOnly ? "暂无待审批报销。" : "暂无报销申请，可先填写事项，再上传发票或添加凭证链接。"}</p> : null}
      <div className="reimbursement-list">{items.map((claim) => {
        const own = claim.membershipId === data?.membershipId;
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
            {!own && data?.canReview && claim.status === "pending" && <fieldset disabled={action.isPending} className="reimbursement-form" style={{ minWidth: 0 }}>
              <label>计入薪资周期<select className={field} value={review.payPeriodId} onChange={(e) => setReviews({ ...reviews, [claim.id]: { ...review, payPeriodId: e.target.value } })}><option value="">请选择开放周期</option>{data.periods.map((period) => <option key={period.id} value={period.id}>{period.name}</option>)}</select></label>
              <label>审批说明<input className={field} placeholder="驳回时必填" maxLength={2000} value={review.note} onChange={(e) => setReviews({ ...reviews, [claim.id]: { ...review, note: e.target.value } })} /></label>
              <div className="reimbursement-actions"><Button disabled={action.isPending || !review.payPeriodId} onClick={() => action.mutate({ claim, action: "approve" })}>批准并计入薪资</Button><Button variant="secondary" disabled={action.isPending || !review.note.trim()} onClick={() => action.mutate({ claim, action: "reject" })}>驳回申请</Button></div>
              {!data.periods.length && <p>暂无开放周期，请先在薪资管理创建周期或取消未结算的计算批次。</p>}
            </fieldset>}
          </div>}
        </article>;
      })}</div>
      {claims.hasNextPage && <Button variant="secondary" disabled={claims.isFetchingNextPage} onClick={() => void claims.fetchNextPage()}>{claims.isFetchingNextPage ? "读取中…" : "加载更多报销"}</Button>}
      {!reviewOnly && !claims.isPending && !claims.isError && !items.length && <p className="lifecycle-caption">本范围暂无记录。以前月份的申请可通过上方历史日期入口查看。</p>}
    </CardContent>
  </Card>;
}
