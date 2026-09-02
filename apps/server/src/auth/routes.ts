import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { ServerConfig } from "../config.js";
import { AccountLockedError, InvalidCredentialsError } from "./service.js";
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
