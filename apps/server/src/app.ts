import { existsSync } from "node:fs";
import { extname, resolve } from "node:path";

import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import csrfProtection from "@fastify/csrf-protection";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { Database } from "@workbench/db";
import { outboxEvents } from "@workbench/db/schema";

import { registerAiRoutes } from "./ai/routes.js";
import { AiConfigurationService } from "./ai/configuration.js";
import { AiService } from "./ai/service.js";
import { registerApprovalRoutes } from "./approvals/routes.js";
import { ApprovalService } from "./approvals/service.js";
import { registerAnalyticsRoutes } from "./analytics/routes.js";
import { AnalyticsService } from "./analytics/service.js";
import { createAuthenticationPreHandler, registerAuthRoutes } from "./auth/routes.js";
import { AuthMailer } from "./auth/mailer.js";
import { AuthService } from "./auth/service.js";
import {
  hashOpaqueToken,
  SESSION_COOKIE_DEV,
  SESSION_COOKIE_PROD,
} from "./auth/security.js";
import type { ServerConfig } from "./config.js";
import { registerEvidenceRoutes } from "./evidence/routes.js";
import { EvidenceService } from "./evidence/service.js";
import { registerOrganizationRoutes } from "./organization/routes.js";
import { OrganizationService } from "./organization/service.js";
import { registerOperationsRoutes } from "./operations/routes.js";
import { OperationsService } from "./operations/service.js";
import { registerNotificationRoutes } from "./notifications/routes.js";
import { registerPayrollRoutes } from "./payroll/routes.js";
import { PayrollService } from "./payroll/service.js";
import { registerProjectRoutes } from "./projects/routes.js";
import { ProjectService } from "./projects/service.js";
import { registerSetupRoutes } from "./setup/routes.js";
import { SetupService } from "./setup/service.js";
import { registerRealtimeRoutes } from "./realtime/routes.js";
import { registerSearchRoutes } from "./search/routes.js";
import { SearchService } from "./search/service.js";
import { registerTimerRoutes } from "./timer/routes.js";
import { TimerService } from "./timer/service.js";
import { registerWorkCorrectionRoutes } from "./work/correction-routes.js";
import { WorkCorrectionService } from "./work/correction-service.js";
import { registerWorkRoutes } from "./work/routes.js";
import { WorkSessionService } from "./work/service.js";

export interface ReadinessProbe {
  check(): Promise<void>;
}

export interface BuildAppOptions {
  config: ServerConfig;
  readiness: ReadinessProbe;
  database?: Database;
}

