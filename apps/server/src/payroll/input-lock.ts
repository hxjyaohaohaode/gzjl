import { sql } from "drizzle-orm";
import type { Database } from "@workbench/db";

/** Acquire before member, period, timer or fact row locks. All payroll-input
 * writers share this lock so settlement validation has no phantom-write gap. */
export async function lockPayrollInputs(db: Pick<Database, "execute">, organizationId: string): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`payroll-inputs:${organizationId}`}))`);
}
