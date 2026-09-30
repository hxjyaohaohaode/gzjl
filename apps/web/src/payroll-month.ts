import { toZonedInputValue } from "./timezone.js";

/** A salary month always includes the first midnight and excludes the next. */
export function isSalaryMonth(month: string) {
  return /^(\d{4})-(0[1-9]|1[0-2])$/.test(month) && Number(month.slice(0, 4)) >= 100 && Number(month.slice(0, 4)) <= 9998;
}

export function salaryMonthForm(month: string) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match || !isSalaryMonth(month)) throw new RangeError("请选择有效结算月份。");
  const year = Number(match[1]), number = Number(match[2]);
  const next = new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7);
  return { name: `${year} 年 ${number} 月`, startsAt: `${month}-01T00:00:00`, endsAt: `${next}-01T00:00:00`, cutoffAt: `${next}-10T18:00:00` };
}

export function previousSalaryMonth(now = new Date()) {
  const current = toZonedInputValue(now).slice(0, 7);
  const [year, month] = current.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 2, 1)).toISOString().slice(0, 7);
}

export function salaryPeriodMatchesMonth(period: { startsAt: string; endsAt: string; timezone?: string }, month: string) {
  if (!month) return true;
  return toZonedInputValue(new Date(period.startsAt), period.timezone).slice(0, 7) <= month
    && toZonedInputValue(new Date(Date.parse(period.endsAt) - 1), period.timezone).slice(0, 7) >= month;
}
