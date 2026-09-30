import { drizzle } from "drizzle-orm/postgres-js";
import { expect, it, vi } from "vitest";
import type { Database } from "@workbench/db";
import * as schema from "@workbench/db/schema";
import { AnalyticsService } from "../analytics/service.js";
import { WorkLifecycleService } from "./lifecycle.js";

it("encodes both cycle boundary parameters through the production postgres-js driver", async () => {
  const unsafe = vi.fn((_query: string, parameters: unknown[]) => {
    // PGlite accepts raw JS dates; the configured production serializer expects
    // strings. Reject them here before the mock can hide a driver regression.
    expect(parameters.some((parameter) => parameter instanceof Date)).toBe(false);
    return { values: async () => [] };
  });
  const client = { options: { parsers: {}, serializers: {} }, unsafe };
  const db = drizzle(client as unknown as Database["$client"], { schema });
  const now = new Date("2026-09-30T17:34:53.214Z");
  await new WorkLifecycleService(db, new AnalyticsService(db)).overview({ organizationId: "e47bb617-5feb-4dd9-bb34-4ef613dbb571", membershipId: crypto.randomUUID(), grants: [] }, now);
  const periodQuery = unsafe.mock.calls.find(([query]) => query.includes('from "pay_periods"'))!;
  expect(periodQuery[1]).toEqual(["e47bb617-5feb-4dd9-bb34-4ef613dbb571", now.toISOString(), now.toISOString(), 1]);
});
