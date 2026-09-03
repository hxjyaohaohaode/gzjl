import { count, eq, or, sql } from "drizzle-orm";
import type { Database } from "@workbench/db";
import {
  accessRoles,
  auditLogs,
  memberRoles,
  organizationOwners,
  organizations,
  orgMemberships,
  permissionDefinitions,
  rolePermissions,
  userCredentials,
  users,
} from "@workbench/db/schema";
import { permissions } from "@workbench/shared";

import {
  hashOpaqueToken,
  hashPassword,
  normalizeLoginIdentifier,
} from "../auth/security.js";

export interface InitialOwnerInput {
  organizationName: string;
  displayName: string;
  email: string;
  phone?: string | undefined;
  password: string;
  timezone: string;
  requestId?: string;
  userAgent?: string;
}

export interface InitialOwnerResult {
  organizationId: string;
  userId: string;
  membershipId: string;
  phoneVerificationPending: boolean;
}

export class SetupAlreadyCompletedError extends Error {
  constructor() {
    super("系统已完成首次初始化；为保护唯一 Owner，不允许再次执行初始化。");
    this.name = "SetupAlreadyCompletedError";
  }
}

export class SetupService {
  constructor(private readonly db: Database) {}

  async isCompleted(): Promise<boolean> {
    const [result] = await this.db.select({ value: count() }).from(organizationOwners);
    return Number(result?.value ?? 0) > 0;
  }

  async createInitialOwner(input: InitialOwnerInput): Promise<InitialOwnerResult> {
    const passwordHash = await hashPassword(input.password);
    const normalizedEmail = normalizeLoginIdentifier(input.email);
    const normalizedPhone = input.phone
      ? normalizeLoginIdentifier(input.phone)
      : undefined;

    return this.db.transaction(async (tx) => {
      // Serializes every bootstrap attempt, including attempts from separate instances.
      await tx.execute(sql`select pg_advisory_xact_lock(908172635421)`);
      const [ownerCount] = await tx.select({ value: count() }).from(organizationOwners);
      if (Number(ownerCount?.value ?? 0) > 0) throw new SetupAlreadyCompletedError();

      const [existingCredential] = await tx
        .select({ id: userCredentials.id })
        .from(userCredentials)
        .where(
          normalizedPhone
            ? or(
                eq(userCredentials.normalizedIdentifier, normalizedEmail),
                eq(userCredentials.normalizedIdentifier, normalizedPhone),
              )
            : eq(userCredentials.normalizedIdentifier, normalizedEmail),
        )
        .limit(1);
      if (existingCredential) throw new SetupAlreadyCompletedError();

      const [organization] = await tx
        .insert(organizations)
        .values({
          name: input.organizationName,
          timezone: input.timezone,
          settings: {
            manualEntryLookbackDays: 7,
            concurrentPrimaryTimers: 1,
            defaultEvidenceVisibility: "management_only",
          },
        })
        .returning({ id: organizations.id });
      if (!organization) throw new Error("Failed to create organization");

      const [user] = await tx
        .insert(users)
        .values({
          displayName: input.displayName,
          locale: "zh-CN",
          timezone: input.timezone,
        })
        .returning({ id: users.id });
      if (!user) throw new Error("Failed to create owner user");

      await tx.insert(userCredentials).values({
        userId: user.id,
        kind: "email",
        normalizedIdentifier: normalizedEmail,
        passwordHash,
        verifiedAt: new Date(),
      });
      // Possession of the one-time setup secret establishes the bootstrap
      // email identity. A telephone number cannot be proven merely because it
      // was typed into this form, so it intentionally stays pending until the
      // Owner confirms the real SMS capability from Account Security.
      if (normalizedPhone) {
        await tx.insert(userCredentials).values({
          userId: user.id,
          kind: "phone",
          normalizedIdentifier: normalizedPhone,
          passwordHash,
        });
      }

      const [membership] = await tx
        .insert(orgMemberships)
        .values({
          organizationId: organization.id,
          userId: user.id,
          status: "active",
          positionTitle: "组织所有者",
          joinedAt: new Date(),
        })
        .returning({ id: orgMemberships.id });
      if (!membership) throw new Error("Failed to create owner membership");

      const [ownerRole] = await tx
        .insert(accessRoles)
        .values({
          organizationId: organization.id,
          name: "Owner",
          kind: "owner",
          description: "唯一组织所有者，拥有组织级完整权限",
          isSystem: true,
        })
        .returning({ id: accessRoles.id });
      if (!ownerRole) throw new Error("Failed to create owner role");

      await tx
        .insert(permissionDefinitions)
        .values(
          permissions.map((code) => ({
            code,
            description: code,
            sensitivity:
              code.startsWith("payroll") || code === "roles.manage" ? "high" : "normal",
          })),
        )
        .onConflictDoNothing();
      await tx.insert(rolePermissions).values(
        permissions.map((permissionCode) => ({
          roleId: ownerRole.id,
          permissionCode,
        })),
      );
      await tx.insert(memberRoles).values({
        membershipId: membership.id,
        roleId: ownerRole.id,
        scopeKind: "organization",
        scopeId: null,
        grantedBy: membership.id,
      });
      await tx.insert(organizationOwners).values({
        organizationId: organization.id,
        membershipId: membership.id,
      });
      await tx.insert(auditLogs).values({
        organizationId: organization.id,
        actorMembershipId: membership.id,
        action: "organization.initialized",
        entityType: "organization",
        entityId: organization.id,
        after: {
          organizationName: input.organizationName,
          ownerDisplayName: input.displayName,
          ownerEmailHash: hashOpaqueToken(normalizedEmail),
          phoneVerificationPending: Boolean(normalizedPhone),
        },
        reason: "initial_setup",
        requestId: input.requestId,
        userAgent: input.userAgent,
      });

      return {
        organizationId: organization.id,
        userId: user.id,
        membershipId: membership.id,
        phoneVerificationPending: Boolean(normalizedPhone),
      };
    });
  }
}
