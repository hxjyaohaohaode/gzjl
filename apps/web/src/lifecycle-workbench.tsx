import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, CardContent, CardHeader } from "@workbench/ui";
import { addDecimalAmounts, formatMoney, roundMoney, sourceHref, type FactSource } from "@workbench/shared";
import { api } from "./api.js";
import { getOrganizationTimezone } from "./timezone.js";
import { workStateLabels } from "./work-states.js";
import { fetchExportFile, fetchExportResponse } from "./export-download.js";
import { hashEvidenceFile } from "./evidence-hash.js";

const dateLabel = (value: string) => new Intl.DateTimeFormat("zh-CN", { timeZone: getOrganizationTimezone(), dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
function QueryFailure({ error, retry }: { error: unknown; retry: () => void }) {
  return <div className="lifecycle-error" role="alert"><p>{error instanceof Error ? error.message : "暂时无法读取，请重试。"}</p><Button onClick={retry} variant="secondary" size="compact">重新读取</Button></div>;
}
export interface CycleOverviewData {
  period: { id: string | null; name: string; startsAt: string; endsAt: string; cutoffAt: string | null; timezone: string };
  counts: Record<string, number>;
  plans: Array<{ name: string; version: number; effectiveFrom: string; effectiveTo: string | null }>;
  activePlan: CycleOverviewData["plans"][number] | null;
  attention: Array<{ id: string; content: string; approvalStatus: string; version: number }>;
  attentionTruncated: boolean;
}
export function CycleOverview({ onboarding = false, compact = false }: { onboarding?: boolean; compact?: boolean }) {
  const query = useQuery({ queryKey: ["work-sessions", "cycle-overview"], queryFn: () => api<CycleOverviewData>("/api/work-lifecycle/me"), staleTime: 15_000 });
  return <Card className={`lifecycle-card${compact ? " lifecycle-card-compact" : ""}`}><CardHeader><h2>本结算周期 · 全部记录状态</h2></CardHeader><CardContent>
    {query.isPending ? <p role="status">正在核对本期记录…</p> : query.isError ? <QueryFailure error={query.error} retry={() => void query.refetch()} /> : query.data?.period && query.data.counts && Array.isArray(query.data.plans) ? <>
      <p className="lifecycle-caption">{query.data.period.name} · {dateLabel(query.data.period.startsAt)} 至 {dateLabel(query.data.period.endsAt)}（结束不含） · {query.data.period.timezone}</p>
      {query.data.period.cutoffAt ? <p className="lifecycle-caption">结算截止 / 计划导出：{dateLabel(query.data.period.cutoffAt)}；实际发薪由外部平台办理。</p> : <p className="lifecycle-warning">管理员尚未建立本期结算周期，以下统计按本月展示，请先确认正式结算范围。</p>}
      <div className="cycle-state-grid">{Object.entries(workStateLabels).map(([status, label]) => <Link key={status} to={`/work?status=${status}&from=${encodeURIComponent(query.data!.period.startsAt)}&to=${encodeURIComponent(query.data!.period.endsAt)}`}><span>{label}</span><strong>{query.data!.counts[status] ?? 0}<small> 条</small></strong></Link>)}</div>
      {onboarding ? <details className="onboarding-path" open={!query.data.activePlan}><summary>首次使用 · 从加入到形成薪资依据</summary><ol>
        <li><strong>确认计薪方案</strong>{query.data.activePlan ? <p>{query.data.activePlan.name} · v{query.data.activePlan.version}，{dateLabel(query.data.activePlan.effectiveFrom)} 起生效。<Link to="/payroll">查看本人计薪明细</Link></p> : <p className="lifecycle-warning">当前没有生效的计薪方案，请联系管理员完成配置。已保存的工时会保留，缺方案期间不能据此猜算薪资。</p>}{query.data.plans.filter((p) => new Date(p.effectiveFrom) > new Date()).slice(0, 3).map((p) => <p key={`${p.version}-${p.effectiveFrom}`}>待生效：{p.name} v{p.version} · {dateLabel(p.effectiveFrom)}</p>)}</li>
        <li><strong>记录实际工作</strong><p>计时或补录已完成时段，未来工作保存为计划。<Link to="/work">开始记录</Link></p></li>
        <li><strong>提交可核对证据</strong><p>图片、视频、文档等任意格式文件，或外部链接、文字纪要；文件须完成完整性核验并允许审核人查看。失败时可逐件重试，也可补充文字或链接。</p></li>
        <li><strong>提交组织授权审核人</strong><p>提交后进入审批单，退回时按明确原因修改；误提交可在处理前撤回。批准或锁定后使用更正申请，保留历史版本。</p></li>
        <li><strong>在结算截止前完成核对</strong><p>管理员确认周期、批准记录、身份映射和金额后形成导出依据。本平台保存记录和交接批次，实际付款在外部平台进行。</p></li>
      </ol></details> : null}
    </> : <QueryFailure error={new Error("结算状态响应不完整，请重新读取或稍后重试。")} retry={() => void query.refetch()} />}
  </CardContent></Card>;
}

export interface WorkFactContextData {
  submitter?: { membershipId: string; displayName: string; status: string };
  memberWorkState?: { counts: Record<string, number>; activeTimers: string[] };
  session: { id: string; version: number; content: string; result: string; blockers: string; nextStep: string; startAt: string; endAt: string; approvalStatus: string };
  evidenceSummary: { total: number; verified: number };
  reasons: string[];
  links: Array<{ projectId: string; nodeId: string; title: string; version: number; progress: string; status: string; reportedProgress: string | null }>;
  neighbors: Array<{ id: string; content: string; startAt: string; endAt: string; approvalStatus: string }>;
  history: Array<{ action: string; note: string | null; createdAt: string; entityVersion: string }>;
  versions: Array<{ version: number; snapshot: unknown; changeReason: string | null; createdAt: string }>;
}
export function WorkFactContext({ id, expectedVersion, children }: { id: string; expectedVersion?: string | null; children?: ReactNode }) {
  const query = useQuery({ queryKey: ["work-sessions", "fact-context", id], queryFn: () => api<WorkFactContextData>(`/api/work-facts/${id}`) });
  if (query.isPending) return <p className="lifecycle-caption" role="status">正在读取事实、相邻时段和审核历史…</p>;
  if (query.isError) return <QueryFailure error={query.error} retry={() => void query.refetch()} />;
  if (!query.data?.session || !query.data.evidenceSummary || !Array.isArray(query.data.links) || !Array.isArray(query.data.history) || !Array.isArray(query.data.neighbors) || !Array.isArray(query.data.reasons)) return <QueryFailure error={new Error("记录核对响应不完整，请重新读取；原有记录操作仍可使用。")} retry={() => void query.refetch()} />;
  const data = query.data;
  return <section className="work-fact-context" aria-label="记录核对与修复路径">
    {data.submitter ? <div className="review-member-state"><strong>提交人：{data.submitter.displayName}</strong><small>成员唯一编号：{data.submitter.membershipId} · {data.submitter.status === "active" ? "在组织中" : "成员状态：" + data.submitter.status}</small>{data.memberWorkState ? <><p>当前计时状态：{data.memberWorkState.activeTimers.length ? data.memberWorkState.activeTimers.map((t) => ({ running: "工作计时中", paused: "已暂停", on_break: "休息中" })[t]).join("、") : "无进行中的可见计时"}</p><p>记录所属月（当前权限可见）：{Object.entries(data.memberWorkState.counts).map(([state, count]) => `${workStateLabels[state] ?? state} ${count} 条`).join("；") || "无记录"}</p></> : null}</div> : null}
    <div className="flex flex-wrap gap-2"><Badge>{workStateLabels[data.session.approvalStatus] ?? data.session.approvalStatus}</Badge><Badge>当前 v{data.session.version}</Badge><Badge>已核验证据 {data.evidenceSummary.verified}/{data.evidenceSummary.total}</Badge></div>
    {expectedVersion && String(data.session.version) !== expectedVersion ? <p className="lifecycle-warning" role="alert">引用的是 v{expectedVersion}，当前已是 v{data.session.version}，请重新核对结论与记录历史。</p> : null}
    {data.reasons.length ? <ul className="readiness-reasons">{data.reasons.map((r) => <li key={r}>{r}</li>)}</ul> : <p className="lifecycle-caption">当前证据条件已满足。审核决定仍由授权审核人依据事实作出。</p>}
    <dl className="fact-description"><div><dt>工作内容</dt><dd>{data.session.content}</dd></div><div><dt>结果</dt><dd>{data.session.result || "尚未填写"}</dd></div><div><dt>阻塞</dt><dd>{data.session.blockers || "尚未填写"}</dd></div><div><dt>下一步 / 待决定事项</dt><dd>{data.session.nextStep || "尚未填写"}</dd></div></dl>
    {data.links.length ? <div className="fact-project-links">{data.links.map((n) => <Link key={n.nodeId} to={`/projects/${n.projectId}?node=${n.nodeId}`}>{n.title} · 当前 {n.progress}% · v{n.version}{n.reportedProgress !== null ? ` · 本条报告 ${n.reportedProgress}%` : ""}</Link>)}</div> : null}
    <details><summary>相邻与重叠时段（前后一天，最多 100 条）</summary><ul className="fact-neighbors">{data.neighbors.map((n) => <li key={n.id}><Link to={`/work?record=${n.id}`}>{n.content}</Link><p>{dateLabel(n.startAt)} – {dateLabel(n.endAt)} · {workStateLabels[n.approvalStatus]}</p>{new Date(n.startAt) < new Date(data.session.endAt) && new Date(n.endAt) > new Date(data.session.startAt) ? <Badge tone="warning">时段重叠，需核对实际有效工作时间</Badge> : null}</li>)}{!data.neighbors.length ? <li>当前范围内没有相邻时段。</li> : null}</ul></details>
    <details open={data.session.approvalStatus === "returned"}><summary>审核依据与历次退回原因</summary><ul className="fact-history">{data.history.map((h, i) => <li key={`${h.createdAt}-${i}`}><strong>{({ submitted: "提交审核", approved: "批准", returned: "退回修改", cancelled: "撤回", management_corrected: "管理更正", commented: "说明" } as Record<string, string>)[h.action] ?? h.action} · v{h.entityVersion}</strong><p>{h.note || "未附加说明"}</p><small>{dateLabel(h.createdAt)}</small></li>)}{!data.history.length ? <li>尚未产生审批历史。</li> : null}</ul></details>
    {children}
    <details><summary>版本事实快照（最多最近 100 版）</summary>{data.versions?.map((v) => <details key={v.version} open={String(v.version) === expectedVersion}><summary>v{v.version} · {dateLabel(v.createdAt)} · {v.changeReason ?? "记录变更"}</summary><pre>{JSON.stringify(v.snapshot, null, 2)}</pre></details>)}</details>
  </section>;
}

export function CitedText({ text, sources = [] }: { text: string; sources?: Array<FactSource & { stale?: boolean }> | undefined }) {
  const parts = text.split(/(\[source:[a-f0-9-]{36}\])/gi);
  return <>{parts.map((part, index) => {
    const id = /^\[source:([a-f0-9-]{36})\]$/i.exec(part)?.[1];
    if (!id) return <span key={index}>{part}</span>;
    const source = sources.find((s) => s.entityId.toLowerCase() === id.toLowerCase());
    if (!source) return <span className="citation-unresolved" key={index}>［来源待核对］</span>;
    const href = sourceHref(source);
    const label = `［${source.label}${source.entityVersion ? ` · v${source.entityVersion}` : ""}${source.stale ? " · 已变化" : ""}］`;
    return href ? <Link className="fact-citation" key={index} to={href}>{label}</Link> : <span className="fact-citation" key={index}>{label}</span>;
  })}</>;
}

export function AiFactAnswer({ reportId, text }: { reportId: string; text: string }) {
  const query = useQuery({ queryKey: ["ai-report-detail", reportId], queryFn: () => api<{ stale?: boolean; sources: Array<FactSource & { stale?: boolean }> }>(`/api/ai/reports/${reportId}`) });
  return <><CitedText text={text} sources={query.data?.sources} />{query.data?.stale ? <p className="lifecycle-warning">来源版本已变化，请重新生成并核对。</p> : null}{query.isError ? <p className="lifecycle-caption">来源暂时无法核对，请重试或打开报告查看。</p> : null}<Link className="fact-citation" to={`/ai?report=${reportId}`}>查看完整来源与报告</Link></>;
}

export function AiDraftEditor({ report }: { report: { title: string; summary: string; structuredOutput: { highlights?: string[]; risks?: string[]; suggestions?: string[] } } }) {
  const [draft, setDraft] = useState([report.title, report.summary, ...(report.structuredOutput.highlights ?? []), ...(report.structuredOutput.risks ?? []), ...(report.structuredOutput.suggestions ?? [])].join("\n\n"));
  const [confirmed, setConfirmed] = useState(false);
  const save = () => {
    const url = URL.createObjectURL(new Blob([draft], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "已校对工作回顾.txt"; anchor.click();
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };
  return <details className="review-draft"><summary>校对 AI 周报 / 说明草稿</summary><p>逐条核对状态、事实和来源；来源标记可保留在文字中供后续复查。任何文字修改都会取消确认。保存的是本人校对文件，不会自动提交审批或修改源记录。</p><textarea aria-label="校对 AI 草稿" value={draft} onChange={(e) => { setDraft(e.target.value); setConfirmed(false); }} /><label className="handoff-confirmation"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /><span>我已检查来源及当前版本，并确认这份草稿可用于后续工作沟通</span></label><Button disabled={!confirmed || !draft.trim()} onClick={save}>保存已校对 AI 草稿</Button></details>;
}

interface HandoffPreview {
  run: { status: string; calculationVersion: string; runNumber: number };
  period: { id: string; name: string; startsAt: string; endsAt: string; timezone: string; cutoffAt: string };
  rows: Array<{ membershipId: string; displayName: string; externalId: string; currency: string; approvedSeconds: number; pendingSeconds: number; finalAmount: string; amountChange: string | null; planVersionId: string; estimate: boolean; needsReview: boolean; amounts?: { wages: string; bonus: string; subsidies: string; reimbursements: string; other: string } }>;
  missingPlans: Array<{ id: string; displayName: string }>;
  pending: Array<{ id: string }>;
  drafts: Array<{ id: string }>;
  anomalies: Array<{ id: string }>;
  blockers: string[]; previewHash: string;
  batch: { id: string; fileName: string; sha256: string; ruleVersion: string; createdAt: string; manifest?: { workbookFileName?: string; workbookSha256?: string; workRowCount?: number; componentRowCount?: number; reimbursementRowCount?: number } } | null;
}
export function PayrollHandoffPanel({ runId, onClose, onRecalculate, canExportWork = true }: { runId: string; onClose: () => void; onRecalculate?: (id: string) => void; canExportWork?: boolean }) {
  const client = useQueryClient();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { panel.current?.scrollIntoView({ block: "start" }); panel.current?.focus({ preventScroll: true }); }, [runId]);
  const [confirmedHash, setConfirmedHash] = useState<string | null>(null);
  const [identities, setIdentities] = useState<Record<string, string>>({});
  const query = useQuery({ queryKey: ["payroll-management", "handoff", runId], queryFn: () => api<HandoffPreview>(`/api/payroll-runs/${runId}/handoff`) });
  const refresh = () => { setConfirmedHash(null); return client.invalidateQueries({ queryKey: ["payroll-management"] }); };
  const profile = useMutation({ mutationFn: (row: HandoffPreview["rows"][number]) => api(`/api/payroll/members/${row.membershipId}/external-identity`, { method: "PUT", body: { externalId: identities[row.membershipId] ?? row.externalId } }), onSuccess: refresh });
  const confirm = useMutation({ mutationFn: () => api(`/api/payroll-runs/${runId}/handoff`, { method: "POST", body: { previewHash: query.data!.previewHash, identityMatchingConfirmed: true, exceptionsAcknowledged: true } }), onSuccess: async () => { await refresh(); await client.invalidateQueries({ queryKey: ["payroll-me"] }); await client.invalidateQueries({ queryKey: ["work-sessions"] }); } });
  const report = useMutation({ mutationFn: async () => {
    const file = await fetchExportResponse(`/api/payroll-runs/${runId}/report.xlsx`, "xlsx", 120_000);
    if (!file.fileName || !file.sha256 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("服务未返回有效的文件名或校验信息，请重试。");
    if (await hashEvidenceFile(new File([file.blob], file.fileName)) !== file.sha256) throw new Error("下载文件校验失败，请重新下载。");
    const url = URL.createObjectURL(file.blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.fileName; anchor.click();
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  } });
  const download = useMutation({ mutationFn: async (format: "csv" | "xlsx") => {
    const batch = query.data?.batch;
    if (!batch) throw new Error("请先确认并保存交接批次。");
    const filename = format === "xlsx" ? batch.manifest?.workbookFileName : batch.fileName;
    const checksum = format === "xlsx" ? batch.manifest?.workbookSha256 : batch.sha256;
    if (!filename || !checksum) throw new Error("该历史批次未保存完整工作簿，请重取已有原 CSV。 ");
    const blob = await fetchExportFile(`/api/payroll-runs/${runId}/${format === "xlsx" ? "handoff.xlsx" : "finance-export.csv"}`, format);
    const file = new File([blob], filename);
    if (await hashEvidenceFile(file) !== checksum) throw new Error("文件校验与已保存批次不一致，未下载；请重新读取批次后重试。");
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click();
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  } });
  return <div ref={panel} tabIndex={-1} className="payroll-preview-anchor"><Card className="handoff-panel"><CardHeader><h2>薪资交接 · 预检与逐行预览</h2><Button variant="ghost" size="compact" onClick={onClose}>收起</Button></CardHeader><CardContent>
    {query.isPending ? <p role="status">正在核对整批数据…</p> : query.isError ? <QueryFailure error={query.error} retry={() => void query.refetch()} /> : query.data ? <>
      <p className="lifecycle-caption">{query.data.period.name} · {dateLabel(query.data.period.startsAt)} 至 {dateLabel(query.data.period.endsAt)}（不含） · {query.data.period.timezone}。本平台导出薪资依据，由外部平台实际发薪。</p>
      <p>完整 Excel 将包含薪资汇总、工资组成（工资 / 补贴 / 奖励 / 扣减）、报销明细、工作提交单、工作证据目录及规则来源；同时保留汇总 CSV 用于外部导入。</p>
      <h3 className="font-bold">老板核对：每人薪资总览 + 本周期工作明细</h3>
      <div className="flex flex-wrap gap-3">{canExportWork ? <Button disabled={report.isPending} onClick={() => report.mutate()}>{report.isPending ? "正在生成并校验 Excel…" : "下载薪资总览及工作明细 Excel"}</Button> : <p>完整工作明细导出需要组织全部工时查看权限。</p>}{!query.data.batch && onRecalculate ? <Button variant="secondary" disabled={report.isPending} onClick={() => onRecalculate(query.data!.period.id)}>更新计算并查看</Button> : null}</div>
      {!query.data.batch ? <p className="lifecycle-caption">可直接下载当前统计表，无须先锁定或配置外部人员编号。待审与待复核金额会标明；正式交接待处理事项见下方。源数据变化后请更新计算。</p> : null}
      {report.isSuccess ? <p role="status">Excel 校验通过，已发起下载。第一张为每人薪资总览，后附本周期工作提交单及各项明细。</p> : null}
      <p>缺方案 {query.data.missingPlans.length} 人 · 待审 {query.data.pending.length} 条 · 未提交/退回 {query.data.drafts.length} 条 · 异常 {query.data.anomalies.length} 条</p>
      {query.data.blockers.map((b) => <p className="lifecycle-warning" key={b}>{b}</p>)}
      {query.data.missingPlans.length ? <ul>{query.data.missingPlans.map((m) => <li key={m.id}>{m.displayName} · {m.id}：请配置覆盖本周期的方案。</li>)}</ul> : null}
      {query.data.pending.length || query.data.drafts.length || query.data.anomalies.length ? <details><summary>查看待处理或需核对记录</summary><div className="fact-project-links">{[...new Set([...query.data.pending, ...query.data.drafts, ...query.data.anomalies].map((f) => f.id))].map((id) => <Link key={id} to={`/work?record=${id}`}>记录 {id.slice(0, 8)}</Link>)}</div></details> : null}
      <div className="handoff-table-scroll" tabIndex={0} aria-label="完整逐行薪资预览，可横向滚动"><table><thead><tr><th>成员 / 唯一编号</th><th>已批准 / 待审工时</th><th>工作工资</th><th>奖励</th><th>补贴</th><th>报销</th><th>其他调整</th><th>本周期合计</th><th>金额状态</th><th>较上批变化</th></tr></thead><tbody>{query.data.rows.map((r) => <tr key={r.membershipId}><td><strong>{r.displayName}</strong><small>{r.membershipId}</small></td><td>{(r.approvedSeconds / 3600).toFixed(2)} / {(r.pendingSeconds / 3600).toFixed(2)} 小时</td>{(["wages", "bonus", "subsidies", "reimbursements", "other"] as const).map((key) => <td key={key}>{r.amounts ? roundMoney(r.amounts[key]) : "见组成明细"}</td>)}<td><strong>{formatMoney(r.currency, r.finalAmount)}</strong></td><td>{query.data!.batch ? "已确认交接" : r.needsReview ? "待复核 · 未确认" : r.estimate ? "含待审预估 · 未确认" : "计算值 · 未确认"}</td><td>{r.amountChange === null ? "首批" : roundMoney(r.amountChange)}</td></tr>)}{!query.data.batch ? query.data.missingPlans.map((m) => <tr key={m.id}><td><strong>{m.displayName}</strong><small>{m.id}</small></td><td colSpan={9}>缺计薪方案，无法计算金额；请配置方案后更新计算。</td></tr>) : null}</tbody></table></div>
      <div className="flex flex-wrap gap-3" aria-label="按币种汇总">{[...new Set(query.data.rows.map((r) => r.currency))].map((currency) => <p key={currency}>{currency} 本周期合计：<strong>{roundMoney(addDecimalAmounts(...query.data!.rows.filter((r) => r.currency === currency).map((r) => r.finalAmount)))}</strong>（{query.data!.batch ? "已确认" : "未确认；含预估时须核对"}）</p>)}</div>
      <details><summary>正式交接：核对外部人员编号和方案版本</summary><div className="handoff-table-scroll"><table><thead><tr><th>成员</th><th>外部平台人员编号</th><th>方案版本</th></tr></thead><tbody>{query.data.rows.map((r) => <tr key={r.membershipId}><td>{r.displayName}<small>{r.membershipId}</small></td><td>{query.data!.batch ? r.externalId : <><input aria-label={`${r.displayName} 外部人员编号`} value={identities[r.membershipId] ?? r.externalId} maxLength={120} onChange={(e) => { setIdentities((v) => ({ ...v, [r.membershipId]: e.target.value })); setConfirmedHash(null); }} /><Button variant="ghost" size="compact" disabled={profile.isPending || !(identities[r.membershipId] ?? r.externalId).trim()} onClick={() => profile.mutate(r)}>保存映射</Button></>}</td><td>{r.planVersionId}</td></tr>)}</tbody></table></div></details>
      {query.data.batch ? <div className="handoff-manifest"><p>已确认交接批次：{query.data.batch.id}</p><p>规则：{query.data.batch.ruleVersion}</p><p>文件 SHA-256：<code>{query.data.batch.sha256}</code></p><p>保留原批次文件，实际外部付款状态请到发薪平台核对。下方预览使用确认时的人员和金额快照。</p><Button disabled={download.isPending} onClick={() => download.mutate("csv")}>{download.isPending ? "下载并校验中…" : "重取已确认原文件"}</Button>{query.data.batch.manifest?.workbookFileName ? <><p>完整工作单：{query.data.batch.manifest.workRowCount} 条工作记录 · {query.data.batch.manifest.componentRowCount} 项工资组成 · {query.data.batch.manifest.reimbursementRowCount} 条报销。已批准、未提交、退回和异常均标记状态；补贴和报销不重复加总。</p><Button disabled={download.isPending} onClick={() => download.mutate("xlsx")}>下载薪资及完整工作单 Excel</Button><small>Excel SHA-256：{query.data.batch.manifest.workbookSha256}</small></> : null}{download.isSuccess ? <p role="status">文件校验通过，已发起下载；可随时重取同一批次。</p> : null}</div> : <>
        {profile.isPending || query.isFetching ? <p role="status">正在重新核对整批数据，请等待人员映射和金额预览更新后确认。</p> : null}
        <label className="handoff-confirmation"><input type="checkbox" disabled={profile.isPending || query.isFetching || confirm.isPending} checked={confirmedHash === query.data.previewHash} onChange={(e) => setConfirmedHash(e.target.checked ? query.data!.previewHash : null)} /><span>我已逐行核对金额和人员编号，确认外部平台接受这些编号及当前列格式；已检查未提交、退回和异常记录对本期的影响。默认 UUID 是本平台成员编号，须按外部平台规则保存映射。同名成员不能只按姓名识别。</span></label>
        <Button disabled={profile.isPending || query.isFetching || confirm.isPending || confirmedHash !== query.data.previewHash || query.data.blockers.length > 0 || Object.keys(identities).some((id) => identities[id] !== query.data!.rows.find((r) => r.membershipId === id)?.externalId)} onClick={() => confirm.mutate()}>{confirm.isPending ? "正在确认并保存原文件…" : "确认导出并锁定"}</Button>
      </>}
    </> : null}
    {profile.error || confirm.error || download.error || report.error ? <QueryFailure error={profile.error ?? confirm.error ?? download.error ?? report.error} retry={() => void query.refetch()} /> : null}
  </CardContent></Card></div>;
}
