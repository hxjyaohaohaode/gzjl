import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import type { Database } from "@workbench/db";
import { attachments, organizations, orgMemberships, users, workSessions } from "@workbench/db/schema";
import type { AuthContext } from "../auth/service.js";
import type { ServerConfig } from "../config.js";
import { EvidenceService, EvidenceValidationError } from "./service.js";

const clients: PGlite[] = [];
afterEach(async () => { await Promise.all(clients.splice(0).map((client) => client.close())); });
async function setup() {
  const client = new PGlite(); clients.push(client);
  const dir = resolve(import.meta.dirname, "../../../../packages/db/drizzle");
  for (const file of (await readdir(dir)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort()) {
    for (const statement of (await readFile(resolve(dir, file), "utf8")).split("--> statement-breakpoint").filter((value) => value.trim())) await client.exec(statement);
  }
  const db = drizzle(client) as unknown as Database;
  const [org] = await db.insert(organizations).values({ name: "附件竞态测试" }).returning();
  const [user] = await db.insert(users).values({ displayName: "提交人" }).returning();
  const [member] = await db.insert(orgMemberships).values({ organizationId: org!.id, userId: user!.id, status: "active" }).returning();
  const actor: AuthContext = { organizationId: org!.id, membershipId: member!.id, userId: user!.id, displayName: user!.displayName, timezone: "Asia/Shanghai", isOwner: false, grants: [] };
  const [session] = await db.insert(workSessions).values({ organizationId: org!.id, membershipId: member!.id, startAt: new Date("2026-09-22T01:00:00Z"), endAt: new Date("2026-09-22T02:00:00Z"), timezone: "Asia/Shanghai", grossSeconds: 3_600, breakSeconds: 0, netSeconds: 3_600, billableSeconds: 3_600, source: "manual", content: "附件测试" }).returning();
  const service = new EvidenceService(db, { ATTACHMENT_MAX_BYTES: 10485760 } as ServerConfig);
  const verify = vi.fn(async () => undefined);
  Object.assign(service, { store: { createUploadUrl: async () => ({ uploadUrl: "https://storage.example.test/fixture", requiredHeaders: {} }), verify } });
  const intent = await service.initiateFile(actor, session!.id, { originalName: "旧文件.png", mimeType: "image/png", sizeBytes: 68, sha256: "a".repeat(64), visibility: "management_only" });
  return { db, actor, service, verify, id: intent.attachment.id, readAttachment: async () => (await db.select().from(attachments).where(eq(attachments.id, intent.attachment.id)))[0]! };
}

it.each(["verified", "corrupt"])("does not apply an old %s verification to a replacement version", async (outcome) => {
  const { actor, service, verify, id, readAttachment } = await setup();
  let start!: () => void;
  let finish!: () => void;
  const started = new Promise<void>((resolve) => { start = resolve; });
  const blocked = new Promise<void>((resolve) => { finish = resolve; });
  verify.mockImplementationOnce(async () => { start(); await blocked; if (outcome === "corrupt") throw new EvidenceValidationError("旧文件校验失败"); });
  const oldCompletion = service.completeFile(actor, id).then(() => null, (error: unknown) => error);
  await started;
  const replacement = await service.initiateReplacement(actor, id, { originalName: "新文件.png", mimeType: "image/png", sizeBytes: 69, sha256: "b".repeat(64), reason: "原图有误，重新上传" });
  finish();
  expect(await oldCompletion).toBeInstanceOf(EvidenceValidationError);
  expect(await readAttachment()).toMatchObject({ version: 2, status: "pending_upload", objectKey: replacement.attachment.objectKey, sha256: "b".repeat(64) });
  await expect(service.completeFile(actor, id)).resolves.toMatchObject({ attachment: { status: "available", version: 2 } });
});

it("commits verified status, audit and refresh event atomically so a failed completion can be retried", async () => {
  const { db, actor, service, id, readAttachment } = await setup();
  await db.execute(sql`create function reject_evidence_audit() returns trigger language plpgsql as $$ begin if new.action = 'evidence.upload_completed' then raise exception 'audit unavailable'; end if; return new; end $$`);
  await db.execute(sql`create trigger reject_evidence_audit before insert on audit_logs for each row execute function reject_evidence_audit()`);
  await expect(service.completeFile(actor, id)).rejects.toThrow();
  expect((await readAttachment()).status).toBe("pending_upload");
  await db.execute(sql`drop trigger reject_evidence_audit on audit_logs`);
  await expect(service.completeFile(actor, id)).resolves.toMatchObject({ attachment: { status: "available" } });
});
