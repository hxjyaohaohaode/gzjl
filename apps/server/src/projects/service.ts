import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  ne,
  or,
} from "drizzle-orm";
import type { Database } from "@workbench/db";
import {
  calculateDerivedProjectProgress,
  ProjectProgressCycleError,
} from "@workbench/shared";
import {
  auditLogs,
  projectActivityLog,
  projectBranches,
  projectBranchVersions,
  projectEdges,
  projectMembers,
  projectMilestones,
  projectNodes,
  projectNodeAssignees,
  projectNodeVersions,
  projects,
  recycleBinEntries,
  orgMemberships,
  users,
  workSessionProjectLinks,
  workSessions,
} from "@workbench/db/schema";

export interface ProjectActor {
  organizationId: string;
  membershipId: string;
}

export class ProjectNotFoundError extends Error {
  constructor() {
    super(
      "项目或项目节点不存在，或当前账号无权访问。请联系管理员以明确更多相关细节。",
    );
    this.name = "ProjectNotFoundError";
  }
}

export class ProjectVersionConflictError extends Error {
  constructor() {
    super("数据已被其他成员更新，请刷新后重试。");
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
  progress?: number | undefined;
  progressMode?: "manual" | "weighted_children" | "milestone_based";
  weight?: number | undefined;
  startAt?: Date | undefined;
  dueAt?: Date | undefined;
  sortOrder: number;
}

export interface ProjectNodeAssigneeInput {
  membershipId: string;
  isResponsible?: boolean | undefined;
}

export interface ProjectMemberInput {
  role: "lead" | "member" | "observer";
  publicActivityVisible?: boolean | undefined;
}

type ProjectProgressMode =
  | "manual"
  | "weighted_children"
  | "milestone_based";

/** The subset shared by the root Drizzle client and a transaction client. */
type ProjectExecutor = Pick<Database, "select" | "insert" | "update" | "delete">;
type ProjectNodeVersionSnapshot = typeof projectNodes.$inferSelect & {
  assignees?: Array<{
    membershipId: string;
    isResponsible: boolean;
  }>;
};

export interface CreateBranchInput {
  name: string;
  description?: string | undefined;
  parentBranchId?: string | undefined;
  sourceNodeId?: string | undefined;
}

export interface UpdateBranchInput {
  name?: string | undefined;
  description?: string | null | undefined;
  changeSummary: string;
}

export interface CreateEdgeInput {
  sourceNodeId: string;
  targetNodeId: string;
  type: "depends_on" | "blocks" | "relates_to" | "replaces" | "merges_into";
  label?: string | undefined;
}

export class ProjectService {
  constructor(private readonly db: Database) {}

  /**
   * A node version includes its collaboration state, not merely its scalar
   * fields. Keeping assignees in the same snapshot makes rollback a real
   * recovery operation while the relational assignment table remains the
   * current source used by normal project reads.
   */
  private async recordNodeVersion(
    executor: ProjectExecutor,
    node: typeof projectNodes.$inferSelect,
    changeSummary: string,
    actorMembershipId: string,
  ) {
    const assignees = await executor
      .select({
        membershipId: projectNodeAssignees.membershipId,
        isResponsible: projectNodeAssignees.isResponsible,
      })
      .from(projectNodeAssignees)
      .where(eq(projectNodeAssignees.nodeId, node.id))
      .orderBy(asc(projectNodeAssignees.assignedAt));
    const snapshot: ProjectNodeVersionSnapshot = { ...node, assignees };
    await executor.insert(projectNodeVersions).values({
      nodeId: node.id,
      version: node.version,
      snapshot,
      changeSummary,
      createdBy: actorMembershipId,
    });
  }

  async list(actor: ProjectActor, canViewAll: boolean) {
    if (canViewAll) {
      return this.db
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.organizationId, actor.organizationId),
            isNull(projects.deletedAt),
          ),
        )
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

  /**
   * Calendar overlays deliberately derive from milestone nodes instead of the
   * legacy project_milestones table. This keeps project-tree editing and the
   * calendar on one authoritative versioned fact chain.
   */
  async calendarMilestones(
    actor: ProjectActor,
    rangeStart: Date,
    rangeEnd: Date,
    canViewAll: boolean,
  ) {
    const fields = {
      nodeId: projectNodes.id,
      projectId: projects.id,
      projectKey: projects.key,
      projectName: projects.name,
      projectColor: projects.color,
      title: projectNodes.title,
      dueAt: projectNodes.dueAt,
      status: projectNodes.status,
      progress: projectNodes.progress,
    };
    const conditions = and(
      eq(projects.organizationId, actor.organizationId),
      isNull(projects.deletedAt),
      isNull(projectNodes.deletedAt),
      eq(projectNodes.type, "milestone"),
      ne(projectNodes.status, "cancelled"),
      isNull(projectBranches.deletedAt),
      isNull(projectBranches.archivedAt),
      gte(projectNodes.dueAt, rangeStart),
      lt(projectNodes.dueAt, rangeEnd),
    );
    const orderBy = [
      asc(projectNodes.dueAt),
      asc(projects.name),
      asc(projectNodes.title),
    ] as const;

    if (canViewAll) {
      return this.db
        .select(fields)
        .from(projectNodes)
        .innerJoin(projects, eq(projects.id, projectNodes.projectId))
        .innerJoin(projectBranches, eq(projectBranches.id, projectNodes.branchId))
        .where(conditions)
        .orderBy(...orderBy);
    }
    return this.db
      .select(fields)
      .from(projectNodes)
      .innerJoin(projects, eq(projects.id, projectNodes.projectId))
      .innerJoin(projectBranches, eq(projectBranches.id, projectNodes.branchId))
      .innerJoin(
        projectMembers,
        and(
          eq(projectMembers.projectId, projectNodes.projectId),
          eq(projectMembers.membershipId, actor.membershipId),
          isNull(projectMembers.leftAt),
        ),
      )
      .where(conditions)
      .orderBy(...orderBy);
  }

