import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import { registerTimerRoutes } from "./routes.js";
import type { TimerService } from "./service.js";

const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });
const membershipId = "00000000-0000-4000-8000-000000000002";
async function setup() {
  const app = Fastify();
  apps.push(app);
  app.decorate("csrfProtection", async () => undefined);
  const start = vi.fn(async () => ({ id: "timer", status: "running" }));
  const transition = vi.fn(async () => ({ id: "timer", status: "paused" }));
  await registerTimerRoutes(app, { start, transition } as unknown as TimerService, async (request) => {
    request.auth = {
      membershipId, organizationId: crypto.randomUUID(), userId: crypto.randomUUID(),
      displayName: "测试成员", timezone: "Asia/Shanghai", isOwner: false,
      grants: [{ permission: "work.view_own", scopeKind: "self", scopeId: membershipId }],
    };
  });
  return { app, start, transition };
}
it("rejects an offline start owned by a different account before writing any facts", async () => {
  const { app, start } = await setup();
  const response = await app.inject({ method: "POST", url: "/api/timer/start", headers: { "x-workbench-membership": crypto.randomUUID() }, payload: { eventId: crypto.randomUUID(), occurredAt: new Date().toISOString(), content: "原账号离线事件" } });
  expect(response.statusCode).toBe(409);
  expect(response.json()).toMatchObject({ error: "timer_session_changed" });
  expect(start).not.toHaveBeenCalled();
});
it("accepts an owned idempotent start and protects transitions with the same guard", async () => {
  const { app, start, transition } = await setup();
  const response = await app.inject({ method: "POST", url: "/api/timer/start", headers: { "x-workbench-membership": membershipId }, payload: { eventId: crypto.randomUUID(), occurredAt: new Date().toISOString(), content: "本人计时" } });
  expect(response.statusCode).toBe(201);
  expect(start).toHaveBeenCalledOnce();
  const blocked = await app.inject({ method: "POST", url: `/api/timer/${crypto.randomUUID()}/events`, headers: { "x-workbench-membership": crypto.randomUUID() }, payload: { eventId: crypto.randomUUID(), occurredAt: new Date().toISOString(), eventType: "pause" } });
  expect(blocked.statusCode).toBe(409);
  expect(transition).not.toHaveBeenCalled();
});
