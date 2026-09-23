import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, expect, it } from "vitest";
import type { Database } from "@workbench/db";
import { notificationPreferences, notifications, organizations, orgMemberships, pushSubscriptions, users } from "@workbench/db/schema";
import { currentPushEligibility } from "./push-eligibility.js";

const clients: PGlite[] = [];
afterEach(async () => { await Promise.all(clients.splice(0).map((client) => client.close())); });
async function setup() {
  const client = new PGlite(); clients.push(client);
  const dir = resolve(import.meta.dirname, "../../../packages/db/drizzle");
  for (const file of (await readdir(dir)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort()) {
    for (const statement of (await readFile(resolve(dir, file), "utf8")).split("--> statement-breakpoint").filter((value) => value.trim())) await client.exec(statement);
  }
  const db = drizzle(client) as unknown as Database;
  const [org] = await db.insert(organizations).values({ name: "推送权限测试" }).returning();
  const people = await db.insert(users).values([{ displayName: "甲" }, { displayName: "乙" }]).returning();
  const members = await db.insert(orgMemberships).values(people.map((person) => ({ organizationId: org!.id, userId: person.id, status: "active" as const }))).returning();
  const [notification] = await db.insert(notifications).values({ organizationId: org!.id, recipientMembershipId: members[0]!.id, category: "export_ready", title: "导出", body: "个人敏感提示", severity: "info", dedupeKey: "test" }).returning();
  const [subscription] = await db.insert(pushSubscriptions).values({ membershipId: members[0]!.id, endpointHash: "test", endpointCiphertext: "encrypted", p256dhCiphertext: "encrypted", authCiphertext: "encrypted" }).returning();
  const [preference] = await db.insert(notificationPreferences).values({ membershipId: members[0]!.id, category: "export_ready", pushEnabled: true }).returning();
  return { db, members, preference: preference!, subscription: subscription!, check: (now?: Date) => currentPushEligibility(db, notification!.id, subscription!.id, now), notification: notification! };
}

it("rechecks subscription ownership and member status when dispatching an already queued message", async () => {
  const { db, check, members, subscription } = await setup();
  expect((await check()).decision).toBe("send");
  await db.update(pushSubscriptions).set({ membershipId: members[1]!.id }).where(eq(pushSubscriptions.id, subscription.id));
  expect((await check()).decision).toBe("cancel");
  await db.update(pushSubscriptions).set({ membershipId: members[0]!.id }).where(eq(pushSubscriptions.id, subscription.id));
  await db.update(orgMemberships).set({ status: "inactive" }).where(eq(orgMemberships.id, members[0]!.id));
  expect((await check()).decision).toBe("cancel");
});

it("defers muted and quiet-hour deliveries without consuming attempts and honors later opt-out", async () => {
  const { db, check, preference } = await setup();
  const now = new Date("2026-09-22T15:00:00Z");
  await db.update(notificationPreferences).set({ mutedUntil: new Date(now.getTime() + 60_000) }).where(eq(notificationPreferences.id, preference.id));
  expect((await check(now)).decision).toBe("defer");
  expect((await check(new Date(now.getTime() + 61_000))).decision).toBe("send");
  await db.update(notificationPreferences).set({ mutedUntil: null, quietHours: { start: "22:00", end: "08:00", timeZone: "Asia/Shanghai" } }).where(eq(notificationPreferences.id, preference.id));
  expect((await check(now)).decision).toBe("defer");
  expect((await check(new Date("2026-09-23T01:00:00Z"))).decision).toBe("send");
  await db.update(notificationPreferences).set({ pushEnabled: false }).where(eq(notificationPreferences.id, preference.id));
  expect((await check()).decision).toBe("cancel");
});

it.each(["readAt", "ignoredAt", "handledAt"] as const)("does not push notifications whose %s changed on another device", async (field) => {
  const { db, check, notification } = await setup();
  await db.update(notifications).set({ [field]: new Date() }).where(eq(notifications.id, notification.id));
  expect((await check()).decision).toBe("cancel");
});