  async create(actor: ProjectActor, input: CreateProjectInput) {
    if (input.startAt && input.dueAt && input.dueAt < input.startAt) {
      throw new ProjectTreeValidationError("项目截止时间不能早于开始时间。");
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
      await this.recordNodeVersion(
        tx,
        root,
        "创建项目根节点",
        actor.membershipId,
      );
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

  async canAccess(
    actor: ProjectActor,
    projectId: string,
    canViewAll: boolean,
  ): Promise<boolean> {
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
    if (!(await this.canAccess(actor, projectId, canViewAll)))
      throw new ProjectNotFoundError();
    const [project] = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const branches = await this.db
      .select()
      .from(projectBranches)
      .where(
        and(
          eq(projectBranches.projectId, projectId),
          isNull(projectBranches.deletedAt),
        ),
      )
      .orderBy(desc(projectBranches.isDefault), asc(projectBranches.createdAt));
    const activeBranchIds = new Set(
      branches
        .filter((branch) => !branch.archivedAt)
        .map((branch) => branch.id),
    );
    const nodes = (
      await this.db
        .select()
        .from(projectNodes)
        .where(
          and(
            eq(projectNodes.projectId, projectId),
            isNull(projectNodes.deletedAt),
          ),
        )
        .orderBy(
          asc(projectNodes.branchId),
          asc(projectNodes.parentId),
          asc(projectNodes.sortOrder),
        )
    ).filter((node) => activeBranchIds.has(node.branchId));
    const activeNodeIds = new Set(nodes.map((node) => node.id));
    const edges = (
      await this.db
        .select()
        .from(projectEdges)
        .where(
          and(
            eq(projectEdges.projectId, projectId),
            isNull(projectEdges.deletedAt),
          ),
        )
        .orderBy(asc(projectEdges.createdAt))
    ).filter(
      (edge) =>
        activeNodeIds.has(edge.sourceNodeId) &&
        activeNodeIds.has(edge.targetNodeId),
    );
    const nodeAssignees = nodes.length
      ? await this.db
          .select({
            nodeId: projectNodeAssignees.nodeId,
            membershipId: projectNodeAssignees.membershipId,
            isResponsible: projectNodeAssignees.isResponsible,
            assignedAt: projectNodeAssignees.assignedAt,
            displayName: users.displayName,
            avatarUrl: users.avatarUrl,
          })
          .from(projectNodeAssignees)
          .innerJoin(
            projectMembers,
            and(
              eq(projectMembers.membershipId, projectNodeAssignees.membershipId),
              eq(projectMembers.projectId, projectId),
              isNull(projectMembers.leftAt),
            ),
          )
          .innerJoin(
            orgMemberships,
            eq(orgMemberships.id, projectNodeAssignees.membershipId),
          )
          .innerJoin(users, eq(users.id, orgMemberships.userId))
          .where(inArray(projectNodeAssignees.nodeId, nodes.map((node) => node.id)))
          .orderBy(asc(projectNodeAssignees.assignedAt))
      : [];
    const milestones = await this.db
      .select()
      .from(projectMilestones)
      .where(eq(projectMilestones.projectId, projectId))
      .orderBy(asc(projectMilestones.dueAt));
    return { project, branches, nodes, edges, nodeAssignees, milestones };
  }

  async members(actor: ProjectActor, projectId: string, canViewAll: boolean) {
    if (!(await this.canAccess(actor, projectId, canViewAll))) {
      throw new ProjectNotFoundError();
    }
    return this.db
      .select({
        membershipId: projectMembers.membershipId,
        role: projectMembers.role,
        publicActivityVisible: projectMembers.publicActivityVisible,
        joinedAt: projectMembers.joinedAt,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      })
      .from(projectMembers)
      .innerJoin(
        orgMemberships,
        eq(orgMemberships.id, projectMembers.membershipId),
      )
      .innerJoin(users, eq(users.id, orgMemberships.userId))
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          isNull(projectMembers.leftAt),
        ),
      )
      .orderBy(asc(projectMembers.joinedAt), asc(users.displayName));
  }

  async candidateMembers(
    actor: ProjectActor,
    projectId: string,
    canViewAll: boolean,
  ) {
    if (!(await this.canAccess(actor, projectId, canViewAll))) {
      throw new ProjectNotFoundError();
    }
    return this.db
      .select({
        membershipId: orgMemberships.id,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      })
      .from(orgMemberships)
      .innerJoin(users, eq(users.id, orgMemberships.userId))
      .where(
        and(
          eq(orgMemberships.organizationId, actor.organizationId),
          eq(orgMemberships.status, "active"),
          eq(users.status, "active"),
        ),
      )
      .orderBy(asc(users.displayName));
  }

