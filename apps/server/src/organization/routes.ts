import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import { requirePermission } from "../auth/authorization.js";
import { OrganizationConflictError, type OrganizationService } from "./service.js";

const unitSchema = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(2_000).optional(), parentId: z.uuid().nullable().default(null) });
const inviteSchema = z.object({ displayName: z.string().trim().min(2).max(80), email: z.email().max(320), positionTitle: z.string().trim().max(120).optional(), orgUnitId: z.uuid().nullable().default(null), roleId: z.uuid() });
const acceptSchema = z.object({ token: z.string().min(32).max(500), password: z.string().min(12).max(1_024).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/).regex(/[^A-Za-z0-9]/) });

export async function registerOrganizationRoutes(app: FastifyInstance, service: OrganizationService, authenticate: preHandlerHookHandler): Promise<void> {
  const manageMembers = requirePermission("members.manage", () => ({ scopeKind: "organization" }));
  const manageOrg = requirePermission("org.manage", () => ({ scopeKind: "organization" }));
  app.get("/api/organization", { preHandler: [authenticate, manageMembers] }, async (request) => service.overview(request.auth!));
  app.post("/api/organization/units", { preHandler: [app.csrfProtection, authenticate, manageOrg] }, async (request, reply) => { const input = unitSchema.parse(request.body); try { return reply.code(201).send({ unit: await service.createUnit(request.auth!, input) }); } catch (error) { if (error instanceof OrganizationConflictError) return reply.code(409).send({ error: "organization_conflict", message: error.message }); throw error; } });
  app.post("/api/organization/invitations", { preHandler: [app.csrfProtection, authenticate, manageMembers] }, async (request, reply) => { const input = inviteSchema.parse(request.body); try { return reply.code(201).send(await service.invite(request.auth!, input)); } catch (error) { if (error instanceof OrganizationConflictError) return reply.code(409).send({ error: "organization_conflict", message: error.message }); throw error; } });
  app.post("/api/auth/invitations/accept", { preHandler: app.csrfProtection }, async (request, reply) => { const input = acceptSchema.parse(request.body); try { return { membership: await service.acceptInvitation(input.token, input.password) }; } catch (error) { if (error instanceof OrganizationConflictError) return reply.code(409).send({ error: "invitation_invalid", message: error.message }); throw error; } });
}
