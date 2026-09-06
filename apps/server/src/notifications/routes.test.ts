import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import Fastify from "fastify";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "@workbench/db";
import {
  notifications,
  organizations,
  orgMemberships,
  outboxEvents,
  users,
} from "@workbench/db/schema";

import type { ServerConfig } from "../config.js";

import {
  notificationPreferenceSchema,
  pushSubscriptionSchema,
  registerNotificationRoutes,
} from "./routes.js";

const clients: PGlite[] = [];

async function createTestDatabase(): Promise<Database> {
  const client = new PGlite();
  clients.push(client);
  const migrationsDir = resolve(import.meta.dirname, "../../../../packages/db/drizzle");
  const migrations = (await readdir(migrationsDir))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
  for (const file of migrations) {
    const migration = await readFile(resolve(migrationsDir, file), "utf8");
    for (const statement of migration
      .split("--> statement-breakpoint")
      .map((value) => value.trim())
      .filter(Boolean)) {
      await client.exec(statement);
    }
  }
  return drizzle(client) as unknown as Database;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("notification channel input boundaries", () => {
  it("accepts an HTTPS browser subscription with exact Web Push key sizes", () => {
    expect(
      pushSubscriptionSchema.parse({
        endpoint: "https://push.example.test/subscriptions/device",
        expirationTime: null,
        keys: {
          p256dh: Buffer.alloc(65, 1).toString("base64url"),
          auth: Buffer.alloc(16, 2).toString("base64url"),
        },
      }),
    ).toMatchObject({
      endpoint: "https://push.example.test/subscriptions/device",
    });
  });

  it("rejects non-HTTPS endpoints and malformed browser keys", () => {
    expect(() =>
      pushSubscriptionSchema.parse({
        endpoint: "http://push.example.test/device",
        keys: {
          p256dh: Buffer.alloc(64, 1).toString("base64url"),
          auth: Buffer.alloc(15, 2).toString("base64url"),
        },
      }),
    ).toThrow();
  });

  it("validates cross-midnight quiet hours and rejects invented time zones", () => {
    expect(
      notificationPreferenceSchema.parse({
        category: "timer_long_running",
        inAppEnabled: true,
        pushEnabled: true,
        emailEnabled: false,
        quietHours: {
          start: "22:00",
          end: "07:00",
          timeZone: "Asia/Shanghai",
        },
        mutedUntil: null,
      }).quietHours,
    ).toMatchObject({ start: "22:00", end: "07:00" });
    expect(() =>
      notificationPreferenceSchema.parse({
        category: "timer_long_running",
        inAppEnabled: true,
        pushEnabled: false,
        emailEnabled: false,
        quietHours: {
          start: "22:00",
          end: "07:00",
          timeZone: "Mars/Olympus",
        },
      }),
    ).toThrow();
  });
});

describe("notification read state", () => {
  it("marks all own notifications read and supports toggling one item back to unread", async () => {
    const db = await createTestDatabase();
    const [organization] = await db.insert(organizations).values({
      name: "通知状态测试",
      timezone: "Asia/Shanghai",
    }).returning();
    const [firstUser, secondUser] = await db.insert(users).values([
      { displayName: "员工甲" },
      { displayName: "员工乙" },
    ]).returning();
    const [firstMember, secondMember] = await db.insert(orgMemberships).values([
      {
        organizationId: organization!.id,
        userId: firstUser!.id,
        status: "active",
        joinedAt: new Date(),
      },
      {
        organizationId: organization!.id,
        userId: secondUser!.id,
        status: "active",
        joinedAt: new Date(),
      },
    ]).returning();
    const created = await db.insert(notifications).values([
      {
        organizationId: organization!.id,
        recipientMembershipId: firstMember!.id,
        category: "approval_returned",
        severity: "warning",
        title: "第一条",
        body: "待处理",
        dedupeKey: "first-1",
      },
      {
        organizationId: organization!.id,
        recipientMembershipId: firstMember!.id,
        category: "approval_returned",
        severity: "info",
        title: "第二条",
        body: "待处理",
        dedupeKey: "first-2",
      },
      {
        organizationId: organization!.id,
        recipientMembershipId: secondMember!.id,
        category: "approval_returned",
        severity: "info",
        title: "其他员工",
        body: "不能被批量修改",
        dedupeKey: "second-1",
      },
    ]).returning();
    const app = Fastify();
    app.decorate("csrfProtection", async () => undefined);
    await registerNotificationRoutes(
      app,
      db,
      async (request) => {
        request.auth = {
          organizationId: organization!.id,
          membershipId: firstMember!.id,
          userId: firstUser!.id,
          displayName: firstUser!.displayName,
          timezone: "Asia/Shanghai",
          isOwner: false,
          grants: [],
        };
      },
      {} as ServerConfig,
    );

    const readAll = await app.inject({ method: "POST", url: "/api/notifications/read-all" });
    expect(readAll.statusCode).toBe(200);
    expect(readAll.json()).toEqual({ updatedCount: 2 });
    const otherUserNotification = (await db.select().from(notifications).where(
      eq(notifications.id, created[2]!.id),
    ))[0];
    expect(otherUserNotification?.readAt).toBeNull();

    const unread = await app.inject({
      method: "POST",
      url: `/api/notifications/${created[0]!.id}/unread`,
    });
    expect(unread.statusCode).toBe(200);
    expect(unread.json().notification.readAt).toBeNull();
    const readAgain = await app.inject({
      method: "POST",
      url: `/api/notifications/${created[0]!.id}/read`,
    });
    expect(readAgain.statusCode).toBe(200);
    expect(readAgain.json().notification.readAt).toBeTruthy();
    expect((await db.select().from(outboxEvents)).map((event) => event.eventType)).toEqual([
      "notification.read_state_changed",
      "notification.read_state_changed",
      "notification.read_state_changed",
    ]);
    await app.close();
  });
});
