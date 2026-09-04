import { and, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { Database } from "@workbench/db";
import {
  memberRoles,
  auditLogs,
  organizationOwners,
  organizations,
  orgMemberships,
  outboxEvents,
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
  maskCredentialIdentifier,
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
  timezone: string;
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

export interface CredentialSummary {
  id: string;
  kind: CredentialDeliveryKind;
  maskedIdentifier: string;
  verifiedAt: Date | null;
  createdAt: Date;
}

export interface CredentialBindingInput {
  kind: CredentialDeliveryKind;
  identifier: string;
  password: string;
  totpCode?: string | undefined;
}

export interface CredentialDelivery {
  credential: CredentialSummary;
  /** Internal-only: this is passed to the delivery provider and never serialized. */
  identifier: string;
  kind: CredentialDeliveryKind;
  token: string;
  expiresAt: Date;
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

export class CredentialBindingTokenError extends Error {
  constructor() {
    super("验证链接无效、已使用或已过期。请从账户安全页面重新发送。");
    this.name = "CredentialBindingTokenError";
  }
}

export class CredentialConflictError extends Error {
  constructor(message = "该邮箱或手机号无法绑定到当前账号。") {
    super(message);
    this.name = "CredentialConflictError";
  }
}

export class CredentialRemovalError extends Error {
  constructor(message = "至少保留一个已验证的邮箱或手机号，才能移除此联系方式。") {
    super(message);
    this.name = "CredentialRemovalError";
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
    private readonly credentialVerificationTtlSeconds: number,
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
    }).from(userCredentials).innerJoin(users, eq(users.id, userCredentials.userId)).innerJoin(orgMemberships, eq(orgMemberships.userId, users.id)).where(and(eq(userCredentials.normalizedIdentifier, normalizedIdentifier), isNotNull(userCredentials.verifiedAt))).limit(1);
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

  /**
   * Creates an Owner-authorized, one-time reset capability when an
   * organization intentionally does not configure email or SMS delivery.
   * The caller must have just completed sensitive-action verification; this
   * method still enforces organization ownership and never returns a contact
   * identifier, so the link can be manually relayed without broadening data
   * access.
   */
  async issueOwnerManagedPasswordResetLink(
    context: AuthContext,
    membershipId: string,
  ) {
    if (!context.isOwner) {
      throw new CredentialConflictError(
        "只有唯一 Owner 能为成员生成手工密码重置链接。",
      );
    }
    const token = createOpaqueToken();
    const expiresAt = new Date(
      Date.now() + this.passwordResetTtlSeconds * 1_000,
    );
    return this.db.transaction(async (tx) => {
      const [account] = await tx
        .select({
          membershipId: orgMemberships.id,
          userId: users.id,
          userStatus: users.status,
          membershipStatus: orgMemberships.status,
        })
        .from(orgMemberships)
        .innerJoin(users, eq(users.id, orgMemberships.userId))
        .where(
          and(
            eq(orgMemberships.id, membershipId),
            eq(orgMemberships.organizationId, context.organizationId),
          ),
        )
        .for("update")
        .limit(1);
      if (
        !account ||
        account.userStatus !== "active" ||
        account.membershipStatus !== "active"
      ) {
        throw new CredentialConflictError(
          "只能为当前组织中的在职成员生成密码重置链接。",
        );
      }
      const credentials = await tx
        .select({ id: userCredentials.id, kind: userCredentials.kind })
        .from(userCredentials)
        .where(
          and(
            eq(userCredentials.userId, account.userId),
            isNotNull(userCredentials.verifiedAt),
          ),
        )
        .for("update");
      if (!credentials.length) {
        throw new CredentialConflictError(
          "该成员尚无已验证的登录方式，不能生成密码重置链接。",
        );
      }
      // Prefer email when both contacts exist only to select the token owner;
      // completing a reset updates the shared password for every credential.
      const credential =
        credentials.find((item) => item.kind === "email") ?? credentials[0];
      if (!credential) {
        throw new CredentialConflictError(
          "该成员尚无可用于生成重置链接的登录方式。",
        );
      }
      const now = new Date();
      await tx
        .update(verificationTokens)
        .set({ consumedAt: now })
        .where(
          and(
            eq(verificationTokens.purpose, "password_reset"),
            isNull(verificationTokens.consumedAt),
            inArray(
              verificationTokens.credentialId,
              credentials.map((item) => item.id),
            ),
          ),
        );
      await tx.insert(verificationTokens).values({
        credentialId: credential.id,
        purpose: "password_reset",
        tokenHash: hashOpaqueToken(token),
        expiresAt,
      });
      await tx.insert(auditLogs).values({
        organizationId: context.organizationId,
        actorMembershipId: context.membershipId,
        action: "auth.password_reset_owner_link_issued",
        entityType: "org_membership",
        entityId: membershipId,
        after: { credentialKinds: credentials.map((item) => item.kind) },
      });
      return { token, expiresAt };
    });
  }

  async resetPassword(token: string, password: string) {
    const passwordHash = await hashPassword(password);
    return this.db.transaction(async (tx) => {
      const [record] = await tx.select({ token: verificationTokens, credential: userCredentials, membership: orgMemberships }).from(verificationTokens).innerJoin(userCredentials, eq(userCredentials.id, verificationTokens.credentialId)).innerJoin(orgMemberships, eq(orgMemberships.userId, userCredentials.userId)).where(and(eq(verificationTokens.tokenHash, hashOpaqueToken(token)), eq(verificationTokens.purpose, "password_reset"), isNull(verificationTokens.consumedAt), gt(verificationTokens.expiresAt, new Date()), isNotNull(userCredentials.verifiedAt), eq(orgMemberships.status, "active"))).for("update").limit(1);
      if (!record) throw new PasswordResetTokenError();
      const now = new Date();
      const accountCredentials = await tx
        .select({ id: userCredentials.id })
        .from(userCredentials)
        .where(eq(userCredentials.userId, record.credential.userId))
        .for("update");
      await tx.update(userCredentials).set({ passwordHash, passwordChangedAt: now, failedLoginAttempts: 0, lockedUntil: null, updatedAt: now }).where(eq(userCredentials.userId, record.credential.userId));
      await tx.update(verificationTokens).set({ consumedAt: now }).where(and(eq(verificationTokens.purpose, "password_reset"), isNull(verificationTokens.consumedAt), inArray(verificationTokens.credentialId, accountCredentials.map((credential) => credential.id))));
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
      .where(
        and(
          eq(userCredentials.normalizedIdentifier, normalizedIdentifier),
          isNotNull(userCredentials.verifiedAt),
        ),
      )
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

  async listCredentials(context: AuthContext) {
    const credentials = await this.db
      .select({
        id: userCredentials.id,
        kind: userCredentials.kind,
        normalizedIdentifier: userCredentials.normalizedIdentifier,
        verifiedAt: userCredentials.verifiedAt,
        createdAt: userCredentials.createdAt,
      })
      .from(userCredentials)
      .where(eq(userCredentials.userId, context.userId));
    return {
      credentials: credentials.map(toCredentialSummary),
      verifiedCount: credentials.filter((credential) => credential.verifiedAt !== null)
        .length,
    };
  }

  /**
   * A second login/recovery address is intentionally unavailable until its
   * owner follows a capability link delivered through that exact channel.
   * The current password (and TOTP, when enabled) establishes intent before
   * the new pending identifier is created.
   */
  async beginCredentialBinding(
    context: AuthContext,
    input: CredentialBindingInput,
  ): Promise<CredentialDelivery> {
    await this.verifySensitiveAction(context, input.password, input.totpCode);
    const normalizedIdentifier = normalizeLoginIdentifier(input.identifier);
    const now = new Date();
    const token = createOpaqueToken();
    const expiresAt = new Date(
      now.getTime() + this.credentialVerificationTtlSeconds * 1_000,
    );

    return this.db.transaction(async (tx) => {
      const [verifiedCredential] = await tx
        .select({ passwordHash: userCredentials.passwordHash })
        .from(userCredentials)
        .where(
          and(
            eq(userCredentials.userId, context.userId),
            isNotNull(userCredentials.verifiedAt),
          ),
        )
        .for("update")
        .limit(1);
      if (!verifiedCredential) {
        throw new CredentialConflictError(
          "当前账号没有可用的已验证联系方式，不能新增恢复方式。",
        );
      }

      const [existing] = await tx
        .select()
        .from(userCredentials)
        .where(eq(userCredentials.normalizedIdentifier, normalizedIdentifier))
        .for("update")
        .limit(1);

      let credential: typeof userCredentials.$inferSelect;
      if (existing) {
        if (existing.userId !== context.userId || existing.kind !== input.kind) {
          throw new CredentialConflictError("该邮箱或手机号已经绑定到其他账号。");
        }
        if (existing.verifiedAt) {
          throw new CredentialConflictError("该邮箱或手机号已经是当前账号的已验证联系方式。");
        }
        const [updated] = await tx
          .update(userCredentials)
          .set({
            passwordHash: verifiedCredential.passwordHash,
            passwordChangedAt: now,
            failedLoginAttempts: 0,
            lockedUntil: null,
            updatedAt: now,
          })
          .where(eq(userCredentials.id, existing.id))
          .returning();
        if (!updated) throw new Error("Failed to refresh pending credential");
        credential = updated;
      } else {
        const [created] = await tx
          .insert(userCredentials)
          .values({
            userId: context.userId,
            kind: input.kind,
            normalizedIdentifier,
            passwordHash: verifiedCredential.passwordHash,
          })
          .returning();
        if (!created) throw new Error("Failed to create pending credential");
        credential = created;
      }

      await tx
        .update(verificationTokens)
        .set({ consumedAt: now })
        .where(
          and(
            eq(verificationTokens.credentialId, credential.id),
            eq(verificationTokens.purpose, "credential_binding"),
            isNull(verificationTokens.consumedAt),
          ),
        );
      await tx.insert(verificationTokens).values({
        credentialId: credential.id,
        purpose: "credential_binding",
        tokenHash: hashOpaqueToken(token),
        expiresAt,
      });
      await tx.insert(auditLogs).values({
        organizationId: context.organizationId,
        actorMembershipId: context.membershipId,
        action: "auth.credential_binding_started",
        entityType: "user_credential",
        entityId: credential.id,
        after: {
          credentialKind: credential.kind,
          identifierHash: hashOpaqueToken(normalizedIdentifier),
          verificationExpiresAt: expiresAt.toISOString(),
        },
      });
      return {
        credential: toCredentialSummary(credential),
        identifier: credential.normalizedIdentifier,
        kind: credential.kind,
        token,
        expiresAt,
      };
    });
  }

  async resendCredentialBinding(
    context: AuthContext,
    credentialId: string,
    input: Pick<CredentialBindingInput, "password" | "totpCode">,
    assertDeliveryConfigured?: (kind: CredentialDeliveryKind) => void,
  ): Promise<CredentialDelivery> {
    // Check a known-missing provider before consuming a one-time TOTP code.
    // The identifier itself is never exposed, and the transaction below still
    // re-checks ownership/pending state before creating a new capability.
    if (assertDeliveryConfigured) {
      const [pendingCredential] = await this.db
        .select({ kind: userCredentials.kind })
        .from(userCredentials)
        .where(
          and(
            eq(userCredentials.id, credentialId),
            eq(userCredentials.userId, context.userId),
            isNull(userCredentials.verifiedAt),
          ),
        )
        .limit(1);
      if (!pendingCredential) {
        throw new CredentialConflictError(
          "只能重新发送当前账号中仍待验证的邮箱或手机号。",
        );
      }
      assertDeliveryConfigured(pendingCredential.kind);
    }
    await this.verifySensitiveAction(context, input.password, input.totpCode);
    const now = new Date();
    const token = createOpaqueToken();
    const expiresAt = new Date(
      now.getTime() + this.credentialVerificationTtlSeconds * 1_000,
    );
    return this.db.transaction(async (tx) => {
      const [credential] = await tx
        .select()
        .from(userCredentials)
        .where(
          and(
            eq(userCredentials.id, credentialId),
            eq(userCredentials.userId, context.userId),
            isNull(userCredentials.verifiedAt),
          ),
        )
        .for("update")
        .limit(1);
      if (!credential) {
        throw new CredentialConflictError(
          "只能重新发送当前账号中仍待验证的邮箱或手机号。",
        );
      }
      await tx
        .update(verificationTokens)
        .set({ consumedAt: now })
        .where(
          and(
            eq(verificationTokens.credentialId, credential.id),
            eq(verificationTokens.purpose, "credential_binding"),
            isNull(verificationTokens.consumedAt),
          ),
        );
      await tx.insert(verificationTokens).values({
        credentialId: credential.id,
        purpose: "credential_binding",
        tokenHash: hashOpaqueToken(token),
        expiresAt,
      });
      await tx.insert(auditLogs).values({
        organizationId: context.organizationId,
        actorMembershipId: context.membershipId,
        action: "auth.credential_binding_resent",
        entityType: "user_credential",
        entityId: credential.id,
        after: {
          credentialKind: credential.kind,
          identifierHash: hashOpaqueToken(credential.normalizedIdentifier),
          verificationExpiresAt: expiresAt.toISOString(),
        },
      });
      return {
        credential: toCredentialSummary(credential),
        identifier: credential.normalizedIdentifier,
        kind: credential.kind,
        token,
        expiresAt,
      };
    });
  }

  async confirmCredentialBinding(token: string) {
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const [record] = await tx
        .select({
          verification: verificationTokens,
          credential: userCredentials,
          membership: orgMemberships,
          user: users,
        })
        .from(verificationTokens)
        .innerJoin(
          userCredentials,
          eq(userCredentials.id, verificationTokens.credentialId),
        )
        .innerJoin(users, eq(users.id, userCredentials.userId))
        .innerJoin(orgMemberships, eq(orgMemberships.userId, users.id))
        .where(
          and(
            eq(verificationTokens.tokenHash, hashOpaqueToken(token)),
            eq(verificationTokens.purpose, "credential_binding"),
            isNull(verificationTokens.consumedAt),
            gt(verificationTokens.expiresAt, now),
            isNull(userCredentials.verifiedAt),
            eq(users.status, "active"),
            eq(orgMemberships.status, "active"),
          ),
        )
        .for("update")
        .limit(1);
      if (!record) throw new CredentialBindingTokenError();

      const [credential] = await tx
        .update(userCredentials)
        .set({ verifiedAt: now, failedLoginAttempts: 0, lockedUntil: null, updatedAt: now })
        .where(eq(userCredentials.id, record.credential.id))
        .returning();
      if (!credential) throw new Error("Failed to verify credential");
      await tx
        .update(verificationTokens)
        .set({ consumedAt: now })
        .where(
          and(
            eq(verificationTokens.credentialId, credential.id),
            eq(verificationTokens.purpose, "credential_binding"),
            isNull(verificationTokens.consumedAt),
          ),
        );
      await tx.insert(auditLogs).values({
        organizationId: record.membership.organizationId,
        actorMembershipId: record.membership.id,
        action: "auth.credential_binding_confirmed",
        entityType: "user_credential",
        entityId: credential.id,
        after: {
          credentialKind: credential.kind,
          identifierHash: hashOpaqueToken(credential.normalizedIdentifier),
        },
      });
      // The event contains no credential or identity data. It only prompts an
      // already authenticated device to refetch through its normal scoped API,
      // so a phone verified on one device is reflected on the owner's other
      // active devices without broadcasting the phone number to the company.
      await tx.insert(outboxEvents).values({
        organizationId: record.membership.organizationId,
        eventType: "auth.credential.verified",
        entityType: "user_credential",
        entityId: credential.id,
        entityVersion: 1,
        payload: {},
      });
      return { verified: true, credential: toCredentialSummary(credential) };
    });
  }

  async removeCredential(
    context: AuthContext,
    credentialId: string,
    input: Pick<CredentialBindingInput, "password" | "totpCode">,
  ) {
    await this.verifySensitiveAction(context, input.password, input.totpCode);
    const now = new Date();
    return this.db.transaction(async (tx) => {
      // Lock every verified identifier before counting. This prevents two
      // concurrent device sessions from each removing a different final
      // recovery method.
      const verifiedCredentials = await tx
        .select({ id: userCredentials.id })
        .from(userCredentials)
        .where(
          and(
            eq(userCredentials.userId, context.userId),
            isNotNull(userCredentials.verifiedAt),
          ),
        )
        .for("update");
      const [credential] = await tx
        .select()
        .from(userCredentials)
        .where(
          and(
            eq(userCredentials.id, credentialId),
            eq(userCredentials.userId, context.userId),
          ),
        )
        .for("update")
        .limit(1);
      if (!credential) {
        throw new CredentialConflictError("该邮箱或手机号不属于当前账号。");
      }
      if (credential.verifiedAt && verifiedCredentials.length <= 1) {
        throw new CredentialRemovalError();
      }
      await tx.delete(userCredentials).where(eq(userCredentials.id, credential.id));
      await tx.insert(auditLogs).values({
        organizationId: context.organizationId,
        actorMembershipId: context.membershipId,
        action: "auth.credential_removed",
        entityType: "user_credential",
        entityId: credential.id,
        before: {
          credentialKind: credential.kind,
          identifierHash: hashOpaqueToken(credential.normalizedIdentifier),
          verified: Boolean(credential.verifiedAt),
        },
        after: { removedAt: now.toISOString() },
      });
      return { removed: true };
    });
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
        .where(
          and(
            eq(userCredentials.userId, context.userId),
            isNotNull(userCredentials.verifiedAt),
          ),
        )
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
    const [credential] = await this.db.select({ passwordHash: userCredentials.passwordHash }).from(userCredentials).where(and(eq(userCredentials.userId, context.userId), isNotNull(userCredentials.verifiedAt))).limit(1);
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
    base: Omit<AuthContext, "grants" | "isOwner" | "timezone">,
  ): Promise<AuthContext> {
    const [rows, owners, organization] = await Promise.all([
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
      this.db
        .select({ timezone: organizations.timezone })
        .from(organizations)
        .where(eq(organizations.id, base.organizationId))
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

    return {
      ...base,
      timezone: organization[0]?.timezone ?? "Asia/Shanghai",
      isOwner: Boolean(owners[0]),
      grants,
    };
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

function toCredentialSummary(record: {
  id: string;
  kind: CredentialDeliveryKind;
  normalizedIdentifier: string;
  verifiedAt: Date | null;
  createdAt: Date;
}): CredentialSummary {
  return {
    id: record.id,
    kind: record.kind,
    maskedIdentifier: maskCredentialIdentifier(
      record.kind,
      record.normalizedIdentifier,
    ),
    verifiedAt: record.verifiedAt,
    createdAt: record.createdAt,
  };
}
