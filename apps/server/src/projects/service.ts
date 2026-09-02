import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { Database } from "@workbench/db";
import {
  auditLogs,
  projectActivityLog,
  projectBranches,
  projectBranchVersions,
  projectMembers,
  projectNodes,
  projectNodeVersions,
  projects,
  recycleBinEntries,
} from "@workbench/db/schema";

export interface ProjectActor {
  organizationId: string;
  membershipId: string;
}

export class ProjectNotFoundError extends Error {
  constructor() {
    super("项目或项目节点不存在，或当前账号无权访问。请联系管理员以明确更多相关细节。")
    this.name = "ProjectNotFoundError";
  }
}

export class ProjectVersionConflictError extends Error {
  constructor() {
    super("数据已被其他成员更新，请刷新后重试。")
    this.name = "ProjectVersionConflictError";
  }
}

export class ProjectTreeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectTreeValidationError";
  }
}

export interface CreateProjectInput {
  key: string;
  name: string;
  description?: string | undefined;
  color: string;
  startAt?: Date | undefined;
  dueAt?: Date | undefined;
}

export interface CreateNodeInput {
  branchId: string;
  parentId: string | null;
  type: "phase" | "milestone" | "task" | "deliverable" | "decision";
  title: string;
  description?: string | undefined;
  startAt?: Date | undefined;
  dueAt?: Date | undefined;
  sortOrder: number;
}

export class ProjectService {
  constructor(private readonly db: Database) {}

  async list(actor: ProjectActor, canViewAll: boolean) {
    if (canViewAll) {
      return this.db
        .select()
        .from(projects)
        .where(and(eq(projects.organizationId, actor.organizationId), isNull(projects.deletedAt)))
        .orderBy(desc(projects.updatedAt));
    }
    return this.db
      .select({ project: projects })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(
        and(
          eq(projects.organizationId, actor.organizationId),
          eq(projectMembers.membershipId, actor.membershipId),
          isNull(projectMembers.leftAt),
          isNull(projects.deletedAt),
        ),
      )
      .orderBy(desc(projects.updatedAt))
      .then((rows) => rows.map((row) => row.project));
  }

