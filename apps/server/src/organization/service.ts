import { and, asc, eq, gt, isNull } from "drizzle-orm";
import type { Database } from "@workbench/db";
import {
  accessRoles,
  auditLogs,
  memberRoles,
  organizations,
  orgMemberships,
  sessions,
  orgUnits,
  userCredentials,
  users,
  verificationTokens,
} from "@workbench/db/schema";

import { createOpaqueToken, hashOpaqueToken, hashPassword, normalizeLoginIdentifier } from "../auth/security.js";

export interface OrganizationActor { organizationId: string; membershipId: string }
export class OrganizationConflictError extends Error {
  constructor(message: string) { super(message); this.name = "OrganizationConflictError"; }
}

export class OrganizationService {
  constructor(private readonly db: Database) {}

  async overview(actor: OrganizationActor) {
    const [organization] = await this.db.select().from(organizations).where(eq(organizations.id, actor.organizationId)).limit(1);
    const units = await this.db.select().from(orgUnits).where(and(eq(orgUnits.organizationId, actor.organizationId), isNull(orgUnits.archivedAt))).orderBy(asc(orgUnits.sortOrder), asc(orgUnits.name));
    const members = await this.db
      .select({
        membership: orgMemberships,
        user: users,
        positionTitle: orgMemberships.positionTitle,
        unitName: orgUnits.name,
      })
      .from(orgMemberships)
      .innerJoin(users, eq(users.id, orgMemberships.userId))
      .leftJoin(orgUnits, eq(orgUnits.id, orgMemberships.orgUnitId))
      .where(eq(orgMemberships.organizationId, actor.organizationId))
      .orderBy(asc(users.displayName));
    const roles = await this.db.select().from(accessRoles).where(eq(accessRoles.organizationId, actor.organizationId)).orderBy(asc(accessRoles.name));
    return { organization, units, members, roles };
  }

  async createUnit(actor: OrganizationActor, input: { name: string; description?: string | undefined; parentId: string | null }) {
    if (input.parentId) {
      const [parent] = await this.db.select({ id: orgUnits.id }).from(orgUnits).where(and(eq(orgUnits.id, input.parentId), eq(orgUnits.organizationId, actor.organizationId), isNull(orgUnits.archivedAt))).limit(1);
      if (!parent) throw new OrganizationConflictError("父组织单元不存在。")
    }
    const [unit] = await this.db.insert(orgUnits).values({ organizationId: actor.organizationId, parentId: input.parentId, name: input.name, description: input.description }).returning();
    if (!unit) throw new Error("Failed to create organization unit");
    await this.db.insert(auditLogs).values({ organizationId: actor.organizationId, actorMembershipId: actor.membershipId, action: "org_unit.created", entityType: "org_unit", entityId: unit.id, after: unit });
    return unit;
  }

  async setMemberStatus(actor: OrganizationActor, membershipId: string, status: "active" | "inactive") {
    if (membershipId === actor.membershipId) throw new OrganizationConflictError("不能在当前会话中停用或恢复自己。");
    return this.db.transaction(async (tx) => {
      const [member] = await tx.select({ membership: orgMemberships, roleKind: accessRoles.kind }).from(orgMemberships).leftJoin(memberRoles, eq(memberRoles.membershipId, orgMemberships.id)).leftJoin(accessRoles, eq(accessRoles.id, memberRoles.roleId)).where(and(eq(orgMemberships.id, membershipId), eq(orgMemberships.organizationId, actor.organizationId))).for("update").limit(1);
      if (!member) throw new OrganizationConflictError("成员不存在或不属于当前组织。");
      if (member.roleKind === "owner") throw new OrganizationConflictError("Owner 不能在此处停用；请先完成所有权转移。");
      if (member.membership.status === status) return member.membership;
      const now = new Date();
      const [updated] = await tx.update(orgMemberships).set({ status, leftAt: status === "inactive" ? now : null, updatedAt: now }).where(eq(orgMemberships.id, membershipId)).returning();
      if (!updated) throw new OrganizationConflictError("成员状态更新失败。");
      if (status === "inactive") {
        await tx.update(sessions).set({ revokedAt: now, revokeReason: "membership_deactivated" }).where(and(eq(sessions.userId, member.membership.userId), isNull(sessions.revokedAt)));
      }
      await tx.insert(auditLogs).values({ organizationId: actor.organizationId, actorMembershipId: actor.membershipId, action: `member.${status === "inactive" ? "deactivated" : "reactivated"}`, entityType: "org_membership", entityId: membershipId, before: { status: member.membership.status }, after: { status } });
      return updated;
    });
  }

