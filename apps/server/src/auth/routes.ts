import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { ServerConfig } from "../config.js";
import { AuthDeliveryUnavailableError, AuthMailer } from "./mailer.js";
import {
  AccountLockedError,
  CredentialBindingTokenError,
  CredentialConflictError,
  CredentialRemovalError,
  InvalidCredentialsError,
  PasswordResetTokenError,
  TotpCodeError,
  TotpSetupError,
} from "./service.js";
import type { AuthService, CredentialDelivery } from "./service.js";
import {
  isE164PhoneIdentifier,
  normalizePhoneIdentifier,
  SESSION_COOKIE_DEV,
  SESSION_COOKIE_PROD,
} from "./security.js";

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
const phoneIdentifierSchema = z
  .string()
  .trim()
  .transform(normalizePhoneIdentifier)
  .refine(isE164PhoneIdentifier, {
    message: "请输入 11 位中国大陆手机号，或带国家区号的国际手机号。",
  });
const passwordResetSchema = z.object({ token: z.string().min(32).max(512), password: strongPassword });
const totpCode = z.string().regex(/^\d{6}$/, "请输入 6 位动态验证码。");
const totpLoginSchema = z.object({ challengeToken: z.string().min(32).max(512), code: totpCode });
const totpDisableSchema = z.object({ password: z.string().min(8).max(1_024), code: totpCode });
const sensitiveCredentialActionSchema = z.object({
  password: z.string().min(8).max(1_024),
  totpCode: totpCode.optional(),
});
const credentialBindingSchema = z.discriminatedUnion("kind", [
  sensitiveCredentialActionSchema.extend({
    kind: z.literal("email"),
    identifier: z.email().max(320),
  }),
  sensitiveCredentialActionSchema.extend({
    kind: z.literal("phone"),
    identifier: phoneIdentifierSchema,
  }),
]);
const credentialParams = z.object({ credentialId: z.uuid() });
const credentialVerificationSchema = z.object({ token: z.string().min(32).max(512) });

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

