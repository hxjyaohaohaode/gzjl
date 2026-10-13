import { and, asc, eq, sql } from "drizzle-orm";
import type { Database } from "@workbench/db";
import { outboxEvents } from "@workbench/db/schema";

export interface RealtimeCursor { createdAt: string; id: string }

export function readRealtimeChanges(db: Database, organizationId: string, cursor: RealtimeCursor, limit = 100) {
  // PostgreSQL stores microseconds. Mapping this cursor through a JS Date loses
  // precision and replays the final event on every poll, flooding all open tabs.
  return db.select({ id: outboxEvents.id, createdAt: sql<string>`${outboxEvents.createdAt}::text` })
    .from(outboxEvents)
    .where(and(
      eq(outboxEvents.organizationId, organizationId),
      sql`(${outboxEvents.createdAt}, ${outboxEvents.id}) > (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`,
    ))
    .orderBy(asc(outboxEvents.createdAt), asc(outboxEvents.id))
    .limit(limit);
}
