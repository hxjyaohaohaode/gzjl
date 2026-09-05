import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "@workbench/db";
import {
  attachmentLinks,
  attachments,
  organizations,
  orgMemberships,
  outboxEvents,
  users,
  workSessions,
} from "@workbench/db/schema";

import { ApprovalService } from "../approvals/service.js";
import {
  WorkSessionConflictError,
  WorkSessionEvidenceRequiredError,
  WorkSessionService,
} from "./service.js";

const clients: PGlite[] = [];

async function createTestDatabase(): Promise<Database> {
  const client = new PGlite();
  clients.push(client);
  const migrationsDir = resolve(import.meta.dirname, "../../../../packages/db/drizzle");
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

async function seedActors(db: Database) {
  const [organization] = await db
    .insert(organizations)
    .values({ name: "工时链路测试", timezone: "Asia/Shanghai" })
    .returning();
  const createdUsers = await db
    .insert(users)
    .values([{ displayName: "员工" }, { displayName: "所有者" }])
    .returning();
  const memberships = await db
    .insert(orgMemberships)
    .values(
      createdUsers.map((user) => ({
        organizationId: organization!.id,
        userId: user.id,
        status: "active" as const,
        joinedAt: new Date("2026-01-01T00:00:00.000Z"),
      })),
    )
    .returning();
  return {
    employee: { organizationId: organization!.id, membershipId: memberships[0]!.id },
    owner: {
      organizationId: organization!.id,
      membershipId: memberships[1]!.id,
      grants: [
        {
          permission: "work.review" as const,
          scopeKind: "organization" as const,
          scopeId: null,
        },
      ],
    },
  };
}

function manualInput(startAt: Date, endAt: Date, content: string) {
  return {
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    timezone: "Asia/Shanghai",
    source: "manual" as const,
    content,
    result: "",
    blockers: "",
    nextStep: "",
    primaryProjectNodeId: null,
    projectNodeIds: [] as string[],
    visibility: "management_only" as const,
    parallelWork: false,
    breaks: [] as Array<{ startAt: string; endAt: string }>,
  };
}

describe("structured work entry and approval chain", () => {
  it("rolls back the entire multi-segment batch when one segment overlaps", async () => {
    const db = await createTestDatabase();
    const actors = await seedActors(db);
    const service = new WorkSessionService(db);
    const anchor = Date.now() - 6 * 60 * 60_000;

    await expect(
      service.createStructuredBatch(actors.employee, [
        {
          recordKind: "fact",
          input: manualInput(new Date(anchor), new Date(anchor + 60 * 60_000), "第一段"),
        },
        {
          recordKind: "fact",
          input: manualInput(
            new Date(anchor + 30 * 60_000),
            new Date(anchor + 90 * 60_000),
            "冲突段",
          ),
        },
      ]),
    ).rejects.toBeInstanceOf(WorkSessionConflictError);

    expect(await db.select().from(workSessions)).toHaveLength(0);
  });

  it("accepts an in-progress private plan and exposes submitted fact to the owner", async () => {
    const db = await createTestDatabase();
    const actors = await seedActors(db);
    const work = new WorkSessionService(db);
    const now = Date.now();
    const [fact, plan] = await work.createStructuredBatch(actors.employee, [
      {
        recordKind: "fact",
        input: manualInput(
          new Date(now - 4 * 60 * 60_000),
          new Date(now - 3 * 60 * 60_000),
          "已完成工作",
        ),
      },
      {
        recordKind: "plan",
        input: manualInput(
          new Date(now - 30 * 60_000),
          new Date(now + 30 * 60_000),
          "尚未结束的计划",
        ),
      },
    ]);

    expect(fact?.recordKind).toBe("fact");
    expect(plan).toMatchObject({ recordKind: "plan", visibility: "private" });
    const [evidence] = await db
      .insert(attachments)
      .values({
        organizationId: actors.employee.organizationId,
        uploadedBy: actors.employee.membershipId,
        kind: "text",
        status: "available",
        textContent: "已核验的交付说明",
        visibility: "management_only",
      })
      .returning();
    await db.insert(attachmentLinks).values({
      attachmentId: evidence!.id,
      entityType: "work_session",
      entityId: fact!.id,
      createdBy: actors.employee.membershipId,
    });
    await work.submit(actors.employee, fact!.id, fact!.version);

    const pending = await new ApprovalService(db).listPending(actors.owner, 20);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      session: {
        id: fact!.id,
        content: "已完成工作",
        submissionStatus: "submitted",
        approvalStatus: "pending_review",
      },
    });

    const submitted = pending[0]!.session;
    const withdrawn = await work.withdrawSubmission(
      actors.employee,
      submitted.id,
      submitted.version,
    );
    expect(withdrawn).toMatchObject({
      submissionStatus: "draft",
      approvalStatus: "not_requested",
    });
    expect(await new ApprovalService(db).listPending(actors.owner, 20)).toHaveLength(0);
    const realtimeSignals = await db.select().from(outboxEvents);
    expect(
      realtimeSignals.map((event) => event.eventType),
    ).toEqual(
      expect.arrayContaining([
        "work_session.changed",
      ]),
    );
  });

  it("refuses submission until review-visible verified evidence exists", async () => {
    const db = await createTestDatabase();
    const actors = await seedActors(db);
    const work = new WorkSessionService(db);
    const now = Date.now();
    const fact = await work.createManual(
      actors.employee,
      manualInput(
        new Date(now - 2 * 60 * 60_000),
        new Date(now - 60 * 60_000),
        "等待证据的工作",
      ),
    );

    await expect(
      work.submit(actors.employee, fact.id, fact.version),
    ).rejects.toBeInstanceOf(WorkSessionEvidenceRequiredError);

    const [privateEvidence] = await db
      .insert(attachments)
      .values({
        organizationId: actors.employee.organizationId,
        uploadedBy: actors.employee.membershipId,
        kind: "text",
        status: "available",
        textContent: "仅本人可见",
        visibility: "private",
      })
      .returning();
    await db.insert(attachmentLinks).values({
      attachmentId: privateEvidence!.id,
      entityType: "work_session",
      entityId: fact.id,
      createdBy: actors.employee.membershipId,
    });

    await expect(
      work.submit(actors.employee, fact.id, fact.version),
    ).rejects.toBeInstanceOf(WorkSessionEvidenceRequiredError);
  });
});
