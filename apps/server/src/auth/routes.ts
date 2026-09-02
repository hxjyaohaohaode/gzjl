import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { ServerConfig } from "../config.js";
import { AuthDeliveryUnavailableError, AuthMailer } from "./mailer.js";
import { AccountLockedError, InvalidCredentialsError, PasswordResetTokenError } from "./service.js";
import type { AuthService } from "./service.js";
import { SESSION_COOKIE_DEV, SESSION_COOKIE_PROD } from "./security.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: Awaited<ReturnType<AuthService["authenticate"]>>;
  }
}

const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(320),
  password: z.string().min(8).max(1_024),
});
const passwordResetRequestSchema = z.object({ identifier: z.string().trim().min(3).max(320) });
const strongPassword = z.string().min(12).max(1_024).regex(/[a-z]/, "密码须包含小写字母。").regex(/[A-Z]/, "密码须包含大写字母。").regex(/\d/, "密码须包含数字。").regex(/[^A-Za-z0-9]/, "密码须包含特殊字符。");
const passwordResetSchema = z.object({ token: z.string().min(32).max(512), password: strongPassword });

export function sessionCookieName(config: ServerConfig): string {
  return config.NODE_ENV === "production" ? SESSION_COOKIE_PROD : SESSION_COOKIE_DEV;
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  service: AuthService,
  config: ServerConfig,
): Promise<FastifyReply | void> {
  const context = await service.authenticate(request.cookies[sessionCookieName(config)]);
  request.auth = context;
  if (!context) {
    return reply.code(401).send({
      error: "unauthorized",
      message: "登录状态已失效，请重新登录。",
      requestId: request.id,
    });
  }
}

export function createAuthenticationPreHandler(
  service: AuthService,
  config: ServerConfig,
) {
  return (request: FastifyRequest, reply: FastifyReply) =>
    requireAuth(request, reply, service, config);
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  service: AuthService,
  config: ServerConfig,
): Promise<void> {
  const cookieName = sessionCookieName(config);
  const authenticate = createAuthenticationPreHandler(service, config);
  const mailer = new AuthMailer(config);
  const cookieOptions = {
    path: "/",
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "strict" as const,
  };

  app.post(
    "/api/auth/login",
    {
      preHandler: app.csrfProtection,
      config: { rateLimit: { max: 10, timeWindow: "15 minutes", ban: 3 } },
    },
    async (request, reply) => {
      const input = loginSchema.parse(request.body);
      try {
        const result = await service.login(input.identifier, input.password);
        reply.setCookie(cookieName, result.token, {
          ...cookieOptions,
          expires: result.expiresAt,
          maxAge: config.SESSION_TTL_SECONDS,
        });
        return {
          user: {
            id: result.context.userId,
            membershipId: result.context.membershipId,
            organizationId: result.context.organizationId,
            displayName: result.context.displayName,
          },
          permissions: result.context.grants,
        };
      } catch (error) {
        if (error instanceof AccountLockedError) {
          return reply.code(423).send({ error: "account_locked", message: error.message });
        }
        if (error instanceof InvalidCredentialsError) {
          return reply.code(401).send({ error: "invalid_credentials", message: error.message });
        }
        throw error;
      }
    },
  );

  app.post(
    "/api/auth/logout",
    { preHandler: [app.csrfProtection, authenticate] },
    async (request, reply) => {
      await service.logout(request.cookies[cookieName]);
      reply.clearCookie(cookieName, cookieOptions);
      return reply.code(204).send();
    },
  );

  app.post(
    "/api/auth/password-reset/request",
    {
      preHandler: app.csrfProtection,
      config: { rateLimit: { max: 5, timeWindow: "15 minutes", ban: 3 } },
    },
    async (request, reply) => {
      const { identifier } = passwordResetRequestSchema.parse(request.body);
      try {
        const reset = await service.requestPasswordReset(identifier);
        if (reset) await mailer.sendPasswordReset(reset);
        return reply.code(202).send({ accepted: true, message: "若该邮箱对应有效账号，重置链接将发送至邮箱。" });
      } catch (error) {
        if (error instanceof AuthDeliveryUnavailableError) {
          return reply.code(503).send({ error: "password_reset_unavailable", message: error.message });
        }
        throw error;
      }
    },
  );

  app.post(
    "/api/auth/password-reset/complete",
    { preHandler: app.csrfProtection },
    async (request, reply) => {
      const input = passwordResetSchema.parse(request.body);
      try {
        return await service.resetPassword(input.token, input.password);
      } catch (error) {
        if (error instanceof PasswordResetTokenError) {
          return reply.code(409).send({ error: "invalid_reset_token", message: error.message });
        }
        throw error;
      }
    },
  );

  app.get(
    "/api/me",
    { preHandler: authenticate },
    async (request) => ({
      user: request.auth
        ? {
            id: request.auth.userId,
            membershipId: request.auth.membershipId,
            organizationId: request.auth.organizationId,
            displayName: request.auth.displayName,
          }
        : null,
      permissions: request.auth?.grants ?? [],
    }),
  );

  app.post(
    "/api/auth/sessions/revoke-others",
    { preHandler: [app.csrfProtection, authenticate] },
    async (request) => ({
      revokedCount: request.auth
        ? await service.revokeAllOtherSessions(
            request.auth.userId,
            request.cookies[cookieName] ?? "",
          )
        : 0,
    }),
  );
}
