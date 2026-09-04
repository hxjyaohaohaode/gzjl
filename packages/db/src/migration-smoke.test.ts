import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

describe("generated PostgreSQL migration", () => {
  it("creates the complete schema on a clean PostgreSQL-compatible database", async () => {
    const database = new PGlite();
    try {
      const migrationsDir = resolve(import.meta.dirname, "../drizzle");
      const migrations = (await readdir(migrationsDir)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort();
      for (const file of migrations) {
        const migration = await readFile(resolve(migrationsDir, file), "utf8");
        const statements = migration
          .split("--> statement-breakpoint")
          .map((statement) => statement.trim())
          .filter(Boolean);
        for (const statement of statements) await database.exec(statement);
      }
      const tables = await database.query<{ count: number }>(
        "select count(*)::int as count from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
      );
      expect(tables.rows[0]?.count).toBe(68);
      const planKindColumn = await database.query<{
        column_default: string | null;
        is_nullable: string;
      }>(
        "select column_default, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'work_sessions' and column_name = 'record_kind'",
      );
      expect(planKindColumn.rows).toEqual([
        expect.objectContaining({
          column_default: "'fact'::text",
          is_nullable: "NO",
        }),
      ]);
      const pushDeliveryIndexes = await database.query<{ indexname: string }>(
        "select indexname from pg_indexes where schemaname = 'public' and tablename = 'notification_deliveries' order by indexname",
      );
      expect(pushDeliveryIndexes.rows.map((row) => row.indexname)).toEqual(
        expect.arrayContaining([
          "notification_deliveries_dispatch_idx",
          "notification_deliveries_notification_subscription_uidx",
        ]),
      );
    } finally {
      await database.close();
    }
  }, 30_000);
});
