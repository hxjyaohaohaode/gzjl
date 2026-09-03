import { describe, expect, it } from "vitest";
import type { Database } from "@workbench/db";

import type { ServerConfig } from "../config.js";
import { EvidenceService } from "./service.js";

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
  AI_MAX_RETRIES: 2,
  S3_REGION: "auto",
  S3_FORCE_PATH_STYLE: false,
  SIGNED_URL_TTL_SECONDS: 900,
  ATTACHMENT_MAX_BYTES: 100 * 1024 * 1024,
  SMTP_PORT: 587,
  SMTP_SECURE: false,
  SMS_PROVIDER: "disabled",
};

describe("evidence storage capabilities", () => {
  it("keeps links and text available while refusing to pretend that absent object storage can upload files", () => {
    const capabilities = new EvidenceService({} as Database, config).capabilities();

    expect(capabilities).toEqual({
      fileUploads: {
        available: false,
        maxBytes: 100 * 1024 * 1024,
        unavailableReason: "对象存储凭据尚未完整配置。",
        acceptsArbitraryFormats: true,
      },
      references: { url: true, text: true },
    });
  });

  it("reports file upload availability only when all private S3 credentials are present", () => {
    const service = new EvidenceService({} as Database, {
      ...config,
      S3_BUCKET: "private-evidence",
      S3_ACCESS_KEY_ID: "test-access-key",
      S3_SECRET_ACCESS_KEY: "test-secret-key",
    });

    expect(service.capabilities().fileUploads.available).toBe(true);
  });

  it("returns every signed object metadata header the browser must send", async () => {
    const service = new EvidenceService({} as Database, {
      ...config,
      S3_ENDPOINT: "https://storage.example.test",
      S3_REGION: "us-east-1",
      S3_BUCKET: "private-evidence",
      S3_ACCESS_KEY_ID: "test-access-key",
      S3_SECRET_ACCESS_KEY: "test-secret-key",
      S3_FORCE_PATH_STYLE: true,
    });
    const store = (service as unknown as {
      store: {
        createUploadUrl(
          objectKey: string,
          declaredMimeType: string,
          sizeBytes: number,
          sha256: string,
        ): Promise<{
          requiredHeaders: Record<string, string>;
          expiresInSeconds: number;
        }>;
      };
    }).store;

    await expect(
      store.createUploadUrl(
        "organization/member/evidence.tracebundle",
        "application/x-acme-work-proof",
        1,
        "a".repeat(64),
      ),
    ).resolves.toMatchObject({
      expiresInSeconds: 900,
      requiredHeaders: {
        "content-type": "application/octet-stream",
        "x-amz-meta-sha256": "a".repeat(64),
        "x-amz-meta-declared-mime": "application/x-acme-work-proof",
      },
    });
  });

  it("does not advertise direct production uploads until their exact browser origin is allow-listed", () => {
    const productionConfig = {
      ...config,
      NODE_ENV: "production" as const,
      WEB_ORIGIN: "https://app.example.test",
      PUBLIC_APP_URL: "https://app.example.test",
      S3_BUCKET: "private-evidence",
      S3_ACCESS_KEY_ID: "test-access-key",
      S3_SECRET_ACCESS_KEY: "test-secret-key",
    };

    expect(
      new EvidenceService({} as Database, productionConfig).capabilities()
        .fileUploads,
    ).toMatchObject({
      available: false,
      unavailableReason: "对象存储浏览器直传 origin 尚未配置。",
    });
    expect(
      new EvidenceService({} as Database, {
        ...productionConfig,
        S3_BROWSER_ORIGIN: "https://private-evidence.storage.example.test",
      }).capabilities().fileUploads.available,
    ).toBe(true);
  });
});
