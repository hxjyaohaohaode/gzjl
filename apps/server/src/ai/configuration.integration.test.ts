import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptSecret, resolveOrganizationAiProvider, type Database } from "@workbench/db";
import { aiGenerationOptionsSchema, requestAiChatCompletion } from "@workbench/shared";
import {
  organizationAiSettings,
  aiProviderChecks,
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
        max_tokens: 1200,
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
    const options = aiGenerationOptionsSchema.parse({ requestTimeoutMs: 150000, maxAttempts: 4, temperature: null, topP: 0.8, tokenLimitParameter: "max_completion_tokens", responseFormat: "json_object" });
    const updated = await service.updateSettings(actor, { enabled: true, baseUrl: "https://second.example/api/v1/chat/completions/", model: "vendor/reasoning-model:free", apiKey: "replacement-secret", maxOutputTokens: 8000, dailyRequestLimit: 50, monthlyRequestLimit: 600, generationOptions: options });
    expect(updated).toMatchObject({ baseUrl: "https://second.example/api/v1", model: "vendor/reasoning-model:free", hasApiKey: true, generationOptions: options });
    expect(JSON.stringify(updated)).not.toContain("replacement-secret");
    const provider = await resolveOrganizationAiProvider(db, actor.organizationId, { AI_ENABLED: false, AI_CONFIG_ENCRYPTION_KEY: encryptionKey, AI_REQUEST_TIMEOUT_MS: 5000, AI_MAX_RETRIES: 1 });
    expect(provider).toMatchObject({ baseUrl: updated.baseUrl, model: updated.model, apiKey: "replacement-secret", maxAttempts: 4, generationOptions: options, configurationVersion: 2 });
    const switchedFetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ model: updated.model, max_completion_tokens: 8000, top_p: 0.8, response_format: { type: "json_object" } });
      expect(body).not.toHaveProperty("temperature");
      expect(body).not.toHaveProperty("max_tokens");
      expect(init?.headers).toMatchObject({ authorization: "Bearer replacement-secret" });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
    }) as typeof fetch;
    await requestAiChatCompletion(provider!, [{ role: "user", content: "JSON test" }], switchedFetch);
    expect(switchedFetch).toHaveBeenCalledWith("https://second.example/api/v1/chat/completions", expect.anything());
    // A saved-config check uses exactly the same options as the Worker resolver.
    await db.update(aiProviderChecks).set({ checkedAt: new Date(Date.now() - 31000) });
    const secondService = new AiConfigurationService(db, { NODE_ENV: "test", AI_ENABLED: true, ZHIPU_API_KEY: "legacy-fallback-secret", AI_CONFIG_ENCRYPTION_KEY: encryptionKey, AI_REQUEST_TIMEOUT_MS: 5000, AI_MAX_RETRIES: 1 } as ServerConfig, switchedFetch);
    expect(await secondService.checkProvider(actor)).toMatchObject({ status: "succeeded", model: updated.model });
    const retained = await secondService.updateSettings(actor, { ...updated, model: "vendor/another-model" });
    expect(retained.hasApiKey).toBe(true);
    const cleared = await secondService.updateSettings(actor, { ...retained, enabled: false, clearApiKey: true });
    expect(cleared).toMatchObject({ hasApiKey: false, usable: false });
    expect(await secondService.resolveEffective(actor.organizationId)).toBeNull();
  });
});