  async upsertMember(
    actor: ProjectActor,
    projectId: string,
    membershipId: string,
    input: ProjectMemberInput,
  ) {
    return this.db.transaction(async (tx) => {
      const [project] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.id, projectId),
            eq(projects.organizationId, actor.organizationId),
            isNull(projects.deletedAt),
          ),
        )
        .for("update")
        .limit(1);
      if (!project) throw new ProjectNotFoundError();
      const [membership] = await tx
        .select({ id: orgMemberships.id })
        .from(orgMemberships)
        .innerJoin(users, eq(users.id, orgMemberships.userId))
        .where(
          and(
            eq(orgMemberships.id, membershipId),
            eq(orgMemberships.organizationId, actor.organizationId),
            eq(orgMemberships.status, "active"),
            eq(users.status, "active"),
          ),
        )
        .limit(1);
      if (!membership) {
        throw new ProjectTreeValidationError("成员不在当前组织中或账号已停用。");
      }
      const [before] = await tx
        .select()
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.membershipId, membershipId),
          ),
        )
        .for("update")
        .limit(1);
      if (
        before &&
        !before.leftAt &&
        before.role === "lead" &&
        input.role !== "lead"
      ) {
        const activeLeads = await tx
          .select({ id: projectMembers.id })
          .from(projectMembers)
          .where(
            and(
              eq(projectMembers.projectId, projectId),
              eq(projectMembers.role, "lead"),
              isNull(projectMembers.leftAt),
            ),
          );
        if (activeLeads.length < 2) {
          throw new ProjectTreeValidationError(
            "项目至少需要保留一名项目负责人。",
          );
        }
      }
      const publicActivityVisible = input.publicActivityVisible ?? true;
      const [member] = before
        ? await tx
            .update(projectMembers)
            .set({
              role: input.role,
              publicActivityVisible,
              leftAt: null,
            })
            .where(eq(projectMembers.id, before.id))
            .returning()
        : await tx
            .insert(projectMembers)
            .values({
              projectId,
              membershipId,
              role: input.role,
              publicActivityVisible,
            })
            .returning();
      if (!member) throw new Error("Failed to save project member");
      await tx.insert(projectActivityLog).values({
        projectId,
        actorMembershipId: actor.membershipId,
        activityType: "updated",
        entityType: "project_member",
        entityId: member.id,
        details: { before, after: member },
      });
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "project.member_upserted",
        entityType: "project_member",
        entityId: member.id,
        before,
        after: member,
      });
      return member;
    });
  }

  async removeMember(
    actor: ProjectActor,
    projectId: string,
    membershipId: string,
  ) {
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.membershipId, membershipId),
            isNull(projectMembers.leftAt),
          ),
        )
        .for("update")
        .limit(1);
      if (!before) throw new ProjectNotFoundError();
      const activeLeads = await tx
        .select({ id: projectMembers.id })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.role, "lead"),
            isNull(projectMembers.leftAt),
          ),
        );
      if (before.role === "lead" && activeLeads.length < 2) {
        throw new ProjectTreeValidationError("项目至少需要保留一名项目负责人。");
      }
      const leftAt = new Date();
      const [member] = await tx
        .update(projectMembers)
        .set({ leftAt })
        .where(eq(projectMembers.id, before.id))
        .returning();
      if (!member) throw new ProjectNotFoundError();
      const nodeRows = await tx
        .select({ id: projectNodes.id })
        .from(projectNodes)
        .where(eq(projectNodes.projectId, projectId));
      if (nodeRows.length) {
        await tx
          .delete(projectNodeAssignees)
          .where(
            and(
              eq(projectNodeAssignees.membershipId, membershipId),
              inArray(
                projectNodeAssignees.nodeId,
                nodeRows.map((node) => node.id),
              ),
            ),
          );
      }
      await tx.insert(projectActivityLog).values({
        projectId,
        actorMembershipId: actor.membershipId,
        activityType: "updated",
        entityType: "project_member",
        entityId: member.id,
        details: { before, after: member, clearedNodeAssignments: true },
      });
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "project.member_removed",
        entityType: "project_member",
        entityId: member.id,
        before,
        after: member,
      });
      return member;
    });
  }

  async setNodeAssignees(
    actor: ProjectActor,
    projectId: string,
    nodeId: string,
    expectedVersion: number,
    assignments: ProjectNodeAssigneeInput[],
  ) {
    const membershipIds = assignments.map((assignment) => assignment.membershipId);
    if (new Set(membershipIds).size !== membershipIds.length) {
      throw new ProjectTreeValidationError("同一成员不能重复分配到一个项目节点。");
    }
    if (assignments.filter((assignment) => assignment.isResponsible).length > 1) {
      throw new ProjectTreeValidationError("一个项目节点只能指定一名主要负责人。");
    }
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
      const [branch] = await tx
        .select({ id: projectBranches.id })
        .from(projectBranches)
        .where(
          and(
            eq(projectBranches.id, node.branchId),
            isNull(projectBranches.deletedAt),
            isNull(projectBranches.archivedAt),
          ),
        )
        .limit(1);
      if (!branch) {
        throw new ProjectTreeValidationError("归档分支中的节点不能继续调整负责人。");
      }
      if (membershipIds.length) {
        const members = await tx
          .select({ membershipId: projectMembers.membershipId })
          .from(projectMembers)
          .where(
            and(
              eq(projectMembers.projectId, projectId),
              isNull(projectMembers.leftAt),
              inArray(projectMembers.membershipId, membershipIds),
            ),
          );
        if (members.length !== membershipIds.length) {
          throw new ProjectTreeValidationError(
            "负责人必须是当前项目中的有效成员。",
          );
        }
      }
      const beforeAssignments = await tx
        .select()
        .from(projectNodeAssignees)
        .where(eq(projectNodeAssignees.nodeId, nodeId));
      await tx
        .delete(projectNodeAssignees)
        .where(eq(projectNodeAssignees.nodeId, nodeId));
      if (assignments.length) {
        await tx.insert(projectNodeAssignees).values(
          assignments.map((assignment) => ({
            nodeId,
            membershipId: assignment.membershipId,
            isResponsible: Boolean(assignment.isResponsible),
          })),
        );
      }
      const [updated] = await tx
        .update(projectNodes)
        .set({ version: expectedVersion + 1, updatedAt: new Date() })
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
      await this.recordNodeVersion(
        tx,
        updated,
        "更新节点负责人",
        actor.membershipId,
      );
      await tx.insert(projectActivityLog).values({
        projectId,
        actorMembershipId: actor.membershipId,
        activityType: "updated",
        entityType: "project_node_assignment",
        entityId: nodeId,
        entityVersion: updated.version,
        details: { before: beforeAssignments, after: assignments },
      });
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "project.node_assignments_updated",
        entityType: "project_node",
        entityId: nodeId,
        before: beforeAssignments,
        after: assignments,
      });
      return updated;
    });
  }

  async nodeVersions(
    actor: ProjectActor,
    projectId: string,
    nodeId: string,
    canViewAll: boolean,
  ) {
    if (!(await this.canAccess(actor, projectId, canViewAll)))
      throw new ProjectNotFoundError();
    const [node] = await this.db
      .select({ id: projectNodes.id })
      .from(projectNodes)
      .where(
        and(
          eq(projectNodes.id, nodeId),
          eq(projectNodes.projectId, projectId),
          isNull(projectNodes.deletedAt),
        ),
      )
      .limit(1);
    if (!node) throw new ProjectNotFoundError();
    return this.db
      .select({
        version: projectNodeVersions.version,
        snapshot: projectNodeVersions.snapshot,
        changeSummary: projectNodeVersions.changeSummary,
        createdAt: projectNodeVersions.createdAt,
        createdBy: projectNodeVersions.createdBy,
      })
      .from(projectNodeVersions)
      .where(eq(projectNodeVersions.nodeId, nodeId))
      .orderBy(desc(projectNodeVersions.version));
  }

  async nodeWorkSessions(
    actor: ProjectActor,
    projectId: string,
    nodeId: string,
    canViewAll: boolean,
  ) {
    if (!(await this.canAccess(actor, projectId, canViewAll)))
      throw new ProjectNotFoundError();
    const [node] = await this.db
      .select({ id: projectNodes.id })
      .from(projectNodes)
      .where(
        and(
          eq(projectNodes.id, nodeId),
          eq(projectNodes.projectId, projectId),
          isNull(projectNodes.deletedAt),
        ),
      )
      .limit(1);
    if (!node) throw new ProjectNotFoundError();
    return this.db
      .select({
        id: workSessions.id,
        membershipId: workSessions.membershipId,
        displayName: users.displayName,
        startAt: workSessions.startAt,
        endAt: workSessions.endAt,
        netSeconds: workSessions.netSeconds,
        content: workSessions.content,
        source: workSessions.source,
        submissionStatus: workSessions.submissionStatus,
        approvalStatus: workSessions.approvalStatus,
        isPrimary: workSessionProjectLinks.isPrimary,
      })
      .from(workSessionProjectLinks)
      .innerJoin(
        workSessions,
        eq(workSessions.id, workSessionProjectLinks.workSessionId),
      )
      .innerJoin(
        orgMemberships,
        eq(orgMemberships.id, workSessions.membershipId),
      )
      .innerJoin(users, eq(users.id, orgMemberships.userId))
      .where(
        and(
          eq(workSessionProjectLinks.projectId, projectId),
          eq(workSessionProjectLinks.projectNodeId, nodeId),
          eq(workSessions.organizationId, actor.organizationId),
          eq(workSessions.recordKind, "fact"),
          isNull(workSessions.deletedAt),
          or(
            eq(workSessions.membershipId, actor.membershipId),
            eq(workSessions.visibility, "project_visible"),
          ),
        ),
      )
      .orderBy(desc(workSessions.startAt), desc(workSessions.id))
      .limit(50);
  }

  async recycleBin(
    actor: ProjectActor,
    projectId: string,
    canViewAll: boolean,
  ) {
    if (!(await this.canAccess(actor, projectId, canViewAll)))
      throw new ProjectNotFoundError();
    return this.db
      .select({
        id: recycleBinEntries.id,
        entityId: recycleBinEntries.entityId,
        snapshot: recycleBinEntries.snapshot,
        deletedAt: recycleBinEntries.deletedAt,
        restoreUntil: recycleBinEntries.restoreUntil,
      })
      .from(recycleBinEntries)
      .innerJoin(projectNodes, eq(projectNodes.id, recycleBinEntries.entityId))
      .where(
        and(
          eq(recycleBinEntries.organizationId, actor.organizationId),
          eq(recycleBinEntries.entityType, "project_node"),
          eq(projectNodes.projectId, projectId),
          isNull(recycleBinEntries.restoredAt),
        ),
      )
      .orderBy(desc(recycleBinEntries.deletedAt));
  }

  async createEdge(
    actor: ProjectActor,
    projectId: string,
    input: CreateEdgeInput,
  ) {
    if (input.sourceNodeId === input.targetNodeId)
      throw new ProjectTreeValidationError(
        "关联的起点和终点不能是同一个节点。",
      );
    return this.db.transaction(async (tx) => {
      const [source] = await tx
        .select({ id: projectNodes.id })
        .from(projectNodes)
        .where(
          and(
            eq(projectNodes.id, input.sourceNodeId),
            eq(projectNodes.projectId, projectId),
            isNull(projectNodes.deletedAt),
          ),
        )
        .limit(1);
      const [target] = await tx
        .select({ id: projectNodes.id })
        .from(projectNodes)
        .where(
          and(
            eq(projectNodes.id, input.targetNodeId),
            eq(projectNodes.projectId, projectId),
            isNull(projectNodes.deletedAt),
          ),
        )
        .limit(1);
      if (!source || !target) throw new ProjectNotFoundError();
      const [existing] = await tx
        .select({ id: projectEdges.id })
        .from(projectEdges)
        .where(
          and(
            eq(projectEdges.projectId, projectId),
            eq(projectEdges.sourceNodeId, input.sourceNodeId),
            eq(projectEdges.targetNodeId, input.targetNodeId),
            eq(projectEdges.type, input.type),
            isNull(projectEdges.deletedAt),
          ),
        )
        .limit(1);
      if (existing)
        throw new ProjectTreeValidationError("相同的节点关联已经存在。");

      if (input.type === "depends_on" || input.type === "blocks") {
        const activeEdges = await tx
          .select({
            sourceNodeId: projectEdges.sourceNodeId,
            targetNodeId: projectEdges.targetNodeId,
            type: projectEdges.type,
          })
          .from(projectEdges)
          .where(
            and(
              eq(projectEdges.projectId, projectId),
              isNull(projectEdges.deletedAt),
            ),
          );
        const adjacency = new Map<string, string[]>();
        activeEdges
          .filter(
            (edge) => edge.type === "depends_on" || edge.type === "blocks",
          )
          .forEach((edge) =>
            adjacency.set(edge.sourceNodeId, [
              ...(adjacency.get(edge.sourceNodeId) ?? []),
              edge.targetNodeId,
            ]),
          );
        const visited = new Set<string>();
        const reachesSource = (nodeId: string): boolean => {
          if (nodeId === input.sourceNodeId) return true;
          if (visited.has(nodeId)) return false;
          visited.add(nodeId);
          return (adjacency.get(nodeId) ?? []).some(reachesSource);
        };
        if (reachesSource(input.targetNodeId))
          throw new ProjectTreeValidationError(
            "该依赖会形成循环，请调整关联方向或使用“关联”关系。",
          );
      }

      const [edge] = await tx
        .insert(projectEdges)
        .values({
          projectId,
          sourceNodeId: input.sourceNodeId,
          targetNodeId: input.targetNodeId,
          type: input.type,
          label: input.label?.trim() || null,
          createdBy: actor.membershipId,
        })
        .returning();
      if (!edge) throw new Error("Failed to create project edge");
      await tx.insert(projectActivityLog).values({
        projectId,
        actorMembershipId: actor.membershipId,
        activityType: "updated",
        entityType: "project_edge",
        entityId: edge.id,
        details: {
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          type: edge.type,
        },
      });
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "project.edge_created",
        entityType: "project_edge",
        entityId: edge.id,
        after: edge,
      });
      return edge;
    });
  }

  async deleteEdge(actor: ProjectActor, projectId: string, edgeId: string) {
    return this.db.transaction(async (tx) => {
      const [edge] = await tx
        .update(projectEdges)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(projectEdges.id, edgeId),
            eq(projectEdges.projectId, projectId),
            isNull(projectEdges.deletedAt),
          ),
        )
        .returning();
      if (!edge) throw new ProjectNotFoundError();
      await tx.insert(projectActivityLog).values({
        projectId,
        actorMembershipId: actor.membershipId,
        activityType: "updated",
        entityType: "project_edge",
        entityId: edge.id,
        details: { deleted: true },
      });
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "project.edge_deleted",
        entityType: "project_edge",
        entityId: edge.id,
        before: edge,
      });
      return edge;
    });
  }

  async createBranch(
    actor: ProjectActor,
    projectId: string,
    input: CreateBranchInput,
  ) {
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
    if (!project) throw new ProjectNotFoundError();
    if (input.parentBranchId) {
      const [parent] = await this.db
        .select({ id: projectBranches.id })
        .from(projectBranches)
        .where(
          and(
            eq(projectBranches.id, input.parentBranchId),
            eq(projectBranches.projectId, projectId),
            isNull(projectBranches.deletedAt),
            isNull(projectBranches.archivedAt),
          ),
        )
        .limit(1);
      if (!parent)
        throw new ProjectTreeValidationError(
          "父分支不属于当前项目或已被删除。",
        );
    }
    if (input.sourceNodeId) {
      const [source] = await this.db
        .select({ id: projectNodes.id })
        .from(projectNodes)
        .where(
          and(
            eq(projectNodes.id, input.sourceNodeId),
            eq(projectNodes.projectId, projectId),
            isNull(projectNodes.deletedAt),
          ),
        )
        .limit(1);
      if (!source)
        throw new ProjectTreeValidationError(
          "分支来源节点不属于当前项目或已被删除。",
        );
    }
    return this.db.transaction(async (tx) => {
      const [branch] = await tx
        .insert(projectBranches)
        .values({
          projectId,
          name: input.name,
          description: input.description,
          parentBranchId: input.parentBranchId,
          sourceNodeId: input.sourceNodeId,
          createdBy: actor.membershipId,
        })
        .returning();
      if (!branch) throw new Error("Failed to create project branch");
      await tx.insert(projectBranchVersions).values({
        branchId: branch.id,
        version: 1,
        snapshot: branch,
        changeSummary: "创建分支",
        createdBy: actor.membershipId,
      });
      await tx.insert(projectActivityLog).values({
        projectId,
        actorMembershipId: actor.membershipId,
        activityType: "branched",
        entityType: "project_branch",
        entityId: branch.id,
        entityVersion: 1,
        details: {
          parentBranchId: input.parentBranchId ?? null,
          sourceNodeId: input.sourceNodeId ?? null,
        },
      });
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "project.branch_created",
        entityType: "project_branch",
        entityId: branch.id,
        after: branch,
      });
      return branch;
    });
  }

  async updateBranch(
    actor: ProjectActor,
    projectId: string,
    branchId: string,
    expectedVersion: number,
    changes: UpdateBranchInput,
  ) {
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(projectBranches)
        .where(
          and(
            eq(projectBranches.id, branchId),
            eq(projectBranches.projectId, projectId),
            isNull(projectBranches.deletedAt),
            isNull(projectBranches.archivedAt),
          ),
        )
        .limit(1);
      if (!before) throw new ProjectNotFoundError();
      const [updated] = await tx
        .update(projectBranches)
        .set({
          name: changes.name,
          description: changes.description,
          version: expectedVersion + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(projectBranches.id, branchId),
            eq(projectBranches.projectId, projectId),
            eq(projectBranches.version, expectedVersion),
            isNull(projectBranches.deletedAt),
            isNull(projectBranches.archivedAt),
          ),
        )
        .returning();
      if (!updated) throw new ProjectVersionConflictError();
      await tx.insert(projectBranchVersions).values({
        branchId,
        version: updated.version,
        snapshot: updated,
        changeSummary: changes.changeSummary,
        createdBy: actor.membershipId,
      });
      await tx.insert(projectActivityLog).values({
        projectId,
        actorMembershipId: actor.membershipId,
        activityType: "updated",
        entityType: "project_branch",
        entityId: branchId,
        entityVersion: updated.version,
        details: {
          before,
          after: updated,
          changeSummary: changes.changeSummary,
        },
      });
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "project.branch_updated",
        entityType: "project_branch",
        entityId: branchId,
        before,
        after: updated,
      });
      return updated;
    });
  }

  async archiveBranch(
    actor: ProjectActor,
    projectId: string,
    branchId: string,
    expectedVersion: number,
  ) {
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(projectBranches)
        .where(
          and(
            eq(projectBranches.id, branchId),
            eq(projectBranches.projectId, projectId),
            isNull(projectBranches.deletedAt),
            isNull(projectBranches.archivedAt),
          ),
        )
        .limit(1);
      if (!before) throw new ProjectNotFoundError();
      if (before.isDefault) {
        throw new ProjectTreeValidationError("项目主线不能归档。");
      }
      const archivedAt = new Date();
      const [archived] = await tx
        .update(projectBranches)
        .set({
          archivedAt,
          version: expectedVersion + 1,
          updatedAt: archivedAt,
        })
        .where(
          and(
            eq(projectBranches.id, branchId),
            eq(projectBranches.projectId, projectId),
            eq(projectBranches.version, expectedVersion),
            isNull(projectBranches.deletedAt),
            isNull(projectBranches.archivedAt),
          ),
        )
        .returning();
      if (!archived) throw new ProjectVersionConflictError();
      await tx.insert(projectBranchVersions).values({
        branchId,
        version: archived.version,
        snapshot: archived,
        changeSummary: "归档分支",
        createdBy: actor.membershipId,
      });
      await tx.insert(projectActivityLog).values({
        projectId,
        actorMembershipId: actor.membershipId,
        activityType: "archived",
        entityType: "project_branch",
        entityId: branchId,
        entityVersion: archived.version,
        details: { archivedAt: archivedAt.toISOString() },
      });
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "project.branch_archived",
        entityType: "project_branch",
        entityId: branchId,
        before,
        after: archived,
      });
      return archived;
    });
  }

  async restoreBranch(
    actor: ProjectActor,
    projectId: string,
    branchId: string,
    expectedVersion: number,
  ) {
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(projectBranches)
        .where(
          and(
            eq(projectBranches.id, branchId),
            eq(projectBranches.projectId, projectId),
            isNull(projectBranches.deletedAt),
          ),
        )
        .limit(1);
      if (!before || !before.archivedAt) throw new ProjectNotFoundError();
      if (before.mergedAt) {
        throw new ProjectTreeValidationError(
          "已合并的分支不能恢复，以免重复合并项目结构。",
        );
      }
      const [restored] = await tx
        .update(projectBranches)
        .set({
          archivedAt: null,
          version: expectedVersion + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(projectBranches.id, branchId),
            eq(projectBranches.projectId, projectId),
            eq(projectBranches.version, expectedVersion),
            isNull(projectBranches.deletedAt),
          ),
        )
        .returning();
      if (!restored) throw new ProjectVersionConflictError();
      await tx.insert(projectBranchVersions).values({
        branchId,
        version: restored.version,
        snapshot: restored,
        changeSummary: "恢复已归档分支",
        createdBy: actor.membershipId,
      });
      await tx.insert(projectActivityLog).values({
        projectId,
        actorMembershipId: actor.membershipId,
        activityType: "restored",
        entityType: "project_branch",
        entityId: branchId,
        entityVersion: restored.version,
        details: { restoredFromArchive: true },
      });
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "project.branch_restored",
        entityType: "project_branch",
        entityId: branchId,
        before,
        after: restored,
      });
      return restored;
    });
  }

  async mergeBranch(
    actor: ProjectActor,
    projectId: string,
    branchId: string,
    targetBranchId: string,
    expectedVersion: number,
  ) {
    if (branchId === targetBranchId) {
      throw new ProjectTreeValidationError("分支不能合并到自身。");
    }
    return this.db.transaction(async (tx) => {
      const [source] = await tx
        .select()
        .from(projectBranches)
        .where(
          and(
            eq(projectBranches.id, branchId),
            eq(projectBranches.projectId, projectId),
            isNull(projectBranches.deletedAt),
            isNull(projectBranches.archivedAt),
          ),
        )
        .for("update")
        .limit(1);
      if (!source) throw new ProjectNotFoundError();
      if (source.isDefault) {
        throw new ProjectTreeValidationError("项目主线不能作为待合并来源。");
      }
      const [target] = await tx
        .select()
        .from(projectBranches)
        .where(
          and(
            eq(projectBranches.id, targetBranchId),
            eq(projectBranches.projectId, projectId),
            isNull(projectBranches.deletedAt),
            isNull(projectBranches.archivedAt),
          ),
        )
        .for("update")
        .limit(1);
      if (!target) {
        throw new ProjectTreeValidationError(
          "合并目标必须是当前项目中的活跃分支。",
        );
      }

      const sourceNodes = await tx
        .select()
        .from(projectNodes)
        .where(
          and(
            eq(projectNodes.projectId, projectId),
            eq(projectNodes.branchId, branchId),
            isNull(projectNodes.deletedAt),
          ),
        )
        .orderBy(asc(projectNodes.createdAt), asc(projectNodes.sortOrder));
      const sourceNodeIds = new Set(sourceNodes.map((node) => node.id));
      const clonedIdBySourceId = new Map<string, string>();
      const pendingNodes = new Map(sourceNodes.map((node) => [node.id, node]));
      const clonedNodes: typeof sourceNodes = [];
      while (pendingNodes.size > 0) {
        const next = [...pendingNodes.values()].find(
          (node) => !node.parentId || clonedIdBySourceId.has(node.parentId),
        );
        if (!next) {
          throw new ProjectTreeValidationError(
            "待合并分支存在无法解析的节点层级。",
          );
        }
        const [clone] = await tx
          .insert(projectNodes)
          .values({
            projectId,
            branchId: targetBranchId,
            parentId: next.parentId
              ? (clonedIdBySourceId.get(next.parentId) ?? null)
              : null,
            type: next.type,
            title: next.title,
            description: next.description,
            status: next.status,
            progress: next.progress,
            progressMode: next.progressMode,
            weight: next.weight,
            sortOrder: next.sortOrder,
            startAt: next.startAt,
            dueAt: next.dueAt,
            metadata: next.metadata,
            createdBy: actor.membershipId,
          })
          .returning();
        if (!clone)
          throw new Error("Failed to copy project node while merging");
        clonedIdBySourceId.set(next.id, clone.id);
        pendingNodes.delete(next.id);
        clonedNodes.push(clone);
      }

      const sourceEdges = (
        await tx
          .select()
          .from(projectEdges)
          .where(
            and(
              eq(projectEdges.projectId, projectId),
              isNull(projectEdges.deletedAt),
            ),
          )
      ).filter(
        (edge) =>
          sourceNodeIds.has(edge.sourceNodeId) &&
          sourceNodeIds.has(edge.targetNodeId),
      );
      const sourceAssignments = sourceNodeIds.size
        ? await tx
            .select({
              nodeId: projectNodeAssignees.nodeId,
              membershipId: projectNodeAssignees.membershipId,
              isResponsible: projectNodeAssignees.isResponsible,
            })
            .from(projectNodeAssignees)
            .innerJoin(
              projectMembers,
              and(
                eq(
                  projectMembers.membershipId,
                  projectNodeAssignees.membershipId,
                ),
                eq(projectMembers.projectId, projectId),
                isNull(projectMembers.leftAt),
              ),
            )
            .where(inArray(projectNodeAssignees.nodeId, [...sourceNodeIds]))
        : [];
      if (sourceEdges.length) {
        await tx.insert(projectEdges).values(
          sourceEdges.map((edge) => ({
            projectId,
            sourceNodeId: clonedIdBySourceId.get(edge.sourceNodeId)!,
            targetNodeId: clonedIdBySourceId.get(edge.targetNodeId)!,
            type: edge.type,
            label: edge.label,
            createdBy: actor.membershipId,
          })),
        );
      }
      if (sourceAssignments.length) {
        await tx.insert(projectNodeAssignees).values(
          sourceAssignments.map((assignment) => ({
            nodeId: clonedIdBySourceId.get(assignment.nodeId)!,
            membershipId: assignment.membershipId,
            isResponsible: assignment.isResponsible,
          })),
        );
      }
      for (const clone of clonedNodes) {
        await this.recordNodeVersion(
          tx,
          clone,
          `从分支“${source.name}”合并`,
          actor.membershipId,
        );
      }
      await this.recalculateDerivedProgress(
        tx,
        actor,
        projectId,
        targetBranchId,
      );

      const mergedAt = new Date();
      const [merged] = await tx
        .update(projectBranches)
        .set({
          mergedIntoBranchId: targetBranchId,
          mergedAt,
          archivedAt: mergedAt,
          version: expectedVersion + 1,
          updatedAt: mergedAt,
        })
        .where(
          and(
            eq(projectBranches.id, branchId),
            eq(projectBranches.projectId, projectId),
            eq(projectBranches.version, expectedVersion),
            isNull(projectBranches.deletedAt),
            isNull(projectBranches.archivedAt),
          ),
        )
        .returning();
      if (!merged) throw new ProjectVersionConflictError();
      await tx.insert(projectBranchVersions).values({
        branchId,
        version: merged.version,
        snapshot: merged,
        changeSummary: `合并到“${target.name}”`,
        createdBy: actor.membershipId,
      });
      await tx.insert(projectActivityLog).values({
        projectId,
        actorMembershipId: actor.membershipId,
        activityType: "merged",
        entityType: "project_branch",
        entityId: branchId,
        entityVersion: merged.version,
        details: {
          targetBranchId,
          copiedNodeCount: clonedNodes.length,
          copiedEdgeCount: sourceEdges.length,
          copiedAssigneeCount: sourceAssignments.length,
        },
      });
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "project.branch_merged",
        entityType: "project_branch",
        entityId: branchId,
        before: source,
        after: merged,
      });
      return {
        branch: merged,
        copiedNodeCount: clonedNodes.length,
        copiedEdgeCount: sourceEdges.length,
        copiedAssigneeCount: sourceAssignments.length,
      };
    });
  }

  async createNode(
    actor: ProjectActor,
    projectId: string,
    input: CreateNodeInput,
  ) {
    const progressMode = input.progressMode ?? "manual";
    if (progressMode !== "manual" && input.progress !== undefined) {
      throw new ProjectTreeValidationError(
        "自动进度模式不能在创建时直接填写进度。",
      );
    }
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
            isNull(projectBranches.archivedAt),
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
        if (!parent)
          throw new ProjectTreeValidationError("父节点不在当前项目分支中。");
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
          progress: String(input.progress ?? 0),
          progressMode,
          weight: String(input.weight ?? 1),
          startAt: input.startAt,
          dueAt: input.dueAt,
          sortOrder: input.sortOrder,
          createdBy: actor.membershipId,
        })
        .returning();
      if (!node) throw new Error("Failed to create project node");
      await this.recordNodeVersion(tx, node, "创建节点", actor.membershipId);
      await tx.insert(projectActivityLog).values({
        projectId,
        actorMembershipId: actor.membershipId,
        activityType: "created",
        entityType: "project_node",
        entityId: node.id,
        entityVersion: 1,
        details: { title: node.title, parentId: node.parentId },
      });
      await this.recalculateDerivedProgress(
        tx,
        actor,
        projectId,
        input.branchId,
      );
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
      status?:
        | "not_started"
        | "in_progress"
        | "blocked"
        | "in_review"
        | "completed"
        | "cancelled"
        | undefined;
      progress?: number | undefined;
      progressMode?: ProjectProgressMode | undefined;
      weight?: number | undefined;
      startAt?: Date | null | undefined;
      dueAt?: Date | null | undefined;
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
      const progressMode = changes.progressMode ?? before.progressMode;
      if (progressMode !== "manual" && changes.progress !== undefined) {
        throw new ProjectTreeValidationError(
          "自动进度模式不能手工填写进度；请先切回手动模式。",
        );
      }
      const nextStartAt =
        changes.startAt === undefined ? before.startAt : changes.startAt;
      const nextDueAt =
        changes.dueAt === undefined ? before.dueAt : changes.dueAt;
      if (nextStartAt && nextDueAt && nextDueAt < nextStartAt) {
        throw new ProjectTreeValidationError("节点截止时间不能早于开始时间。");
      }
      const [updated] = await tx
        .update(projectNodes)
        .set({
          title: changes.title,
          description: changes.description,
          status: changes.status,
          progress:
            changes.progress === undefined
              ? undefined
              : String(changes.progress),
          progressMode,
          weight:
            changes.weight === undefined ? undefined : String(changes.weight),
          startAt: changes.startAt,
          dueAt: changes.dueAt,
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
      await this.recordNodeVersion(
        tx,
        updated,
        changes.changeSummary,
        actor.membershipId,
      );
      await tx.insert(projectActivityLog).values({
        projectId,
        actorMembershipId: actor.membershipId,
        activityType: "updated",
        entityType: "project_node",
        entityId: nodeId,
        entityVersion: updated.version,
        details: {
          before,
          after: updated,
          changeSummary: changes.changeSummary,
        },
      });
      await this.recalculateDerivedProgress(
        tx,
        actor,
        projectId,
        before.branchId,
      );
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
        throw new ProjectTreeValidationError("目标父节点不在当前分支中。");
      }
      let cursor = parentId;
      while (cursor) {
        if (cursor === nodeId)
          throw new ProjectTreeValidationError("移动会造成项目树循环。");
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
        .where(
          and(
            eq(projectNodes.id, nodeId),
            eq(projectNodes.version, expectedVersion),
          ),
        )
        .returning();
      if (!updated) throw new ProjectVersionConflictError();
      await this.recordNodeVersion(
        tx,
        updated,
        "移动节点",
        actor.membershipId,
      );
      await tx.insert(projectActivityLog).values({
        projectId,
        actorMembershipId: actor.membershipId,
        activityType: "moved",
        entityType: "project_node",
        entityId: nodeId,
        entityVersion: updated.version,
        details: {
          fromParentId: node.parentId,
          toParentId: parentId,
          sortOrder,
        },
      });
      await this.recalculateDerivedProgress(
        tx,
        actor,
        projectId,
        node.branchId,
      );
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
      const snapshot = versionRecord.snapshot as ProjectNodeVersionSnapshot;
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
      const historicalAssignments = Array.isArray(snapshot.assignees)
        ? snapshot.assignees.filter(
            (assignment) =>
              typeof assignment?.membershipId === "string" &&
              typeof assignment.isResponsible === "boolean",
          )
        : null;
      let restoredAssigneeCount = 0;
      let skippedFormerAssigneeCount = 0;
      if (historicalAssignments) {
        const historicalMembershipIds = [
          ...new Set(
            historicalAssignments.map((assignment) => assignment.membershipId),
          ),
        ];
        const activeMembershipIds = historicalMembershipIds.length
          ? new Set(
              (
                await tx
                  .select({ membershipId: projectMembers.membershipId })
                  .from(projectMembers)
                  .where(
                    and(
                      eq(projectMembers.projectId, projectId),
                      isNull(projectMembers.leftAt),
                      inArray(projectMembers.membershipId, historicalMembershipIds),
                    ),
                  )
              ).map((member) => member.membershipId),
            )
          : new Set<string>();
        let hasResponsible = false;
        const seenMembershipIds = new Set<string>();
        const assignmentsToRestore = historicalAssignments.filter((assignment) => {
          if (seenMembershipIds.has(assignment.membershipId)) return false;
          seenMembershipIds.add(assignment.membershipId);
          if (!activeMembershipIds.has(assignment.membershipId)) return false;
          if (assignment.isResponsible && hasResponsible) return false;
          if (assignment.isResponsible) hasResponsible = true;
          return true;
        });
        skippedFormerAssigneeCount =
          historicalAssignments.length - assignmentsToRestore.length;
        await tx
          .delete(projectNodeAssignees)
          .where(eq(projectNodeAssignees.nodeId, nodeId));
        if (assignmentsToRestore.length) {
          await tx.insert(projectNodeAssignees).values(
            assignmentsToRestore.map((assignment) => ({
              nodeId,
              membershipId: assignment.membershipId,
              isResponsible: assignment.isResponsible,
            })),
          );
        }
        restoredAssigneeCount = assignmentsToRestore.length;
      }
      await this.recordNodeVersion(
        tx,
        updated,
        `回滚到版本 ${targetVersion}`,
        actor.membershipId,
      );
      await tx.insert(projectActivityLog).values({
        projectId,
        actorMembershipId: actor.membershipId,
        activityType: "rolled_back",
        entityType: "project_node",
        entityId: nodeId,
        entityVersion: updated.version,
        details: {
          targetVersion,
          newVersion: updated.version,
          restoredAssigneeCount,
          skippedFormerAssigneeCount,
          assignmentStateIncluded: historicalAssignments !== null,
        },
      });
      await this.recalculateDerivedProgress(
        tx,
        actor,
        projectId,
        updated.branchId,
      );
      return updated;
    });
  }

  async deleteNode(
    actor: ProjectActor,
    projectId: string,
    nodeId: string,
    expectedVersion: number,
  ) {
    return this.db.transaction(async (tx) => {
      const descendants = await tx
        .select({ id: projectNodes.id })
        .from(projectNodes)
        .where(
          and(
            eq(projectNodes.parentId, nodeId),
            isNull(projectNodes.deletedAt),
          ),
        )
        .limit(1);
      if (descendants.length > 0) {
        throw new ProjectTreeValidationError(
          "请先移动或删除子节点，不能删除仍包含子节点的节点。",
        );
      }
      const [deleted] = await tx
        .update(projectNodes)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
          version: expectedVersion + 1,
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
      await this.recalculateDerivedProgress(
        tx,
        actor,
        projectId,
        deleted.branchId,
      );
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
        .where(
          and(
            eq(projectNodes.id, nodeId),
            eq(projectNodes.projectId, projectId),
          ),
        )
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
      await this.recalculateDerivedProgress(
        tx,
        actor,
        projectId,
        restored.branchId,
      );
      return restored;
    });
  }

  /**
   * Recomputes only derived progress in one branch.  Manual nodes remain the
   * source of truth; parent nodes in automatic modes receive a normal version,
   * activity event, and audit trail just like an explicit edit.
   */
  private async recalculateDerivedProgress(
    db: ProjectExecutor,
    actor: ProjectActor,
    projectId: string,
    branchId: string,
  ) {
    const nodes = await db
      .select()
      .from(projectNodes)
      .where(
        and(
          eq(projectNodes.projectId, projectId),
          eq(projectNodes.branchId, branchId),
          isNull(projectNodes.deletedAt),
        ),
      );
    if (!nodes.length) return;

    let calculatedProgress: Map<string, number>;
    try {
      calculatedProgress = calculateDerivedProjectProgress(
        nodes.map((node) => ({
          id: node.id,
          parentId: node.parentId,
          type: node.type,
          status: node.status,
          progress: Number(node.progress),
          progressMode: node.progressMode,
          weight: Number(node.weight),
        })),
      );
    } catch (error) {
      if (error instanceof ProjectProgressCycleError) {
        throw new ProjectTreeValidationError(error.message);
      }
      throw error;
    }

    for (const node of nodes) {
      if (node.progressMode === "manual") continue;
      const roundedProgress = calculatedProgress.get(node.id);
      if (roundedProgress === undefined) continue;
      if (Math.abs(Number(node.progress) - roundedProgress) < 0.005) continue;

      const [updated] = await db
        .update(projectNodes)
        .set({
          progress: roundedProgress.toFixed(2),
          version: node.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(projectNodes.id, node.id),
            eq(projectNodes.version, node.version),
            isNull(projectNodes.deletedAt),
          ),
        )
        .returning();
      if (!updated) throw new ProjectVersionConflictError();
      await this.recordNodeVersion(
        db,
        updated,
        node.progressMode === "weighted_children"
          ? "根据子节点权重自动汇总进度"
          : "根据里程碑自动汇总进度",
        actor.membershipId,
      );
      await db.insert(projectActivityLog).values({
        projectId,
        actorMembershipId: actor.membershipId,
        activityType: "updated",
        entityType: "project_node",
        entityId: node.id,
        entityVersion: updated.version,
        details: {
          automaticProgress: true,
          progressMode: node.progressMode,
          beforeProgress: node.progress,
          afterProgress: updated.progress,
        },
      });
      await db.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "project.node_progress_recalculated",
        entityType: "project_node",
        entityId: node.id,
        before: { progress: node.progress, version: node.version },
        after: { progress: updated.progress, version: updated.version },
      });
    }
  }
}
