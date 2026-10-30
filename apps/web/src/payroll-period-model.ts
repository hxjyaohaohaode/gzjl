export interface SettlementPeriod { id: string; name: string; status: string; startsAt: string; endsAt: string; cutoffAt: string }
export interface SettlementRun { run: { id: string; runNumber: number; status: string; completedAt?: string | null }; period: { id: string } }
export function latestPeriodRuns(runs: SettlementRun[]) {
  const latest = new Map<string, SettlementRun["run"]>();
  for (const entry of runs) {
    const previous = latest.get(entry.period.id);
    const order = previous?.completedAt && entry.run.completedAt
      ? Date.parse(entry.run.completedAt) - Date.parse(previous.completedAt)
      : 0;
    if (!previous || order > 0 || (order === 0 && previous.runNumber < entry.run.runNumber)) latest.set(entry.period.id, entry.run);
  }
  return latest;
}
export function settlementState(period: SettlementPeriod, run?: SettlementRun["run"]) {
  if (["settled", "locked"].includes(period.status)) return "settled";
  if (run?.status === "review_required") return "review";
  if (run?.status === "ready") return "ready";
  if (period.status === "calculating" || run?.status === "calculating" || run?.status === "queued") return "calculating";
  if (run?.status === "failed") return "failed";
  if (new Date(period.endsAt).getTime() > Date.now()) return "accruing";
  return "open";
}
