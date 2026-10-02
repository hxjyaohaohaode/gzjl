import { Badge, Button } from "@workbench/ui";
import { toZonedInputValue } from "./timezone.js";

import { latestPeriodRuns, settlementState, type SettlementPeriod, type SettlementRun } from "./payroll-period-model.js";

const labels: Record<string, string> = { settled: "已导出并锁定", review: "需要复核", ready: "可导出锁定", calculating: "计算中", failed: "计算失败", open: "待计算" };
const nextSteps: Record<string, string> = {
  open: "下一步：计算本周期，生成每人的工资与工作依据。",
  review: "下一步：查看待复核记录，处理后更新计算，再确认交接。",
  ready: "下一步：核对金额和人员编号，确认后锁定并保留原文件。",
  settled: "本批文件已固定，可以重新下载；实际付款请到发薪平台核对。",
  calculating: "正在生成计算结果，请稍候。",
  failed: "计算未完成，可以重试；工作记录仍然保留。",
};
export function PayrollPeriodList({ periods, runs, timezone, canSettle, busy, calculatingId, onCalculate, onPreview, onDelete, onCancel, onReopen }: {
  periods: SettlementPeriod[]; runs: SettlementRun[]; timezone: string; canSettle: boolean; busy: boolean; calculatingId?: string | undefined;
  onCalculate: (id: string) => void; onPreview: (id: string) => void; onDelete: (id: string) => void; onCancel: (id: string) => void; onReopen: (id: string) => void;
}) {
  const latest = latestPeriodRuns(runs);
  const date = (at: string) => toZonedInputValue(new Date(at), timezone).replace("T", " ");
  return <div className="payroll-period-list">{periods.map((period) => {
    const latestRun = latest.get(period.id);
    const run = latestRun?.status === "cancelled" ? undefined : latestRun;
    const state = settlementState(period, run);
    const canCalculate = ["open", "pending_confirmation"].includes(period.status) && state !== "calculating";
    const canPreview = run && ["ready", "review_required", "settled"].includes(run.status);
    return <article className="payroll-period-card" key={period.id} data-period-id={period.id} data-settlement-state={state}>
      <div className="payroll-period-heading"><div><h3>{period.name}</h3><p>{date(period.startsAt)} — {date(period.endsAt)}（结束不含）</p></div><Badge tone={state === "settled" ? "positive" : ["review", "failed"].includes(state) ? "warning" : "info"}>{labels[state]}</Badge></div>
      <div className="payroll-period-progress" aria-label="结算进度">{["建立周期", "计算工资", "核对交接", "锁定原文件"].map((step, index) => {
        const stage = state === "settled" ? 4 : ["ready", "review"].includes(state) ? 2 : 1;
        return <span key={step} data-complete={index < stage} aria-current={index === stage ? "step" : undefined}><i aria-hidden>{index + 1}</i>{step}</span>;
      })}</div>
      <p className="payroll-period-next">{nextSteps[state]}</p>
      {canPreview && <p className="payroll-run-label">{period.name} · 批次 #{run.runNumber} · {labels[state]}</p>}
      <div className="payroll-period-actions">
        {canPreview && canSettle && <Button disabled={busy} onClick={() => onPreview(run.id)}>{state === "settled" ? "重新导出账单" : "核对导出预览"}</Button>}
        {canCalculate && <Button disabled={!canSettle || busy} title={!canSettle ? "需要组织级薪资结算权限" : undefined} variant={canPreview ? "secondary" : "primary"} onClick={() => onCalculate(period.id)}>{calculatingId === period.id ? "正在计算本周期…" : canPreview ? "更新计算并查看" : "计算并查看薪资总览"}</Button>}
        {canSettle && canPreview && state !== "settled" && <Button variant="ghost" disabled={busy} onClick={() => { if (window.confirm("撤销本次尚未锁定的计算？周期将恢复为可计算，工作记录和审计仍保留。")) onCancel(run.id); }}>撤销本次计算</Button>}
        {canSettle && canPreview && state === "settled" && <Button variant="ghost" disabled={busy} onClick={() => { if (window.confirm("撤销后恢复本周期和对应工时的可编辑计薪状态，历史批次保留审计。确认撤销？")) onReopen(run.id); }}>撤销导出锁定</Button>}
        {canCalculate && !canPreview && <Button variant="ghost" disabled={busy} onClick={() => { if (window.confirm("撤销这个误建周期？只移除尚未锁定的周期和已撤销计算，不删除工作记录；曾锁定的周期不能删除。")) onDelete(period.id); }}>撤销误建周期</Button>}
        <small>计划导出 {date(period.cutoffAt)} · {timezone}</small>
      </div>
    </article>;
  })}</div>;
}
