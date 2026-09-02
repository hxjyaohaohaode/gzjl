import { and, asc, eq, gt } from "drizzle-orm";
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
    const close = () => {
      if (pollTimer) clearInterval(pollTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    };
    socket.once("close", close);
    socket.once("error", close);

    void (async () => {
      const auth = await authService.authenticate(
        request.cookies[sessionCookieName(config)],
      );
      if (!auth) {
        socket.close(4_401, "unauthorized");
        return;
      }
      let cursor = new Date();
      socket.send(
        JSON.stringify({
          type: "realtime.ready",
          occurredAt: cursor.toISOString(),
        }),
      );
      pollTimer = setInterval(() => {
        void (async () => {
          const events = await db
            .select()
            .from(outboxEvents)
            .where(
              and(
                eq(outboxEvents.organizationId, auth.organizationId),
                gt(outboxEvents.createdAt, cursor),
              ),
            )
            .orderBy(asc(outboxEvents.createdAt))
            .limit(100);
          for (const event of events) {
            if (socket.readyState !== 1) return;
            socket.send(
              JSON.stringify({
                type: event.eventType,
                entityType: event.entityType,
                entityId: event.entityId,
                entityVersion: event.entityVersion,
                payload: event.payload,
                occurredAt: event.createdAt.toISOString(),
              }),
            );
            cursor = event.createdAt;
          }
        })().catch((error) => request.log.warn({ error }, "realtime polling failed"));
      }, 3_000);
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
