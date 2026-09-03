import { z } from "zod";

const booleanString = z.stringbool();

const serverConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
  WEB_ORIGIN: z.url().default("http://localhost:5173"),
  PUBLIC_APP_URL: z.url().default("http://localhost:5173"),
  WEB_DIST_DIR: z.string().min(1).default("apps/web/dist"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  SESSION_SECRET: z.string().min(32),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
  PASSWORD_RESET_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(3_600),
  SETUP_TOKEN: z.string().min(32).optional(),
  DATABASE_URL: z.url(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_SSL: booleanString.default(false),
  AI_ENABLED: booleanString.default(false),
  ZHIPU_API_KEY: z.string().min(1).optional(),
  ZHIPU_API_BASE_URL: z.url().default("https://open.bigmodel.cn/api/paas/v4"),
  ZHIPU_MODEL: z.string().min(1).default("glm-4.7-flash"),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(180_000).default(60_000),
  AI_MAX_RETRIES: z.coerce.number().int().min(1).max(5).default(2),
  /**
   * Dedicated envelope key for organization-owned AI keys. This must be the
   * same value on the web/API service and the background worker; it is never
   * returned by an API or written to the database.
   */
  AI_CONFIG_ENCRYPTION_KEY: z.string().min(32).optional(),
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1).default("auto"),
  S3_BUCKET: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_FORCE_PATH_STYLE: booleanString.default(false),
  ATTACHMENT_MAX_BYTES: z.coerce.number().int().positive().max(100 * 1024 * 1024).default(20 * 1024 * 1024),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
  SMTP_SECURE: booleanString.default(false),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  SMTP_FROM: z.email().optional(),
  SMS_PROVIDER: z.enum(["disabled", "twilio"]).default("disabled"),
  TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  TWILIO_FROM: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
}).superRefine((value, context) => {
  if (value.NODE_ENV !== "production") return;

  const assertPublicHttps = (
    key: "WEB_ORIGIN" | "PUBLIC_APP_URL" | "ZHIPU_API_BASE_URL",
  ) => {
    const url = new URL(value[key]);
    if (url.protocol !== "https:" || url.username || url.password) {
      context.addIssue({
        code: "custom",
        path: [key],
        message: `${key} 在生产环境必须是不含账号信息的 HTTPS 地址。`,
      });
    }
  };
  assertPublicHttps("WEB_ORIGIN");
  assertPublicHttps("PUBLIC_APP_URL");
  assertPublicHttps("ZHIPU_API_BASE_URL");

  // This deployment serves the PWA and API together. Keeping the trusted
  // CORS/WebSocket origin identical to the URL placed in invitations and
  // password-reset messages prevents a mixed-origin deployment from silently
  // breaking strict cookies or weakening socket-origin verification.
  if (
    new URL(value.WEB_ORIGIN).origin !== new URL(value.PUBLIC_APP_URL).origin
  ) {
    context.addIssue({
      code: "custom",
      path: ["PUBLIC_APP_URL"],
      message:
        "生产环境的 PUBLIC_APP_URL 必须与 WEB_ORIGIN 使用同一 origin。",
    });
  }
});

export type ServerConfig = z.infer<typeof serverConfigSchema>;

export function loadServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  return serverConfigSchema.parse(environment);
}
