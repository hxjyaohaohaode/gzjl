import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import {
  ApprovalConflictError,
  ApprovalNotFoundError,
  type ApprovalService,
} from "./service.js";

const listSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });
const paramsSchema = z.object({ requestId: z.uuid() });
const decisionSchema = z.object({
  decision: z.enum(["approved", "returned"]),
  reason: z.string().trim().max(2_000).optional(),
});
const correctionSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(2).max(2_000),
    content: z.string().trim().min(1).max(10_000).optional(),
    result: z.string().trim().max(10_000).optional(),
    blockers: z.string().trim().max(5_000).optional(),
    nextStep: z.string().trim().max(5_000).optional(),
  })
  .refine((input) => input.content !== undefined || input.result !== undefined || input.blockers !== undefined || input.nextStep !== undefined, {
    message: "至少提供一个更正字段",
  });

export async function registerApprovalRoutes(
  app: FastifyInstance,
  service: ApprovalService,
  authenticate: preHandlerHookHandler,
): Promise<void> {
  const requireReviewer: preHandlerHookHandler = async (request, reply) => {
    if (!request.auth?.grants.some((grant) => grant.permission === "work.review")) {
      return reply.code(403).send({
        error: "forbidden",
        message: "当前账号没有工时审核权限请联系管理员以明确细节。",
        requestId: request.id,
      });
    }
  };
  const readHooks = [authenticate, requireReviewer];
  const writeHooks = [app.csrfProtection, authenticate, requireReviewer];

  app.get("/api/approvals", { preHandler: readHooks }, async (request) => {
    const { limit } = listSchema.parse(request.query);
    return { items: await service.listPending(request.auth!, limit) };
  });

  app.post("/api/approvals/:requestId/decision", { preHandler: writeHooks }, async (request, reply) => {
    const { requestId } = paramsSchema.parse(request.params);
    const input = decisionSchema.parse(request.body);
    try {
      return await service.decide(request.auth!, requestId, input.decision, input.reason);
    } catch (error) {
      if (error instanceof ApprovalNotFoundError) {
        return reply.code(404).send({ error: "approval_not_found", message: error.message });
      }
      if (error instanceof ApprovalConflictError) {
        return reply.code(409).send({ error: "approval_conflict", message: error.message });
      }
      throw error;
    }
  });

  app.post("/api/approvals/:requestId/corrections", { preHandler: writeHooks }, async (request, reply) => {
    const { requestId } = paramsSchema.parse(request.params);
    const input = correctionSchema.parse(request.body);
    const { expectedVersion, reason, ...changes } = input;
    try {
      return { session: await service.managementCorrect(request.auth!, requestId, expectedVersion, changes, reason) };
    } catch (error) {
      if (error instanceof ApprovalNotFoundError) {
        return reply.code(404).send({ error: "approval_not_found", message: error.message });
      }
      if (error instanceof ApprovalConflictError) {
        return reply.code(409).send({ error: "approval_conflict", message: error.message });
      }
      throw error;
    }
  });
}
