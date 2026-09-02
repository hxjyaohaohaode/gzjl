import "dotenv/config";

import { sql } from "drizzle-orm";
import { createDatabase } from "@workbench/db";

import { buildApp } from "./app.js";
import { loadServerConfig } from "./config.js";

const config = loadServerConfig();
const database = createDatabase();
const app = await buildApp({
  config,
  database: database.db,
  readiness: {
    async check() {
      await database.db.execute(sql`select 1`);
    },
  },
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "graceful shutdown started");
  await app.close();
  await database.close();
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.fatal({ error }, "server failed to start");
  await database.close();
  process.exitCode = 1;
}
