import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Card, CardHeader, CardContent } from "@workbench/ui";
import type { WorkSubmissionPolicy } from "@workbench/shared";
import { api } from "./api.js";

interface Policy extends WorkSubmissionPolicy { version: number; timezone: string; currentMonthDeadline: string | null }
export function WorkPolicyPanel({ editable = false }: { editable?: boolean }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["work-policy"], queryFn: () => api<Policy>("/api/work-policy"), staleTime: 30_000 });
  const [draft, setDraft] = useState<Policy | null>(null);
  const policy = draft ?? query.data;
  const save = useMutation({ mutationFn: () => api("/api/work-policy", { method: "PUT", body: { ...policy, expectedVersion: policy!.version } }), onSuccess: async () => { setDraft(null); await client.invalidateQueries({ queryKey: ["work-policy"] }); } });
  if (!editable) return <details className="work-policy-notice"><summary>老板设置的提交与补录规则</summary>{query.data && typeof query.data.manualEntryLookbackDays === "number" ? <><p>手工补录：{query.data.manualEntryLookbackDays === 0 ? "仅组织时区的当天" : `最近 ${query.data.manualEntryLookbackDays} 天（从当前时刻回溯）`}。</p><p>{query.data.monthlyDeadlineEnabled ? `每条记录以开始时间所在月份归属，${query.data.followingMonth ? "次月" : "当月"}${query.data.deadlineDay === "last" ? "最后一天" : `${query.data.deadlineDay}日（不足该日取月末）`} ${query.data.deadlineTime} 截止；过时不能补录、恢复或提交该月历史内容。` : "尚未设置每月提交截止时间。"} 时区：{query.data.timezone}。未来内容保存为计划；异常通过有留痕的更正申请处理。</p></> : <p role="status">{query.isError ? "规则读取失败，请刷新后重试。" : "正在读取提交规则…"}</p>}</details>;
  return <Card className="work-policy-panel"><CardHeader><h2>老板设置 · 最晚提交与补录期限</h2></CardHeader><CardContent>
    {query.isError ? <p role="alert">{query.error.message}<Button variant="ghost" onClick={() => void query.refetch()}>重新读取</Button></p> : policy && typeof policy.manualEntryLookbackDays === "number" ? <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <div className="work-policy-grid">
        <label>最多补录多少天前的工作<input type="number" min={0} max={366} required value={policy.manualEntryLookbackDays} onChange={(e) => setDraft({ ...policy, manualEntryLookbackDays: Number(e.target.value) })} /><small>默认 7 天；0 表示仅当天。老板保存后覆盖成员个人的补录期限。</small></label>
        <label className="handoff-confirmation"><input type="checkbox" checked={policy.monthlyDeadlineEnabled} onChange={(e) => setDraft({ ...policy, monthlyDeadlineEnabled: e.target.checked })} /><span>启用每月最晚提交时间</span></label>
        <label>截止日<select value={policy.deadlineDay} disabled={!policy.monthlyDeadlineEnabled} onChange={(e) => setDraft({ ...policy, deadlineDay: e.target.value === "last" ? "last" : Number(e.target.value) })}><option value="last">每月最后一天</option>{Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1} 日</option>)}</select></label>
        <label>最晚提交时间<input type="time" required disabled={!policy.monthlyDeadlineEnabled} value={policy.deadlineTime} onChange={(e) => setDraft({ ...policy, deadlineTime: e.target.value })} /></label>
        <label>记录归属月的截止月份<select value={policy.followingMonth ? "next" : "current"} disabled={!policy.monthlyDeadlineEnabled} onChange={(e) => setDraft({ ...policy, followingMonth: e.target.value === "next" })}><option value="current">当月截止</option><option value="next">次月截止</option></select></label>
      </div>
      <p>例如：当月最后一天 23:30，超过后不能补录或提交该月历史工时。以记录开始时间和组织时区 {policy.timezone} 判定；短月份自动取月末。计时事实与已有记录仍保留，特殊更正必须经过审核并保留历史。</p>
      <Button disabled={save.isPending} type="submit">{save.isPending ? "保存规则中…" : "保存提交与补录规则"}</Button>{draft ? <Button variant="ghost" onClick={() => setDraft(null)} type="button">放弃未保存修改</Button> : null}
      {save.isSuccess ? <p role="status">规则已生效。</p> : null}{save.error ? <p role="alert">{save.error.message}</p> : null}
    </form> : <p role="status">正在读取规则…</p>}
  </CardContent></Card>;
}
