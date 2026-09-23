import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "@workbench/db";
import {
  auditLogs,
  exports as exportJobs,
  organizations,
  orgMemberships,
  outboxEvents,
  users,
  workSessions,
} from "@workbench/db/schema";

import { AnalyticsService, type AnalyticsActor } from "../analytics/service.js";
import { WorkSessionService } from "../work/service.js";
import type { ExportArtifactAccess } from "./artifact-store.js";
import { OperationsService } from "./service.js";
import type { ExportJobError } from "./service.js";

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

const availableStore: ExportArtifactAccess = {
  capabilities: () => ({
    available: true,
    formats: ["csv", "json", "xlsx", "pdf"],
    retentionHours: 24,
  }),
  createDownloadUrl: async () => ({
    url: "https://objects.example.test/signed-download",
    expiresInSeconds: 300,
  }),
};

async function createFixture(store: ExportArtifactAccess = availableStore) {
  const db = await createTestDatabase();
  const [organization] = await db
    .insert(organizations)
    .values({ name: "后台导出测试组织" })
    .returning();
  const [ownerUser, otherUser] = await db
    .insert(users)
    .values([{ displayName: "Owner" }, { displayName: "Other" }])
    .returning();
  const [owner, other] = await db
    .insert(orgMemberships)
    .values([
      {
        organizationId: organization!.id,
        userId: ownerUser!.id,
        status: "active",
        joinedAt: new Date(),
      },
      {
        organizationId: organization!.id,
        userId: otherUser!.id,
        status: "active",
        joinedAt: new Date(),
      },
    ])
    .returning();
  const actor: AnalyticsActor = {
    organizationId: organization!.id,
    membershipId: owner!.id,
    grants: [
      { permission: "export.scope", scopeKind: "organization", scopeId: null },
      {
        permission: "work.view_full_scope",
        scopeKind: "organization",
        scopeId: null,
      },
    ],
  };
  const otherActor: AnalyticsActor = {
    organizationId: organization!.id,
    membershipId: other!.id,
    grants: [{ permission: "export.scope", scopeKind: "organization", scopeId: null }],
  };
  return {
    db,
    actor,
    otherActor,
    service: new OperationsService(
      db,
      new AnalyticsService(db),
      new WorkSessionService(db),
      store,
    ),
  };
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("background export lifecycle", () => {
  it("rechecks data and sensitive-field access independently of export permission before download", async () => {
    const { db, service, actor } = await createFixture();
    const created = await service.createBackgroundExport(actor, { exportType: "work_sessions", format: "json", from: new Date("2026-09-01"), to: new Date("2026-09-05") });
    await db.update(exportJobs).set({ status: "completed", objectKey: "private-file", fileName: "file.json", contentType: "application/json", expiresAt: new Date(Date.now() + 60_000) }).where(eq(exportJobs.id, created.id));
    await expect(service.backgroundExportDownload({ ...actor, grants: [{ permission: "export.scope", scopeKind: "organization", scopeId: null }] }, created.id)).rejects.toMatchObject({ code: "export_scope_revoked", statusCode: 403 });
    await expect(service.backgroundExportDownload({ ...actor, grants: [
      { permission: "export.scope", scopeKind: "organization", scopeId: null },
      { permission: "analytics.view_team", scopeKind: "organization", scopeId: null },
    ] }, created.id)).rejects.toMatchObject({ code: "export_scope_revoked", statusCode: 403 });
  });

  it("applies narrow export grants to both synchronous formats despite broad viewing access", async () => {
    const { db, service, actor, otherActor } = await createFixture();
    await db.insert(workSessions).values([actor, otherActor].map((person) => ({
      organizationId: actor.organizationId, membershipId: person.membershipId,
      startAt: new Date("2026-09-02T01:00:00Z"), endAt: new Date("2026-09-02T02:00:00Z"),
      timezone: "Asia/Shanghai", grossSeconds: 3_600, breakSeconds: 0, netSeconds: 3_600, billableSeconds: 3_600,
      source: "manual" as const, content: `=HYPERLINK("https://example.test/${person.membershipId}")`,
    })));
    const limited: AnalyticsActor = { ...actor, grants: [
      { permission: "work.view_full_scope", scopeKind: "organization", scopeId: null },
      { permission: "export.scope", scopeKind: "self", scopeId: null },
    ] };
    const from = new Date("2026-09-01"), to = new Date("2026-09-05");
    const csv = await service.exportWorkSessions(limited, from, to);
    expect(csv.rowCount).toBe(1);
    expect(csv.csv).toContain("'=HYPERLINK");
    expect(csv.sha256).toBe(createHash("sha256").update(`\uFEFF${csv.csv}`).digest("hex"));
    const json = JSON.parse((await service.exportWorkSessionsJson(limited, from, to)).json);
    expect(json.items.map((item: { membershipId: string }) => item.membershipId)).toEqual([actor.membershipId]);
    const emptyProject: AnalyticsActor = { ...limited, grants: [limited.grants[0]!, { permission: "export.scope", scopeKind: "project", scopeId: "00000000-0000-4000-8000-000000000099" }] };
    expect((await service.exportWorkSessions(emptyProject, from, to)).rowCount).toBe(0);
    expect(JSON.parse((await service.exportWorkSessionsJson(emptyProject, from, to)).json).items).toEqual([]);
  });
  it("queues an auditable permission snapshot and only lists the requester's jobs", async () => {
    const { db, service, actor, otherActor } = await createFixture();
    const created = await service.createBackgroundExport(actor, {
      exportType: "work_sessions",
      format: "xlsx",
      from: new Date("2026-09-01T00:00:00.000Z"),
      to: new Date("2026-09-05T00:00:00.000Z"),
    });
    expect(created).toMatchObject({
      format: "xlsx",
      status: "queued",
      progress: 0,
      downloadReady: false,
    });
    const [stored] = await db
      .select()
      .from(exportJobs)
      .where(eq(exportJobs.id, created.id));
    expect(stored?.deliveryMode).toBe("background");
    expect(stored?.fieldPolicySnapshot).toMatchObject({
      version: 1,
      requestedBy: actor.membershipId,
      includeContent: true,
      organizationWide: true,
    });
    expect(await service.listBackgroundExports(actor)).toHaveLength(1);
    expect(await service.listBackgroundExports(otherActor)).toHaveLength(0);
    expect(
      await db.select().from(outboxEvents).where(eq(outboxEvents.entityId, created.id)),
    ).toHaveLength(1);
    expect(
      await db.select().from(auditLogs).where(eq(auditLogs.entityId, created.id)),
    ).toHaveLength(1);
  });

  it("supports cancellation, controlled retry, signed download, and ownership isolation", async () => {
    const { db, service, actor, otherActor } = await createFixture();
    const created = await service.createBackgroundExport(actor, {
      exportType: "work_sessions",
      format: "pdf",
      from: new Date("2026-09-01T00:00:00.000Z"),
      to: new Date("2026-09-02T00:00:00.000Z"),
    });
    await expect(service.cancelBackgroundExport(actor, created.id)).resolves.toMatchObject({
      status: "cancelled",
    });
    await expect(service.cancelBackgroundExport(actor, created.id)).rejects.toMatchObject({
      code: "export_not_cancellable",
    });
    await db
      .update(exportJobs)
      .set({ status: "failed", errorSummary: "export_upload_failed", attempt: 3 })
      .where(eq(exportJobs.id, created.id));
    await expect(service.retryBackgroundExport(actor, created.id)).resolves.toMatchObject({
      status: "queued",
      attempt: 0,
      errorCode: null,
    });
    await db
      .update(exportJobs)
      .set({
        status: "completed",
        progress: 100,
        objectKey: `exports/${created.id}/file.pdf`,
        fileName: "work-sessions.pdf",
        contentType: "application/pdf",
        sha256: "abc123",
        expiresAt: new Date(Date.now() + 60_000),
      })
      .where(eq(exportJobs.id, created.id));
    await expect(service.backgroundExportDownload(actor, created.id)).resolves.toEqual({
      url: "https://objects.example.test/signed-download",
      expiresInSeconds: 300,
      fileName: "work-sessions.pdf",
      sha256: "abc123",
    });
    const reducedActor: AnalyticsActor = {
      ...actor,
      grants: [
        {
          permission: "export.scope",
          scopeKind: "project",
          scopeId: "00000000-0000-4000-8000-000000000099",
        },
      ],
    };
    await expect(
      service.backgroundExportDownload(reducedActor, created.id),
    ).rejects.toMatchObject({ code: "export_scope_revoked", statusCode: 403 });
    await expect(
      service.backgroundExportDownload(otherActor, created.id),
    ).rejects.toMatchObject({ code: "export_not_found", statusCode: 404 });
  });

  it("rejects unavailable storage and oversized time ranges before enqueueing", async () => {
    const unavailable: ExportArtifactAccess = {
      capabilities: () => ({
        available: false,
        formats: ["csv", "json", "xlsx", "pdf"],
        retentionHours: 24,
        unavailableReason: "对象存储未配置",
      }),
      createDownloadUrl: async () => {
        throw new Error("unreachable");
      },
    };
    const unavailableFixture = await createFixture(unavailable);
    await expect(
      unavailableFixture.service.createBackgroundExport(unavailableFixture.actor, {
        exportType: "work_sessions",
        format: "csv",
        from: new Date("2026-09-01T00:00:00.000Z"),
        to: new Date("2026-09-02T00:00:00.000Z"),
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ExportJobError>>({
        code: "export_storage_unavailable",
        statusCode: 503,
      }),
    );

    const availableFixture = await createFixture();
    await expect(
      availableFixture.service.createBackgroundExport(availableFixture.actor, {
        exportType: "work_sessions",
        format: "csv",
        from: new Date("2025-01-01T00:00:00.000Z"),
        to: new Date("2026-09-02T00:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "invalid_export_range", statusCode: 400 });
  });
});
