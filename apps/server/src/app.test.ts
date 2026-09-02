import { afterEach, describe, expect, it } from "vitest";

import type { ServerConfig } from "./config.js";
import { buildApp } from "./app.js";

const config: ServerConfig = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 3_000,
  WEB_ORIGIN: "http://localhost:5173",
  WEB_DIST_DIR: "apps/web/dist",
  LOG_LEVEL: "silent",
  SESSION_SECRET: "test-secret-that-is-at-least-thirty-two-bytes",
  SESSION_TTL_SECONDS: 2_592_000,
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  DATABASE_POOL_MAX: 1,
  DATABASE_SSL: false,
  AI_ENABLED: false,
  ZHIPU_API_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
  ZHIPU_MODEL: "glm-5.3-flash",
  AI_MAX_RETRIES: 3,
  S3_REGION: "auto",
  S3_FORCE_PATH_STYLE: false,
  ATTACHMENT_MAX_BYTES: 20 * 1024 * 1024,
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
});
