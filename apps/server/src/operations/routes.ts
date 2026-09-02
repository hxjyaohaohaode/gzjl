import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import { requirePermission } from "../auth/authorization.js";
import { ImportValidationError, type OperationsService } from "./service.js";

const rangeQuery = z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) }).refine((value) => new Date(value.to) > new Date(value.from), { message: "结束时间必须晚于开始时间" });
const csvBody = z.object({ csv: z.string().min(1).max(5 * 1024 * 1024) });
const importParams = z.object({ importId: z.uuid() });
const auditQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100), before: z.iso.datetime({ offset: true }).optional() });

export async function registerOperationsRoutes(app: FastifyInstance, service: OperationsService, authenticate: preHandlerHookHandler): Promise<void> {
  const requireOrgImport = requirePermission("import.scope", () => ({ scopeKind: "organization" }));
  const requireOrgExport = requirePermission("export.scope", () => ({ scopeKind: "organization" }));
  app.get("/api/exports/work-sessions.csv", { preHandler: [authenticate, requireOrgExport] }, async (request, reply) => { const query = rangeQuery.parse(request.query); const result = await service.exportWorkSessions(request.auth!, new Date(query.from), new Date(query.to)); return reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", 'attachment; filename="work-sessions.csv"').header("x-content-sha256", result.sha256).send(`\uFEFF${result.csv}`); });
  app.post("/api/imports/work-sessions/preview", { preHandler: [app.csrfProtection, authenticate, requireOrgImport] }, async (request, reply) => { const { csv } = csvBody.parse(request.body); try { return await service.createImportPreview(request.auth!, csv); } catch (error) { if (error instanceof ImportValidationError) return reply.code(400).send({ error: "invalid_import", message: error.message }); throw error; } });
  app.post("/api/imports/:importId/confirm", { preHandler: [app.csrfProtection, authenticate, requireOrgImport] }, async (request, reply) => { const { importId } = importParams.parse(request.params); const { csv } = csvBody.parse(request.body); try { return await service.confirmImport(request.auth!, importId, csv); } catch (error) { if (error instanceof ImportValidationError) return reply.code(409).send({ error: "import_conflict", message: error.message }); throw error; } });
  app.get("/api/audit", { preHandler: [authenticate, requirePermission("audit.view", () => ({ scopeKind: "organization" }))] }, async (request) => { const query = auditQuery.parse(request.query); return { items: await service.audit(request.auth!, query.limit, query.before ? new Date(query.before) : undefined) }; });
}
