import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import { isAuthorized, requirePermission } from "../auth/authorization.js";
import {
  ProjectNotFoundError,
  ProjectTreeValidationError,
  ProjectVersionConflictError,
  type ProjectService,
} from "./service.js";

const projectIdParams = z.object({ projectId: z.uuid() });
const nodeParams = z.object({ projectId: z.uuid(), nodeId: z.uuid() });
const createProjectSchema = z.object({
  key: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_-]{1,15}$/),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(10_000).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#3468f5"),
  startAt: z.iso.datetime({ offset: true }).optional(),
  dueAt: z.iso.datetime({ offset: true }).optional(),
});
const createNodeSchema = z.object({
  branchId: z.uuid(),
  parentId: z.uuid().nullable().default(null),
  type: z.enum(["phase", "milestone", "task", "deliverable", "decision"]).default("task"),
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(20_000).optional(),
  startAt: z.iso.datetime({ offset: true }).optional(),
  dueAt: z.iso.datetime({ offset: true }).optional(),
  sortOrder: z.number().int().min(0).default(0),
});
const createBranchSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(10_000).optional(),
  parentBranchId: z.uuid().optional(),
  sourceNodeId: z.uuid().optional(),
});
const updateNodeSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().trim().max(20_000).nullable().optional(),
    status: z.enum(["not_started", "in_progress", "blocked", "in_review", "completed", "cancelled"]).optional(),
    progress: z.number().min(0).max(100).optional(),
    changeSummary: z.string().trim().min(2).max(500),
  })
  .refine((input) => input.title !== undefined || input.description !== undefined || input.status !== undefined || input.progress !== undefined, {
    message: "至少提供一个要更新的字段",
  });
const moveNodeSchema = z.object({
  expectedVersion: z.number().int().positive(),
  parentId: z.uuid().nullable(),
  sortOrder: z.number().int().min(0),
});
const rollbackSchema = z.object({
  expectedVersion: z.number().int().positive(),
  targetVersion: z.number().int().positive(),
});
const versionOnlySchema = z.object({ expectedVersion: z.number().int().positive() });

function mapProjectError(error: unknown, reply: FastifyReply) {
  if (error instanceof ProjectNotFoundError) {
    return reply.code(404).send({ error: "project_not_found", message: error.message });
  }
  if (error instanceof ProjectVersionConflictError) {
    return reply.code(409).send({ error: "version_conflict", message: error.message });
  }
  if (error instanceof ProjectTreeValidationError) {
    return reply.code(400).send({ error: "invalid_project_tree", message: error.message });
  }
  throw error;
}

export async function registerProjectRoutes(
  app: FastifyInstance,
  service: ProjectService,
  authenticate: preHandlerHookHandler,
): Promise<void> {
  const canViewAll = (request: Parameters<preHandlerHookHandler>[0]) =>
    Boolean(
      request.auth &&
        isAuthorized(request.auth.grants, "project.view_all", { scopeKind: "organization" }),
    );

  app.get("/api/projects", { preHandler: authenticate }, async (request) => ({
    items: await service.list(request.auth!, canViewAll(request)),
  }));

  app.post(
    "/api/projects",
    {
      preHandler: [
        app.csrfProtection,
        authenticate,
        requirePermission("project.create", () => ({ scopeKind: "organization" })),
      ],
    },
    async (request, reply) => {
      const input = createProjectSchema.parse(request.body);
      const { startAt, dueAt, ...projectInput } = input;
      try {
        const result = await service.create(request.auth!, {
          ...projectInput,
          ...(startAt ? { startAt: new Date(startAt) } : {}),
          ...(dueAt ? { dueAt: new Date(dueAt) } : {}),
        });
        return reply.code(201).send(result);
      } catch (error) {
        return mapProjectError(error, reply);
      }
    },
  );

  app.get("/api/projects/:projectId/tree", { preHandler: authenticate }, async (request, reply) => {
    const { projectId } = projectIdParams.parse(request.params);
    try {
      return await service.tree(request.auth!, projectId, canViewAll(request));
    } catch (error) {
      return mapProjectError(error, reply);
    }
  });

  const manageProject = requirePermission("project.manage", (request) => ({
    scopeKind: "project",
    scopeId: projectIdParams.parse(request.params).projectId,
  }));
  const mutationHooks = [app.csrfProtection, authenticate, manageProject];

  app.post("/api/projects/:projectId/branches", { preHandler: mutationHooks }, async (request, reply) => {
    const { projectId } = projectIdParams.parse(request.params);
    try {
      const branch = await service.createBranch(request.auth!, projectId, createBranchSchema.parse(request.body));
      return reply.code(201).send({ branch });
    } catch (error) {
      return mapProjectError(error, reply);
    }
  });

  app.post("/api/projects/:projectId/nodes", { preHandler: mutationHooks }, async (request, reply) => {
    const { projectId } = projectIdParams.parse(request.params);
    const input = createNodeSchema.parse(request.body);
    const { startAt, dueAt, ...nodeInput } = input;
    try {
      const node = await service.createNode(request.auth!, projectId, {
        ...nodeInput,
        ...(startAt ? { startAt: new Date(startAt) } : {}),
        ...(dueAt ? { dueAt: new Date(dueAt) } : {}),
      });
      return reply.code(201).send({ node });
    } catch (error) {
      return mapProjectError(error, reply);
    }
  });

  app.patch("/api/projects/:projectId/nodes/:nodeId", { preHandler: mutationHooks }, async (request, reply) => {
    const { projectId, nodeId } = nodeParams.parse(request.params);
    const input = updateNodeSchema.parse(request.body);
    try {
      return { node: await service.updateNode(request.auth!, projectId, nodeId, input.expectedVersion, input) };
    } catch (error) {
      return mapProjectError(error, reply);
    }
  });

  app.post("/api/projects/:projectId/nodes/:nodeId/move", { preHandler: mutationHooks }, async (request, reply) => {
    const { projectId, nodeId } = nodeParams.parse(request.params);
    const input = moveNodeSchema.parse(request.body);
    try {
      return { node: await service.moveNode(request.auth!, projectId, nodeId, input.expectedVersion, input.parentId, input.sortOrder) };
    } catch (error) {
      return mapProjectError(error, reply);
    }
  });

  app.post("/api/projects/:projectId/nodes/:nodeId/rollback", { preHandler: mutationHooks }, async (request, reply) => {
    const { projectId, nodeId } = nodeParams.parse(request.params);
    const input = rollbackSchema.parse(request.body);
    try {
      return { node: await service.rollbackNode(request.auth!, projectId, nodeId, input.targetVersion, input.expectedVersion) };
    } catch (error) {
      return mapProjectError(error, reply);
    }
  });

  app.delete("/api/projects/:projectId/nodes/:nodeId", { preHandler: mutationHooks }, async (request, reply) => {
    const { projectId, nodeId } = nodeParams.parse(request.params);
    const input = versionOnlySchema.parse(request.body);
    try {
      await service.deleteNode(request.auth!, projectId, nodeId, input.expectedVersion);
      return reply.code(204).send();
    } catch (error) {
      return mapProjectError(error, reply);
    }
  });

  app.post("/api/projects/:projectId/nodes/:nodeId/restore", { preHandler: mutationHooks }, async (request, reply) => {
    const { projectId, nodeId } = nodeParams.parse(request.params);
    try {
      return { node: await service.restoreNode(request.auth!, projectId, nodeId) };
    } catch (error) {
      return mapProjectError(error, reply);
    }
  });
}
