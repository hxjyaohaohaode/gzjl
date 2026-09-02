import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import type { AnalyticsService } from "./service.js";

const summaryQuery = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
  })
  .refine((input) => new Date(input.to) > new Date(input.from), {
    message: "to must be later than from",
  })
  .refine(
    (input) => new Date(input.to).getTime() - new Date(input.from).getTime() <= 366 * 86_400_000,
    { message: "分析区间不能超过 366 天" },
  );
const activityQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) });

export async function registerAnalyticsRoutes(
  app: FastifyInstance,
  service: AnalyticsService,
  authenticate: preHandlerHookHandler,
): Promise<void> {
  app.get("/api/analytics/summary", { preHandler: authenticate }, async (request) => {
    const query = summaryQuery.parse(request.query);
    return service.summary(request.auth!, new Date(query.from), new Date(query.to));
  });
  app.get("/api/team-activity", { preHandler: authenticate }, async (request) => {
    const { limit } = activityQuery.parse(request.query);
    return { items: await service.teamActivity(request.auth!, limit) };
  });
}
