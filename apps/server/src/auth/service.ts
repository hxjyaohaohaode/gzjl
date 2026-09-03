import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { Database } from "@workbench/db";
import {
  memberRoles,
  auditLogs,
  organizationOwners,
  orgMemberships,
  rolePermissions,
  sessions,
  userCredentials,
  userTotpFactors,
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
import {
  createTotpSecret,
  createTotpUri,
  decryptTotpSecret,
  encryptTotpSecret,
  verifyTotp,
} from "./totp.js";
import type { CredentialDeliveryKind } from "./mailer.js";

export interface AuthContext {
  userId: string;
  membershipId: string;
  organizationId: string;
  displayName: string;
  /** The unique organization owner; used only for owner-gated UI affordances. */
  isOwner: boolean;
  grants: PermissionGrant[];
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  context: AuthContext;
}

export interface MfaChallengeResult {
  mfaRequired: true;
  challengeToken: string;
  expiresAt: Date;
}

export type PasswordLoginResult = LoginResult | MfaChallengeResult;

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

export class TotpCodeError extends Error {
  constructor() {
    super("动态验证码无效、已过期或已使用，请重试。");
    this.name = "TotpCodeError";
  }
}

export class TotpSetupError extends Error {
  constructor(message = "暂时无法完成双因素认证设置，请重新开始。") {
    super(message);
    this.name = "TotpSetupError";
  }
}

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly sessionTtlSeconds: number,
    private readonly passwordResetTtlSeconds: number,
    private readonly sessionSecret: string,
  ) {}

  async requestPasswordReset(
    identifier: string,
    assertDeliveryConfigured?: (kind: CredentialDeliveryKind) => void,
  ) {
    const normalizedIdentifier = normalizeLoginIdentifier(identifier);
    const [account] = await this.db.select({
      credentialId: userCredentials.id,
      identifier: userCredentials.normalizedIdentifier,
      kind: userCredentials.kind,
      membershipId: orgMemberships.id,
      organizationId: orgMemberships.organizationId,
      userId: users.id,
      userStatus: users.status,
      membershipStatus: orgMemberships.status,
    }).from(userCredentials).innerJoin(users, eq(users.id, userCredentials.userId)).innerJoin(orgMemberships, eq(orgMemberships.userId, users.id)).where(eq(userCredentials.normalizedIdentifier, normalizedIdentifier)).limit(1);
    if (!account || account.userStatus !== "active" || account.membershipStatus !== "active") return null;
    assertDeliveryConfigured?.(account.kind);
    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + this.passwordResetTtlSeconds * 1_000);
    await this.db.transaction(async (tx) => {
      await tx.update(verificationTokens).set({ consumedAt: new Date() }).where(and(eq(verificationTokens.credentialId, account.credentialId), eq(verificationTokens.purpose, "password_reset"), isNull(verificationTokens.consumedAt)));
      await tx.insert(verificationTokens).values({ credentialId: account.credentialId, purpose: "password_reset", tokenHash: hashOpaqueToken(token), expiresAt });
      await tx.insert(auditLogs).values({ organizationId: account.organizationId, actorMembershipId: account.membershipId, action: "auth.password_reset_requested", entityType: "user", entityId: account.userId });
    });
    return { identifier: account.identifier, kind: account.kind, token, expiresAt };
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

  async login(identifier: string, password: string): Promise<PasswordLoginResult> {
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

    const [factor] = await this.db
      .select({ enabledAt: userTotpFactors.enabledAt })
      .from(userTotpFactors)
      .where(eq(userTotpFactors.userId, account.userId))
      .limit(1);
    if (factor?.enabledAt) {
      const challengeToken = createOpaqueToken();
      const expiresAt = new Date(now.getTime() + 5 * 60_000);
      await this.db.transaction(async (tx) => {
        await tx
          .update(verificationTokens)
          .set({ consumedAt: now })
          .where(and(eq(verificationTokens.credentialId, account.credentialId), eq(verificationTokens.purpose, "mfa_login"), isNull(verificationTokens.consumedAt)));
        await tx.insert(verificationTokens).values({
          credentialId: account.credentialId,
          purpose: "mfa_login",
          tokenHash: hashOpaqueToken(challengeToken),
          expiresAt,
        });
      });
      return { mfaRequired: true, challengeToken, expiresAt };
    }

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

  async completeTotpLogin(challengeToken: string, code: string): Promise<LoginResult> {
    const now = new Date();
    const outcome = await this.db.transaction(async (tx) => {
      const [record] = await tx
        .select({
          token: verificationTokens,
          credential: userCredentials,
          factor: userTotpFactors,
          user: users,
          membership: orgMemberships,
        })
        .from(verificationTokens)
        .innerJoin(userCredentials, eq(userCredentials.id, verificationTokens.credentialId))
        .innerJoin(users, eq(users.id, userCredentials.userId))
        .innerJoin(orgMemberships, eq(orgMemberships.userId, users.id))
        .innerJoin(userTotpFactors, eq(userTotpFactors.userId, users.id))
        .where(and(
          eq(verificationTokens.tokenHash, hashOpaqueToken(challengeToken)),
          eq(verificationTokens.purpose, "mfa_login"),
          isNull(verificationTokens.consumedAt),
          gt(verificationTokens.expiresAt, now),
          eq(users.status, "active"),
          eq(orgMemberships.status, "active"),
        ))
        .for("update")
        .limit(1);
      if (!record?.factor.enabledAt) throw new TotpCodeError();
      const secret = decryptTotpSecret(record.factor.secretCiphertext, this.sessionSecret);
      const counter = secret ? verifyTotp(secret, code, now) : null;
      if (counter === null || (record.factor.lastUsedCounter !== null && counter <= record.factor.lastUsedCounter)) throw new TotpCodeError();
      const token = createOpaqueToken();
      const expiresAt = new Date(now.getTime() + this.sessionTtlSeconds * 1_000);
      await tx.update(userTotpFactors).set({ lastUsedCounter: counter, updatedAt: now }).where(eq(userTotpFactors.userId, record.user.id));
      await tx.update(verificationTokens).set({ consumedAt: now }).where(eq(verificationTokens.id, record.token.id));
      await tx.insert(sessions).values({ userId: record.user.id, tokenHash: hashOpaqueToken(token), csrfSecretHash: hashOpaqueToken(createOpaqueToken()), expiresAt });
      await tx.insert(auditLogs).values({ organizationId: record.membership.organizationId, actorMembershipId: record.membership.id, action: "auth.totp_login_completed", entityType: "user", entityId: record.user.id });
      return {
        token,
        expiresAt,
        base: { userId: record.user.id, membershipId: record.membership.id, organizationId: record.membership.organizationId, displayName: record.user.displayName },
      };
    });
    return { token: outcome.token, expiresAt: outcome.expiresAt, context: await this.createContext(outcome.base) };
  }

  async getTotpStatus(userId: string) {
    const [factor] = await this.db.select({ enabledAt: userTotpFactors.enabledAt }).from(userTotpFactors).where(eq(userTotpFactors.userId, userId)).limit(1);
    return { enabled: Boolean(factor?.enabledAt), pending: Boolean(factor && !factor.enabledAt) };
  }

  /**
   * Re-establishes intent immediately before a high-risk action. A valid
   * session is not enough for an irreversible ownership change: password is
   * always required and an enabled TOTP factor is consumed as well.
   */
  async verifySensitiveAction(
    context: AuthContext,
    password: string,
    code?: string,
  ) {
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const [credential] = await tx
        .select({ passwordHash: userCredentials.passwordHash })
        .from(userCredentials)
        .where(eq(userCredentials.userId, context.userId))
        .for("update")
        .limit(1);
      if (!credential || !(await verifyPassword(credential.passwordHash, password))) {
        throw new InvalidCredentialsError();
      }

      const [factor] = await tx
        .select()
        .from(userTotpFactors)
        .where(eq(userTotpFactors.userId, context.userId))
        .for("update")
        .limit(1);
      if (factor?.enabledAt) {
        const secret = decryptTotpSecret(factor.secretCiphertext, this.sessionSecret);
        const counter = secret ? verifyTotp(secret, code ?? "", now) : null;
        if (
          counter === null ||
          (factor.lastUsedCounter !== null && counter <= factor.lastUsedCounter)
        ) {
          throw new TotpCodeError();
        }
        await tx
          .update(userTotpFactors)
          .set({ lastUsedCounter: counter, updatedAt: now })
          .where(eq(userTotpFactors.userId, context.userId));
      }

      await tx.insert(auditLogs).values({
        organizationId: context.organizationId,
        actorMembershipId: context.membershipId,
        action: "auth.sensitive_action_verified",
        entityType: "user",
        entityId: context.userId,
        after: { mfaVerified: Boolean(factor?.enabledAt) },
      });
      return { verifiedAt: now, mfaVerified: Boolean(factor?.enabledAt) };
    });
  }

  async beginTotpSetup(context: AuthContext) {
    const [existing] = await this.db.select({ enabledAt: userTotpFactors.enabledAt }).from(userTotpFactors).where(eq(userTotpFactors.userId, context.userId)).limit(1);
    if (existing?.enabledAt) throw new TotpSetupError("双因素认证已经启用。请先验证后再撤销。");
    const secret = createTotpSecret();
    const now = new Date();
    const values = { secretCiphertext: encryptTotpSecret(secret, this.sessionSecret), enabledAt: null, lastUsedCounter: null, updatedAt: now };
    if (existing) await this.db.update(userTotpFactors).set(values).where(eq(userTotpFactors.userId, context.userId));
    else await this.db.insert(userTotpFactors).values({ userId: context.userId, ...values });
    await this.db.insert(auditLogs).values({ organizationId: context.organizationId, actorMembershipId: context.membershipId, action: "auth.totp_setup_started", entityType: "user", entityId: context.userId });
    return { secret, otpauthUri: createTotpUri(secret, context.displayName) };
  }

  async confirmTotpSetup(context: AuthContext, code: string) {
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const [factor] = await tx.select().from(userTotpFactors).where(and(eq(userTotpFactors.userId, context.userId), isNull(userTotpFactors.enabledAt))).for("update").limit(1);
      const secret = factor ? decryptTotpSecret(factor.secretCiphertext, this.sessionSecret) : null;
      const counter = secret ? verifyTotp(secret, code, now) : null;
      if (counter === null) throw new TotpSetupError("动态验证码无效，请检查设备时间后重试。");
      await tx.update(userTotpFactors).set({ enabledAt: now, lastUsedCounter: counter, updatedAt: now }).where(eq(userTotpFactors.userId, context.userId));
      await tx.insert(auditLogs).values({ organizationId: context.organizationId, actorMembershipId: context.membershipId, action: "auth.totp_enabled", entityType: "user", entityId: context.userId });
      return { enabled: true };
    });
  }

  async disableTotp(context: AuthContext, password: string, code: string) {
    const [credential] = await this.db.select({ passwordHash: userCredentials.passwordHash }).from(userCredentials).where(eq(userCredentials.userId, context.userId)).limit(1);
    if (!credential || !(await verifyPassword(credential.passwordHash, password))) throw new InvalidCredentialsError();
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const [factor] = await tx.select().from(userTotpFactors).where(and(eq(userTotpFactors.userId, context.userId), sql`${userTotpFactors.enabledAt} is not null`)).for("update").limit(1);
      const secret = factor ? decryptTotpSecret(factor.secretCiphertext, this.sessionSecret) : null;
      if (!secret || verifyTotp(secret, code, now) === null) throw new TotpCodeError();
      await tx.delete(userTotpFactors).where(eq(userTotpFactors.userId, context.userId));
      await tx.insert(auditLogs).values({ organizationId: context.organizationId, actorMembershipId: context.membershipId, action: "auth.totp_disabled", entityType: "user", entityId: context.userId });
      return { enabled: false };
    });
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

  private async createContext(
    base: Omit<AuthContext, "grants" | "isOwner">,
  ): Promise<AuthContext> {
    const [rows, owners] = await Promise.all([
      this.db
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
        ),
      this.db
        .select({ membershipId: organizationOwners.membershipId })
        .from(organizationOwners)
        .where(
          and(
            eq(organizationOwners.organizationId, base.organizationId),
            eq(organizationOwners.membershipId, base.membershipId),
          ),
        )
        .limit(1),
    ]);

    const permissionSet = new Set<string>(permissions);
    const grants = rows
      .filter((row) => permissionSet.has(row.permission))
      .map((row) => ({
        permission: row.permission as Permission,
        scopeKind: row.scopeKind as ScopeKind,
        scopeId: row.scopeId,
      }));

    return { ...base, isOwner: Boolean(owners[0]), grants };
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
