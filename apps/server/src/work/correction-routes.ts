import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { createWorkSessionSchema } from "@workbench/shared";

import { requirePermission } from "../auth/authorization.js";
import {
  WorkCorrectionConflictError,
  WorkCorrectionForbiddenError,
  WorkCorrectionNotFoundError,
  WorkCorrectionValidationError,
  type WorkCorrectionService,
} from "./correction-service.js";

const sessionParams = z.object({ sessionId: z.uuid() });
const correctionParams = z.object({ correctionId: z.uuid() });
const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
const correctionRequestSchema = createWorkSessionSchema.and(
  z.object({ reason: z.string().trim().min(5).max(2_000) }),
);
// PostgreSQL stores payroll amounts as numeric(20, 6): at most fourteen whole
// digits plus six fractional digits. Validate that boundary at the API edge so
// a reviewer receives an actionable validation error instead of a database
// precision failure after approving a locked-record correction.
const adjustmentAmountSchema = z
  .string()
  .regex(
    /^-?(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?$/,
    "调整金额最多 14 位整数和 6 位小数。",
  );
const decisionSchema = z
  .object({
    decision: z.enum(["approved", "rejected"]),
    reviewNote: z.string().trim().max(2_000).optional(),
    adjustmentAmount: adjustmentAmountSchema.optional(),
  })
  .superRefine((input, context) => {
    if (input.decision === "rejected" && !input.reviewNote) {
      context.addIssue({
        code: "custom",
        path: ["reviewNote"],
        message: "驳回更正申请时必须填写审核说明。",
      });
    }
    if (
      input.adjustmentAmount &&
      /^-?0(?:\.0+)?$/.test(input.adjustmentAmount)
    ) {
      context.addIssue({
        code: "custom",
        path: ["adjustmentAmount"],
        message: "金额为零时无需创建下期调整；请留空即可。",
      });
    }
  });

function sendCorrectionError(
  error: unknown,
  reply: { code: (statusCode: number) => { send: (payload: object) => unknown } },
) {
  if (error instanceof WorkCorrectionNotFoundError) {
    return reply.code(404).send({ error: "work_correction_not_found", message: error.message });
  }
  if (error instanceof WorkCorrectionForbiddenError) {
    return reply.code(403).send({ error: "work_correction_forbidden", message: error.message });
  }
  if (error instanceof WorkCorrectionValidationError) {
    return reply.code(400).send({ error: "invalid_work_correction", message: error.message });
  }
  if (error instanceof WorkCorrectionConflictError) {
    return reply.code(409).send({ error: "work_correction_conflict", message: error.message });
  }
  throw error;
}

export async function registerWorkCorrectionRoutes(
  app: FastifyInstance,
  service: WorkCorrectionService,
  authenticate: preHandlerHookHandler,
): Promise<void> {
  const ownPermission = requirePermission("work.view_own", (request) => ({
    scopeKind: "self",
    scopeId: request.auth?.membershipId ?? null,
  }));

  app.get(
    "/api/work-session-corrections/mine",
    { preHandler: [authenticate, ownPermission] },
    async (request) => {
      const { limit } = listSchema.parse(request.query);
      return { items: await service.listOwn(request.auth!, limit) };
    },
  );
  app.get(
    "/api/work-session-corrections/pending",
    { preHandler: authenticate },
    async (request) => {
      const { limit } = listSchema.parse(request.query);
      return { items: await service.listPending(request.auth!, limit) };
    },
  );
  app.post(
    "/api/work-sessions/:sessionId/corrections",
    { preHandler: [app.csrfProtection, authenticate, ownPermission] },
    async (request, reply) => {
      const { sessionId } = sessionParams.parse(request.params);
      const { reason, ...proposal } = correctionRequestSchema.parse(request.body);
      try {
        const correction = await service.requestOwn(
          request.auth!,
          sessionId,
          proposal,
          reason,
        );
        return reply.code(201).send({ correction });
      } catch (error) {
        return sendCorrectionError(error, reply);
      }
    },
  );
  app.post(
    "/api/work-session-corrections/:correctionId/decision",
    { preHandler: [app.csrfProtection, authenticate] },
    async (request, reply) => {
      const { correctionId } = correctionParams.parse(request.params);
      const input = decisionSchema.parse(request.body);
      try {
        return await service.decide(request.auth!, correctionId, {
          decision: input.decision,
          ...(input.reviewNote ? { reviewNote: input.reviewNote } : {}),
          ...(input.adjustmentAmount
            ? {
                adjustment: {
                  amount: input.adjustmentAmount,
                },
              }
            : {}),
        });
      } catch (error) {
        return sendCorrectionError(error, reply);
      }
    },
  );
}
