import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, CardContent, CardHeader } from "@workbench/ui";
import { api } from "./api.js";
import { WorkFactContext } from "./lifecycle-workbench.js";
import { workStateLabels } from "./work-states.js";
import { getOrganizationTimezone } from "./timezone.js";

interface FactRow { id: string; version: number; content: string; result: string; blockers: string; nextStep: string; startAt: string; endAt: string; displayName: string; approvalStatus: string; projectId: string | null; nodeId: string | null; nodeTitle: string | null; nodeProgress: string | null; nodeStatus: string | null }
export interface FactFilters { projectId: string; workTypeId: string; memberId: string; orgUnitId: string; approvalState: string; sourceType: string }
export function FactExplorer({ from, to, filters }: { from: Date; to: Date; filters: FactFilters }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reviewDraft, setReviewDraft] = useState<string | null>(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const records = useInfiniteQuery({ queryKey: ["analytics", "records", from.toISOString(), to.toISOString(), filters], initialPageParam: "", queryFn: ({ pageParam, signal }) => {
    const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), limit: "50" });
    for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
    if (pageParam) query.set("before", pageParam);
    return api<{ items: FactRow[]; nextCursor: string | null }>(`/api/analytics/records?${query}`, { signal });
  }, getNextPageParam: (page) => page.nextCursor ?? undefined });
  const review = useMutation({ mutationFn: () => api<{ draft: string }>(`/api/work-reviews/me?${new URLSearchParams({ from: from.toISOString(), to: to.toISOString() })}`), onSuccess: (response) => { setReviewDraft(response.draft); setReviewConfirmed(false); } });
  const exportReview = () => {
    const blob = new Blob([reviewDraft ?? ""], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `已校对工作回顾-${from.toISOString().slice(0, 10)}.txt`; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };
  const items = records.data?.pages.flatMap((p) => Array.isArray(p.items) ? p.items : []) ?? [];
  return <Card className="fact-explorer"><CardHeader><div><h2>从图表进入事实</h2><p className="lifecycle-caption">以下明细使用当前日期与筛选范围；点击图表改变筛选后，继续核对原始记录与项目。</p></div><Button variant="secondary" size="compact" disabled={review.isPending} onClick={() => review.mutate()}>生成本人可校对回顾</Button></CardHeader><CardContent>
    {records.isPending ? <p role="status">正在读取授权记录…</p> : null}
    {records.error ? <p role="alert">{records.error.message}<Button onClick={() => void records.refetch()} variant="ghost">重试</Button></p> : null}
    {!records.isPending && !records.error && !items.length ? <p>当前范围暂无事实记录。可以调整日期或清除筛选。</p> : null}
    <div className="fact-explorer-list">{items.map((r) => <article key={r.id}><div className="fact-explorer-heading"><strong>{r.displayName}</strong><Badge>{workStateLabels[r.approvalStatus]}</Badge><small>v{r.version}</small></div><p className="fact-explorer-content">{r.content}</p><p className="lifecycle-caption">{new Date(r.startAt).toLocaleString("zh-CN", { timeZone: getOrganizationTimezone() })} · {r.nodeTitle ?? "未关联节点"}{r.nodeProgress !== null ? ` · 节点当前进度 ${r.nodeProgress}%` : ""}</p>{r.blockers ? <p className="lifecycle-warning">阻塞：{r.blockers}</p> : null}{r.nextStep ? <p>待行动：{r.nextStep}</p> : null}<div className="fact-project-links"><Button size="compact" variant="ghost" onClick={() => setExpanded((current) => current === r.id ? null : r.id)} aria-expanded={expanded === r.id}>{expanded === r.id ? "收起核对" : "核对时段、证据条件与历史"}</Button><Link to={`/work?record=${r.id}&version=${r.version}`}>完整事实与证据</Link>{r.projectId ? <Link to={`/projects/${r.projectId}?node=${r.nodeId ?? ""}`}>节点变更与项目行动</Link> : null}</div>{expanded === r.id ? <WorkFactContext id={r.id} expectedVersion={String(r.version)} /> : null}</article>)}</div>
    {records.hasNextPage ? <Button variant="secondary" disabled={records.isFetchingNextPage} onClick={() => void records.fetchNextPage()}>{records.isFetchingNextPage ? "读取中…" : "加载更多事实"}</Button> : null}
    <p className="lifecycle-caption">已加载 {items.length} 条。单条展示完整时段；图表金额和工时按所选范围裁切，不能直接用跨边界记录的完整时长相加。</p>
    {review.error ? <p role="alert">{review.error.message}</p> : null}
    {reviewDraft !== null ? <section className="review-draft"><h3>本人工作回顾 · 待校对草稿</h3><p>使用所选日期内的全部本人事实记录，保留版本与来源。此回顾不受团队筛选影响，确认前不会发布或修改记录。</p><textarea aria-label="校对工作回顾" value={reviewDraft} onChange={(e) => { setReviewDraft(e.target.value); setReviewConfirmed(false); }} /><label><input type="checkbox" checked={reviewConfirmed} onChange={(e) => setReviewConfirmed(e.target.checked)} />我已核对记录、结果、状态和来源</label><Button disabled={!reviewConfirmed} onClick={exportReview}>保存已校对回顾</Button><Button variant="ghost" onClick={() => setReviewDraft(null)}>关闭草稿</Button></section> : null}
  </CardContent></Card>;
}

export function RecordReadiness({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  return <details className="record-readiness" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}><summary>这条记录能否顺利审批 · 核对原因与修复入口</summary>{open ? <WorkFactContext id={id} /> : null}</details>;
}
