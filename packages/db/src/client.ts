import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";

import * as schema from "./schema/index.js";

const databaseConfigSchema = z.object({
  DATABASE_URL: z.url(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_SSL: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export type Database = ReturnType<typeof createDatabase>["db"];

export function createDatabase(environment: NodeJS.ProcessEnv = process.env) {
  const config = databaseConfigSchema.parse(environment);
  const client = postgres(config.DATABASE_URL, {
    max: config.DATABASE_POOL_MAX,
    ssl: config.DATABASE_SSL ? "require" : false,
    prepare: true,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  const db = drizzle(client, { schema });

  return {
    db,
    client,
    async close(): Promise<void> {
      await client.end({ timeout: 5 });
    },
  };
}
