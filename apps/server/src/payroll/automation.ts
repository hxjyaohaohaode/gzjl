import type { Database } from "@workbench/db";
import { organizationOwners } from "@workbench/db/schema";
import type { FastifyInstance } from "fastify";
import { PayrollService } from "./service.js";

export async function synchronizePayroll(db: Database, report: (error: unknown, organizationId: string) => void) {
  const owners = await db.select().from(organizationOwners);
  for (const owner of owners) {
    try { await new PayrollService(db).synchronizeMonthly({ organizationId: owner.organizationId, membershipId: owner.membershipId }); }
    catch (error) { report(error, owner.organizationId); }
  }
}

/** Runs without an open browser, catches up on restart, and drains on shutdown. */
export function registerPayrollAutomation(app: FastifyInstance, db: Database) {
  let running: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const tick = () => {
    if (running) return;
    running = synchronizePayroll(db, (err, organizationId) => app.log.error({ err, organizationId }, "monthly payroll failed"))
      .catch((err: unknown) => app.log.error({ err }, "monthly payroll scheduler failed"))
      .finally(() => { running = undefined; });
  };
  app.addHook("onReady", async () => { tick(); timer = setInterval(tick, 60_000); timer.unref(); });
  app.addHook("onClose", async () => { clearInterval(timer); await running; });
}