export async function buildApp({
  config,
  readiness,
  database,
}: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      config.NODE_ENV === "test"
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: {
              paths: [
                "req.headers.authorization",
                "req.headers.cookie",
                "res.headers.set-cookie",
                "password",
                "token",
                "apiKey",
                "identifier",
                "email",
                "phone",
                "req.body.identifier",
                "req.body.email",
                "req.body.phone",
                "req.headers.x-setup-token",
              ],
              censor: "[REDACTED]",
            },
          },
    trustProxy: true,
    requestIdHeader: "x-request-id",
  });

  await app.register(
    helmet,
    config.NODE_ENV === "production"
      ? {
          global: true,
          contentSecurityPolicy: {
            directives: {
              connectSrc: [
                "'self'",
                // This must be the actual browser-facing signed-PUT origin,
                // which may differ from a virtual-hosted S3 SDK endpoint.
                ...(config.S3_BROWSER_ORIGIN
                  ? [new URL(config.S3_BROWSER_ORIGIN).origin]
                  : []),
              ],
            },
          },
        }
      : { global: true, contentSecurityPolicy: false },
  );
  await app.register(cors, {
    origin: config.WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(cookie, {
    secret: config.SESSION_SECRET,
    hook: "onRequest",
  });
  await app.register(csrfProtection, {
    cookieOpts: {
      signed: true,
      httpOnly: true,
      sameSite: "strict",
      secure: config.NODE_ENV === "production",
      path: "/",
    },
  });
  await app.register(rateLimit, {
    global: true,
    // Office networks commonly put every employee behind one public IP. Once
    // authenticated, isolate the general API budget by opaque session instead
    // of letting one active browser exhaust the whole company's allowance.
    // Public/authentication routes keep their stricter route-level limits.
    max: 600,
    timeWindow: "1 minute",
    ban: 3,
    allowList: (request) => request.url === "/healthz" || request.url === "/readyz",
    keyGenerator: (request) => {
      const cookieName =
        config.NODE_ENV === "production"
          ? SESSION_COOKIE_PROD
          : SESSION_COOKIE_DEV;
      const sessionToken = request.cookies[cookieName];
      return sessionToken
        ? `session:${hashOpaqueToken(sessionToken)}`
        : `ip:${request.ip}`;
    },
  });
  await app.register(websocket);

  app.get("/healthz", async () => ({
    status: "ok",
    service: "workbench-server",
    timestamp: new Date().toISOString(),
  }));

  app.get("/readyz", async (_request, reply) => {
    try {
      await readiness.check();
      return { status: "ready", timestamp: new Date().toISOString() };
    } catch {
      return reply.code(503).send({
        status: "not_ready",
        reason: "database_unavailable",
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.get("/api/auth/csrf", async (_request, reply) => ({
    csrfToken: await reply.generateCsrf(),
  }));

  if (database) {
    await registerSetupRoutes(app, new SetupService(database), config);
    const authService = new AuthService(
      database,
      config.SESSION_TTL_SECONDS,
      config.PASSWORD_RESET_TTL_SECONDS,
      config.CREDENTIAL_VERIFICATION_TTL_SECONDS,
      config.SESSION_SECRET,
    );
    /**
     * Every successful authenticated write emits a privacy-safe organization
     * invalidation event. The browser never receives request bodies or record
     * contents, only a signal to refetch the facts it is authorized to read.
     * Services that already emit a more specific event may coexist with this;
     * query invalidation is idempotent.
     */
    app.addHook("onSend", async (request, reply, payload) => {
      const method = request.method.toUpperCase();
      const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
      const path = request.url.split("?")[0] ?? request.url;
      const isCredentialLifecycleWrite = path.startsWith("/api/auth/credentials");
      const auth = request.auth;
      if (
        !isWrite ||
        !auth ||
        reply.statusCode < 200 ||
        reply.statusCode >= 300 ||
        !path.startsWith("/api/") ||
        (path.startsWith("/api/auth/") && !isCredentialLifecycleWrite) ||
        path === "/api/realtime"
      ) {
        return payload;
      }
      try {
        await database.insert(outboxEvents).values({
          organizationId: auth.organizationId,
          eventType: "organization.data.changed",
          entityType: "organization_sync",
          entityId: auth.membershipId,
          entityVersion: 1,
          payload: { method, route: request.routeOptions.url ?? path },
        });
      } catch (error) {
        // The business mutation has already committed. Do not turn a durable
        // user action into a confusing 5xx merely because a follower needs to
        // fall back to normal query refresh after an outbox transient failure.
        request.log.error({ error, path }, "realtime invalidation enqueue failed");
      }
      return payload;
    });
    await registerAuthRoutes(
      app,
      authService,
      config,
    );
    const authenticate = createAuthenticationPreHandler(authService, config);
    const workService = new WorkSessionService(database);
    await registerWorkRoutes(
      app,
      workService,
      authenticate,
    );
    await registerWorkCorrectionRoutes(
      app,
      new WorkCorrectionService(database),
      authenticate,
    );
    await registerTimerRoutes(
      app,
      new TimerService(database),
      authenticate,
    );
    await registerProjectRoutes(
      app,
      new ProjectService(database),
      authenticate,
    );
    await registerApprovalRoutes(
      app,
      new ApprovalService(database),
      authenticate,
    );
    await registerPayrollRoutes(
      app,
      new PayrollService(database),
      authenticate,
    );
    const analyticsService = new AnalyticsService(database);
    await registerAnalyticsRoutes(
      app,
      analyticsService,
      authenticate,
    );
    await registerSearchRoutes(
      app,
      new SearchService(database, analyticsService),
      authenticate,
    );
    await registerOrganizationRoutes(
      app,
      new OrganizationService(database, new AuthMailer(config)),
      authService,
      authenticate,
    );
    const aiConfigurationService = new AiConfigurationService(database, config);
    await registerAiRoutes(
      app,
      new AiService(database, analyticsService, aiConfigurationService),
      aiConfigurationService,
      authService,
      authenticate,
    );
    await registerNotificationRoutes(
      app,
      database,
      authenticate,
      config,
    );
    await registerRealtimeRoutes(app, database, authService, config);
    await registerOperationsRoutes(
      app,
      new OperationsService(database, analyticsService, workService),
      authenticate,
    );
    await registerEvidenceRoutes(
      app,
      new EvidenceService(database, config),
      authenticate,
    );
  }

  const webRoot = resolve(config.WEB_DIST_DIR);
  if (config.NODE_ENV === "production" && existsSync(webRoot)) {
    await app.register(staticFiles, {
      root: webRoot,
      prefix: "/",
      cacheControl: false,
      setHeaders(reply, filePath) {
        // Only Vite's content-hashed assets are safe to cache forever. The
        // SPA shell and service worker must revalidate, otherwise an employee
        // can remain pinned to an old release long after Render switched the
        // server and API to a newer commit.
        reply.header(
          "Cache-Control",
          filePath.includes(`${resolve(webRoot, "assets")}`)
            ? "public, max-age=31536000, immutable"
            : "no-cache, no-store, must-revalidate",
        );
      },
    });
    app.setNotFoundHandler((request, reply) => {
      const pathname = request.url.split("?", 1)[0] ?? request.url;
      const isClientRoute =
        request.method === "GET" &&
        !pathname.startsWith("/api/") &&
        // Existing files are served by @fastify/static before this handler.
        // Keep a missing JS/CSS/image request as a real 404, but return the
        // SPA shell for every route-style navigation even when an embedded
        // browser sends Accept: */* instead of text/html.
        extname(pathname) === "";
      if (isClientRoute) {
        return reply.header("cache-control", "no-cache").sendFile("index.html");
      }
      return reply.code(404).send({
        error: "not_found",
        message: "请求的资源不存在。",
        requestId: request.id,
      });
    });
  }

  app.setErrorHandler((error, request, reply) => {
    const requestError = error instanceof Error ? error : new Error("Unknown request error");
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: "validation_error",
        message: "请求参数不符合要求。",
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
        requestId: request.id,
      });
    }
    const fastifyMetadata = error as { statusCode?: number; code?: string };
    request.log.error({ error: requestError }, "request failed");
    const statusCode =
      fastifyMetadata.statusCode && fastifyMetadata.statusCode >= 400
        ? fastifyMetadata.statusCode
        : 500;
    void reply.code(statusCode).send({
      error:
        statusCode >= 500
          ? "internal_error"
          : fastifyMetadata.code ?? "request_error",
      message:
        statusCode >= 500
          ? "服务暂时无法完成请求，请稍后重试。"
          : requestError.message,
      requestId: request.id,
    });
  });

  return app;
}
