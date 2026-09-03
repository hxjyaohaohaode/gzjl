import { describe, expect, it } from "vitest";

import type { ServerConfig } from "../config.js";
import { AuthDeliveryUnavailableError, AuthMailer } from "./mailer.js";

const baseConfig: ServerConfig = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 3_000,
  WEB_ORIGIN: "http://localhost:5173",
  PUBLIC_APP_URL: "http://localhost:5173",
  WEB_DIST_DIR: "apps/web/dist",
  LOG_LEVEL: "silent",
  SESSION_SECRET: "test-secret-that-is-at-least-thirty-two-bytes",
  SESSION_TTL_SECONDS: 2_592_000,
  PASSWORD_RESET_TTL_SECONDS: 3_600,
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
  ATTACHMENT_MAX_BYTES: 20 * 1024 * 1024,
  SMTP_PORT: 587,
  SMTP_SECURE: false,
  SMS_PROVIDER: "disabled",
};

describe("credential-delivery configuration", () => {
  it("rejects an absent channel before an invitation creates a pending account", () => {
    const mailer = new AuthMailer(baseConfig);

    expect(() => mailer.assertDeliveryConfigured("email")).toThrow(
      AuthDeliveryUnavailableError,
    );
    expect(() => mailer.assertDeliveryConfigured("phone")).toThrow(
      AuthDeliveryUnavailableError,
    );
  });

  it("accepts complete SMTP or Twilio configuration but rejects half SMTP credentials", () => {
    expect(
      () =>
        new AuthMailer({
          ...baseConfig,
          SMTP_HOST: "smtp.example.test",
          SMTP_FROM: "noreply@example.test",
        }).assertDeliveryConfigured("email"),
    ).not.toThrow();
    expect(
      () =>
        new AuthMailer({
          ...baseConfig,
          SMTP_HOST: "smtp.example.test",
          SMTP_FROM: "noreply@example.test",
          SMTP_USER: "only-a-user",
        }).assertDeliveryConfigured("email"),
    ).toThrow(AuthDeliveryUnavailableError);
    expect(
      () =>
        new AuthMailer({
          ...baseConfig,
          SMS_PROVIDER: "twilio",
          TWILIO_ACCOUNT_SID: "test-account",
          TWILIO_AUTH_TOKEN: "test-token",
          TWILIO_FROM: "+8613812345678",
        }).assertDeliveryConfigured("phone"),
    ).not.toThrow();
  });
});
