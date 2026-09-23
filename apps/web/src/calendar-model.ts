import { api } from "./api.js";
import { toZonedInputValue } from "./timezone.js";

const boundaryCache = new Map<string, number>();
/** First real instant of a civil date. Some zones skip midnight completely. */
export function calendarDayBoundary(day: string, timezone: string): Date {
  const key = `${timezone}:${day}`;
  const cached = boundaryCache.get(key);
  if (cached !== undefined) return new Date(cached);
  const center = Date.parse(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(center) || new Date(center).toISOString().slice(0, 10) !== day) throw new RangeError("日历日期格式不正确。");
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const dateAt = (instant: number) => {
    const parts = formatter.formatToParts(new Date(instant));
    return ["year", "month", "day"].map((name) => parts.find((part) => part.type === name)!.value).join("-");
  };
  let lower = center - 36 * 3_600_000;
  let upper = center + 36 * 3_600_000;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (dateAt(middle) < day) lower = middle + 1;
    else upper = middle;
  }
  if (boundaryCache.size >= 512) boundaryCache.delete(boundaryCache.keys().next().value!);
  boundaryCache.set(key, lower);
  return new Date(lower);
}

export interface CalendarIntervalSegment {
  day: string;
  startAt: string;
  endAt: string;
  startWall: string;
  endWall: string;
  elapsedSeconds: number;
  range: { startPercent: number; endPercent: number; widthPercent: number | null; startLabel: string; endLabel: string; clockShift: boolean; startOffset: string; endOffset: string };
}

/** Clip real instants first. Wall clocks may repeat or skip and cannot decide
 * whether a record exists, or how much real time elapsed. */
export function splitCalendarInterval(start: Date, end: Date, from: Date, to: Date, timezone: string): CalendarIntervalSegment[] {
  if (![start, end, from, to].every((value) => Number.isFinite(value.getTime())) || end <= start || to <= from) return [];
  const visibleStart = Math.max(start.getTime(), from.getTime());
  const visibleEnd = Math.min(end.getTime(), to.getTime());
  if (visibleEnd <= visibleStart) return [];
  const wall = (value: Date) => `${toZonedInputValue(value, timezone)}${value.getUTCMilliseconds() ? `.${String(value.getUTCMilliseconds()).padStart(3, "0")}` : ""}`;
  const offset = (value: Date) => new Intl.DateTimeFormat("en", { timeZone: timezone, timeZoneName: "longOffset" }).formatToParts(value).find((part) => part.type === "timeZoneName")?.value ?? timezone;
  let day = toZonedInputValue(new Date(visibleStart), timezone).slice(0, 10);
  const result: CalendarIntervalSegment[] = [];
  while (true) {
    const dayWallMs = Date.parse(`${day}T00:00:00Z`);
    const nextDay = new Date(dayWallMs + 86_400_000).toISOString().slice(0, 10);
    const dayStart = calendarDayBoundary(day, timezone).getTime();
    const dayEnd = calendarDayBoundary(nextDay, timezone).getTime();
    const clippedStart = Math.max(visibleStart, dayStart);
    const clippedEnd = Math.min(visibleEnd, dayEnd);
    if (clippedEnd > clippedStart) {
      const startAt = new Date(clippedStart);
      const endAt = new Date(clippedEnd);
      const startWall = wall(startAt);
      const endWall = wall(endAt);
      const startPosition = Date.parse(`${startWall}Z`) - dayWallMs;
      const endPosition = Date.parse(`${endWall}Z`) - dayWallMs;
      const clockShift = endPosition - startPosition !== clippedEnd - clippedStart;
      result.push({
        day, startAt: startAt.toISOString(), endAt: endAt.toISOString(), startWall, endWall,
        elapsedSeconds: (clippedEnd - clippedStart) / 1000,
        range: {
          startPercent: Math.max(0, Math.min(100, startPosition / 86_400_000 * 100)),
          endPercent: Math.max(0, Math.min(100, endPosition / 86_400_000 * 100)),
          widthPercent: clockShift ? null : (clippedEnd - clippedStart) / 86_400_000 * 100,
          startLabel: startWall.slice(11), endLabel: endPosition === 86_400_000 ? "24:00:00" : endWall.slice(11),
          clockShift, startOffset: clockShift ? offset(startAt) : "", endOffset: clockShift ? offset(endAt) : "",
        },
      });
    }
    if (dayEnd >= visibleEnd) break;
    day = nextDay;
  }
  return result;
}

export function shiftCalendarMonth(value: Date, months: number): Date {
  const target = new Date(value);
  const day = target.getDate();
  target.setDate(1);
  target.setMonth(target.getMonth() + months);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target;
}

export function calendarDayDifference(from: Date, to: Date): number {
  const day = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  return (day(to) - day(from)) / 86_400_000;
}

export function calendarPeriodSeconds(record: { startAt: string; endAt: string; netSeconds: number; periodNetSeconds?: number }, from: Date, to: Date): number | null {
  if (record.periodNetSeconds !== undefined) return record.periodNetSeconds;
  // Older responses can be safely reused only when the complete record lies
  // within the requested range. Break placement cannot be guessed proportionally.
  return new Date(record.startAt) >= from && new Date(record.endAt) <= to ? record.netSeconds : null;
}

export async function loadCalendarRecords<T extends { id: string }>(from: string, to: string, signal?: AbortSignal): Promise<{ items: T[] }> {
  const items = new Map<string, T>();
  const visited = new Set<string>();
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ limit: "100", from, to });
    if (cursor) query.set("before", cursor);
    const page = await api<{ items: T[]; nextCursor?: string | null }>(`/api/work-sessions?${query.toString()}`, { ...(signal ? { signal } : {}) });
    page.items.forEach((item) => items.set(item.id, item));
    cursor = page.nextCursor ?? null;
    if (cursor && visited.has(cursor)) throw new Error("日历记录分页未能继续，请重新加载后核对当前周期。");
    if (cursor) visited.add(cursor);
  } while (cursor);
  return { items: [...items.values()] };
}
