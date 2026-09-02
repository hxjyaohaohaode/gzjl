import { timingSafeEqual } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { ServerConfig } from "../config.js";
import { hashOpaqueToken } from "../auth/security.js";
import { SetupAlreadyCompletedError, type SetupService } from "./service.js";

const initialOwnerSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  displayName: z.string().trim().min(2).max(80),
  email: z.email().max(320),
  password: z
    .string()
    .min(12)
    .max(1_024)
    .regex(/[a-z]/, "密码必须包含小写字母")
    .regex(/[A-Z]/, "密码必须包含大写字母")
    .regex(/[0-9]/, "密码必须包含数字")
    .regex(/[^A-Za-z0-9]/, "密码必须包含特殊字符"),
  timezone: z.string().trim().min(3).max(64).default("Asia/Shanghai"),
});

function tokenMatches(expected: string | undefined, provided: string | undefined): boolean {
  if (!expected || !provided) return false;
  const expectedHash = Buffer.from(hashOpaqueToken(expected), "hex");
  const providedHash = Buffer.from(hashOpaqueToken(provided), "hex");
  return timingSafeEqual(expectedHash, providedHash);
}

export async function registerSetupRoutes(
  app: FastifyInstance,
  service: SetupService,
  config: ServerConfig,
): Promise<void> {
  app.get("/api/setup/status", async () => ({
    completed: await service.isCompleted(),
    setupAvailable: Boolean(config.SETUP_TOKEN),
  }));

  app.post(
    "/api/setup/initial-owner",
    {
      preHandler: app.csrfProtection,
      config: { rateLimit: { max: 5, timeWindow: "1 hour", ban: 2 } },
    },
    async (request, reply) => {
      if (!config.SETUP_TOKEN) {
        return reply.code(503).send({
          error: "setup_disabled",
          message: "服务端尚未配置首次初始化令牌。",
        });
      }
      const providedToken = request.headers["x-setup-token"];
      if (!tokenMatches(config.SETUP_TOKEN, typeof providedToken === "string" ? providedToken : undefined)) {
        return reply.code(403).send({
          error: "invalid_setup_token",
          message: "初始化令牌无效。",
        });
      }

      const input = initialOwnerSchema.parse(request.body);
      try {
        const result = await service.createInitialOwner({
          ...input,
          requestId: request.id,
          ...(request.headers["user-agent"]
            ? { userAgent: request.headers["user-agent"] }
            : {}),
        });
        return reply.code(201).send({
          ...result,
          message: "初始化完成，请使用 Owner 邮箱与密码登录。",
        });
      } catch (error) {
        if (error instanceof SetupAlreadyCompletedError) {
          return reply.code(409).send({
            error: "setup_already_completed",
            message: error.message,
          });
        }
        throw error;
      }
    },
  );
}
