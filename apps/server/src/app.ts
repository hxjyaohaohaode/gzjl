import { existsSync } from "node:fs";
import { resolve } from "node:path";

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

import { registerAiRoutes } from "./ai/routes.js";
import { AiService } from "./ai/service.js";
import { registerApprovalRoutes } from "./approvals/routes.js";
import { ApprovalService } from "./approvals/service.js";
import { registerAnalyticsRoutes } from "./analytics/routes.js";
import { AnalyticsService } from "./analytics/service.js";
import { createAuthenticationPreHandler, registerAuthRoutes } from "./auth/routes.js";
import { AuthService } from "./auth/service.js";
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
import { registerTimerRoutes } from "./timer/routes.js";
import { TimerService } from "./timer/service.js";
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
                ...(config.S3_ENDPOINT ? [new URL(config.S3_ENDPOINT).origin] : []),
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
    max: 300,
    timeWindow: "1 minute",
    ban: 3,
    allowList: (request) => request.url === "/healthz" || request.url === "/readyz",
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
      config.SESSION_SECRET,
    );
    await registerAuthRoutes(
      app,
      authService,
      config,
    );
    await registerWorkRoutes(
      app,
      new WorkSessionService(database),
      createAuthenticationPreHandler(authService, config),
    );
    await registerTimerRoutes(
      app,
      new TimerService(database),
      createAuthenticationPreHandler(authService, config),
    );
    await registerProjectRoutes(
      app,
      new ProjectService(database),
      createAuthenticationPreHandler(authService, config),
    );
    await registerApprovalRoutes(
      app,
      new ApprovalService(database),
      createAuthenticationPreHandler(authService, config),
    );
    await registerPayrollRoutes(
      app,
      new PayrollService(database),
      createAuthenticationPreHandler(authService, config),
    );
    const analyticsService = new AnalyticsService(database);
    await registerAnalyticsRoutes(
      app,
      analyticsService,
      createAuthenticationPreHandler(authService, config),
    );
    await registerOrganizationRoutes(
      app,
      new OrganizationService(database),
      createAuthenticationPreHandler(authService, config),
    );
    await registerAiRoutes(
      app,
      new AiService(database, analyticsService, config),
      createAuthenticationPreHandler(authService, config),
    );
    await registerNotificationRoutes(
      app,
      database,
      createAuthenticationPreHandler(authService, config),
    );
    await registerRealtimeRoutes(app, database, authService, config);
    await registerOperationsRoutes(
      app,
      new OperationsService(database, analyticsService, new WorkSessionService(database)),
      createAuthenticationPreHandler(authService, config),
    );
    await registerEvidenceRoutes(
      app,
      new EvidenceService(database, config),
      createAuthenticationPreHandler(authService, config),
    );
  }

  const webRoot = resolve(config.WEB_DIST_DIR);
  if (config.NODE_ENV === "production" && existsSync(webRoot)) {
    await app.register(staticFiles, {
      root: webRoot,
      prefix: "/",
      immutable: true,
      maxAge: "1 year",
    });
    app.setNotFoundHandler((request, reply) => {
      if (
        request.method === "GET" &&
        !request.url.startsWith("/api/") &&
        request.headers.accept?.includes("text/html")
      ) {
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
