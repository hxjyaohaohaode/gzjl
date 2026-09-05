import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { createWorkSessionSchema } from "@workbench/shared";

import { requirePermission } from "../auth/authorization.js";
import {
  WorkSessionConflictError,
  WorkSessionEvidenceRequiredError,
  WorkSessionValidationError,
  WorkSessionVersionConflictError,
} from "./service.js";
import type { WorkSessionService } from "./service.js";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: z.iso.datetime({ offset: true }).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  recordKind: z.enum(["all", "fact", "plan"]).default("all"),
}).refine(
  (value) =>
    !value.from || !value.to || new Date(value.from) < new Date(value.to),
  { message: "时间范围必须满足 from 早于 to。", path: ["to"] },
);
const versionListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
const submitParamsSchema = z.object({ sessionId: z.uuid() });
const submitBodySchema = z.object({ expectedVersion: z.number().int().positive() });
const updateWorkSessionSchema = z
  .object({ expectedVersion: z.number().int().positive() })
  .and(createWorkSessionSchema);
const scheduleSchema = z.object({ expectedVersion: z.number().int().positive(), startAt: z.iso.datetime({ offset: true }), endAt: z.iso.datetime({ offset: true }) });
const structuredBatchSchema = z.object({
  entries: z
    .array(
      z.object({
        recordKind: z.enum(["fact", "plan"]),
        input: createWorkSessionSchema,
      }),
    )
    .min(2, "批量录入至少需要两段工作。")
    .max(24, "一次最多录入 24 段工作。"),
});

