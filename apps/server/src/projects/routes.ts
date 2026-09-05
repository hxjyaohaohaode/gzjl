import type {
  FastifyInstance,
  FastifyReply,
  preHandlerHookHandler,
} from "fastify";
import { z } from "zod";

import { isAuthorized, requirePermission } from "../auth/authorization.js";
import {
  ProjectNotFoundError,
  ProjectTreeValidationError,
  ProjectVersionConflictError,
  type ProjectService,
} from "./service.js";

const projectIdParams = z.object({ projectId: z.uuid() });
const calendarMilestoneQuery = z
  .object({
    startAt: z.iso.datetime({ offset: true }),
    endAt: z.iso.datetime({ offset: true }),
  })
  .refine(
    (input) => new Date(input.endAt).getTime() > new Date(input.startAt).getTime(),
    { message: "里程碑查询结束时间必须晚于开始时间。" },
  )
  .refine(
    (input) =>
      new Date(input.endAt).getTime() - new Date(input.startAt).getTime() <=
      93 * 86_400_000,
    { message: "单次里程碑查询范围不能超过 93 天。" },
  );
const nodeParams = z.object({ projectId: z.uuid(), nodeId: z.uuid() });
const edgeParams = z.object({ projectId: z.uuid(), edgeId: z.uuid() });
const branchParams = z.object({ projectId: z.uuid(), branchId: z.uuid() });
const projectMemberParams = z.object({
  projectId: z.uuid(),
  membershipId: z.uuid(),
});
const createProjectSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[A-Za-z][A-Za-z0-9_-]{1,15}$/),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(10_000).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#3468f5"),
  startAt: z.iso.datetime({ offset: true }).optional(),
  dueAt: z.iso.datetime({ offset: true }).optional(),
});
const createNodeSchema = z.object({
  branchId: z.uuid(),
  parentId: z.uuid().nullable().default(null),
  type: z
    .enum(["phase", "milestone", "task", "deliverable", "decision"])
    .default("task"),
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(20_000).optional(),
  progress: z.number().min(0).max(100).optional(),
  progressMode: z
    .enum([
      "manual",
      "weighted_children",
      "time_weighted_children",
      "milestone_based",
    ])
    .default("manual"),
  weight: z.number().min(0).max(1_000_000).default(1),
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
const updateBranchSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(10_000).nullable().optional(),
    parentBranchId: z.uuid().nullable().optional(),
    changeSummary: z.string().trim().min(2).max(500),
  })
  .refine(
    (input) =>
      input.name !== undefined ||
      input.description !== undefined ||
      input.parentBranchId !== undefined,
    { message: "至少提供一个要更新的分支字段" },
  );
const mergeBranchSchema = z.object({
  expectedVersion: z.number().int().positive(),
  targetBranchId: z.uuid(),
});
const createEdgeSchema = z.object({
  sourceNodeId: z.uuid(),
  targetNodeId: z.uuid(),
  type: z.enum([
    "depends_on",
    "blocks",
    "relates_to",
    "replaces",
    "merges_into",
  ]),
  label: z.string().trim().min(1).max(160).optional(),
});
const updateNodeSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().trim().max(20_000).nullable().optional(),
    status: z
      .enum([
        "not_started",
        "in_progress",
        "blocked",
        "in_review",
        "completed",
        "cancelled",
      ])
      .optional(),
    progress: z.number().min(0).max(100).optional(),
    progressMode: z
      .enum([
        "manual",
        "weighted_children",
        "time_weighted_children",
        "milestone_based",
      ])
      .optional(),
    weight: z.number().min(0).max(1_000_000).optional(),
    startAt: z.iso.datetime({ offset: true }).nullable().optional(),
    dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
    changeSummary: z.string().trim().min(2).max(500),
  })
  .refine(
    (input) =>
      input.title !== undefined ||
      input.description !== undefined ||
      input.status !== undefined ||
      input.progress !== undefined ||
      input.progressMode !== undefined ||
      input.weight !== undefined ||
      input.startAt !== undefined ||
      input.dueAt !== undefined,
    {
      message: "至少提供一个要更新的字段",
    },
  );
