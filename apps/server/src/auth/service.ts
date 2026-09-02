import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { Database } from "@workbench/db";
import {
  memberRoles,
  auditLogs,
  orgMemberships,
  rolePermissions,
  sessions,
  userCredentials,
  users,
  verificationTokens,
} from "@workbench/db/schema";
import {
  permissions,
  type Permission,
  type PermissionGrant,
  type ScopeKind,
} from "@workbench/shared";

import {
  createOpaqueToken,
  hashPassword,
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

export class PasswordResetTokenError extends Error {
  constructor() {
    super("重置链接无效、已使用或已过期。请重新申请。");
    this.name = "PasswordResetTokenError";
  }
}

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly sessionTtlSeconds: number,
    private readonly passwordResetTtlSeconds: number,
  ) {}

  async requestPasswordReset(identifier: string) {
    const normalizedIdentifier = normalizeLoginIdentifier(identifier);
    const [account] = await this.db.select({
      credentialId: userCredentials.id,
      email: userCredentials.normalizedIdentifier,
      membershipId: orgMemberships.id,
      organizationId: orgMemberships.organizationId,
      userId: users.id,
      userStatus: users.status,
      membershipStatus: orgMemberships.status,
    }).from(userCredentials).innerJoin(users, eq(users.id, userCredentials.userId)).innerJoin(orgMemberships, eq(orgMemberships.userId, users.id)).where(and(eq(userCredentials.normalizedIdentifier, normalizedIdentifier), eq(userCredentials.kind, "email"))).limit(1);
    if (!account || account.userStatus !== "active" || account.membershipStatus !== "active") return null;
    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + this.passwordResetTtlSeconds * 1_000);
    await this.db.transaction(async (tx) => {
      await tx.update(verificationTokens).set({ consumedAt: new Date() }).where(and(eq(verificationTokens.credentialId, account.credentialId), eq(verificationTokens.purpose, "password_reset"), isNull(verificationTokens.consumedAt)));
      await tx.insert(verificationTokens).values({ credentialId: account.credentialId, purpose: "password_reset", tokenHash: hashOpaqueToken(token), expiresAt });
      await tx.insert(auditLogs).values({ organizationId: account.organizationId, actorMembershipId: account.membershipId, action: "auth.password_reset_requested", entityType: "user", entityId: account.userId });
    });
    return { email: account.email, token, expiresAt };
  }

  async resetPassword(token: string, password: string) {
    const passwordHash = await hashPassword(password);
    return this.db.transaction(async (tx) => {
      const [record] = await tx.select({ token: verificationTokens, credential: userCredentials, membership: orgMemberships }).from(verificationTokens).innerJoin(userCredentials, eq(userCredentials.id, verificationTokens.credentialId)).innerJoin(orgMemberships, eq(orgMemberships.userId, userCredentials.userId)).where(and(eq(verificationTokens.tokenHash, hashOpaqueToken(token)), eq(verificationTokens.purpose, "password_reset"), isNull(verificationTokens.consumedAt), gt(verificationTokens.expiresAt, new Date()), eq(orgMemberships.status, "active"))).for("update").limit(1);
      if (!record) throw new PasswordResetTokenError();
      const now = new Date();
      await tx.update(userCredentials).set({ passwordHash, passwordChangedAt: now, failedLoginAttempts: 0, lockedUntil: null, updatedAt: now }).where(eq(userCredentials.id, record.credential.id));
      await tx.update(verificationTokens).set({ consumedAt: now }).where(eq(verificationTokens.id, record.token.id));
      await tx.update(sessions).set({ revokedAt: now, revokeReason: "password_reset" }).where(and(eq(sessions.userId, record.credential.userId), isNull(sessions.revokedAt)));
      await tx.insert(auditLogs).values({ organizationId: record.membership.organizationId, actorMembershipId: record.membership.id, action: "auth.password_reset_completed", entityType: "user", entityId: record.credential.userId });
      return { reset: true };
    });
  }

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
