import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "@workbench/db";
import {
  memberIdentities,
  organizations,
  orgMemberships,
  professionalIdentities,
  projectBranches,
  projectMembers,
  projectNodes,
  projects,
  users,
  workSessionProjectLinks,
  workSessions,
} from "@workbench/db/schema";

import { ProjectService } from "../projects/service.js";
import { AnalyticsService, type AnalyticsActor } from "./service.js";

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

async function seedVisibilityScenario(db: Database) {
  const [organization] = await db
    .insert(organizations)
    .values({ name: "权限隔离组织", timezone: "Asia/Shanghai" })
    .returning();
  const createdUsers = await db
    .insert(users)
    .values([
      { displayName: "普通成员" },
      { displayName: "公开协作者" },
      { displayName: "关闭动态成员" },
    ])
    .returning();
  const memberships = await db
    .insert(orgMemberships)
    .values(
      createdUsers.map((user, index) => ({
        organizationId: organization!.id,
        userId: user.id,
        status: "active" as const,
        positionTitle: ["前端工程师", "产品经理", "财务"][index],
        joinedAt: new Date("2026-01-01T00:00:00.000Z"),
      })),
    )
    .returning();
  const [actor, coworker, hidden] = memberships;
  const [project] = await db
    .insert(projects)
    .values({
      organizationId: organization!.id,
      key: "PRIVACY",
      name: "权限项目",
      status: "active",
      createdBy: actor!.id,
    })
    .returning();
  await db.insert(projectMembers).values([
    { projectId: project!.id, membershipId: actor!.id, role: "member" },
    { projectId: project!.id, membershipId: coworker!.id, role: "member" },
    {
      projectId: project!.id,
      membershipId: hidden!.id,
      role: "member",
      publicActivityVisible: false,
    },
  ]);
  const [branch] = await db
    .insert(projectBranches)
    .values({
      projectId: project!.id,
      name: "主线",
      isDefault: true,
      createdBy: actor!.id,
    })
    .returning();
  const [node] = await db
    .insert(projectNodes)
    .values({
      projectId: project!.id,
      branchId: branch!.id,
      title: "交付节点",
      createdBy: actor!.id,
    })
    .returning();
  const [identity] = await db
    .insert(professionalIdentities)
    .values({
      organizationId: organization!.id,
      name: "产品设计",
      normalizedName: "产品设计",
    })
    .returning();
  await db.insert(memberIdentities).values({
    membershipId: coworker!.id,
    identityId: identity!.id,
    source: "organization",
  });

  const sessionInputs = [
    {
      membershipId: actor!.id,
      content: "本人私密记录",
      visibility: "private" as const,
      startAt: new Date("2026-09-04T00:00:00.000Z"),
      endAt: new Date("2026-09-04T01:00:00.000Z"),
      seconds: 3_600,
    },
    {
      membershipId: actor!.id,
      content: "本人公开记录",
      visibility: "project_visible" as const,
      startAt: new Date("2026-09-04T02:00:00.000Z"),
      endAt: new Date("2026-09-04T02:30:00.000Z"),
      seconds: 1_800,
    },
    {
      membershipId: coworker!.id,
      content: "协作者公开记录",
      visibility: "project_visible" as const,
      startAt: new Date("2026-09-04T03:00:00.000Z"),
      endAt: new Date("2026-09-04T05:00:00.000Z"),
      seconds: 7_200,
    },
    {
      membershipId: coworker!.id,
      content: "协作者私密记录",
      visibility: "private" as const,
      startAt: new Date("2026-09-04T06:00:00.000Z"),
      endAt: new Date("2026-09-04T07:00:00.000Z"),
      seconds: 3_600,
    },
    {
      membershipId: hidden!.id,
      content: "关闭公开动态后的记录",
      visibility: "project_visible" as const,
      startAt: new Date("2026-09-04T08:00:00.000Z"),
      endAt: new Date("2026-09-04T09:00:00.000Z"),
      seconds: 3_600,
    },
  ];
  const sessions = await db
    .insert(workSessions)
    .values(
      sessionInputs.map((input) => ({
        organizationId: organization!.id,
        membershipId: input.membershipId,
        startAt: input.startAt,
        endAt: input.endAt,
        timezone: "Asia/Shanghai",
        grossSeconds: input.seconds,
        netSeconds: input.seconds,
        source: "manual" as const,
        content: input.content,
        result: `${input.content}结果`,
        primaryProjectNodeId: node!.id,
        visibility: input.visibility,
      })),
    )
    .returning();
  await db.insert(workSessionProjectLinks).values(
    sessions.map((session) => ({
      workSessionId: session.id,
      projectId: project!.id,
      projectNodeId: node!.id,
      projectBranchId: branch!.id,
      isPrimary: true,
    })),
  );

  const employeeActor: AnalyticsActor = {
    organizationId: organization!.id,
    membershipId: actor!.id,
    grants: [
      {
        permission: "work.view_own",
        scopeKind: "self",
        scopeId: actor!.id,
      },
      {
        permission: "work.view_project_public",
        scopeKind: "organization",
        scopeId: null,
      },
    ],
  };
  const ownerActor: AnalyticsActor = {
    organizationId: organization!.id,
    membershipId: actor!.id,
    grants: [
      {
        permission: "work.view_full_scope",
        scopeKind: "organization",
        scopeId: null,
      },
    ],
  };
  return {
    organization: organization!,
    actor: actor!,
    coworker: coworker!,
    hidden: hidden!,
    project: project!,
    node: node!,
    employeeActor,
    ownerActor,
  };
}

