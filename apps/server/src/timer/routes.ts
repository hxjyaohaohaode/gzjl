import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import { requirePermission } from "../auth/authorization.js";
import {
  ActiveTimerConflictError,
  TimerEventConflictError,
  TimerNotFoundError,
  type TimerService,
} from "./service.js";

const startSchema = z.object({
  eventId: z.uuid(),
  occurredAt: z.iso.datetime({ offset: true }),
  content: z.string().trim().min(1).max(10_000),
  result: z.string().max(10_000).default(""),
  blockers: z.string().max(5_000).default(""),
  nextStep: z.string().max(5_000).default(""),
  primaryProjectNodeId: z.uuid().nullable().default(null),
  visibility: z
    .enum(["private", "management_only", "project_visible"])
    .default("management_only"),
  timezone: z.string().min(1).max(100).default("Asia/Shanghai"),
});
const paramsSchema = z.object({ timerId: z.uuid() });
const eventSchema = z.object({
  eventId: z.uuid(),
  eventType: z.enum(["pause", "resume", "break_start", "break_end", "stop"]),
  occurredAt: z.iso.datetime({ offset: true }),
});

export async function registerTimerRoutes(
  app: FastifyInstance,
  service: TimerService,
  authenticate: preHandlerHookHandler,
): Promise<void> {
  const ownPermission = requirePermission("work.view_own", (request) => ({
    scopeKind: "self",
    scopeId: request.auth?.membershipId ?? null,
  }));
  const protectedRead = [authenticate, ownPermission];
  const protectedWrite = [app.csrfProtection, authenticate, ownPermission];

  app.get("/api/timer", { preHandler: protectedRead }, async (request) => ({
    timer: await service.getCurrent(request.auth!),
  }));

  app.post("/api/timer/start", { preHandler: protectedWrite }, async (request, reply) => {
    const input = startSchema.parse(request.body);
    try {
      const timer = await service.start(request.auth!, {
        ...input,
        occurredAt: new Date(input.occurredAt),
      });
      return reply.code(201).send({ timer });
    } catch (error) {
      if (error instanceof ActiveTimerConflictError || error instanceof TimerEventConflictError) {
        return reply.code(409).send({ error: "timer_conflict", message: error.message });
      }
      throw error;
    }
  });

  app.post(
    "/api/timer/:timerId/events",
    { preHandler: protectedWrite },
    async (request, reply) => {
      const { timerId } = paramsSchema.parse(request.params);
      const input = eventSchema.parse(request.body);
      try {
        const timer = await service.transition(request.auth!, timerId, {
          ...input,
          occurredAt: new Date(input.occurredAt),
        });
        return { timer };
      } catch (error) {
        if (error instanceof TimerNotFoundError) {
          return reply.code(404).send({ error: "timer_not_found", message: error.message });
        }
        if (error instanceof TimerEventConflictError) {
          return reply.code(409).send({ error: "timer_conflict", message: error.message });
        }
        throw error;
      }
    },
  );
}