const projectMemberSchema = z.object({
  role: z.enum(["lead", "member", "observer"]),
  publicActivityVisible: z.boolean().optional(),
});
const nodeAssigneesSchema = z.object({
  expectedVersion: z.number().int().positive(),
  assignments: z
    .array(
      z.object({
        membershipId: z.uuid(),
        isResponsible: z.boolean().optional(),
      }),
    )
    .max(100),
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
const versionOnlySchema = z.object({
  expectedVersion: z.number().int().positive(),
});

function mapProjectError(error: unknown, reply: FastifyReply) {
  if (error instanceof ProjectNotFoundError) {
    return reply
      .code(404)
      .send({ error: "project_not_found", message: error.message });
  }
  if (error instanceof ProjectVersionConflictError) {
    return reply
      .code(409)
      .send({ error: "version_conflict", message: error.message });
  }
  if (error instanceof ProjectTreeValidationError) {
    return reply
      .code(400)
      .send({ error: "invalid_project_tree", message: error.message });
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
      isAuthorized(request.auth.grants, "project.view_all", {
        scopeKind: "organization",
      }),
    );

  app.get("/api/projects", { preHandler: authenticate }, async (request) => ({
    items: await service.list(request.auth!, canViewAll(request)),
  }));

  app.get(
    "/api/projects/calendar-milestones",
    { preHandler: authenticate },
    async (request) => {
      const input = calendarMilestoneQuery.parse(request.query);
      return {
        items: await service.calendarMilestones(
          request.auth!,
          new Date(input.startAt),
          new Date(input.endAt),
          canViewAll(request),
        ),
      };
    },
  );

  app.post(
    "/api/projects",
    {
      preHandler: [
        app.csrfProtection,
        authenticate,
        requirePermission("project.create", () => ({
          scopeKind: "organization",
        })),
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

  app.get(
    "/api/projects/:projectId/tree",
    { preHandler: authenticate },
    async (request, reply) => {
      const { projectId } = projectIdParams.parse(request.params);
      try {
        return await service.tree(
          request.auth!,
          projectId,
          canViewAll(request),
        );
      } catch (error) {
        return mapProjectError(error, reply);
      }
    },
  );

  app.get(
    "/api/projects/:projectId/nodes/:nodeId/versions",
    { preHandler: authenticate },
    async (request, reply) => {
      const { projectId, nodeId } = nodeParams.parse(request.params);
      try {
        return {
          items: await service.nodeVersions(
            request.auth!,
            projectId,
            nodeId,
            canViewAll(request),
          ),
        };
      } catch (error) {
        return mapProjectError(error, reply);
      }
    },
  );

  app.get(
    "/api/projects/:projectId/nodes/:nodeId/work-sessions",
    { preHandler: authenticate },
    async (request, reply) => {
      const { projectId, nodeId } = nodeParams.parse(request.params);
      try {
        return {
          items: await service.nodeWorkSessions(
            request.auth!,
            projectId,
            nodeId,
            canViewAll(request),
          ),
        };
      } catch (error) {
        return mapProjectError(error, reply);
      }
    },
  );

  app.get(
    "/api/projects/:projectId/recycle-bin",
    { preHandler: authenticate },
    async (request, reply) => {
      const { projectId } = projectIdParams.parse(request.params);
      try {
        return {
          items: await service.recycleBin(
            request.auth!,
            projectId,
            canViewAll(request),
          ),
        };
      } catch (error) {
        return mapProjectError(error, reply);
      }
    },
  );

  const manageProject = requirePermission("project.manage", (request) => ({
    scopeKind: "project",
    scopeId: projectIdParams.parse(request.params).projectId,
  }));
  const mutationHooks = [app.csrfProtection, authenticate, manageProject];

  app.get(
    "/api/projects/:projectId/members",
    { preHandler: authenticate },
    async (request, reply) => {
      const { projectId } = projectIdParams.parse(request.params);
      try {
        return {
          items: await service.members(
            request.auth!,
            projectId,
            canViewAll(request),
          ),
        };
      } catch (error) {
        return mapProjectError(error, reply);
      }
    },
  );

  app.get(
    "/api/projects/:projectId/member-candidates",
    { preHandler: [authenticate, manageProject] },
    async (request, reply) => {
      const { projectId } = projectIdParams.parse(request.params);
      try {
        return {
          items: await service.candidateMembers(
            request.auth!,
            projectId,
            canViewAll(request),
          ),
        };
      } catch (error) {
        return mapProjectError(error, reply);
      }
    },
  );

  app.put(
    "/api/projects/:projectId/members/:membershipId",
    { preHandler: mutationHooks },
    async (request, reply) => {
      const { projectId, membershipId } = projectMemberParams.parse(
        request.params,
      );
      try {
        return {
          member: await service.upsertMember(
            request.auth!,
            projectId,
            membershipId,
            projectMemberSchema.parse(request.body),
          ),
        };
      } catch (error) {
        return mapProjectError(error, reply);
      }
    },
  );

  app.delete(
    "/api/projects/:projectId/members/:membershipId",
    { preHandler: mutationHooks },
    async (request, reply) => {
      const { projectId, membershipId } = projectMemberParams.parse(
        request.params,
      );
      try {
        await service.removeMember(request.auth!, projectId, membershipId);
        return reply.code(204).send();
      } catch (error) {
        return mapProjectError(error, reply);
      }
    },
  );

  app.post(
    "/api/projects/:projectId/edges",
    { preHandler: mutationHooks },
    async (request, reply) => {
      const { projectId } = projectIdParams.parse(request.params);
      try {
        const edge = await service.createEdge(
          request.auth!,
          projectId,
          createEdgeSchema.parse(request.body),
        );
        return reply.code(201).send({ edge });
      } catch (error) {
        return mapProjectError(error, reply);
      }
    },
  );

  app.delete(
    "/api/projects/:projectId/edges/:edgeId",
    { preHandler: mutationHooks },
    async (request, reply) => {
      const { projectId, edgeId } = edgeParams.parse(request.params);
      try {
        await service.deleteEdge(request.auth!, projectId, edgeId);
        return reply.code(204).send();
      } catch (error) {
        return mapProjectError(error, reply);
      }
    },
  );

  app.post(
    "/api/projects/:projectId/branches",
    { preHandler: mutationHooks },
    async (request, reply) => {
      const { projectId } = projectIdParams.parse(request.params);
      try {
        const branch = await service.createBranch(
          request.auth!,
          projectId,
          createBranchSchema.parse(request.body),
        );
        return reply.code(201).send({ branch });
      } catch (error) {
        return mapProjectError(error, reply);
      }
    },
  );

  app.patch(
    "/api/projects/:projectId/branches/:branchId",
    { preHandler: mutationHooks },
    async (request, reply) => {
      const { projectId, branchId } = branchParams.parse(request.params);
      const input = updateBranchSchema.parse(request.body);
      try {
        return {
          branch: await service.updateBranch(
            request.auth!,
            projectId,
            branchId,
            input.expectedVersion,
            input,
          ),
        };
      } catch (error) {
        return mapProjectError(error, reply);
      }
    },
  );

  app.post(
    "/api/projects/:projectId/branches/:branchId/archive",
    { preHandler: mutationHooks },
    async (request, reply) => {
      const { projectId, branchId } = branchParams.parse(request.params);
      const input = versionOnlySchema.parse(request.body);
      try {
        return {
          branch: await service.archiveBranch(
            request.auth!,
            projectId,
            branchId,
            input.expectedVersion,
          ),
        };
      } catch (error) {
        return mapProjectError(error, reply);
      }
    },
  );

  app.post(
    "/api/projects/:projectId/branches/:branchId/restore",
    { preHandler: mutationHooks },
    async (request, reply) => {
      const { projectId, branchId } = branchParams.parse(request.params);
      const input = versionOnlySchema.parse(request.body);
      try {
        return {
          branch: await service.restoreBranch(
            request.auth!,
            projectId,
            branchId,
            input.expectedVersion,
          ),
        };
      } catch (error) {
        return mapProjectError(error, reply);
      }
    },
  );

  app.post(
    "/api/projects/:projectId/branches/:branchId/merge",
    { preHandler: mutationHooks },
    async (request, reply) => {
      const { projectId, branchId } = branchParams.parse(request.params);
      const input = mergeBranchSchema.parse(request.body);
      try {
        return {
          result: await service.mergeBranch(
            request.auth!,
            projectId,
            branchId,
            input.targetBranchId,
            input.expectedVersion,
          ),
        };
      } catch (error) {
        return mapProjectError(error, reply);
      }
    },
  );

  app.post(
    "/api/projects/:projectId/nodes",
    { preHandler: mutationHooks },
    async (request, reply) => {
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
    },
  );

  app.patch(
    "/api/projects/:projectId/nodes/:nodeId",
    { preHandler: mutationHooks },
    async (request, reply) => {
      const { projectId, nodeId } = nodeParams.parse(request.params);
      const input = updateNodeSchema.parse(request.body);
      const { expectedVersion, startAt, dueAt, ...changes } = input;
      try {
        return {
          node: await service.updateNode(
            request.auth!,
            projectId,
            nodeId,
            expectedVersion,
            {
              ...changes,
              ...(startAt === undefined
                ? {}
                : { startAt: startAt ? new Date(startAt) : null }),
              ...(dueAt === undefined
                ? {}
                : { dueAt: dueAt ? new Date(dueAt) : null }),
            },
          ),
        };
      } catch (error) {
        return mapProjectError(error, reply);
      }
    },
  );

  app.put(
    "/api/projects/:projectId/nodes/:nodeId/assignees",
    { preHandler: mutationHooks },
    async (request, reply) => {
      const { projectId, nodeId } = nodeParams.parse(request.params);
      const input = nodeAssigneesSchema.parse(request.body);
      try {
        return {
          node: await service.setNodeAssignees(
            request.auth!,
            projectId,
            nodeId,
            input.expectedVersion,
            input.assignments,
          ),
        };
      } catch (error) {
        return mapProjectError(error, reply);
      }
    },
  );

  app.post(
    "/api/projects/:projectId/nodes/:nodeId/move",
    { preHandler: mutationHooks },
    async (request, reply) => {
      const { projectId, nodeId } = nodeParams.parse(request.params);
      const input = moveNodeSchema.parse(request.body);
      try {
        return {
          node: await service.moveNode(
            request.auth!,
            projectId,
            nodeId,
            input.expectedVersion,
            input.parentId,
            input.sortOrder,
          ),
        };
      } catch (error) {
        return mapProjectError(error, reply);
      }
    },
  );

  app.post(
    "/api/projects/:projectId/nodes/:nodeId/rollback",
    { preHandler: mutationHooks },
    async (request, reply) => {
      const { projectId, nodeId } = nodeParams.parse(request.params);
      const input = rollbackSchema.parse(request.body);
      try {
        return {
          node: await service.rollbackNode(
            request.auth!,
            projectId,
            nodeId,
            input.targetVersion,
            input.expectedVersion,
          ),
        };
      } catch (error) {
        return mapProjectError(error, reply);
      }
    },
  );

  app.delete(
    "/api/projects/:projectId/nodes/:nodeId",
    { preHandler: mutationHooks },
    async (request, reply) => {
      const { projectId, nodeId } = nodeParams.parse(request.params);
      const input = versionOnlySchema.parse(request.body);
      try {
        await service.deleteNode(
          request.auth!,
          projectId,
          nodeId,
          input.expectedVersion,
        );
        return reply.code(204).send();
      } catch (error) {
        return mapProjectError(error, reply);
      }
    },
  );

  app.post(
    "/api/projects/:projectId/nodes/:nodeId/restore",
    { preHandler: mutationHooks },
    async (request, reply) => {
      const { projectId, nodeId } = nodeParams.parse(request.params);
      try {
        return {
          node: await service.restoreNode(request.auth!, projectId, nodeId),
        };
      } catch (error) {
        return mapProjectError(error, reply);
      }
    },
  );
}