describe("analytics and project work visibility", () => {
  it("keeps employee analytics strictly on the employee's own fact rows", async () => {
    const db = await createTestDatabase();
    const seeded = await seedVisibilityScenario(db);
    const summary = await new AnalyticsService(db).summary(
      seeded.employeeActor,
      new Date("2026-09-03T16:00:00.000Z"),
      new Date("2026-09-05T16:00:00.000Z"),
    );

    expect(summary.totals).toMatchObject({
      sessionCount: 2,
      totalSeconds: 5_400,
    });
    expect(summary.byMember).toEqual([
      expect.objectContaining({
        membershipId: seeded.actor.id,
        displayName: "普通成员",
        seconds: 5_400,
      }),
    ]);
    expect(JSON.stringify(summary)).not.toContain("协作者私密记录");
  });

  it("shows shared-project public activity and last work time without leaking intervals or duration", async () => {
    const db = await createTestDatabase();
    const seeded = await seedVisibilityScenario(db);
    const result = await new AnalyticsService(db).teamActivity(
      seeded.employeeActor,
      50,
    );

    expect(result.scope).toBe("shared_projects");
    expect(result.items.map((item) => item.content)).toEqual([
      "协作者公开记录",
      "本人公开记录",
    ]);
    expect(
      result.items.every(
        (item) =>
          item.hasFullTiming === false &&
          item.startAt === null &&
          item.endAt === null &&
          item.netSeconds === null,
      ),
    ).toBe(true);
    const coworker = result.members.find(
      (member) => member.membershipId === seeded.coworker.id,
    );
    expect(coworker).toMatchObject({
      displayName: "公开协作者",
      professionalIdentities: ["产品设计"],
      projectNames: ["权限项目"],
      lastActivity: {
        content: "协作者公开记录",
        activityAt: new Date("2026-09-04T05:00:00.000Z"),
        startAt: null,
        netSeconds: null,
      },
    });
    expect(
      result.members.find((member) => member.membershipId === seeded.hidden.id)
        ?.lastActivity,
    ).toBeNull();
    expect(JSON.stringify(result)).not.toContain("协作者私密记录");
    expect(JSON.stringify(result)).not.toContain("关闭公开动态后的记录");
  });

  it("lets the Owner inspect all organization facts with full timing", async () => {
    const db = await createTestDatabase();
    const seeded = await seedVisibilityScenario(db);
    const result = await new AnalyticsService(db).teamActivity(
      seeded.ownerActor,
      50,
    );

    expect(result.scope).toBe("organization");
    expect(result.items).toHaveLength(5);
    expect(result.items.every((item) => item.hasFullTiming)).toBe(true);
    expect(result.items.find((item) => item.content === "协作者私密记录"))
      .toMatchObject({ netSeconds: 3_600 });
  });

  it("redacts other members' node timing and respects their public-activity switch", async () => {
    const db = await createTestDatabase();
    const seeded = await seedVisibilityScenario(db);
    const service = new ProjectService(db);
    const employeeRows = await service.nodeWorkSessions(
      seeded.employeeActor,
      seeded.project.id,
      seeded.node.id,
      false,
    );

    expect(employeeRows.map((row) => row.content)).toEqual([
      "协作者公开记录",
      "本人公开记录",
      "本人私密记录",
    ]);
    expect(
      employeeRows.find((row) => row.content === "协作者公开记录"),
    ).toMatchObject({
      hasFullTiming: false,
      startAt: null,
      endAt: null,
      netSeconds: null,
      source: null,
    });
    expect(
      employeeRows.find((row) => row.content === "本人私密记录"),
    ).toMatchObject({ hasFullTiming: true, netSeconds: 3_600 });
    expect(JSON.stringify(employeeRows)).not.toContain("协作者私密记录");
    expect(JSON.stringify(employeeRows)).not.toContain("关闭公开动态后的记录");

    const employeeMembers = await service.members(
      seeded.employeeActor,
      seeded.project.id,
      false,
    );
    expect(
      employeeMembers.find((member) => member.membershipId === seeded.actor.id)
        ?.lastActivityAt,
    ).toEqual(new Date("2026-09-04T02:30:00.000Z"));
    expect(
      employeeMembers.find((member) => member.membershipId === seeded.coworker.id)
        ?.lastActivityAt,
    ).toEqual(new Date("2026-09-04T05:00:00.000Z"));
    expect(
      employeeMembers.find((member) => member.membershipId === seeded.hidden.id)
        ?.lastActivityAt,
    ).toBeNull();

    const ownerRows = await service.nodeWorkSessions(
      seeded.ownerActor,
      seeded.project.id,
      seeded.node.id,
      true,
    );
    expect(ownerRows).toHaveLength(5);
    expect(ownerRows.every((row) => row.hasFullTiming)).toBe(true);
    const ownerMembers = await service.members(
      seeded.ownerActor,
      seeded.project.id,
      true,
    );
    expect(
      ownerMembers.find((member) => member.membershipId === seeded.hidden.id)
        ?.lastActivityAt,
    ).toEqual(new Date("2026-09-04T09:00:00.000Z"));
  });
});
