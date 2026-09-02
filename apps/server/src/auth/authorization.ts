import type { FastifyReply, FastifyRequest } from "fastify";
import {
  hasPermission,
  type Permission,
  type PermissionGrant,
  type ScopeKind,
} from "@workbench/shared";

export interface AuthorizationTarget {
  scopeKind: ScopeKind;
  scopeId?: string | null;
}

export function isAuthorized(
  grants: readonly PermissionGrant[],
  permission: Permission,
  target: AuthorizationTarget,
): boolean {
  return hasPermission(grants, permission, target);
}

export function requirePermission(
  permission: Permission,
  resolveTarget: (request: FastifyRequest) => AuthorizationTarget,
) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> => {
    if (!request.auth) {
      return reply.code(401).send({
        error: "unauthorized",
        message: "登录状态已失效，请重新登录。",
        requestId: request.id,
      });
    }

    const target = resolveTarget(request);
    if (!isAuthorized(request.auth.grants, permission, target)) {
      return reply.code(403).send({
        error: "forbidden",
        message: "当前账号没有执行此操作的权限，请联系管理员明确细节。",
        requestId: request.id,
      });
    }
  };
}
