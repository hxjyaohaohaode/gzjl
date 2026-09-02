import "dotenv/config";

import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createDatabase } from "./client.js";

const database = createDatabase();

try {
  await migrate(database.db, { migrationsFolder: "./drizzle" });
} finally {
  await database.close();
}
