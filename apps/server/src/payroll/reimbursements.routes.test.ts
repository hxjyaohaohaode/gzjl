import Fastify from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { registerPayrollRoutes } from "./routes.js";
import type { PayrollService } from "./service.js";
import type { ReimbursementService } from "./reimbursements.js";

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });
it("validates paired month boundaries and pagination before querying reimbursements", async () => {
  const app = Fastify(); apps.push(app);
  app.decorate("csrfProtection", async () => undefined);
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof ZodError ? 400 : 500).send({ error: "invalid_query" }));
  const list = vi.fn(async (...args: Parameters<ReimbursementService["list"]>) => { void args; return { items: [] }; });
  await registerPayrollRoutes(app, {} as PayrollService, async () => undefined, { list } as unknown as ReimbursementService);
  for (const query of ["from=2026-09-01", "from=2026-10-01&to=2026-09-01", "from=2026-02-30&to=2026-03-05", "from=2024-01-01&to=2026-01-01", "before=invalid", "limit=101", "pendingOnly=anything", "ownOnly=anything", "reviewedOnly=anything", "id=invalid"]) {
    expect((await app.inject({ method: "GET", url: `/api/reimbursements?${query}` })).statusCode).toBe(400);
  }
  expect(list).not.toHaveBeenCalled();
  expect((await app.inject({ method: "GET", url: "/api/reimbursements?from=2026-09-01&to=2026-10-01&limit=50" })).statusCode).toBe(200);
  expect(list.mock.calls[0]?.[1]).toEqual({ from: "2026-09-01", to: "2026-10-01", limit: 50 });
  expect((await app.inject({ method: "GET", url: "/api/reimbursements?ownOnly=true" })).statusCode).toBe(200);
  expect(list.mock.calls[1]?.[1]).toEqual({ ownOnly: true, limit: 100 });
});
