export interface VisualWorkRecord {
  id: string; content: string; startAt?: string | null; endAt?: string | null; netSeconds?: number | null;
  recordKind?: string; result?: string; activityAt?: string; displayName?: string; membershipId?: string; projectName?: string | null;
}
export function visualDate(value: string | Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)?.value).join("-");
}
export function visualHour(value: string | Date, timezone: string): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(new Date(value)));
}
export function shiftVisualDay(value: string, days: number): string {
  return new Date(Date.parse(`${value}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
export interface WorkHeatCell { date: string; hour: number; records: VisualWorkRecord[]; count: number; level: number }
/** Counts records covering each local hour. It never infers payroll hours from public activity times. */
export function workHeatCells(records: readonly VisualWorkRecord[], lastDay: string, timezone: string): WorkHeatCell[] {
  const cells = Array.from({ length: 7 }, (_, day) => shiftVisualDay(lastDay, day - 6)).flatMap((date) => Array.from({ length: 24 }, (_, hour) => ({ date, hour, records: [] as VisualWorkRecord[], count: 0, level: 0 })));
  const byKey = new Map(cells.map((cell) => [`${cell.date}-${cell.hour}`, cell]));
  for (const record of records) {
    if (record.recordKind === "plan" || !record.startAt || !record.endAt) continue;
    const start = Date.parse(record.startAt), end = Date.parse(record.endAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const seen = new Set<string>();
    const format = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, minute: "2-digit", second: "2-digit" });
    // At most seven days intersect this grid; sampling starts at the exact record boundary.
    let cursor = start;
    const firstDate = visualDate(new Date(cursor), timezone);
    if (firstDate < cells[0]!.date) cursor = Math.max(start, Date.parse(`${cells[0]!.date}T00:00:00Z`) - 14 * 3_600_000);
    for (let step = 0; cursor < end && step < 240; step++) {
      const date = visualDate(new Date(cursor), timezone);
      if (date > lastDay) break;
      const key = `${date}-${visualHour(new Date(cursor), timezone)}`;
      const cell = byKey.get(key);
      if (cell && !seen.has(key)) { cell.records.push(record); seen.add(key); }
      const parts = format.formatToParts(new Date(cursor));
      const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
      const second = Number(parts.find((part) => part.type === "second")?.value ?? 0);
      cursor += Math.max(1_000, (60 - minute) * 60_000 - second * 1_000 - cursor % 1_000);
    }
  }
  const peak = Math.max(1, ...cells.map((cell) => cell.records.length));
  return cells.map((cell) => ({ ...cell, count: cell.records.length, level: cell.records.length ? Math.max(1, Math.ceil(cell.records.length / peak * 4)) : 0 }));
}
export function pageSlice<T>(items: readonly T[], page: number, size: number): T[] {
  const current = Math.max(1, Math.min(page, Math.max(1, Math.ceil(items.length / size))));
  return items.slice((current - 1) * size, current * size);
}
export function visualDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  return safe >= 3600 ? `${Math.floor(safe / 3600)} 小时 ${Math.floor(safe % 3600 / 60)} 分` : safe >= 60 ? `${Math.floor(safe / 60)} 分` : `${safe} 秒`;
}

/** Arrange overlapping intervals on separate rows; public events remain points. */
export function swimRows(records: readonly VisualWorkRecord[], from: number, to: number) {
  const intervals = records.flatMap((record) => {
    if (record.recordKind === "plan") return [];
    const precise = Boolean(record.startAt && record.endAt);
    const begin = Date.parse(precise ? record.startAt! : record.activityAt ?? "");
    const end = precise ? Date.parse(record.endAt!) : begin;
    if (!Number.isFinite(begin) || !Number.isFinite(end) || (precise && end <= begin) || begin >= to || (precise ? end <= from : begin < from)) return [];
    return [{ record, begin: Math.max(from, begin), end: Math.min(to, end), precise }];
  }).sort((left,right) => left.begin - right.begin || left.end - right.end || left.record.id.localeCompare(right.record.id));
  const rowEnds: number[] = [];
  return intervals.map((interval) => {
    let row = rowEnds.findIndex((value) => value <= interval.begin);
    if (row < 0) row = rowEnds.length;
    rowEnds[row] = Math.max(interval.end, interval.begin + 1);
    return { ...interval, row, hours: (interval.begin - from) / 3_600_000, hoursEnd: (interval.end - from) / 3_600_000 };
  });
}

/** Whole-hour focus windows keep the ruler aligned with blocks, including 23/25-hour days. */
export function swimDomain(intervals: ReadonlyArray<{ hours: number; hoursEnd: number }>, dayHours: number, full: boolean, compact: boolean) {
  const columns = compact ? 4 : 8;
  let start = 0, end = dayHours;
  if (!full && intervals.length) {
    start = Math.max(0, Math.floor(Math.min(...intervals.map((row) => row.hours)) - 1));
    end = Math.min(dayHours, Math.ceil(Math.max(...intervals.map((row) => row.hoursEnd)) + 1));
    if (end - start < 6) { start = Math.max(0, start - Math.ceil((6 - (end - start)) / 2)); end = Math.min(dayHours, start + 6); start = Math.max(0, end - 6); }
  }
  const step = Math.max(1, Math.ceil((end - start) / columns));
  end = Math.min(dayHours, start + step * Math.ceil((end - start) / step));
  const ticks = Array.from({ length: Math.floor((end - start) / step) + 1 }, (_, index) => start + index * step);
  if (ticks.at(-1) !== end) ticks.push(end);
  return { start, end, ticks };
}
