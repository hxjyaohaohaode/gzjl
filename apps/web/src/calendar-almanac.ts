import { Solar } from "lunar-typescript";

export interface CalendarAlmanacDay {
  lunarMonth: string;
  lunarDay: string;
  lunarLabel: string;
  festivals: string[];
  solarTerm: string | null;
  officialSchedule: {
    status: "off" | "workday";
    name: string;
  } | null;
  detail: string;
}

// 国办发明电〔2025〕7号。Only published statutory arrangements are stored;
// traditional festivals and solar terms remain algorithmic for future years.
const officialSchedule2026 = new Map<string, { status: "off" | "workday"; name: string }>();

function addOfficialRange(start: string, end: string, name: string) {
  const cursor = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);
  while (cursor <= last) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    officialSchedule2026.set(key, { status: "off", name });
    cursor.setDate(cursor.getDate() + 1);
  }
}

addOfficialRange("2026-01-01", "2026-01-03", "元旦");
addOfficialRange("2026-02-15", "2026-02-23", "春节");
addOfficialRange("2026-04-04", "2026-04-06", "清明节");
addOfficialRange("2026-05-01", "2026-05-05", "劳动节");
addOfficialRange("2026-06-19", "2026-06-21", "端午节");
addOfficialRange("2026-09-25", "2026-09-27", "中秋节");
addOfficialRange("2026-10-01", "2026-10-07", "国庆节");
for (const [date, name] of [
  ["2026-01-04", "元旦调休"],
  ["2026-02-14", "春节调休"],
  ["2026-02-28", "春节调休"],
  ["2026-05-09", "劳动节调休"],
  ["2026-09-20", "国庆节调休"],
  ["2026-10-10", "国庆节调休"],
] as const) {
  officialSchedule2026.set(date, { status: "workday", name });
}

/**
 * Calendar dates in the UI are wall-clock dates, so this deliberately reads
 * getFullYear/getMonth/getDate rather than converting through UTC.
 */
export function getCalendarAlmanac(date: Date): CalendarAlmanacDay {
  const solar = Solar.fromYmd(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
  );
  const lunar = solar.getLunar();
  const lunarMonth = `${lunar.getMonthInChinese()}月`;
  const lunarDay = lunar.getDayInChinese();
  const solarTerm = lunar.getJieQi().trim() || null;
  const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const officialSchedule = officialSchedule2026.get(dateKey) ?? null;
  const festivals = [...new Set([
    ...solar.getFestivals(),
    ...lunar.getFestivals(),
  ].filter(Boolean))];
  const lunarLabel = solarTerm ?? festivals[0] ?? (lunarDay === "初一" ? lunarMonth : lunarDay);
  const detail = [
    `农历${lunarMonth}${lunarDay}`,
    solarTerm ? `节气：${solarTerm}` : null,
    festivals.length ? `节日：${festivals.join("、")}` : null,
    officialSchedule
      ? `法定安排：${officialSchedule.name}${officialSchedule.status === "off" ? "放假" : "调休上班"}`
      : null,
  ].filter(Boolean).join(" · ");
  return { lunarMonth, lunarDay, lunarLabel, festivals, solarTerm, officialSchedule, detail };
}
