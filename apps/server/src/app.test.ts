import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ServerConfig } from "./config.js";
import { buildApp } from "./app.js";

const config: ServerConfig = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 3_000,
  WEB_ORIGIN: "http://localhost:5173",
  PUBLIC_APP_URL: "http://localhost:5173",
  WEB_DIST_DIR: "../web/dist",
  LOG_LEVEL: "silent",
  SESSION_SECRET: "test-secret-that-is-at-least-thirty-two-bytes",
  SESSION_TTL_SECONDS: 2_592_000,
  PASSWORD_RESET_TTL_SECONDS: 3_600,
  CREDENTIAL_VERIFICATION_TTL_SECONDS: 86_400,
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  DATABASE_POOL_MAX: 1,
  DATABASE_SSL: false,
  AI_ENABLED: false,
  ZHIPU_API_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
  ZHIPU_MODEL: "glm-4.7-flash",
  AI_REQUEST_TIMEOUT_MS: 60_000,
  AI_MAX_RETRIES: 3,
  S3_REGION: "auto",
  S3_FORCE_PATH_STYLE: false,
  SIGNED_URL_TTL_SECONDS: 900,
  ATTACHMENT_MAX_BYTES: 20 * 1024 * 1024,
  SMTP_PORT: 587,
  SMTP_SECURE: false,
  SMS_PROVIDER: "disabled",
};

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("service probes", () => {
  it("returns a liveness response without depending on PostgreSQL", async () => {
    const app = await buildApp({
      config,
      readiness: { check: async () => undefined },
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/healthz" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      service: "workbench-server",
    });
  });

  it("reports not ready when the fact database is unavailable", async () => {
    const app = await buildApp({
      config,
      readiness: {
        check: async () => {
          throw new Error("unavailable");
        },
      },
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/readyz" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: "not_ready",
      reason: "database_unavailable",
    });
  });

  it("serves the PWA entry point for production root and client-side routes", async () => {
    const webRoot = mkdtempSync(join(tmpdir(), "workbench-pwa-"));
    writeFileSync(join(webRoot, "index.html"), "<!doctype html><title>Workbench</title>");
    const app = await buildApp({
      config: {
        ...config,
        NODE_ENV: "production",
        WEB_ORIGIN: "https://app.example.test",
        PUBLIC_APP_URL: "https://app.example.test",
        S3_BROWSER_ORIGIN: "https://private-evidence.storage.example.test",
        WEB_DIST_DIR: webRoot,
      },
      readiness: { check: async () => undefined },
    });
    apps.push(app);

    try {
      const root = await app.inject({
        method: "GET",
        url: "/",
        headers: { accept: "text/html" },
      });
      const setup = await app.inject({
        method: "GET",
        url: "/setup",
        headers: { accept: "text/html" },
      });
      const verifyContact = await app.inject({
        method: "GET",
        url: "/verify-contact",
        headers: { accept: "text/html" },
      });
      const embeddedLogin = await app.inject({
        method: "GET",
        url: "/login",
        headers: { accept: "*/*" },
      });
      const missingAsset = await app.inject({
        method: "GET",
        url: "/assets/not-present.js",
        headers: { accept: "text/html" },
      });
      const missingApi = await app.inject({
        method: "GET",
        url: "/api/not-present",
        headers: { accept: "text/html" },
      });

      expect(root.statusCode).toBe(200);
      expect(setup.statusCode).toBe(200);
      expect(verifyContact.statusCode).toBe(200);
      expect(embeddedLogin.statusCode).toBe(200);
      expect(missingAsset.statusCode).toBe(404);
      expect(missingApi.statusCode).toBe(404);
      expect(root.headers["content-security-policy"]).toContain(
        "connect-src 'self' https://private-evidence.storage.example.test",
      );
      expect(setup.body).toContain("Workbench");
      expect(embeddedLogin.body).toContain("Workbench");
    } finally {
      rmSync(webRoot, { force: true, recursive: true });
    }
  });
});
