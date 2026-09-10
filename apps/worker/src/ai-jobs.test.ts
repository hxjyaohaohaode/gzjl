import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import { encryptSecret, type Database } from "@workbench/db";
import { aiJobs, aiReports, organizationAiSettings, organizations, orgMemberships, users } from "@workbench/db/schema";
import { createAiJobProcessor, recoverStaleAiJobs } from "./ai-jobs.js";

const clients: PGlite[] = [];
const config = { AI_ENABLED: false, AI_CONFIG_ENCRYPTION_KEY: "worker-encryption-test-key-at-least-32-characters", AI_REQUEST_TIMEOUT_MS: 5000, AI_MAX_RETRIES: 1 };
afterEach(async () => { await Promise.all(clients.splice(0).map((client) => client.close())); });

async function setup() {
  const client = new PGlite();
  clients.push(client);
  const dir = resolve(import.meta.dirname, "../../../packages/db/drizzle");
  for (const file of (await readdir(dir)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort()) {
    for (const statement of (await readFile(resolve(dir, file), "utf8")).split("--> statement-breakpoint").filter((value) => value.trim())) await client.exec(statement);
  }
  const db = drizzle(client) as unknown as Database;
  const [org] = await db.insert(organizations).values({ name: "AI Worker 测试" }).returning();
  const [user] = await db.insert(users).values({ displayName: "测试成员" }).returning();
  const [member] = await db.insert(orgMemberships).values({ organizationId: org!.id, userId: user!.id, status: "active" }).returning();
  await db.insert(organizationAiSettings).values({ organizationId: org!.id, enabled: true, baseUrl: "https://new-provider.example/v1", model: "vendor/new-model", apiKeyCiphertext: encryptSecret("current-provider-key", config.AI_CONFIG_ENCRYPTION_KEY), maxOutputTokens: 8000, generationOptions: { maxAttempts: 2, tokenLimitParameter: "max_completion_tokens" } });
  const [job] = await db.insert(aiJobs).values({ organizationId: org!.id, requestedBy: member!.id, scope: {}, taskType: "work_qa", provider: "openai_compatible", model: "old-provider-model", promptTemplateVersion: "test", inputHash: crypto.randomUUID(), sourceSummary: { sources: [] }, maxAttempts: 1, maxOutputTokens: 1200 }).returning();
  return { db, job: job!, readJob: async () => (await db.select().from(aiJobs).where(eq(aiJobs.id, job!.id)))[0]! };
}
function completion() {
  return new Response(JSON.stringify({ id: "current-request", choices: [{ message: { content: JSON.stringify({ title: "实际任务测试", summary: "已完成验证。", highlights: [], risks: [], suggestions: [] }) } }], usage: { prompt_tokens: 20, completion_tokens: 30 } }));
}

it("uses the entire current provider after a switch and claims a job only once", async () => {
  const { db, job, readJob } = await setup();
  const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "vendor/new-model", max_completion_tokens: 8000 });
    expect(JSON.parse(String(init?.body))).not.toHaveProperty("temperature");
    expect(init?.headers).toMatchObject({ authorization: "Bearer current-provider-key" });
    return completion();
  }) as typeof fetch;
  const process = createAiJobProcessor(db, config, async () => false, fetcher);
  await Promise.all([process(job.id), process(job.id)]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith("https://new-provider.example/v1/chat/completions", expect.anything());
  expect(await readJob()).toMatchObject({ status: "completed", model: "vendor/new-model", maxAttempts: 2, maxOutputTokens: 8000, providerRequestId: "current-request", attempt: 1 });
  expect(await db.select().from(aiReports)).toHaveLength(1);
});

it("honors saved retry limits for transient errors and terminates authentication errors immediately", async () => {
  const { db, job, readJob } = await setup();
  const temporaryFetch = vi.fn(async () => new Response("upstream-secret", { status: 429 })) as typeof fetch;
  const process = createAiJobProcessor(db, config, async () => false, temporaryFetch);
  await expect(process(job.id)).rejects.toThrow("HTTP 429");
  expect(await readJob()).toMatchObject({ status: "queued", attempt: 1 });
  await process(job.id);
  expect(await readJob()).toMatchObject({ status: "failed", attempt: 2 });
  await process(job.id);
  expect(temporaryFetch).toHaveBeenCalledTimes(2);
  await db.update(aiJobs).set({ status: "queued", attempt: 0 }).where(eq(aiJobs.id, job.id));
  const deniedFetch = vi.fn(async () => new Response("secret-url-token", { status: 401 })) as typeof fetch;
  await createAiJobProcessor(db, config, async () => false, deniedFetch)(job.id);
  expect(await readJob()).toMatchObject({ status: "failed", attempt: 1, errorSummary: expect.stringContaining("API Key") });
  expect(JSON.stringify(await readJob())).not.toContain("secret-url-token");
  expect(await db.select().from(aiReports)).toHaveLength(0);
});

it("does not resurrect a cancelled task when an in-flight provider finishes", async () => {
  const { db, job, readJob } = await setup();
  let started!: () => void;
  let finish!: () => void;
  const sent = new Promise<void>((resolve) => { started = resolve; });
  const release = new Promise<void>((resolve) => { finish = resolve; });
  const fetcher = vi.fn(async () => { started(); await release; return completion(); }) as typeof fetch;
  const processing = createAiJobProcessor(db, config, async () => false, fetcher)(job.id);
  await sent;
  await db.update(aiJobs).set({ status: "cancelled" }).where(eq(aiJobs.id, job.id));
  finish();
  await processing;
  expect(await readJob()).toMatchObject({ status: "cancelled" });
  expect(await db.select().from(aiReports)).toHaveLength(0);
});

it("recovers interrupted jobs and rejects results from an obsolete attempt", async () => {
  const { db, job, readJob } = await setup();
  let started!: () => void;
  let finish!: () => void;
  const sent = new Promise<void>((resolve) => { started = resolve; });
  const release = new Promise<void>((resolve) => { finish = resolve; });
  const fetcher = vi.fn(async () => { started(); await release; return completion(); }) as typeof fetch;
  const oldAttempt = createAiJobProcessor(db, config, async () => false, fetcher)(job.id);
  await sent;
  await recoverStaleAiJobs(db);
  expect((await readJob()).status).toBe("running");
  await db.update(aiJobs).set({ startedAt: new Date(Date.now() - 7 * 60000) }).where(eq(aiJobs.id, job.id));
  await recoverStaleAiJobs(db);
  expect((await readJob()).status).toBe("queued");
  // Simulate the next queue consumer having already claimed the recovered job.
  await db.update(aiJobs).set({ status: "running", attempt: 2, startedAt: new Date() }).where(eq(aiJobs.id, job.id));
  finish();
  await oldAttempt;
  expect(await readJob()).toMatchObject({ status: "running", attempt: 2 });
  expect(await db.select().from(aiReports)).toHaveLength(0);
  await db.update(aiJobs).set({ startedAt: new Date(Date.now() - 7 * 60000) }).where(eq(aiJobs.id, job.id));
  await recoverStaleAiJobs(db);
  expect(await readJob()).toMatchObject({ status: "failed", errorSummary: expect.stringContaining("达到尝试次数") });
});