  async invite(actor: OrganizationActor, input: { displayName: string; email: string; positionTitle?: string | undefined; orgUnitId: string | null; roleId: string }) {
    const normalizedEmail = normalizeLoginIdentifier(input.email);
    const [existing] = await this.db.select({ id: userCredentials.id }).from(userCredentials).where(eq(userCredentials.normalizedIdentifier, normalizedEmail)).limit(1);
    if (existing) throw new OrganizationConflictError("该邮箱已经绑定账号。")
    const [role] = await this.db.select().from(accessRoles).where(and(eq(accessRoles.id, input.roleId), eq(accessRoles.organizationId, actor.organizationId))).limit(1);
    if (!role || role.kind === "owner") throw new OrganizationConflictError("邀请时不能授予 Owner；所有权必须走双向确认转移。")
    if (input.orgUnitId) {
      const [unit] = await this.db.select({ id: orgUnits.id }).from(orgUnits).where(and(eq(orgUnits.id, input.orgUnitId), eq(orgUnits.organizationId, actor.organizationId))).limit(1);
      if (!unit) throw new OrganizationConflictError("组织单元不存在。")
    }
    const invitationToken = createOpaqueToken();
    const unusablePasswordHash = await hashPassword(createOpaqueToken(48));
    const result = await this.db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({ displayName: input.displayName }).returning();
      if (!user) throw new Error("Failed to create invited user");
      const [credential] = await tx.insert(userCredentials).values({ userId: user.id, kind: "email", normalizedIdentifier: normalizedEmail, passwordHash: unusablePasswordHash }).returning();
      if (!credential) throw new Error("Failed to create invited credential");
      const [membership] = await tx.insert(orgMemberships).values({ organizationId: actor.organizationId, userId: user.id, orgUnitId: input.orgUnitId, status: "invited", positionTitle: input.positionTitle }).returning();
      if (!membership) throw new Error("Failed to create invited membership");
      await tx.insert(memberRoles).values({ membershipId: membership.id, roleId: role.id, scopeKind: role.kind === "member" ? "self" : input.orgUnitId ? "org_unit" : "organization", scopeId: role.kind === "member" ? membership.id : input.orgUnitId, grantedBy: actor.membershipId });
      await tx.insert(verificationTokens).values({ credentialId: credential.id, purpose: "invitation", tokenHash: hashOpaqueToken(invitationToken), expiresAt: new Date(Date.now() + 7 * 86_400_000) });
      await tx.insert(auditLogs).values({ organizationId: actor.organizationId, actorMembershipId: actor.membershipId, action: "member.invited", entityType: "org_membership", entityId: membership.id, after: { displayName: input.displayName, email: normalizedEmail, roleId: role.id, orgUnitId: input.orgUnitId } });
      return membership;
    });
    return { membership: result, invitationToken, expiresAt: new Date(Date.now() + 7 * 86_400_000) };
  }

  async acceptInvitation(token: string, password: string) {
    const tokenHash = hashOpaqueToken(token);
    const passwordHash = await hashPassword(password);
    return this.db.transaction(async (tx) => {
      const [record] = await tx
        .select({ verification: verificationTokens, credential: userCredentials, membership: orgMemberships })
        .from(verificationTokens)
        .innerJoin(userCredentials, eq(userCredentials.id, verificationTokens.credentialId))
        .innerJoin(orgMemberships, eq(orgMemberships.userId, userCredentials.userId))
        .where(and(eq(verificationTokens.tokenHash, tokenHash), eq(verificationTokens.purpose, "invitation"), isNull(verificationTokens.consumedAt), gt(verificationTokens.expiresAt, new Date()), eq(orgMemberships.status, "invited")))
        .for("update")
        .limit(1);
      if (!record) throw new OrganizationConflictError("邀请链接无效、已使用或已过期。")
      const now = new Date();
      await tx.update(userCredentials).set({ passwordHash, verifiedAt: now, passwordChangedAt: now, updatedAt: now }).where(eq(userCredentials.id, record.credential.id));
      const [membership] = await tx.update(orgMemberships).set({ status: "active", joinedAt: now, updatedAt: now }).where(eq(orgMemberships.id, record.membership.id)).returning();
      await tx.update(verificationTokens).set({ consumedAt: now }).where(eq(verificationTokens.id, record.verification.id));
      await tx.insert(auditLogs).values({ organizationId: record.membership.organizationId, actorMembershipId: record.membership.id, action: "member.invitation_accepted", entityType: "org_membership", entityId: record.membership.id });
      return membership;
    });
  }
}
