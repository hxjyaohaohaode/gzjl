import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { createWorkSessionSchema } from "@workbench/shared";

import { requirePermission } from "../auth/authorization.js";
import {
  WorkSessionConflictError,
  WorkSessionValidationError,
  WorkSessionVersionConflictError,
} from "./service.js";
import type { WorkSessionService } from "./service.js";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: z.iso.datetime({ offset: true }).optional(),
});
const submitParamsSchema = z.object({ sessionId: z.uuid() });
const submitBodySchema = z.object({ expectedVersion: z.number().int().positive() });

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
        query.before ? new Date(query.before) : undefined,
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
    "/api/work-sessions/:sessionId/submit",
    { preHandler: [app.csrfProtection, authenticate, ownPermission] },
    async (request, reply) => {
      const { sessionId } = submitParamsSchema.parse(request.params);
      const { expectedVersion } = submitBodySchema.parse(request.body);
      try {
        const session = await service.submit(request.auth!, sessionId, expectedVersion);
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
