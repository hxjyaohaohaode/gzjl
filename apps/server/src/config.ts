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
  ZHIPU_MODEL: z.string().min(1).default("glm-5.3-flash"),
  AI_MAX_RETRIES: z.coerce.number().int().min(1).max(10).default(3),
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
});

export type ServerConfig = z.infer<typeof serverConfigSchema>;

export function loadServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  return serverConfigSchema.parse(environment);
}
