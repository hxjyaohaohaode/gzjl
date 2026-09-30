import { z } from "zod";

export const workSubmissionPolicySchema = z.object({
  manualEntryLookbackDays: z.number().int().min(0).max(366).default(7),
  monthlyDeadlineEnabled: z.boolean().default(false),
  deadlineDay: z.union([z.literal("last"), z.number().int().min(1).max(31)]).default("last"),
  deadlineTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).default("23:30"),
  followingMonth: z.boolean().default(false),
});
export type WorkSubmissionPolicy = z.infer<typeof workSubmissionPolicySchema>;

export function zonedCalendarTime(year: number, month: number, day: number, hour: number, minute: number, timezone: string): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let date = new Date(target);
  for (let i = 0; i < 4; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
    const n = (key: string) => Number(parts.find((p) => p.type === key)?.value);
    const local = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
    if (local === target) return date;
    date = new Date(date.getTime() + target - local);
  }
  // Nonexistent local times in DST must not silently become a different cutoff.
  throw new Error("该组织时区中的本地时间不存在，请调整截止时间。");
}
export function workSubmissionDeadline(policy: WorkSubmissionPolicy, recordStart: Date, timezone: string): Date | null {
  if (!policy.monthlyDeadlineEnabled) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit" }).formatToParts(recordStart);
  const startYear = Number(parts.find((p) => p.type === "year")!.value);
  const startMonth = Number(parts.find((p) => p.type === "month")!.value);
  const anchor = new Date(Date.UTC(startYear, startMonth - 1 + Number(policy.followingMonth), 1));
  const year = anchor.getUTCFullYear(), month = anchor.getUTCMonth() + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = policy.deadlineDay === "last" ? last : Math.min(policy.deadlineDay, last);
  const [hour, minute] = policy.deadlineTime.split(":").map(Number);
  return zonedCalendarTime(year, month, day, hour!, minute!, timezone);
}
