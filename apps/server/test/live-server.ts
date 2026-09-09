// Isolated acceptance runtime. Never connects to DATABASE_URL or real storage.
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import staticFiles from "@fastify/static";
import type { Database } from "@workbench/db";
import { buildApp } from "../src/app.js";
import { loadServerConfig } from "../src/config.js";
import { SetupService } from "../src/setup/service.js";

const database = new PGlite();
const migrations = resolve(import.meta.dirname, "../../../packages/db/drizzle");
for (const file of (await readdir(migrations)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort()) {
  for (const statement of (await readFile(resolve(migrations, file), "utf8")).split("--> statement-breakpoint").filter((sql) => sql.trim())) {
    await database.exec(statement);
  }
}
const db = drizzle(database) as unknown as Database;
await new SetupService(db).createInitialOwner({
  organizationName: "隔离验收组织", displayName: "验收负责人", email: "owner@acceptance.test",
  password: "Acceptance-Only-Password-2026!", timezone: "Asia/Shanghai",
});

// Exercises actual browser PUT/CORS and SDK HEAD/GET with real file bytes.
// This fixture does not attest to any cloud provider's signature enforcement.
const objects = new Map<string, { bytes: Buffer; sha: string }>();
const storage = createServer(async (request, response) => {
  const url = new URL(request.url!, "http://127.0.0.1:3101");
  response.setHeader("access-control-allow-origin", "http://127.0.0.1:3100");
  response.setHeader("access-control-allow-methods", "PUT, GET, HEAD, OPTIONS");
  response.setHeader("access-control-allow-headers", request.headers["access-control-request-headers"] ?? "*");
  if (request.method === "OPTIONS") { response.writeHead(204).end(); return; }
  if (request.method === "PUT") {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    objects.set(url.pathname, { bytes: Buffer.concat(chunks), sha: String(request.headers["x-amz-meta-sha256"] ?? url.searchParams.get("x-amz-meta-sha256") ?? "") });
    response.writeHead(200).end();
    return;
  }
  const object = objects.get(url.pathname);
  if (!object) { response.writeHead(404).end(); return; }
  response.setHeader("content-length", object.bytes.length);
  response.setHeader("content-type", url.searchParams.get("response-content-type") ?? "application/octet-stream");
  response.setHeader("x-amz-meta-sha256", object.sha);
  if (url.searchParams.has("response-content-disposition")) response.setHeader("content-disposition", url.searchParams.get("response-content-disposition")!);
  response.writeHead(200).end(request.method === "HEAD" ? undefined : object.bytes);
});
await new Promise<void>((resolve) => storage.listen(3101, "127.0.0.1", resolve));
const config = loadServerConfig({
  NODE_ENV: "test", SESSION_SECRET: "isolated-acceptance-session-secret-2026",
  DATABASE_URL: "postgresql://unused:unused@127.0.0.1/unused",
  WEB_ORIGIN: "http://127.0.0.1:3100", PUBLIC_APP_URL: "http://127.0.0.1:3100",
  S3_ENDPOINT: "http://127.0.0.1:3101", S3_BROWSER_ORIGIN: "http://127.0.0.1:3101",
  S3_REGION: "us-east-1", S3_BUCKET: "acceptance", S3_ACCESS_KEY_ID: "test-only",
  S3_SECRET_ACCESS_KEY: "test-only", S3_FORCE_PATH_STYLE: "true",
});
const app = await buildApp({ config, database: db, readiness: { async check() { await database.query("select 1"); } } });
await app.register(staticFiles, { root: resolve(import.meta.dirname, "../../web/dist") });
app.setNotFoundHandler((request, reply) => request.url.startsWith("/api/")
  ? reply.code(404).send({ error: "not_found" }) : reply.sendFile("index.html"));
await app.listen({ host: "127.0.0.1", port: 3100 });
async function shutdown() { await app.close(); storage.close(); await database.close(); }
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