export async function registerWorkRoutes(
  app: FastifyInstance,
  service: WorkSessionService,
  authenticate: preHandlerHookHandler,
): Promise<void> {
  const ownPermission = requirePermission("work.view_own", (request) => ({
    scopeKind: "self",
    scopeId: request.auth?.membershipId ?? null,
  }));

  app.get(
    "/api/work-sessions",
    { preHandler: [authenticate, ownPermission] },
    async (request) => {
      const query = listQuerySchema.parse(request.query);
      const actor = request.auth!;
      const items = await service.listOwn(
        actor,
        query.limit,
        {
          before: query.before ? new Date(query.before) : undefined,
          from: query.from ? new Date(query.from) : undefined,
          to: query.to ? new Date(query.to) : undefined,
          recordKind: query.recordKind === "all" ? undefined : query.recordKind,
        },
      );
      return {
        items,
        nextCursor: items.length === query.limit ? items.at(-1)?.startAt.toISOString() : null,
      };
    },
  );

  app.post(
    "/api/work-sessions",
    { preHandler: [app.csrfProtection, authenticate, ownPermission] },
    async (request, reply) => {
      const input = createWorkSessionSchema.parse(request.body);
      try {
        const session = await service.createManual(request.auth!, input, {
          requestId: request.id,
          ...(request.headers["user-agent"]
            ? { userAgent: request.headers["user-agent"] }
            : {}),
        });
        return reply.code(201).send({ session });
      } catch (error) {
        if (error instanceof WorkSessionValidationError) {
          return reply.code(400).send({ error: "invalid_work_session", message: error.message });
        }
        if (error instanceof WorkSessionConflictError) {
          return reply.code(409).send({ error: "work_session_overlap", message: error.message });
        }
        throw error;
      }
    },
  );

  app.post(
    "/api/work-entries/batch",
    { preHandler: [app.csrfProtection, authenticate, ownPermission] },
    async (request, reply) => {
      const { entries } = structuredBatchSchema.parse(request.body);
      try {
        const sessions = await service.createStructuredBatch(
          request.auth!,
          entries,
          {
            requestId: request.id,
            ...(request.headers["user-agent"]
              ? { userAgent: request.headers["user-agent"] }
              : {}),
          },
        );
        return reply.code(201).send({ sessions });
      } catch (error) {
        if (error instanceof WorkSessionValidationError) {
          return reply
            .code(400)
            .send({ error: "invalid_work_batch", message: error.message });
        }
        if (error instanceof WorkSessionConflictError) {
          return reply
            .code(409)
            .send({ error: "work_batch_overlap", message: error.message });
        }
        throw error;
      }
    },
  );

  // Plans use the same structured fields and immutable version chain as a
  // draft, but the service marks them as `plan` so no other business subsystem
  // can mistake an upcoming intention for completed work.
  app.post(
    "/api/work-plans",
    { preHandler: [app.csrfProtection, authenticate, ownPermission] },
    async (request, reply) => {
      const input = createWorkSessionSchema.parse(request.body);
      try {
        const session = await service.createPlan(request.auth!, input, {
          requestId: request.id,
          ...(request.headers["user-agent"]
            ? { userAgent: request.headers["user-agent"] }
            : {}),
        });
        return reply.code(201).send({ session });
      } catch (error) {
        if (error instanceof WorkSessionValidationError) {
          return reply
            .code(400)
            .send({ error: "invalid_work_plan", message: error.message });
        }
        if (error instanceof WorkSessionConflictError) {
          return reply
            .code(409)
            .send({ error: "work_plan_overlap", message: error.message });
        }
        throw error;
      }
    },
  );

  app.post(
    "/api/work-plans/:sessionId/realize",
    { preHandler: [app.csrfProtection, authenticate, ownPermission] },
    async (request, reply) => {
      const { sessionId } = submitParamsSchema.parse(request.params);
      const { expectedVersion } = submitBodySchema.parse(request.body);
      try {
        return {
          session: await service.realizePlanOwn(
            request.auth!,
            sessionId,
            expectedVersion,
          ),
        };
      } catch (error) {
        if (error instanceof WorkSessionValidationError) {
          return reply
            .code(400)
            .send({ error: "invalid_work_plan", message: error.message });
        }
        if (
          error instanceof WorkSessionConflictError ||
          error instanceof WorkSessionVersionConflictError
        ) {
          return reply
            .code(409)
            .send({ error: "work_plan_conflict", message: error.message });
        }
        throw error;
      }
    },
  );

  app.get(
    "/api/work-sessions/:sessionId/versions",
    { preHandler: [authenticate, ownPermission] },
    async (request) => {
      const { sessionId } = submitParamsSchema.parse(request.params);
      const { limit } = versionListQuerySchema.parse(request.query);
      return {
        items: await service.listVersionsOwn(request.auth!, sessionId, limit),
      };
    },
  );

  app.patch(
    "/api/work-sessions/:sessionId",
    { preHandler: [app.csrfProtection, authenticate, ownPermission] },
    async (request, reply) => {
      const { sessionId } = submitParamsSchema.parse(request.params);
      const { expectedVersion, ...input } = updateWorkSessionSchema.parse(
        request.body,
      );
      try {
        return {
          session: await service.updateManualOwn(
            request.auth!,
            sessionId,
            expectedVersion,
            input,
            {
              requestId: request.id,
              ...(request.headers["user-agent"]
                ? { userAgent: request.headers["user-agent"] }
                : {}),
            },
          ),
        };
      } catch (error) {
        if (error instanceof WorkSessionValidationError) {
          return reply
            .code(400)
            .send({ error: "invalid_work_session", message: error.message });
        }
        if (
          error instanceof WorkSessionConflictError ||
          error instanceof WorkSessionVersionConflictError
        ) {
          return reply
            .code(409)
            .send({ error: "work_session_conflict", message: error.message });
        }
        throw error;
      }
    },
  );

  app.patch(
    "/api/work-sessions/:sessionId/schedule",
    { preHandler: [app.csrfProtection, authenticate, ownPermission] },
    async (request, reply) => {
      const { sessionId } = submitParamsSchema.parse(request.params);
      const input = scheduleSchema.parse(request.body);
      try {
        return { session: await service.rescheduleOwn(request.auth!, sessionId, input.expectedVersion, new Date(input.startAt), new Date(input.endAt)) };
      } catch (error) {
        if (error instanceof WorkSessionValidationError) return reply.code(400).send({ error: "invalid_work_session", message: error.message });
        if (error instanceof WorkSessionConflictError || error instanceof WorkSessionVersionConflictError) return reply.code(409).send({ error: "work_session_conflict", message: error.message });
        throw error;
      }
    },
  );

  app.post(
    "/api/work-sessions/:sessionId/submit",
    { preHandler: [app.csrfProtection, authenticate, ownPermission] },
    async (request, reply) => {
      const { sessionId } = submitParamsSchema.parse(request.params);
      const { expectedVersion } = submitBodySchema.parse(request.body);
      try {
        const session = await service.submit(request.auth!, sessionId, expectedVersion);
        return { session };
      } catch (error) {
        if (error instanceof WorkSessionEvidenceRequiredError) {
          return reply.code(422).send({ error: "evidence_required", message: error.message });
        }
        if (error instanceof WorkSessionVersionConflictError) {
          return reply.code(409).send({ error: "version_conflict", message: error.message });
        }
        throw error;
      }
    },
  );

  app.post(
    "/api/work-sessions/:sessionId/withdraw",
    { preHandler: [app.csrfProtection, authenticate, ownPermission] },
    async (request, reply) => {
      const { sessionId } = submitParamsSchema.parse(request.params);
      const { expectedVersion } = submitBodySchema.parse(request.body);
      try {
        const session = await service.withdrawSubmission(
          request.auth!,
          sessionId,
          expectedVersion,
        );
        return { session };
      } catch (error) {
        if (error instanceof WorkSessionVersionConflictError) {
          return reply.code(409).send({ error: "version_conflict", message: error.message });
        }
        throw error;
      }
    },
  );
}