  async create(actor: ProjectActor, input: CreateProjectInput) {
    if (input.startAt && input.dueAt && input.dueAt < input.startAt) {
      throw new ProjectTreeValidationError("项目截止时间不能早于开始时间。")
    }
    return this.db.transaction(async (tx) => {
      const [project] = await tx
        .insert(projects)
        .values({
          organizationId: actor.organizationId,
          key: input.key.toUpperCase(),
          name: input.name,
          description: input.description,
          color: input.color,
          status: "active",
          createdBy: actor.membershipId,
          startAt: input.startAt,
          dueAt: input.dueAt,
        })
        .returning();
      if (!project) throw new Error("Failed to create project");
      await tx.insert(projectMembers).values({
        projectId: project.id,
        membershipId: actor.membershipId,
        role: "lead",
      });
      const [branch] = await tx
        .insert(projectBranches)
        .values({
          projectId: project.id,
          name: "主线",
          description: "项目默认执行分支",
          isDefault: true,
          createdBy: actor.membershipId,
        })
        .returning();
      if (!branch) throw new Error("Failed to create project branch");
      const [root] = await tx
        .insert(projectNodes)
        .values({
          projectId: project.id,
          branchId: branch.id,
          type: "phase",
          title: project.name,
          description: project.description,
          status: "in_progress",
          createdBy: actor.membershipId,
        })
        .returning();
      if (!root) throw new Error("Failed to create project root node");
      await tx.insert(projectBranchVersions).values({
        branchId: branch.id,
        version: 1,
        snapshot: branch,
        changeSummary: "创建默认分支",
        createdBy: actor.membershipId,
      });
      await tx.insert(projectNodeVersions).values({
        nodeId: root.id,
        version: 1,
        snapshot: root,
        changeSummary: "创建项目根节点",
        createdBy: actor.membershipId,
      });
      await tx.insert(projectActivityLog).values({
        projectId: project.id,
        actorMembershipId: actor.membershipId,
        activityType: "created",
        entityType: "project",
        entityId: project.id,
        entityVersion: 1,
        details: { branchId: branch.id, rootNodeId: root.id },
      });
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "project.created",
        entityType: "project",
        entityId: project.id,
        after: project,
      });
      return { project, branch, root };
    });
  }

  async canAccess(actor: ProjectActor, projectId: string, canViewAll: boolean): Promise<boolean> {
    const [project] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.organizationId, actor.organizationId),
          isNull(projects.deletedAt),
        ),
      )
      .limit(1);
    if (!project) return false;
    if (canViewAll) return true;
    const [membership] = await this.db
      .select({ id: projectMembers.id })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.membershipId, actor.membershipId),
          isNull(projectMembers.leftAt),
        ),
      )
      .limit(1);
    return Boolean(membership);
  }

  async tree(actor: ProjectActor, projectId: string, canViewAll: boolean) {
    if (!(await this.canAccess(actor, projectId, canViewAll))) throw new ProjectNotFoundError();
    const [project] = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const branches = await this.db
      .select()
      .from(projectBranches)
      .where(and(eq(projectBranches.projectId, projectId), isNull(projectBranches.deletedAt)))
      .orderBy(desc(projectBranches.isDefault), asc(projectBranches.createdAt));
    const nodes = await this.db
      .select()
      .from(projectNodes)
      .where(and(eq(projectNodes.projectId, projectId), isNull(projectNodes.deletedAt)))
      .orderBy(asc(projectNodes.branchId), asc(projectNodes.parentId), asc(projectNodes.sortOrder));
    return { project, branches, nodes };
  }

  async createNode(actor: ProjectActor, projectId: string, input: CreateNodeInput) {
    return this.db.transaction(async (tx) => {
      const [branch] = await tx
        .select({ id: projectBranches.id })
        .from(projectBranches)
        .innerJoin(projects, eq(projects.id, projectBranches.projectId))
        .where(
          and(
            eq(projectBranches.id, input.branchId),
            eq(projectBranches.projectId, projectId),
            eq(projects.organizationId, actor.organizationId),
            isNull(projectBranches.deletedAt),
            isNull(projects.deletedAt),
          ),
        )
        .limit(1);
      if (!branch) throw new ProjectNotFoundError();
      if (input.parentId) {
        const [parent] = await tx
          .select({ id: projectNodes.id })
          .from(projectNodes)
          .where(
            and(
              eq(projectNodes.id, input.parentId),
              eq(projectNodes.projectId, projectId),
              eq(projectNodes.branchId, input.branchId),
              isNull(projectNodes.deletedAt),
            ),
          )
          .limit(1);
        if (!parent) throw new ProjectTreeValidationError("父节点不在当前项目分支中。")
      }
      const [node] = await tx
        .insert(projectNodes)
        .values({
          projectId,
          branchId: input.branchId,
          parentId: input.parentId,
          type: input.type,
          title: input.title,
          description: input.description,
          startAt: input.startAt,
          dueAt: input.dueAt,
          sortOrder: input.sortOrder,
          createdBy: actor.membershipId,
        })
        .returning();
      if (!node) throw new Error("Failed to create project node");
      await tx.insert(projectNodeVersions).values({
        nodeId: node.id,
        version: 1,
        snapshot: node,
        changeSummary: "创建节点",
        createdBy: actor.membershipId,
      });
      await tx.insert(projectActivityLog).values({
        projectId,
        actorMembershipId: actor.membershipId,
        activityType: "created",
        entityType: "project_node",
        entityId: node.id,
        entityVersion: 1,
        details: { title: node.title, parentId: node.parentId },
      });
      return node;
    });
  }

  async updateNode(
    actor: ProjectActor,
    projectId: string,
    nodeId: string,
    expectedVersion: number,
    changes: {
      title?: string | undefined;
      description?: string | null | undefined;
      status?: "not_started" | "in_progress" | "blocked" | "in_review" | "completed" | "cancelled" | undefined;
      progress?: number | undefined;
      changeSummary: string;
    },
  ) {
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(projectNodes)
        .where(
          and(
            eq(projectNodes.id, nodeId),
            eq(projectNodes.projectId, projectId),
            isNull(projectNodes.deletedAt),
          ),
        )
        .limit(1);
      if (!before) throw new ProjectNotFoundError();
      const [updated] = await tx
        .update(projectNodes)
        .set({
          title: changes.title,
          description: changes.description,
          status: changes.status,
          progress: changes.progress === undefined ? undefined : String(changes.progress),
          version: expectedVersion + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(projectNodes.id, nodeId),
            eq(projectNodes.projectId, projectId),
            eq(projectNodes.version, expectedVersion),
            isNull(projectNodes.deletedAt),
          ),
        )
        .returning();
      if (!updated) throw new ProjectVersionConflictError();
      await tx.insert(projectNodeVersions).values({
        nodeId,
        version: updated.version,
        snapshot: updated,
        changeSummary: changes.changeSummary,
        createdBy: actor.membershipId,
      });
      await tx.insert(projectActivityLog).values({
        projectId,
        actorMembershipId: actor.membershipId,
        activityType: "updated",
        entityType: "project_node",
        entityId: nodeId,
        entityVersion: updated.version,
        details: { before, after: updated, changeSummary: changes.changeSummary },
      });
      return updated;
    });
  }

  async moveNode(
    actor: ProjectActor,
    projectId: string,
    nodeId: string,
    expectedVersion: number,
    parentId: string | null,
    sortOrder: number,
  ) {
    return this.db.transaction(async (tx) => {
      const [node] = await tx
        .select()
        .from(projectNodes)
        .where(
          and(
            eq(projectNodes.id, nodeId),
            eq(projectNodes.projectId, projectId),
            isNull(projectNodes.deletedAt),
          ),
        )
        .for("update")
        .limit(1);
      if (!node) throw new ProjectNotFoundError();
      const tree = await tx
        .select({ id: projectNodes.id, parentId: projectNodes.parentId })
        .from(projectNodes)
        .where(
          and(
            eq(projectNodes.projectId, projectId),
            eq(projectNodes.branchId, node.branchId),
            isNull(projectNodes.deletedAt),
          ),
        );
      const parentById = new Map(tree.map((item) => [item.id, item.parentId]));
      if (parentId && !parentById.has(parentId)) {
        throw new ProjectTreeValidationError("目标父节点不在当前分支中。")
      }
      let cursor = parentId;
      while (cursor) {
        if (cursor === nodeId) throw new ProjectTreeValidationError("移动会造成项目树循环。")
        cursor = parentById.get(cursor) ?? null;
      }
      const [updated] = await tx
        .update(projectNodes)
        .set({
          parentId,
          sortOrder,
          version: expectedVersion + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(projectNodes.id, nodeId), eq(projectNodes.version, expectedVersion)))
        .returning();
      if (!updated) throw new ProjectVersionConflictError();
      await tx.insert(projectNodeVersions).values({
        nodeId,
        version: updated.version,
        snapshot: updated,
        changeSummary: "移动节点",
        createdBy: actor.membershipId,
      });
      await tx.insert(projectActivityLog).values({
        projectId,
        actorMembershipId: actor.membershipId,
        activityType: "moved",
        entityType: "project_node",
        entityId: nodeId,
        entityVersion: updated.version,
        details: { fromParentId: node.parentId, toParentId: parentId, sortOrder },
      });
      return updated;
    });
  }

  async rollbackNode(
    actor: ProjectActor,
    projectId: string,
    nodeId: string,
    targetVersion: number,
    expectedVersion: number,
  ) {
    return this.db.transaction(async (tx) => {
      const [versionRecord] = await tx
        .select({ snapshot: projectNodeVersions.snapshot })
        .from(projectNodeVersions)
        .where(
          and(
            eq(projectNodeVersions.nodeId, nodeId),
            eq(projectNodeVersions.version, targetVersion),
          ),
        )
        .limit(1);
      if (!versionRecord) throw new ProjectNotFoundError();
      const snapshot = versionRecord.snapshot as typeof projectNodes.$inferSelect;
      const [updated] = await tx
        .update(projectNodes)
        .set({
          parentId: snapshot.parentId,
          type: snapshot.type,
          title: snapshot.title,
          description: snapshot.description,
          status: snapshot.status,
          progress: snapshot.progress,
          progressMode: snapshot.progressMode,
          weight: snapshot.weight,
          sortOrder: snapshot.sortOrder,
          startAt: snapshot.startAt ? new Date(snapshot.startAt) : null,
          dueAt: snapshot.dueAt ? new Date(snapshot.dueAt) : null,
          metadata: snapshot.metadata,
          version: expectedVersion + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(projectNodes.id, nodeId),
            eq(projectNodes.projectId, projectId),
            eq(projectNodes.version, expectedVersion),
            isNull(projectNodes.deletedAt),
          ),
        )
        .returning();
      if (!updated) throw new ProjectVersionConflictError();
      await tx.insert(projectNodeVersions).values({
        nodeId,
        version: updated.version,
        snapshot: updated,
        changeSummary: `回滚到版本 ${targetVersion}`,
        createdBy: actor.membershipId,
      });
      await tx.insert(projectActivityLog).values({
        projectId,
        actorMembershipId: actor.membershipId,
        activityType: "rolled_back",
        entityType: "project_node",
        entityId: nodeId,
        entityVersion: updated.version,
        details: { targetVersion, newVersion: updated.version },
      });
      return updated;
    });
  }

  async deleteNode(actor: ProjectActor, projectId: string, nodeId: string, expectedVersion: number) {
    return this.db.transaction(async (tx) => {
      const descendants = await tx
        .select({ id: projectNodes.id })
        .from(projectNodes)
        .where(and(eq(projectNodes.parentId, nodeId), isNull(projectNodes.deletedAt)))
        .limit(1);
      if (descendants.length > 0) {
        throw new ProjectTreeValidationError("请先移动或删除子节点，不能删除仍包含子节点的节点。")
      }
      const [deleted] = await tx
        .update(projectNodes)
        .set({ deletedAt: new Date(), updatedAt: new Date(), version: expectedVersion + 1 })
        .where(
          and(
            eq(projectNodes.id, nodeId),
            eq(projectNodes.projectId, projectId),
            eq(projectNodes.version, expectedVersion),
            isNull(projectNodes.deletedAt),
          ),
        )
        .returning();
      if (!deleted) throw new ProjectVersionConflictError();
      await tx.insert(recycleBinEntries).values({
        organizationId: actor.organizationId,
        entityType: "project_node",
        entityId: nodeId,
        snapshot: deleted,
        deletedBy: actor.membershipId,
        restoreUntil: new Date(Date.now() + 30 * 86_400_000),
      });
      await tx.insert(projectActivityLog).values({
        projectId,
        actorMembershipId: actor.membershipId,
        activityType: "deleted",
        entityType: "project_node",
        entityId: nodeId,
        entityVersion: deleted.version,
      });
      return deleted;
    });
  }

  async restoreNode(actor: ProjectActor, projectId: string, nodeId: string) {
    return this.db.transaction(async (tx) => {
      const [entry] = await tx
        .select()
        .from(recycleBinEntries)
        .where(
          and(
            eq(recycleBinEntries.organizationId, actor.organizationId),
            eq(recycleBinEntries.entityType, "project_node"),
            eq(recycleBinEntries.entityId, nodeId),
            isNull(recycleBinEntries.restoredAt),
          ),
        )
        .limit(1);
      if (!entry || (entry.restoreUntil && entry.restoreUntil < new Date())) {
        throw new ProjectNotFoundError();
      }
      const [restored] = await tx
        .update(projectNodes)
        .set({ deletedAt: null, updatedAt: new Date() })
        .where(and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)))
        .returning();
      if (!restored) throw new ProjectNotFoundError();
      await tx
        .update(recycleBinEntries)
        .set({ restoredAt: new Date(), restoredBy: actor.membershipId })
        .where(eq(recycleBinEntries.id, entry.id));
      await tx.insert(projectActivityLog).values({
        projectId,
        actorMembershipId: actor.membershipId,
        activityType: "restored",
        entityType: "project_node",
        entityId: nodeId,
        entityVersion: restored.version,
      });
      return restored;
    });
  }
}
