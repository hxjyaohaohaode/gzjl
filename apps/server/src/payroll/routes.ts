import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import { requirePermission } from "../auth/authorization.js";
import {
  PayrollConflictError,
  PayrollNotFoundError,
  type PayrollService,
} from "./service.js";

const periodParams = z.object({ payPeriodId: z.uuid() });
const runParams = z.object({ runId: z.uuid() });

export async function registerPayrollRoutes(
  app: FastifyInstance,
  service: PayrollService,
  authenticate: preHandlerHookHandler,
): Promise<void> {
  const ownPermission = requirePermission("payroll.view_own", (request) => ({
    scopeKind: "self",
    scopeId: request.auth?.membershipId ?? null,
  }));
  const settlePermission = requirePermission("payroll.settle", () => ({
    scopeKind: "organization",
  }));

  app.get(
    "/api/payroll/me",
    { preHandler: [authenticate, ownPermission] },
    async (request) => ({ items: await service.listOwn(request.auth!) }),
  );

  app.post(
    "/api/pay-periods/:payPeriodId/calculate",
    { preHandler: [app.csrfProtection, authenticate, settlePermission] },
    async (request, reply) => {
      const { payPeriodId } = periodParams.parse(request.params);
      try {
        const run = await service.calculate(request.auth!, payPeriodId);
        return reply.code(202).send({ run });
      } catch (error) {
        if (error instanceof PayrollNotFoundError) {
          return reply.code(404).send({ error: "payroll_not_found", message: error.message });
        }
        if (error instanceof PayrollConflictError) {
          return reply.code(409).send({ error: "payroll_conflict", message: error.message });
        }
        throw error;
      }
    },
  );

  app.post(
    "/api/payroll-runs/:runId/settle",
    { preHandler: [app.csrfProtection, authenticate, settlePermission] },
    async (request, reply) => {
      const { runId } = runParams.parse(request.params);
      try {
        return { run: await service.settle(request.auth!, runId) };
      } catch (error) {
        if (error instanceof PayrollNotFoundError) {
          return reply.code(404).send({ error: "payroll_not_found", message: error.message });
        }
        if (error instanceof PayrollConflictError) {
          return reply.code(409).send({ error: "payroll_conflict", message: error.message });
        }
        throw error;
      }
    },
  );
}
