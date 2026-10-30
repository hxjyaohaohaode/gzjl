import { and, asc, eq, isNull, lt } from "drizzle-orm";
import type { Database } from "@workbench/db";
import { auditLogs, organizations, payPeriods, workSessions } from "@workbench/db/schema";
import { zonedCalendarTime } from "@workbench/shared";
import { lockPayrollInputs } from "./input-lock.js";

/** The exclusive next-month boundary includes every instant of the last day. */
export function monthlyPeriod(at: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit" }).formatToParts(at);
  const year = Number(parts.find((part) => part.type === "year")!.value);
  const month = Number(parts.find((part) => part.type === "month")!.value);
  const next = new Date(Date.UTC(year, month, 1));
  const startsAt = zonedCalendarTime(year, month, 1, 0, 0, timezone);
  const endsAt = zonedCalendarTime(next.getUTCFullYear(), next.getUTCMonth() + 1, 1, 0, 0, timezone);
  return { name: `${year}-${String(month).padStart(2, "0")} 薪资`, timezone, startsAt, endsAt, cutoffAt: endsAt, automatic: true };
}

/** Also repairs missed months after downtime; never reshapes a legacy ledger. */
export async function ensureMonthlyPeriods(db: Database, organizationId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    await lockPayrollInputs(tx, organizationId);
    const [organization] = await tx.select().from(organizations).where(eq(organizations.id, organizationId));
    if (!organization) return [];
    const existing = await tx.select().from(payPeriods).where(eq(payPeriods.organizationId, organizationId)).orderBy(asc(payPeriods.startsAt));
    const [firstWork] = await tx.select({ at: workSessions.startAt }).from(workSessions).where(and(
      eq(workSessions.organizationId, organizationId), eq(workSessions.recordKind, "fact"), isNull(workSessions.deletedAt), lt(workSessions.startAt, now),
    )).orderBy(asc(workSessions.startAt)).limit(1);
    // An indefinitely effective plan can predate the organization by years.
    // Catch up from actual work or an existing ledger, never invent old wages
    // merely because a plan has an early effectiveFrom.
    const first = new Date(Math.min(now.getTime(), ...[firstWork?.at, existing[0]?.startsAt].flatMap((at) => at ? [at.getTime()] : [])));
    const issues: Array<{ periodId: string; message: string }> = [];
    let month = monthlyPeriod(first, organization.timezone);
    while (month.startsAt <= now) {
      const overlaps = existing.filter((period) => period.startsAt < month.endsAt && period.endsAt > month.startsAt);
      if (!overlaps.length) {
        const [created] = await tx.insert(payPeriods).values({ organizationId, ...month }).returning();
        await tx.insert(auditLogs).values({ organizationId, action: "payroll.monthly_period_created", entityType: "pay_period", entityId: created!.id, after: created });
      } else if (!overlaps.some((period) => period.startsAt.getTime() === month.startsAt.getTime() && period.endsAt.getTime() === month.endsAt.getTime())) {
        issues.push({ periodId: overlaps[0]!.id, message: `${month.name} 与历史自定义周期重叠，已保留原账期，请核对历史范围。` });
      }
      month = monthlyPeriod(month.endsAt, organization.timezone);
    }
    return issues;
  });
}
