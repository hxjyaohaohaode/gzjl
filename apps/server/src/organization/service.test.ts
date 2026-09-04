import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "@workbench/db";
import {
  organizations,
  organizationOwners,
  orgMemberships,
  userCredentials,
  users,
} from "@workbench/db/schema";

import { AuthMailer } from "../auth/mailer.js";
import type { ServerConfig } from "../config.js";
import { OrganizationService } from "./service.js";

const clients: PGlite[] = [];

async function createTestDatabase(): Promise<Database> {
  const client = new PGlite();
  clients.push(client);
  const migrationsDir = resolve(
    import.meta.dirname,
    "../../../../packages/db/drizzle",
  );
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

async function createService() {
  const db = await createTestDatabase();
  const [organization] = await db
    .insert(organizations)
    .values({ name: "邀请链路测试组织" })
    .returning();
  const [ownerUser] = await db
    .insert(users)
    .values({ displayName: "Owner" })
    .returning();
  const [ownerMembership] = await db
    .insert(orgMemberships)
    .values({
      organizationId: organization!.id,
      userId: ownerUser!.id,
      status: "active",
      joinedAt: new Date(),
    })
    .returning();
  await db.insert(organizationOwners).values({
    organizationId: organization!.id,
    membershipId: ownerMembership!.id,
  });
  const mailer = new AuthMailer({
    PUBLIC_APP_URL: "https://app.example.test",
  } as ServerConfig);
  return {
    db,
    service: new OrganizationService(db, mailer),
    actor: {
      organizationId: organization!.id,
      membershipId: ownerMembership!.id,
    },
  };
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("organization invitation lifecycle", () => {
  it("accepts a newly issued link immediately and consumes it exactly once", async () => {
    const { service, actor } = await createService();
    const invitation = await service.invite(actor, {
      displayName: "新成员",
      email: "new.member@example.test",
      deliveryMode: "manual",
      orgUnitId: null,
    });

    const inspection = await service.inspectInvitation(
      invitation.invitationToken,
    );
    expect(inspection).toMatchObject({
      valid: true,
      displayName: "新成员",
    });
    expect(inspection.expiresAt!.getTime()).toBeGreaterThan(
      inspection.serverTime.getTime() + 6 * 86_400_000,
    );

    const membership = await service.acceptInvitation(
      invitation.invitationToken,
      "Employee-Secure-Password-123!",
    );
    expect(membership?.status).toBe("active");
    await expect(
      service.acceptInvitation(
        invitation.invitationToken,
        "Employee-Secure-Password-456!",
      ),
    ).rejects.toThrow("邀请链接无效、已使用或已过期");
    await expect(
      service.inspectInvitation(invitation.invitationToken),
    ).resolves.toMatchObject({ valid: false });
  });

  it("withdraws a pending invite and releases its contact for re-invitation", async () => {
    const { db, service, actor } = await createService();
    const first = await service.invite(actor, {
      displayName: "待撤销成员",
      phone: "13812345678",
      deliveryMode: "manual",
      orgUnitId: null,
    });

    await service.cancelPendingInvitation(actor, first.membership.id);
    await expect(
      service.inspectInvitation(first.invitationToken),
    ).resolves.toMatchObject({ valid: false });
    expect(
      await db
        .select({ id: userCredentials.id })
        .from(userCredentials)
        .where(eq(userCredentials.normalizedIdentifier, "+8613812345678")),
    ).toHaveLength(0);

    await expect(
      service.invite(actor, {
        displayName: "重新邀请成员",
        phone: "13812345678",
        deliveryMode: "manual",
        orgUnitId: null,
      }),
    ).resolves.toMatchObject({
      membership: { status: "invited" },
    });
  });
});
