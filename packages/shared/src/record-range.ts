import { clipWholeSecondPayableIntervals, payableIntervalSeconds, type PayableInterval } from "./payroll-engine.js";

/** Full factual boundaries are retained; only productive seconds inside the
 * selected half-open range are counted, including records crossing midnight. */
export function recordRangeNetSeconds(id: string, startAt: Date, endAt: Date, breaks: readonly { startAt: Date; endAt: Date | null }[], from: Date, to: Date) {
  const intervals: PayableInterval[] = [];
  let cursor = startAt.getTime(); const end = endAt.getTime();
  for (const entry of [...breaks].sort((a, b) => a.startAt.getTime() - b.startAt.getTime())) {
    const first = Math.min(end, Math.max(cursor, entry.startAt.getTime()));
    const last = Math.min(end, Math.max(first, entry.endAt?.getTime() ?? end));
    if (first > cursor) intervals.push({ sourceId: id, startAt: new Date(cursor), endAt: new Date(first), approvalStatus: "approved" });
    cursor = Math.max(cursor, last);
    if (cursor >= end) break;
  }
  if (cursor < end) intervals.push({ sourceId: id, startAt: new Date(cursor), endAt, approvalStatus: "approved" });
  return clipWholeSecondPayableIntervals(intervals, from, to).reduce((total, interval) => total + payableIntervalSeconds(interval), 0);
}
