import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { Database } from "@workbench/db";
import {
  memberRoles,
  orgMemberships,
  rolePermissions,
  sessions,
  userCredentials,
  users,
} from "@workbench/db/schema";
import {
  permissions,
  type Permission,
  type PermissionGrant,
  type ScopeKind,
} from "@workbench/shared";

import {
  createOpaqueToken,
  hashOpaqueToken,
  normalizeLoginIdentifier,
  verifyPassword,
} from "./security.js";

export interface AuthContext {
  userId: string;
  membershipId: string;
  organizationId: string;
  displayName: string;
  grants: PermissionGrant[];
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  context: AuthContext;
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super("账号或密码不正确。请检查后重试。");
    this.name = "InvalidCredentialsError";
  }
}

export class AccountLockedError extends Error {
  constructor() {
    super("登录尝试过多，账号已被暂时锁定。请稍后重试或重置密码。");
    this.name = "AccountLockedError";
  }
}

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly sessionTtlSeconds: number,
  ) {}

  async login(identifier: string, password: string): Promise<LoginResult> {
    const normalizedIdentifier = normalizeLoginIdentifier(identifier);
    const [account] = await this.db
      .select({
        credentialId: userCredentials.id,
        passwordHash: userCredentials.passwordHash,
        failedLoginAttempts: userCredentials.failedLoginAttempts,
        lockedUntil: userCredentials.lockedUntil,
        userId: users.id,
        displayName: users.displayName,
        userStatus: users.status,
        membershipId: orgMemberships.id,
        membershipStatus: orgMemberships.status,
        organizationId: orgMemberships.organizationId,
      })
      .from(userCredentials)
      .innerJoin(users, eq(users.id, userCredentials.userId))
      .innerJoin(orgMemberships, eq(orgMemberships.userId, users.id))
      .where(eq(userCredentials.normalizedIdentifier, normalizedIdentifier))
      .limit(1);

    if (!account || account.userStatus !== "active" || account.membershipStatus !== "active") {
      throw new InvalidCredentialsError();
    }

    const now = new Date();
    if (account.lockedUntil && account.lockedUntil > now) {
      throw new AccountLockedError();
    }

    const valid = await verifyPassword(account.passwordHash, password);
    if (!valid) {
      const attempts = account.failedLoginAttempts + 1;
      await this.db
        .update(userCredentials)
        .set({
          failedLoginAttempts: attempts,
          lockedUntil: attempts >= 5 ? new Date(now.getTime() + 15 * 60_000) : null,
          updatedAt: now,
        })
        .where(eq(userCredentials.id, account.credentialId));
      if (attempts >= 5) throw new AccountLockedError();
      throw new InvalidCredentialsError();
    }

    await this.db
      .update(userCredentials)
      .set({ failedLoginAttempts: 0, lockedUntil: null, updatedAt: now })
      .where(eq(userCredentials.id, account.credentialId));

    const token = createOpaqueToken();
    const expiresAt = new Date(now.getTime() + this.sessionTtlSeconds * 1_000);
    await this.db.insert(sessions).values({
      userId: account.userId,
      tokenHash: hashOpaqueToken(token),
      csrfSecretHash: hashOpaqueToken(createOpaqueToken()),
      expiresAt,
    });

    return {
      token,
      expiresAt,
      context: await this.createContext({
        userId: account.userId,
        membershipId: account.membershipId,
        organizationId: account.organizationId,
        displayName: account.displayName,
      }),
    };
  }

  async authenticate(token: string | undefined): Promise<AuthContext | null> {
    if (!token) return null;
    const now = new Date();
    const [session] = await this.db
      .select({
        sessionId: sessions.id,
        userId: users.id,
        displayName: users.displayName,
        membershipId: orgMemberships.id,
        organizationId: orgMemberships.organizationId,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .innerJoin(orgMemberships, eq(orgMemberships.userId, users.id))
      .where(
        and(
          eq(sessions.tokenHash, hashOpaqueToken(token)),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
          eq(users.status, "active"),
          eq(orgMemberships.status, "active"),
        ),
      )
      .limit(1);

    if (!session) return null;
    await this.db
      .update(sessions)
      .set({ lastSeenAt: now })
      .where(eq(sessions.id, session.sessionId));

    return this.createContext(session);
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date(), revokeReason: "user_logout" })
      .where(and(eq(sessions.tokenHash, hashOpaqueToken(token)), isNull(sessions.revokedAt)));
  }

  private async createContext(base: Omit<AuthContext, "grants">): Promise<AuthContext> {
    const rows = await this.db
      .select({
        permission: rolePermissions.permissionCode,
        scopeKind: memberRoles.scopeKind,
        scopeId: memberRoles.scopeId,
      })
      .from(memberRoles)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, memberRoles.roleId))
      .where(
        and(
          eq(memberRoles.membershipId, base.membershipId),
          or(isNull(memberRoles.expiresAt), gt(memberRoles.expiresAt, new Date())),
        ),
      );

    const permissionSet = new Set<string>(permissions);
    const grants = rows
      .filter((row) => permissionSet.has(row.permission))
      .map((row) => ({
        permission: row.permission as Permission,
        scopeKind: row.scopeKind as ScopeKind,
        scopeId: row.scopeId,
      }));

    return { ...base, grants };
  }

  async revokeAllOtherSessions(userId: string, currentToken: string): Promise<number> {
    const result = await this.db
      .update(sessions)
      .set({ revokedAt: new Date(), revokeReason: "user_revoked_other_devices" })
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          sql`${sessions.tokenHash} <> ${hashOpaqueToken(currentToken)}`,
        ),
      )
      .returning({ id: sessions.id });
    return result.length;
  }
}