function sendCredentialMutationError(error: unknown, reply: FastifyReply) {
  if (
    error instanceof CredentialConflictError ||
    error instanceof CredentialRemovalError ||
    error instanceof CredentialBindingTokenError
  ) {
    return reply.code(409).send({ error: "credential_conflict", message: error.message });
  }
  if (error instanceof AuthDeliveryUnavailableError) {
    return reply
      .code(503)
      .send({ error: "delivery_unavailable", message: error.message });
  }
  if (error instanceof InvalidCredentialsError || error instanceof TotpCodeError) {
    return reply.code(401).send({
      error: "sensitive_action_verification_failed",
      message: "二次验证失败，请检查当前密码或动态验证码后重试。",
    });
  }
  throw error;
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
  const deliverCredentialBinding = async (delivery: CredentialDelivery) => {
    try {
      await mailer.sendCredentialVerification(delivery);
      return {
        kind: delivery.kind,
        expiresAt: delivery.expiresAt,
        status: "sent" as const,
      };
    } catch (error) {
      if (error instanceof AuthDeliveryUnavailableError) {
        // The pending identity and its opaque token are durable. Returning a
        // clear retry-required state is safer than deleting the identity or
        // pretending an external provider accepted the message.
        return {
          kind: delivery.kind,
          expiresAt: delivery.expiresAt,
          status: "retry_required" as const,
          message: error.message,
        };
      }
      throw error;
    }
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
        if ("mfaRequired" in result) {
          return reply.code(202).send({
            mfaRequired: true,
            challengeToken: result.challengeToken,
            expiresAt: result.expiresAt,
          });
        }
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
            isOwner: result.context.isOwner,
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
    "/api/auth/login/mfa",
    {
      preHandler: app.csrfProtection,
      config: { rateLimit: { max: 10, timeWindow: "15 minutes", ban: 3 } },
    },
    async (request, reply) => {
      const input = totpLoginSchema.parse(request.body);
      try {
        const result = await service.completeTotpLogin(input.challengeToken, input.code);
        reply.setCookie(cookieName, result.token, { ...cookieOptions, expires: result.expiresAt, maxAge: config.SESSION_TTL_SECONDS });
        return {
          user: {
            id: result.context.userId,
            membershipId: result.context.membershipId,
            organizationId: result.context.organizationId,
            displayName: result.context.displayName,
            isOwner: result.context.isOwner,
          },
          permissions: result.context.grants,
        };
      } catch (error) {
        if (error instanceof TotpCodeError) return reply.code(401).send({ error: "invalid_totp", message: error.message });
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
    "/api/auth/mfa/totp",
    { preHandler: authenticate },
    async (request) => service.getTotpStatus(request.auth!.userId),
  );

  app.post(
    "/api/auth/mfa/totp/setup",
    { preHandler: [app.csrfProtection, authenticate] },
    async (request, reply) => {
      try {
        return await service.beginTotpSetup(request.auth!);
      } catch (error) {
        if (error instanceof TotpSetupError) return reply.code(409).send({ error: "totp_setup_failed", message: error.message });
        throw error;
      }
    },
  );

  app.post(
    "/api/auth/mfa/totp/confirm",
    { preHandler: [app.csrfProtection, authenticate] },
    async (request, reply) => {
      const { code } = z.object({ code: totpCode }).parse(request.body);
      try {
        return await service.confirmTotpSetup(request.auth!, code);
      } catch (error) {
        if (error instanceof TotpSetupError) return reply.code(409).send({ error: "totp_confirmation_failed", message: error.message });
        throw error;
      }
    },
  );

  app.delete(
    "/api/auth/mfa/totp",
    { preHandler: [app.csrfProtection, authenticate] },
    async (request, reply) => {
      const input = totpDisableSchema.parse(request.body);
      try {
        return await service.disableTotp(request.auth!, input.password, input.code);
      } catch (error) {
        if (error instanceof InvalidCredentialsError || error instanceof TotpCodeError) return reply.code(401).send({ error: "totp_disable_denied", message: "密码或动态验证码不正确。" });
        throw error;
      }
    },
  );

  app.get(
    "/api/auth/credentials",
    { preHandler: authenticate },
    async (request) => service.listCredentials(request.auth!),
  );

  app.post(
    "/api/auth/credentials",
    {
      preHandler: [app.csrfProtection, authenticate],
      config: { rateLimit: { max: 5, timeWindow: "1 hour", ban: 2 } },
    },
    async (request, reply) => {
      try {
        const input = credentialBindingSchema.parse(request.body);
        // A plainly unconfigured channel must never create a misleading
        // pending address. Transient delivery errors remain explicitly
        // retryable after the server stores the one-time verification record.
        mailer.assertDeliveryConfigured(input.kind);
        const pending = await service.beginCredentialBinding(
          request.auth!,
          input,
        );
        return reply.code(202).send({
          credential: pending.credential,
          delivery: await deliverCredentialBinding(pending),
        });
      } catch (error) {
        return sendCredentialMutationError(error, reply);
      }
    },
  );

  app.post(
    "/api/auth/credentials/:credentialId/resend",
    {
      preHandler: [app.csrfProtection, authenticate],
      config: { rateLimit: { max: 5, timeWindow: "1 hour", ban: 2 } },
    },
    async (request, reply) => {
      try {
        const { credentialId } = credentialParams.parse(request.params);
        const input = sensitiveCredentialActionSchema.parse(request.body);
        const pending = await service.resendCredentialBinding(
          request.auth!,
          credentialId,
          input,
          (kind) => mailer.assertDeliveryConfigured(kind),
        );
        return reply.code(202).send({
          credential: pending.credential,
          delivery: await deliverCredentialBinding(pending),
        });
      } catch (error) {
        return sendCredentialMutationError(error, reply);
      }
    },
  );

  app.delete(
    "/api/auth/credentials/:credentialId",
    {
      preHandler: [app.csrfProtection, authenticate],
      config: { rateLimit: { max: 5, timeWindow: "1 hour", ban: 2 } },
    },
    async (request, reply) => {
      try {
        const { credentialId } = credentialParams.parse(request.params);
        const input = sensitiveCredentialActionSchema.parse(request.body);
        return await service.removeCredential(request.auth!, credentialId, input);
      } catch (error) {
        return sendCredentialMutationError(error, reply);
      }
    },
  );

  app.post(
    "/api/auth/credentials/verify",
    {
      preHandler: app.csrfProtection,
      config: { rateLimit: { max: 10, timeWindow: "15 minutes", ban: 3 } },
    },
    async (request, reply) => {
      try {
        const { token } = credentialVerificationSchema.parse(request.body);
        return await service.confirmCredentialBinding(token);
      } catch (error) {
        return sendCredentialMutationError(error, reply);
      }
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
        const reset = await service.requestPasswordReset(
          identifier,
          (kind) => mailer.assertDeliveryConfigured(kind),
        );
        if (reset) await mailer.sendPasswordReset(reset);
        return reply.code(202).send({ accepted: true, message: "若该邮箱或手机号对应有效账号，重置链接将通过已验证渠道发送。" });
      } catch (error) {
        if (error instanceof AuthDeliveryUnavailableError) {
          // Keep the public reset endpoint indistinguishable for existing,
          // unknown, disabled, and temporarily undeliverable identities. The
          // service has already avoided persisting a reset token for a
          // plainly unconfigured channel; exposing that distinction here
          // would turn a recovery affordance into an account-enumeration API.
          return reply.code(202).send({
            accepted: true,
            message: "若该邮箱或手机号对应有效账号，重置链接将通过已验证渠道发送。",
          });
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
            isOwner: request.auth.isOwner,
            timezone: request.auth.timezone,
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
