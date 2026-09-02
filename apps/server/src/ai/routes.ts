import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import { AiUnavailableError, type AiService } from "./service.js";
import { isAuthorized } from "../auth/authorization.js";

const requestSchema = z.object({ scope: z.enum(["self", "team"]).default("self"), from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) }).refine((value) => new Date(value.to) > new Date(value.from), { message: "结束时间必须晚于开始时间" });
const reportParams = z.object({ reportId: z.uuid() });

export async function registerAiRoutes(app: FastifyInstance, service: AiService, authenticate: preHandlerHookHandler): Promise<void> {
  app.get("/api/ai/reports", { preHandler: authenticate }, async (request) => ({ items: await service.list(request.auth!) }));
  app.get("/api/ai/reports/:reportId", { preHandler: authenticate }, async (request, reply) => { const { reportId } = reportParams.parse(request.params); const result = await service.detail(request.auth!, reportId); return result ?? reply.code(404).send({ error: "report_not_found", message: "报告不存在。" }); });
  app.post("/api/ai/reports", { preHandler: [app.csrfProtection, authenticate] }, async (request, reply) => { const input = requestSchema.parse(request.body); if (input.scope === "team" && (!request.auth || !isAuthorized(request.auth.grants, "ai.team_analysis", { scopeKind: "organization" }))) return reply.code(403).send({ error: "forbidden", message: "当前账号没有组织级团队 AI 分析权限。" }); try { const job = await service.requestReport(request.auth!, input.scope, new Date(input.from), new Date(input.to)); return reply.code(202).send({ job }); } catch (error) { if (error instanceof AiUnavailableError) return reply.code(503).send({ error: "ai_unavailable", message: error.message }); throw error; } });
}
