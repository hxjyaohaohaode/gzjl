import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import type { SearchService } from "./service.js";

const searchQuery = z.object({
  q: z.string().trim().min(2).max(80),
  limit: z.coerce.number().int().min(1).max(10).default(5),
});

export async function registerSearchRoutes(
  app: FastifyInstance,
  service: SearchService,
  authenticate: preHandlerHookHandler,
): Promise<void> {
  app.get("/api/search", { preHandler: authenticate }, async (request) => {
    const query = searchQuery.parse(request.query);
    return { items: await service.search(request.auth!, query.q, query.limit) };
  });
}
