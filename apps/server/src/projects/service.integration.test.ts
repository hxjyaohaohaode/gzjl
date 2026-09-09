import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "@workbench/db";
import {
  organizations,
  orgMemberships,
  projectActivityLog,
  projectEdges,
  projectNodeVersions,
  projectNodeAssignees,
  outboxEvents,
  auditLogs,
  users,
} from "@workbench/db/schema";

import { ProjectService, ProjectTreeValidationError, ProjectNotFoundError, ProjectVersionConflictError } from "./service.js";

const clients: PGlite[] = [];

async function createTestDatabase(): Promise<Database> {
  const client = new PGlite();
  clients.push(client);
  const migrationsDir = resolve(
    import.meta.dirname,
    "../../../../packages/db/drizzle",
  );
  const migrations = (await readdir(migrationsDir))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
  for (const file of migrations) {
    const migration = await readFile(resolve(migrationsDir, file), "utf8");
    for (const statement of migration
      .split("--> statement-breakpoint")
      .map((value) => value.trim())
      .filter(Boolean)) {
      await client.exec(statement);
    }
  }
  return drizzle(client) as unknown as Database;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function createFixture() {
  const db = await createTestDatabase();
  const [organization] = await db
    .insert(organizations)
    .values({ name: "项目工作线事务测试", timezone: "Asia/Shanghai" })
    .returning();
  const [user] = await db
    .insert(users)
    .values({ displayName: "项目负责人" })
    .returning();
  const [membership] = await db
    .insert(orgMemberships)
    .values({
      organizationId: organization!.id,
      userId: user!.id,
      status: "active",
      joinedAt: new Date("2026-01-01T00:00:00.000Z"),
    })
    .returning();
  const actor = {
    organizationId: organization!.id,
    membershipId: membership!.id,
  };
  const service = new ProjectService(db);
  const created = await service.create(actor, {
    key: "BRANCH",
    name: "工作线验收项目",
    color: "#3468f5",
    startAt: new Date("2026-09-01T00:00:00.000Z"),
    dueAt: new Date("2026-09-30T00:00:00.000Z"),
  });
  return { db, actor, service, ...created };
}

describe("project node derived work-line transaction", () => {
  it("lets an employee join and claim without replacing collaborators or another responsible member", async () => {
    const { db, actor, service, project, root } = await createFixture();
    const [user] = await db.insert(users).values({ displayName: "主动认领员工", status: "active" }).returning();
    const [member] = await db.insert(orgMemberships).values({ organizationId: actor.organizationId, userId: user!.id, status: "active" }).returning();
    const employee = { organizationId: actor.organizationId, membershipId: member!.id };
    await expect(service.setNodeAssignees(employee, project.id, root.id, root.version, [], true)).rejects.toBeInstanceOf(ProjectNotFoundError);
    await service.joinProject(employee, project.id);
    const assigned = await service.setNodeAssignees(actor, project.id, root.id, root.version, [{ membershipId: actor.membershipId, isResponsible: false }]);
    await expect(service.setNodeAssignees(employee, project.id, root.id, root.version, [], true)).rejects.toBeInstanceOf(ProjectVersionConflictError);
    const claimed = await service.setNodeAssignees(employee, project.id, root.id, assigned.version, [], true);
    const assignments = await db.select().from(projectNodeAssignees);
    expect(assignments).toHaveLength(2);
    expect(assignments).toEqual(expect.arrayContaining([
      expect.objectContaining({ membershipId: actor.membershipId, isResponsible: false }),
      expect.objectContaining({ membershipId: employee.membershipId, isResponsible: true }),
    ]));
    // Retrying a committed claim does not produce a new version or erase peers.
    expect((await service.setNodeAssignees(employee, project.id, root.id, assigned.version, [], true)).version).toBe(claimed.version);
    await expect(service.setNodeAssignees(actor, project.id, root.id, claimed.version, [], true)).rejects.toThrow("已有负责人");
    await expect(service.setNodeAssignees({ ...employee, organizationId: crypto.randomUUID() }, project.id, root.id, claimed.version, [], true)).rejects.toBeInstanceOf(ProjectNotFoundError);
    expect(await db.select().from(auditLogs)).toEqual(expect.arrayContaining([expect.objectContaining({ action: "project.node_self_claimed" })]));
    expect(await db.select().from(outboxEvents)).toEqual(expect.arrayContaining([expect.objectContaining({ entityId: root.id, entityVersion: claimed.version })]));
  });

  it("refuses claims on archived branches and ended nodes", async () => {
    const { actor, service, project, root, branch } = await createFixture();
    const finished = await service.updateNode(actor, project.id, root.id, root.version, { status: "completed", changeSummary: "完成" });
    await expect(service.setNodeAssignees(actor, project.id, root.id, finished.version, [], true)).rejects.toThrow("已完成或已取消");
    const derived = await service.createBranch(actor, project.id, { name: "归档任务", parentBranchId: branch.id, sourceNodeId: root.id });
    const tree = await service.tree(actor, project.id, true);
    const node = tree.nodes.find((item) => item.branchId === derived.id)!;
    await service.archiveBranch(actor, project.id, derived.id, derived.version);
    await expect(service.setNodeAssignees(actor, project.id, node.id, node.version, [], true)).rejects.toThrow("归档分支");
  });

  it("creates a visible entry node and merges its complete hierarchy back under the source node", async () => {
    const { db, actor, service, project, branch: main, root } =
      await createFixture();

    const derived = await service.createBranch(actor, project.id, {
      name: "并行验收",
      description: "从根节点派生后独立推进",
      parentBranchId: main.id,
      sourceNodeId: root.id,
    });
    const afterDerive = await service.tree(actor, project.id, true);
    const entry = afterDerive.nodes.find(
      (node) => node.branchId === derived.id && node.parentId === null,
    );
    expect(derived).toMatchObject({
      parentBranchId: main.id,
      sourceNodeId: root.id,
    });
    expect(entry).toMatchObject({
      title: "并行验收",
      type: "task",
      startAt: root.startAt,
      dueAt: root.dueAt,
    });
    expect(entry?.metadata).toMatchObject({ derivedFromNodeId: root.id });

    const child = await service.createNode(actor, project.id, {
      branchId: derived.id,
      parentId: entry!.id,
      type: "deliverable",
      title: "验收交付物",
      progress: 25,
      sortOrder: 1,
    });
    await service.createEdge(actor, project.id, {
      sourceNodeId: entry!.id,
      targetNodeId: child.id,
      type: "depends_on",
      label: "包含",
    });

    const merge = await service.mergeBranch(
      actor,
      project.id,
      derived.id,
      main.id,
      derived.version,
    );
    expect(merge).toMatchObject({
      copiedNodeCount: 2,
      copiedEdgeCount: 1,
    });

    const afterMerge = await service.tree(actor, project.id, true);
    const mergedEntry = afterMerge.nodes.find(
      (node) => node.branchId === main.id && node.title === "并行验收",
    );
    const mergedChild = afterMerge.nodes.find(
      (node) => node.branchId === main.id && node.title === "验收交付物",
    );
    expect(mergedEntry?.parentId).toBe(root.id);
    expect(mergedChild?.parentId).toBe(mergedEntry?.id);
    expect(afterMerge.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceNodeId: mergedEntry?.id,
          targetNodeId: mergedChild?.id,
          type: "depends_on",
        }),
      ]),
    );
    expect(afterMerge.branches.find((item) => item.id === derived.id)).toMatchObject({
      mergedIntoBranchId: main.id,
      version: 2,
    });
    expect(afterMerge.nodes.some((node) => node.branchId === derived.id)).toBe(false);

    const versions = await db.select().from(projectNodeVersions);
    expect(versions.filter((item) => item.nodeId === mergedEntry?.id)).toHaveLength(1);
    expect(versions.filter((item) => item.nodeId === mergedChild?.id)).toHaveLength(1);
    const activity = await db.select().from(projectActivityLog);
    expect(activity.map((item) => item.activityType)).toEqual(
      expect.arrayContaining(["created", "branched", "merged"]),
    );
  });

  it("rejects a source node paired with an unrelated parent work line", async () => {
    const { actor, service, project, root } = await createFixture();
    const unrelated = await service.createBranch(actor, project.id, {
      name: "无关工作线",
    });
    await expect(
      service.createBranch(actor, project.id, {
        name: "错误挂载",
        parentBranchId: unrelated.id,
        sourceNodeId: root.id,
      }),
    ).rejects.toBeInstanceOf(ProjectTreeValidationError);
  });

  it("normalizes dependency direction and rejects a mixed dependency cycle", async () => {
    const { actor, service, project, branch, root } = await createFixture();
    const task = await service.createNode(actor, project.id, {
      branchId: branch.id,
      parentId: root.id,
      type: "task",
      title: "后续任务",
      progress: 0,
      sortOrder: 1,
    });

    await service.createEdge(actor, project.id, {
      sourceNodeId: task.id,
      targetNodeId: root.id,
      type: "depends_on",
    });
    await expect(
      service.createEdge(actor, project.id, {
        sourceNodeId: task.id,
        targetNodeId: root.id,
        type: "blocks",
      }),
    ).rejects.toThrowError("该执行关系会形成循环");
  });

  it("treats relates-to as an undirected relationship", async () => {
    const { actor, service, project, branch, root } = await createFixture();
    const task = await service.createNode(actor, project.id, {
      branchId: branch.id,
      parentId: root.id,
      type: "task",
      title: "关联任务",
      progress: 0,
      sortOrder: 1,
    });

    await service.createEdge(actor, project.id, {
      sourceNodeId: root.id,
      targetNodeId: task.id,
      type: "relates_to",
    });
    await expect(
      service.createEdge(actor, project.id, {
        sourceNodeId: task.id,
        targetNodeId: root.id,
        type: "relates_to",
      }),
    ).rejects.toThrowError("相同的节点关联已经存在");
  });

  it("creates multiple relationships atomically and records every edge", async () => {
    const { db, actor, service, project, branch, root } = await createFixture();
    const [first, second] = await Promise.all([
      service.createNode(actor, project.id, {
        branchId: branch.id,
        parentId: root.id,
        type: "task",
        title: "批量目标一",
        progress: 0,
        sortOrder: 1,
      }),
      service.createNode(actor, project.id, {
        branchId: branch.id,
        parentId: root.id,
        type: "task",
        title: "批量目标二",
        progress: 0,
        sortOrder: 2,
      }),
    ]);

    const edges = await service.createEdges(actor, project.id, [
      { sourceNodeId: root.id, targetNodeId: first.id, type: "relates_to", label: "共同交付" },
      { sourceNodeId: root.id, targetNodeId: second.id, type: "relates_to", label: "共同交付" },
    ]);

    expect(edges).toHaveLength(2);
    expect(await db.select().from(projectEdges)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetNodeId: first.id, label: "共同交付" }),
        expect.objectContaining({ targetNodeId: second.id, label: "共同交付" }),
      ]),
    );

    await expect(
      service.createEdges(actor, project.id, [
        { sourceNodeId: first.id, targetNodeId: second.id, type: "blocks" },
        { sourceNodeId: second.id, targetNodeId: first.id, type: "blocks" },
      ]),
    ).rejects.toThrowError("形成循环");
    const afterRejectedBatch = await db.select().from(projectEdges);
    expect(afterRejectedBatch.filter((edge) => edge.type === "blocks")).toHaveLength(0);
  });

  it("lets an active organization member discover and join a project", async () => {
    const { db, actor, service, project } = await createFixture();
    const [employee] = await db.insert(users).values({ displayName: "主动加入员工" }).returning();
    const [membership] = await db.insert(orgMemberships).values({
      organizationId: actor.organizationId,
      userId: employee!.id,
      status: "active",
      joinedAt: new Date("2026-09-02T00:00:00.000Z"),
    }).returning();
    const employeeActor = {
      organizationId: actor.organizationId,
      membershipId: membership!.id,
    };

    expect(await service.list(employeeActor, false)).toHaveLength(0);
    expect(await service.catalog(employeeActor, false)).toEqual([
      expect.objectContaining({ id: project.id, isMember: false, canAccess: false }),
    ]);

    const joined = await service.joinProject(employeeActor, project.id);
    expect(joined).toMatchObject({
      projectId: project.id,
      membershipId: membership!.id,
      role: "member",
      leftAt: null,
    });
    expect(await service.list(employeeActor, false)).toEqual([
      expect.objectContaining({ id: project.id }),
    ]);
    expect(await service.catalog(employeeActor, false)).toEqual([
      expect.objectContaining({ id: project.id, isMember: true, canAccess: true }),
    ]);
  });
});
