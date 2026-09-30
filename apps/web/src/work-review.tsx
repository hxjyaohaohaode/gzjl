import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@workbench/ui";
import { api } from "./api.js";
import { toZonedInputValue, zonedInputToDate } from "./timezone.js";
import { salaryMonthForm } from "./payroll-month.js";

export function WorkReviewDraft({ from, to }: { from: string | null; to: string | null }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const defaultMonth = salaryMonthForm(toZonedInputValue(new Date()).slice(0, 7));
  const startsAt = from ?? zonedInputToDate(defaultMonth.startsAt).toISOString();
  const endsAt = to ?? zonedInputToDate(defaultMonth.endsAt).toISOString();
  const review = useMutation({ mutationFn: () => api<{ draft: string }>(`/api/work-reviews/me?${new URLSearchParams({ from: startsAt, to: endsAt })}`), onSuccess: (response) => { setDraft(response.draft); setConfirmed(false); } });
  const save = () => {
    const url = URL.createObjectURL(new Blob([draft ?? ""], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `已校对工作回顾-${toZonedInputValue(new Date(startsAt)).slice(0, 10)}.txt`; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };
  return <details className="review-draft"><summary>生成本人可校对工作回顾</summary><p>按工作页所选日期生成；未选择日期时使用本月。保留完整事实、审批状态、版本和来源，确认后由本人保存。</p>
    <Button variant="secondary" disabled={review.isPending} onClick={() => review.mutate()}>{review.isPending ? "生成中…" : "生成本人可校对回顾"}</Button>
    {review.error && <p role="alert">{review.error.message}</p>}
    {draft !== null && <section><h3>本人工作回顾 · 待校对草稿</h3><textarea aria-label="校对工作回顾" value={draft} onChange={(e) => { setDraft(e.target.value); setConfirmed(false); }} /><label><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />我已核对记录、结果、状态和来源</label><Button disabled={!confirmed} onClick={save}>保存已校对回顾</Button><Button variant="ghost" onClick={() => setDraft(null)}>关闭草稿</Button></section>}
  </details>;
}
