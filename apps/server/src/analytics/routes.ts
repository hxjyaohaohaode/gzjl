import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import type { AnalyticsService } from "./service.js";

const commaSeparated = <T extends z.ZodType>(item: T, max = 100) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === null || value === "") return undefined;
      const values = Array.isArray(value) ? value : [value];
      return values.flatMap((entry) =>
        String(entry)
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean),
      );
    },
    z.array(item).max(max).optional(),
  );

const summaryQuery = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    projectIds: commaSeparated(z.uuid()),
    nodeIds: commaSeparated(z.uuid()),
    workTypeIds: commaSeparated(z.uuid()),
    memberIds: commaSeparated(z.uuid()),
    orgUnitIds: commaSeparated(z.uuid()),
    approvalStates: commaSeparated(
      z.enum(["not_requested", "pending_review", "approved", "returned", "locked"]),
      5,
    ),
    sourceTypes: commaSeparated(z.enum(["manual", "timer", "import"]), 3),
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
    return service.summary(request.auth!, new Date(query.from), new Date(query.to), {
      projectIds: query.projectIds,
      nodeIds: query.nodeIds,
      workTypeIds: query.workTypeIds,
      memberIds: query.memberIds,
      orgUnitIds: query.orgUnitIds,
      approvalStates: query.approvalStates,
      sourceTypes: query.sourceTypes,
    });
  });
  app.get("/api/team-activity", { preHandler: authenticate }, async (request) => {
    const { limit } = activityQuery.parse(request.query);
    return { items: await service.teamActivity(request.auth!, limit) };
  });
}
