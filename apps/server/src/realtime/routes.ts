import { and, asc, eq, gt, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Database } from "@workbench/db";
import { outboxEvents } from "@workbench/db/schema";

import { sessionCookieName } from "../auth/routes.js";
import type { AuthService } from "../auth/service.js";
import type { ServerConfig } from "../config.js";

export async function registerRealtimeRoutes(
  app: FastifyInstance,
  db: Database,
  authService: AuthService,
  config: ServerConfig,
): Promise<void> {
  app.get("/api/realtime", { websocket: true }, (socket, request) => {
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let closed = false;
    const close = () => {
      closed = true;
      if (pollTimer) clearInterval(pollTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    };
    socket.once("close", close);
    socket.once("error", close);

    void (async () => {
      const expectedOrigin = new URL(config.WEB_ORIGIN).origin;
      // CORS middleware does not protect WebSocket upgrades. In production a
      // cookie-authenticated socket must therefore prove it was opened by the
      // configured browser origin, preventing cross-site WebSocket hijacking.
      if (
        config.NODE_ENV === "production" &&
        request.headers.origin !== expectedOrigin
      ) {
        socket.close(4_403, "origin forbidden");
        return;
      }
      const auth = await authService.authenticate(
        request.cookies[sessionCookieName(config)],
      );
      if (!auth || closed || socket.readyState !== 1) {
        socket.close(4_401, "unauthorized");
        return;
      }
      let cursor = {
        createdAt: new Date(),
        id: "00000000-0000-0000-0000-000000000000",
      };
      let polling = false;
      socket.send(
        JSON.stringify({
          type: "realtime.ready",
          occurredAt: cursor.createdAt.toISOString(),
        }),
      );
      pollTimer = setInterval(() => {
        if (polling) return;
        polling = true;
        void (async () => {
          const events = await db
            .select()
            .from(outboxEvents)
            .where(
              and(
                eq(outboxEvents.organizationId, auth.organizationId),
                or(
                  gt(outboxEvents.createdAt, cursor.createdAt),
                  and(
                    eq(outboxEvents.createdAt, cursor.createdAt),
                    gt(outboxEvents.id, cursor.id),
                  ),
                ),
              ),
            )
            .orderBy(asc(outboxEvents.createdAt), asc(outboxEvents.id))
            .limit(100);
          for (const event of events) {
            if (socket.readyState !== 1) return;
            // The socket is an organization-level invalidation channel, not a
            // second data API.  A member who may not read another member's
            // AI job, work record, evidence, or payroll item must not learn
            // its id, state, or payload simply by keeping a WebSocket open.
            // Each receiving screen refetches through its normal scoped API.
            socket.send(
              JSON.stringify({
                type: "organization.data.changed",
                occurredAt: event.createdAt.toISOString(),
              }),
            );
            cursor = { createdAt: event.createdAt, id: event.id };
          }
        })()
          .catch((error) => request.log.warn({ error }, "realtime polling failed"))
          .finally(() => {
            polling = false;
          });
      }, 2_000);
      heartbeatTimer = setInterval(() => {
        if (socket.readyState === 1) {
          socket.send(
            JSON.stringify({ type: "heartbeat", occurredAt: new Date().toISOString() }),
          );
        }
      }, 25_000);
    })().catch((error) => {
      request.log.warn({ error }, "realtime authentication failed");
      socket.close(1_011, "realtime initialization failed");
    });
  });
}
