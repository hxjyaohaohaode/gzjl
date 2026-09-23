import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { DeleteObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@workbench/db";
import {
  auditLogs,
  exports as exportJobs,
  notifications,
  notificationPreferences,
  organizations,
  orgMemberships,
  users,
  workSessions,
} from "@workbench/db/schema";

import { createExportJobRuntime } from "./export-jobs.js";

const clients: PGlite[] = [];

async function createTestDatabase(): Promise<Database> {
  const client = new PGlite();
  clients.push(client);
  const migrationsDir = resolve(import.meta.dirname, "../../../packages/db/drizzle");
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

async function createFixture() {
  const db = await createTestDatabase();
  const [organization] = await db
    .insert(organizations)
    .values({ name: "Worker 导出测试" })
    .returning();
  const [requesterUser, colleagueUser] = await db
    .insert(users)
    .values([{ displayName: "请求人" }, { displayName: "同事" }])
    .returning();
  const [requester, colleague] = await db
    .insert(orgMemberships)
    .values([
      {
        organizationId: organization!.id,
        userId: requesterUser!.id,
        status: "active",
        joinedAt: new Date(),
      },
      {
        organizationId: organization!.id,
        userId: colleagueUser!.id,
        status: "active",
        joinedAt: new Date(),
      },
    ])
    .returning();
  await db.insert(workSessions).values([
    {
      organizationId: organization!.id,
      membershipId: requester!.id,
      startAt: new Date("2026-09-04T01:00:00.000Z"),
      endAt: new Date("2026-09-04T02:00:00.000Z"),
      timezone: "Asia/Shanghai",
      grossSeconds: 3_600,
      breakSeconds: 0,
      netSeconds: 3_600,
      billableSeconds: 3_600,
      source: "manual",
      content: "请求人的真实内容",
      result: "请求人的真实结果",
    },
    {
      organizationId: organization!.id,
      membershipId: colleague!.id,
      startAt: new Date("2026-09-04T03:00:00.000Z"),
      endAt: new Date("2026-09-04T04:00:00.000Z"),
      timezone: "Asia/Shanghai",
      grossSeconds: 3_600,
      breakSeconds: 0,
      netSeconds: 3_600,
      billableSeconds: 3_600,
      source: "manual",
      content: "同事的敏感内容",
      result: "同事的敏感结果",
    },
  ]);
  const [job] = await db
    .insert(exportJobs)
    .values({
      organizationId: organization!.id,
      requestedBy: requester!.id,
      format: "json",
      exportType: "work_sessions",
      deliveryMode: "background",
      scope: {
        version: 1,
        from: "2026-09-01T00:00:00.000Z",
        to: "2026-09-05T00:00:00.000Z",
        snapshotAt: new Date(Date.now() + 60_000).toISOString(),
      },
      fieldPolicySnapshot: {
        version: 1,
        requestedBy: requester!.id,
        includeContent: false,
        contentOrganizationWide: false,
        contentOrgUnitIds: [],
        contentProjectIds: [],
        organizationWide: true,
        orgUnitIds: [],
        projectIds: [],
        exportOrganizationWide: true,
        exportSelf: false,
        exportOrgUnitIds: [],
        exportProjectIds: [],
      },
      status: "queued",
    })
    .returning();
  return { db, job: job! };
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("export worker lifecycle", () => {
  it("keeps completion notifications during a temporary mute for delivery after unmuting", async () => {
    const { db, job } = await createFixture();
    await db.insert(notificationPreferences).values({ membershipId: job.requestedBy, category: "export_ready", inAppEnabled: true, mutedUntil: new Date(Date.now() + 60_000) });
    const client = { send: async () => ({}) } as unknown as S3Client;
    await createExportJobRuntime(db, {} as PgBoss, { client, bucket: "test" }).process(job.id);
    expect(await db.select().from(notifications)).toHaveLength(1);
  });
  it.each(["exportProjectIds", "exportOrgUnitIds"])("keeps an empty authorized %s scope empty", async (scopeKey) => {
    const { db, job } = await createFixture();
    await db.update(exportJobs).set({ fieldPolicySnapshot: {
      ...(job.fieldPolicySnapshot as Record<string, unknown>),
      exportOrganizationWide: false,
      [scopeKey]: ["00000000-0000-4000-8000-000000000099"],
    } }).where(eq(exportJobs.id, job.id));
    let payload: { rowCount: number; items: unknown[] } | undefined;
    const client = { send: async (command: PutObjectCommand) => {
      payload = JSON.parse((command.input.Body as Buffer).toString("utf8"));
      return {};
    } } as unknown as S3Client;
    await createExportJobRuntime(db, {} as PgBoss, { client, bucket: "test" }).process(job.id);
    expect(payload).toMatchObject({ rowCount: 0, items: [] });
  });

  it("preserves a completed export when notification storage fails", async () => {
    const { db, job } = await createFixture();
    await db.execute(sql`create function reject_notification() returns trigger language plpgsql as $$ begin raise exception 'notification unavailable'; end $$`);
    await db.execute(sql`create trigger reject_notification before insert on notifications for each row execute function reject_notification()`);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const send = vi.fn(async (command: PutObjectCommand | DeleteObjectCommand) => {
      expect(command).toBeInstanceOf(PutObjectCommand);
      return {};
    });
    try {
      const runtime = createExportJobRuntime(db, {} as PgBoss, { client: { send } as unknown as S3Client, bucket: "test" });
      await runtime.process(job.id);
      await runtime.process(job.id);
      expect((await db.select().from(exportJobs).where(eq(exportJobs.id, job.id)))[0]).toMatchObject({ status: "completed", attempt: 1 });
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0]?.[0]).not.toBeInstanceOf(DeleteObjectCommand);
      expect(warn).toHaveBeenCalledWith("Export notification unavailable; job result preserved.");
    } finally { warn.mockRestore(); }
  });

  it("does not let an expired worker replace or delete a newer artifact", async () => {
    const { db, job } = await createFixture();
    let start!: () => void;
    let finish!: () => void;
    const started = new Promise<void>((resolve) => { start = resolve; });
    const blocked = new Promise<void>((resolve) => { finish = resolve; });
    const sent: Array<PutObjectCommand | DeleteObjectCommand> = [];
    let first = true;
    const client = { send: async (command: PutObjectCommand | DeleteObjectCommand) => {
      sent.push(command);
      if (command instanceof PutObjectCommand && first) { first = false; start(); await blocked; }
      return {};
    } } as unknown as S3Client;
    const runtime = createExportJobRuntime(db, {} as PgBoss, { client, bucket: "test" });
    const staleRun = runtime.process(job.id);
    await started;
    await db.update(exportJobs).set({ startedAt: new Date(Date.now() - 16 * 60_000) }).where(eq(exportJobs.id, job.id));
    await runtime.recoverExpiredLeases();
    await runtime.process(job.id);
    const completed = (await db.select().from(exportJobs).where(eq(exportJobs.id, job.id)))[0]!;
    finish();
    await staleRun;
    expect(completed).toMatchObject({ status: "completed", attempt: 2 });
    expect((await db.select().from(exportJobs).where(eq(exportJobs.id, job.id)))[0]?.objectKey).toBe(completed.objectKey);
    const uploads = sent.filter((command) => command instanceof PutObjectCommand);
    expect(uploads[0]!.input.Key).not.toBe(uploads[1]!.input.Key);
    expect(sent.filter((command) => command instanceof DeleteObjectCommand).map((command) => command.input.Key)).toEqual([uploads[0]!.input.Key]);
    expect(await db.select().from(notifications)).toHaveLength(1);
  });

  it("stops automatic recovery after the final interrupted lease", async () => {
    const { db, job } = await createFixture();
    await db.update(exportJobs).set({ status: "running", attempt: job.maxAttempts, startedAt: new Date(Date.now() - 16 * 60_000) }).where(eq(exportJobs.id, job.id));
    await createExportJobRuntime(db, {} as PgBoss, null).recoverExpiredLeases();
    expect((await db.select().from(exportJobs).where(eq(exportJobs.id, job.id)))[0]).toMatchObject({ status: "failed", errorSummary: "export_lease_expired", completedAt: expect.any(Date) });
  });
  it("renders authorized facts, redacts sensitive fields, uploads, notifies, and expires", async () => {
    const { db, job } = await createFixture();
    const sent: Array<PutObjectCommand | DeleteObjectCommand> = [];
    const client = {
      send: async (command: PutObjectCommand | DeleteObjectCommand) => {
        sent.push(command);
        return {};
      },
    } as unknown as S3Client;
    const boss = { send: async () => "job-id" } as unknown as PgBoss;
    const runtime = createExportJobRuntime(db, boss, {
      client,
      bucket: "private-test-bucket",
    });

    await runtime.process(job.id);
    const [completed] = await db
      .select()
      .from(exportJobs)
      .where(eq(exportJobs.id, job.id));
    expect(completed).toMatchObject({
      status: "completed",
      progress: 100,
      attempt: 1,
      rowCount: 2,
      contentType: "application/json; charset=utf-8",
    });
    expect(completed?.objectKey).toContain(`/exports/`.slice(1));
    expect(completed?.sha256).toMatch(/^[a-f0-9]{64}$/);
    const upload = sent.find((command) => command instanceof PutObjectCommand);
    expect(upload).toBeDefined();
    const body = (upload as PutObjectCommand).input.Body;
    expect(Buffer.isBuffer(body)).toBe(true);
    const payload = JSON.parse((body as Buffer).toString("utf8")) as {
      items: Array<{ member: string; content: string }>;
    };
    expect(payload.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ member: "请求人", content: "请求人的真实内容" }),
        expect.objectContaining({ member: "同事", content: "[按字段策略隐藏]" }),
      ]),
    );
    expect(
      await db.select().from(notifications).where(eq(notifications.category, "export_ready")),
    ).toHaveLength(1);
    expect(
      await db.select().from(auditLogs).where(eq(auditLogs.entityId, job.id)),
    ).toHaveLength(1);

    await db
      .update(exportJobs)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(exportJobs.id, job.id));
    await runtime.cleanupExpired();
    const [expired] = await db
      .select()
      .from(exportJobs)
      .where(eq(exportJobs.id, job.id));
    expect(expired?.objectKey).toBeNull();
    expect(sent.some((command) => command instanceof DeleteObjectCommand)).toBe(true);
  });

  it("fails permanently with a stable error code when private storage is unavailable", async () => {
    const { db, job } = await createFixture();
    const boss = { send: async () => "job-id" } as unknown as PgBoss;
    const runtime = createExportJobRuntime(db, boss, null);
    await runtime.process(job.id);
    const [failed] = await db
      .select()
      .from(exportJobs)
      .where(eq(exportJobs.id, job.id));
    expect(failed).toMatchObject({
      status: "failed",
      progress: 0,
      attempt: 1,
      errorSummary: "export_storage_unavailable",
    });
    expect(
      await db.select().from(notifications).where(eq(notifications.category, "export_failed")),
    ).toHaveLength(1);
  });

  it("intersects broad data visibility with a narrower export scope", async () => {
    const { db, job } = await createFixture();
    await db
      .update(exportJobs)
      .set({
        fieldPolicySnapshot: {
          ...(job.fieldPolicySnapshot as Record<string, unknown>),
          exportOrganizationWide: false,
          exportSelf: true,
        },
      })
      .where(eq(exportJobs.id, job.id));
    let uploadedBody: Buffer | null = null;
    const client = {
      send: async (command: PutObjectCommand | DeleteObjectCommand) => {
        if (command instanceof PutObjectCommand && Buffer.isBuffer(command.input.Body)) {
          uploadedBody = command.input.Body;
        }
        return {};
      },
    } as unknown as S3Client;
    const runtime = createExportJobRuntime(
      db,
      { send: async () => "job-id" } as unknown as PgBoss,
      { client, bucket: "private-test-bucket" },
    );
    await runtime.process(job.id);
    expect(uploadedBody).not.toBeNull();
    const payload = JSON.parse(uploadedBody!.toString("utf8")) as {
      rowCount: number;
      items: Array<{ member: string }>;
    };
    expect(payload.rowCount).toBe(1);
    expect(payload.items.map((item) => item.member)).toEqual(["请求人"]);
  });
});
