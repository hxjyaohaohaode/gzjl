import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { expect, it } from "vitest";
import type { Database } from "@workbench/db";
import { readRealtimeChanges } from "./cursor.js";

it("delivers microsecond events once, including same-time pagination and organization isolation", async () => {
  const client = new PGlite();
  try {
    await client.exec(`CREATE TABLE outbox_events (id uuid PRIMARY KEY, organization_id uuid NOT NULL, created_at timestamptz NOT NULL);
      INSERT INTO outbox_events VALUES
      ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000010', '2026-10-13 02:14:48.454549+00'),
      ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000010', '2026-10-13 02:14:48.454549+00'),
      ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000010', '2026-10-13 02:14:48.454550+00'),
      ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000020', '2026-10-13 02:14:48.454551+00');`);
    const db = drizzle(client) as unknown as Database;
    const organization = "00000000-0000-4000-8000-000000000010";
    let cursor = { createdAt: "2026-10-13T02:14:48.454Z", id: "00000000-0000-0000-0000-000000000000" };
    const received: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const events = await readRealtimeChanges(db, organization, cursor, 1);
      expect(events).toHaveLength(1);
      cursor = events[0]!;
      received.push(cursor.id);
    }
    expect(received.map((id) => id.slice(-1))).toEqual(["1", "2", "3"]);
    for (let i = 0; i < 3; i += 1) expect(await readRealtimeChanges(db, organization, cursor)).toEqual([]);
    await client.exec(`INSERT INTO outbox_events VALUES ('00000000-0000-4000-8000-000000000005', '${organization}', '2026-10-13 02:14:48.454551+00')`);
    expect((await readRealtimeChanges(db, organization, cursor)).map((event) => event.id.slice(-1))).toEqual(["5"]);
  } finally { await client.close(); }
});
