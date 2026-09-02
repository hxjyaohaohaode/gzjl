import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

describe("generated PostgreSQL migration", () => {
  it("creates the complete schema on a clean PostgreSQL-compatible database", async () => {
    const database = new PGlite();
    try {
      const migration = await readFile(
        resolve(import.meta.dirname, "../drizzle/0000_thin_major_mapleleaf.sql"),
        "utf8",
      );
      const statements = migration
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean);
      for (const statement of statements) await database.exec(statement);
      const tables = await database.query<{ count: number }>(
        "select count(*)::int as count from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
      );
      expect(tables.rows[0]?.count).toBe(65);
    } finally {
      await database.close();
    }
  }, 30_000);
});
