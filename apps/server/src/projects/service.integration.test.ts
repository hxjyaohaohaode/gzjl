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
  projectNodeVersions,
  users,
} from "@workbench/db/schema";

import { ProjectService, ProjectTreeValidationError } from "./service.js";

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
});
