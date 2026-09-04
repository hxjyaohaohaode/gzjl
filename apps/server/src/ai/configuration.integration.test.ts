import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptSecret, type Database } from "@workbench/db";
import {
  organizationAiSettings,
  organizationOwners,
  organizations,
  orgMemberships,
  users,
} from "@workbench/db/schema";

import type { ServerConfig } from "../config.js";
import { AiConfigurationService } from "./configuration.js";

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

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("organization AI provider health check", () => {
  it("uses the encrypted saved key and persists only redacted connection metadata", async () => {
    const db = await createTestDatabase();
    const [organization] = await db
      .insert(organizations)
      .values({ name: "AI 连接测试组织" })
      .returning();
    const [user] = await db
      .insert(users)
      .values({ displayName: "Owner" })
      .returning();
    const [membership] = await db
      .insert(orgMemberships)
      .values({
        organizationId: organization!.id,
        userId: user!.id,
        status: "active",
        joinedAt: new Date(),
      })
      .returning();
    await db.insert(organizationOwners).values({
      organizationId: organization!.id,
      membershipId: membership!.id,
    });
    const encryptionKey = "test-ai-configuration-key-at-least-32-characters";
    await db.insert(organizationAiSettings).values({
      organizationId: organization!.id,
      enabled: true,
      baseUrl: "https://provider.example/v1",
      model: "safe-model",
      apiKeyCiphertext: encryptSecret("provider-secret", encryptionKey),
    });
    const providerFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        authorization: "Bearer provider-secret",
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: "safe-model",
        max_tokens: 8,
      });
      return new Response(
        JSON.stringify({
          id: "provider-request-1",
          choices: [{ message: { content: "OK" } }],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const service = new AiConfigurationService(
      db,
      {
        NODE_ENV: "test",
        AI_CONFIG_ENCRYPTION_KEY: encryptionKey,
        AI_ENABLED: false,
        AI_MAX_RETRIES: 2,
        AI_REQUEST_TIMEOUT_MS: 5_000,
        ZHIPU_API_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
        ZHIPU_MODEL: "glm-4.7-flash",
      } as ServerConfig,
      providerFetch,
    );
    const actor = {
      organizationId: organization!.id,
      membershipId: membership!.id,
    };

    const check = await service.checkProvider(actor);
    expect(check).toMatchObject({
      organizationId: organization!.id,
      requestedBy: membership!.id,
      endpointHost: "provider.example",
      model: "safe-model",
      status: "succeeded",
      httpStatus: 200,
      errorSummary: null,
      providerRequestId: "provider-request-1",
    });
    expect(check).not.toHaveProperty("apiKey");
    await expect(service.listProviderChecks(actor)).resolves.toEqual([
      expect.objectContaining({
        endpointHost: "provider.example",
        status: "succeeded",
      }),
    ]);
  });
});
