import { Badge, Button } from "@workbench/ui";
import { toZonedInputValue } from "./timezone.js";
import { latestPeriodRuns, settlementState, type SettlementPeriod, type SettlementRun } from "./payroll-period-model.js";

const labels: Record<string, string> = { settled: "已导出并锁定", review: "需要复核", ready: "待确认交接", calculating: "自动计算中", failed: "等待自动重试", open: "等待自动计算", accruing: "本月计薪中" };
export function PayrollPeriodList({ periods, runs, timezone, canSettle, busy, onPreview, onReopen }: {
  periods: SettlementPeriod[]; runs: SettlementRun[]; timezone: string; canSettle: boolean; busy: boolean;
  onPreview: (id: string) => void; onReopen: (id: string) => void;
}) {
  const latest = latestPeriodRuns(runs);
  const date = (at: string | Date) => toZonedInputValue(new Date(at), timezone).replace("T", " ");
  const endDate = (at: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(new Date(at).getTime() - 1000));
  return <div className="payroll-period-list">{periods.map((period) => {
    const run = latest.get(period.id);
    const state = settlementState(period, run);
    const canPreview = run && ["ready", "review_required", "settled"].includes(run.status);
    return <article className="payroll-period-card" key={period.id} data-period-id={period.id} data-settlement-state={state}>
      <div className="payroll-period-heading"><div><h3>{period.name}</h3><p>{date(period.startsAt)} — {endDate(period.endsAt)} · {timezone}</p></div><Badge tone={state === "settled" ? "positive" : ["review", "failed"].includes(state) ? "warning" : "info"}>{labels[state]}</Badge></div>
      {state === "review" && <p className="payroll-period-next">处理待审核或异常记录后，系统自动更新金额。</p>}
      {state === "accruing" && <p className="payroll-period-next">月末结束后自动计算。</p>}
      <div className="payroll-period-actions">
        {canPreview && canSettle && <Button disabled={busy} onClick={() => onPreview(run.id)}>{state === "settled" ? "重新导出账单" : "核对导出预览"}</Button>}
        {canSettle && canPreview && state === "settled" && <details><summary>更正已锁定账单</summary><Button variant="ghost" disabled={busy} onClick={() => { if (window.confirm(`确认撤销“${period.name}”的导出锁定？工时将恢复可编辑，系统将重新计算。请先核对是否已实际付款，历史文件保留。`)) onReopen(run.id); }}>撤销导出锁定</Button></details>}
      </div>
    </article>;
  })}</div>;
}
