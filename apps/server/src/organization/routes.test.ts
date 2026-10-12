import Fastify from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import type { PermissionGrant } from "@workbench/shared";
import type { AuthService } from "../auth/service.js";
import type { OrganizationService } from "./service.js";
import { registerOrganizationRoutes } from "./routes.js";

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

it("requires organization-wide member management before exposing the permission graph", async () => {
  const app = Fastify(); apps.push(app);
  app.decorate("csrfProtection", async () => undefined);
  let grants: PermissionGrant[] = [];
  const permissionOverview = vi.fn(async () => ({ organizationId: "org", bindings: [] }));
  await registerOrganizationRoutes(app, { permissionOverview } as unknown as OrganizationService, {} as AuthService, async (request) => {
    request.auth = { userId: "user", membershipId: "member", organizationId: "org", displayName: "测试成员", timezone: "Asia/Shanghai", isOwner: false, grants };
  });
  expect((await app.inject({ method: "GET", url: "/api/organization/permission-overview" })).statusCode).toBe(403);
  grants = [{ permission: "members.manage", scopeKind: "project", scopeId: "project" }];
  expect((await app.inject({ method: "GET", url: "/api/organization/permission-overview" })).statusCode).toBe(403);
  expect(permissionOverview).not.toHaveBeenCalled();
  grants = [{ permission: "members.manage", scopeKind: "organization", scopeId: null }];
  const response = await app.inject({ method: "GET", url: "/api/organization/permission-overview" });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ organizationId: "org", bindings: [] });
  expect(permissionOverview).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ organizationId: "org", membershipId: "member" }));
});
