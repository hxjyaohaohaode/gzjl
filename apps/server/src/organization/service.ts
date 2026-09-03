import { and, asc, desc, eq, gt, inArray, isNull, ne, or } from "drizzle-orm";
import type { Database } from "@workbench/db";
import {
  accessRoles,
  auditLogs,
  identityChangeRequests,
  memberIdentities,
  memberRoles,
  organizations,
  organizationOwners,
  ownershipTransferEvents,
  orgMemberships,
  orgUnits,
  outboxEvents,
  permissionDefinitions,
  professionalIdentities,
  projects,
  rolePermissions,
  sessions,
  userCredentials,
  users,
  verificationTokens,
} from "@workbench/db/schema";
import { permissions, systemAccessRolePresets } from "@workbench/shared";

import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  normalizeLoginIdentifier,
} from "../auth/security.js";
import type {
  AuthMailer,
  CredentialDeliveryKind,
} from "../auth/mailer.js";

export interface OrganizationActor {
  organizationId: string;
  membershipId: string;
}

export class OrganizationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrganizationConflictError";
  }
}

type ScopeKind = "organization" | "org_unit" | "project" | "self";
export type InvitationDeliveryMode = "manual" | CredentialDeliveryKind;

interface InvitationInput {
  displayName: string;
  email?: string | undefined;
  phone?: string | undefined;
  deliveryMode: InvitationDeliveryMode;
  positionTitle?: string | undefined;
  orgUnitId: string | null;
  roleId?: string | undefined;
}

export class OrganizationService {
  constructor(
    private readonly db: Database,
    private readonly mailer: AuthMailer,
  ) {}

  /**
   * Build a reset URL only after AuthService has created a short-lived token
   * for an authorized Owner. The raw token is never persisted by this service.
   */
  passwordResetUrl(token: string): string {
    return this.mailer.passwordResetUrl(token);
  }

  /**
   * Organizations created before the system-role catalog existed can contain
   * only Owner. Owner may never be assigned through an invitation, which used
   * to leave the invite form with a required select and zero valid options.
   *
   * Reconcile this small, immutable catalog idempotently. Custom roles are
   * retained as-is; existing system roles only receive missing permissions.
   * The method is called before role-dependent reads and writes so an older
   * deployed organization repairs itself without a manual database operation.
   */
  private async ensureSystemAccessRoles(organizationId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .insert(permissionDefinitions)
        .values(
          permissions.map((code) => ({
            code,
            description: code,
            sensitivity:
              code.startsWith("payroll") || code === "roles.manage"
                ? "high"
                : "normal",
          })),
        )
        .onConflictDoNothing();

      const knownRoles = await tx
        .select()
        .from(accessRoles)
        .where(eq(accessRoles.organizationId, organizationId))
        .for("update");
      const roleByKind = new Map(
        knownRoles.map((role) => [role.kind, role]),
      );
      const usedNames = new Set(knownRoles.map((role) => role.name));

      for (const preset of systemAccessRolePresets) {
        if (roleByKind.has(preset.kind)) continue;

        let created = false;
        for (let suffix = 1; !created; suffix += 1) {
          const name =
            suffix === 1 ? preset.name : `${preset.name} (${suffix})`;
          if (usedNames.has(name)) continue;
          const [role] = await tx
            .insert(accessRoles)
            .values({
              organizationId,
              name,
              kind: preset.kind,
              description: preset.description,
              isSystem: true,
            })
            .onConflictDoNothing()
            .returning();
          if (role) {
            roleByKind.set(role.kind, role);
            usedNames.add(role.name);
            created = true;
            continue;
          }

          // Another request may have created the same role while this request
          // waited on the unique index. Re-read by kind before trying a safe
          // alternate name.
          const [concurrentRole] = await tx
            .select()
            .from(accessRoles)
            .where(
              and(
                eq(accessRoles.organizationId, organizationId),
                eq(accessRoles.kind, preset.kind),
              ),
            )
            .limit(1);
          if (concurrentRole) {
            roleByKind.set(concurrentRole.kind, concurrentRole);
            usedNames.add(concurrentRole.name);
            created = true;
          } else {
            usedNames.add(name);
          }
        }
        if (!roleByKind.has(preset.kind)) {
          throw new Error(`Unable to reconcile ${preset.kind} system role`);
        }
      }

      const permissionGrants = systemAccessRolePresets.flatMap((preset) => {
        const role = roleByKind.get(preset.kind);
        // A user-defined role whose kind pre-dates this catalog remains under
        // that owner's control. Only platform-owned roles are reconciled.
        if (!role?.isSystem) return [];
        return preset.permissions.map((permissionCode) => ({
          roleId: role.id,
          permissionCode,
        }));
      });
      if (permissionGrants.length) {
        await tx
          .insert(rolePermissions)
          .values(permissionGrants)
          .onConflictDoNothing();
      }
    });
  }

  async overview(actor: OrganizationActor) {
    await this.ensureSystemAccessRoles(actor.organizationId);
    const [organization] = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, actor.organizationId))
      .limit(1);
    const units = await this.db
      .select()
      .from(orgUnits)
      .where(
        and(
          eq(orgUnits.organizationId, actor.organizationId),
          isNull(orgUnits.archivedAt),
        ),
      )
      .orderBy(asc(orgUnits.sortOrder), asc(orgUnits.name));
    const memberRows = await this.db
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
    const roles = await this.db
      .select()
      .from(accessRoles)
      .where(eq(accessRoles.organizationId, actor.organizationId))
      .orderBy(asc(accessRoles.name));
    const identities = await this.db
      .select()
      .from(professionalIdentities)
      .where(
        and(
          eq(professionalIdentities.organizationId, actor.organizationId),
          isNull(professionalIdentities.archivedAt),
        ),
      )
      .orderBy(asc(professionalIdentities.name));
    const [owner] = await this.db
      .select()
      .from(organizationOwners)
      .where(eq(organizationOwners.organizationId, actor.organizationId))
      .limit(1);
    const [ownershipTransfer] = await this.db
      .select()
      .from(ownershipTransferEvents)
      .where(
        and(
          eq(ownershipTransferEvents.organizationId, actor.organizationId),
          eq(ownershipTransferEvents.status, "pending"),
        ),
      )
      .orderBy(desc(ownershipTransferEvents.requestedAt))
      .limit(1);
    const roleGrants = await this.db
      .select({
        membershipId: memberRoles.membershipId,
        roleId: accessRoles.id,
        roleName: accessRoles.name,
        roleKind: accessRoles.kind,
        scopeKind: memberRoles.scopeKind,
        scopeId: memberRoles.scopeId,
        expiresAt: memberRoles.expiresAt,
      })
      .from(memberRoles)
      .innerJoin(accessRoles, eq(accessRoles.id, memberRoles.roleId))
      .innerJoin(
        orgMemberships,
        eq(orgMemberships.id, memberRoles.membershipId),
      )
      .where(eq(orgMemberships.organizationId, actor.organizationId))
      .orderBy(asc(accessRoles.name));
    const identityGrants = await this.db
      .select({
        membershipId: memberIdentities.membershipId,
        identityId: professionalIdentities.id,
        identityName: professionalIdentities.name,
        source: memberIdentities.source,
        verifiedAt: memberIdentities.verifiedAt,
      })
      .from(memberIdentities)
      .innerJoin(
        professionalIdentities,
        eq(professionalIdentities.id, memberIdentities.identityId),
      )
      .innerJoin(
        orgMemberships,
        eq(orgMemberships.id, memberIdentities.membershipId),
      )
      .where(
        and(
          eq(orgMemberships.organizationId, actor.organizationId),
          isNull(professionalIdentities.archivedAt),
        ),
      )
      .orderBy(asc(professionalIdentities.name));

    const rolesByMembership = new Map<string, typeof roleGrants>();
    roleGrants.forEach((grant) =>
      rolesByMembership.set(grant.membershipId, [
        ...(rolesByMembership.get(grant.membershipId) ?? []),
        grant,
      ]),
    );
    const identitiesByMembership = new Map<string, typeof identityGrants>();
    identityGrants.forEach((grant) =>
      identitiesByMembership.set(grant.membershipId, [
        ...(identitiesByMembership.get(grant.membershipId) ?? []),
        grant,
      ]),
    );

    return {
      organization,
      units,
      roles,
      professionalIdentities: identities,
      ownerMembershipId: owner?.membershipId ?? null,
      ownershipTransfer: ownershipTransfer ?? null,
      members: memberRows.map((member) => ({
        ...member,
        isOwner: owner?.membershipId === member.membership.id,
        accessRoles: rolesByMembership.get(member.membership.id) ?? [],
        professionalIdentities:
          identitiesByMembership.get(member.membership.id) ?? [],
      })),
    };
  }

  async pendingOwnershipTransferForRecipient(actor: OrganizationActor) {
    const [transfer] = await this.db
      .select({
        id: ownershipTransferEvents.id,
        requestedAt: ownershipTransferEvents.requestedAt,
        fromDisplayName: users.displayName,
      })
      .from(ownershipTransferEvents)
      .innerJoin(
        orgMemberships,
        eq(orgMemberships.id, ownershipTransferEvents.fromMembershipId),
      )
      .innerJoin(users, eq(users.id, orgMemberships.userId))
      .where(
        and(
          eq(ownershipTransferEvents.organizationId, actor.organizationId),
          eq(ownershipTransferEvents.toMembershipId, actor.membershipId),
          eq(ownershipTransferEvents.status, "pending"),
        ),
      )
      .orderBy(desc(ownershipTransferEvents.requestedAt))
      .limit(1);
    return transfer ?? null;
  }

  async requestOwnershipTransfer(
    actor: OrganizationActor,
    toMembershipId: string,
  ) {
    if (toMembershipId === actor.membershipId) {
      throw new OrganizationConflictError(
        "不能将组织所有权转移给当前 Owner 自己。",
      );
    }
    return this.db.transaction(async (tx) => {
      const [owner] = await tx
        .select()
        .from(organizationOwners)
        .where(eq(organizationOwners.organizationId, actor.organizationId))
        .for("update")
        .limit(1);
      if (!owner || owner.membershipId !== actor.membershipId) {
        throw new OrganizationConflictError(
          "只有当前唯一 Owner 可以发起所有权转移。",
        );
      }
      const [target] = await tx
        .select()
        .from(orgMemberships)
        .where(
          and(
            eq(orgMemberships.id, toMembershipId),
            eq(orgMemberships.organizationId, actor.organizationId),
            eq(orgMemberships.status, "active"),
          ),
        )
        .for("update")
        .limit(1);
      if (!target) {
        throw new OrganizationConflictError(
          "新 Owner 必须是当前组织中的在职成员。",
        );
      }
      const [managerGrant] = await tx
        .select({ roleId: memberRoles.roleId })
        .from(memberRoles)
        .innerJoin(accessRoles, eq(accessRoles.id, memberRoles.roleId))
        .where(
          and(
            eq(memberRoles.membershipId, target.id),
            eq(memberRoles.scopeKind, "organization"),
            eq(accessRoles.kind, "manager"),
            or(
              isNull(memberRoles.expiresAt),
              gt(memberRoles.expiresAt, new Date()),
            ),
          ),
        )
        .limit(1);
      if (!managerGrant) {
        throw new OrganizationConflictError(
          "新 Owner 必须先是拥有组织级管理权限的在职 Manager。",
        );
      }
      const [pending] = await tx
        .select({ id: ownershipTransferEvents.id })
        .from(ownershipTransferEvents)
        .where(
          and(
            eq(ownershipTransferEvents.organizationId, actor.organizationId),
            eq(ownershipTransferEvents.status, "pending"),
          ),
        )
        .limit(1);
      if (pending) {
        throw new OrganizationConflictError(
          "当前已有一笔待确认的所有权转移，请先取消或由接收人完成确认。",
        );
      }
      const [event] = await tx
        .insert(ownershipTransferEvents)
        .values({
          organizationId: actor.organizationId,
          fromMembershipId: actor.membershipId,
          toMembershipId,
          metadata: { requiredRoleId: managerGrant.roleId },
        })
        .returning();
      if (!event) throw new Error("Failed to create ownership transfer event");
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "organization.ownership_transfer_requested",
        entityType: "ownership_transfer",
        entityId: event.id,
        after: { fromMembershipId: actor.membershipId, toMembershipId },
      });
      return event;
    });
  }

  async confirmOwnershipTransfer(actor: OrganizationActor, transferId: string) {
    return this.db.transaction(async (tx) => {
      const [event] = await tx
        .select()
        .from(ownershipTransferEvents)
        .where(
          and(
            eq(ownershipTransferEvents.id, transferId),
            eq(ownershipTransferEvents.organizationId, actor.organizationId),
            eq(ownershipTransferEvents.status, "pending"),
          ),
        )
        .for("update")
        .limit(1);
      if (!event || event.toMembershipId !== actor.membershipId) {
        throw new OrganizationConflictError(
          "该所有权转移不存在、已失效，或当前账号不是接收人。",
        );
      }
      const [owner] = await tx
        .select()
        .from(organizationOwners)
        .where(eq(organizationOwners.organizationId, actor.organizationId))
        .for("update")
        .limit(1);
      if (!owner || owner.membershipId !== event.fromMembershipId) {
        throw new OrganizationConflictError(
          "组织 Owner 已发生变化，当前转移请求已失效。",
        );
      }
      const [source] = await tx
        .select()
        .from(orgMemberships)
        .where(
          and(
            eq(orgMemberships.id, event.fromMembershipId),
            eq(orgMemberships.organizationId, actor.organizationId),
            eq(orgMemberships.status, "active"),
          ),
        )
        .for("update")
        .limit(1);
      const [target] = await tx
        .select()
        .from(orgMemberships)
        .where(
          and(
            eq(orgMemberships.id, event.toMembershipId),
            eq(orgMemberships.organizationId, actor.organizationId),
            eq(orgMemberships.status, "active"),
          ),
        )
        .for("update")
        .limit(1);
      if (!source || !target) {
        throw new OrganizationConflictError(
          "转移双方必须仍是当前组织中的在职成员。",
        );
      }
      const [managerGrant] = await tx
        .select({ roleId: memberRoles.roleId })
        .from(memberRoles)
        .innerJoin(accessRoles, eq(accessRoles.id, memberRoles.roleId))
        .where(
          and(
            eq(memberRoles.membershipId, target.id),
            eq(memberRoles.scopeKind, "organization"),
            eq(accessRoles.kind, "manager"),
            or(
              isNull(memberRoles.expiresAt),
              gt(memberRoles.expiresAt, new Date()),
            ),
          ),
        )
        .limit(1);
      if (!managerGrant) {
        throw new OrganizationConflictError(
          "接收人已不具备组织级 Manager 权限，不能确认所有权转移。",
        );
      }
      const [ownerRole] = await tx
        .select({ id: accessRoles.id })
        .from(accessRoles)
        .where(
          and(
            eq(accessRoles.organizationId, actor.organizationId),
            eq(accessRoles.kind, "owner"),
          ),
        )
        .limit(1);
      if (!ownerRole) {
        throw new OrganizationConflictError(
          "组织缺少 Owner 角色配置，不能安全完成所有权转移。",
        );
      }
      const [sourceManagerGrant] = await tx
        .select({ id: memberRoles.id })
        .from(memberRoles)
        .where(
          and(
            eq(memberRoles.membershipId, source.id),
            eq(memberRoles.roleId, managerGrant.roleId),
            eq(memberRoles.scopeKind, "organization"),
          ),
        )
        .limit(1);
      await tx
        .delete(memberRoles)
        .where(
          and(
            eq(memberRoles.membershipId, source.id),
            eq(memberRoles.roleId, ownerRole.id),
          ),
        );
      await tx
        .delete(memberRoles)
        .where(
          and(
            eq(memberRoles.membershipId, target.id),
            eq(memberRoles.roleId, ownerRole.id),
          ),
        );
      if (!sourceManagerGrant) {
        await tx.insert(memberRoles).values({
          membershipId: source.id,
          roleId: managerGrant.roleId,
          scopeKind: "organization",
          scopeId: null,
          grantedBy: actor.membershipId,
        });
      }
      await tx.insert(memberRoles).values({
        membershipId: target.id,
        roleId: ownerRole.id,
        scopeKind: "organization",
        scopeId: null,
        grantedBy: actor.membershipId,
      });
      const now = new Date();
      await tx
        .update(organizationOwners)
        .set({ membershipId: target.id, assignedAt: now })
        .where(eq(organizationOwners.organizationId, actor.organizationId));
      const [confirmed] = await tx
        .update(ownershipTransferEvents)
        .set({ status: "approved", confirmedAt: now })
        .where(eq(ownershipTransferEvents.id, event.id))
        .returning();
      if (!confirmed)
        throw new Error("Failed to confirm ownership transfer event");
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "organization.ownership_transferred",
        entityType: "ownership_transfer",
        entityId: event.id,
        before: { ownerMembershipId: source.id },
        after: {
          ownerMembershipId: target.id,
          formerOwnerGrantedManager: !sourceManagerGrant,
        },
      });
      return confirmed;
    });
  }

  async cancelOwnershipTransfer(actor: OrganizationActor, transferId: string) {
    return this.db.transaction(async (tx) => {
      const [event] = await tx
        .select()
        .from(ownershipTransferEvents)
        .where(
          and(
            eq(ownershipTransferEvents.id, transferId),
            eq(ownershipTransferEvents.organizationId, actor.organizationId),
            eq(ownershipTransferEvents.status, "pending"),
          ),
        )
        .for("update")
        .limit(1);
      if (
        !event ||
        (event.fromMembershipId !== actor.membershipId &&
          event.toMembershipId !== actor.membershipId)
      ) {
        throw new OrganizationConflictError(
          "该所有权转移不存在、已处理，或当前账号无权取消。",
        );
      }
      const now = new Date();
      const [cancelled] = await tx
        .update(ownershipTransferEvents)
        .set({
          status: "cancelled",
          cancelledAt: now,
          metadata: { cancelledBy: actor.membershipId },
        })
        .where(eq(ownershipTransferEvents.id, event.id))
        .returning();
      if (!cancelled)
        throw new Error("Failed to cancel ownership transfer event");
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "organization.ownership_transfer_cancelled",
        entityType: "ownership_transfer",
        entityId: event.id,
        before: {
          fromMembershipId: event.fromMembershipId,
          toMembershipId: event.toMembershipId,
        },
        after: { cancelledBy: actor.membershipId },
      });
      return cancelled;
    });
  }

  async createUnit(
    actor: OrganizationActor,
    input: {
      name: string;
      description?: string | undefined;
      parentId: string | null;
      leaderMembershipId?: string | null | undefined;
    },
  ) {
    await this.assertUnitParent(actor.organizationId, null, input.parentId);
    await this.assertMember(
      actor.organizationId,
      input.leaderMembershipId ?? null,
    );
    const [unit] = await this.db
      .insert(orgUnits)
      .values({
        organizationId: actor.organizationId,
        parentId: input.parentId,
        name: input.name,
        description: input.description,
        leaderMembershipId: input.leaderMembershipId ?? null,
      })
      .returning();
    if (!unit) throw new Error("Failed to create organization unit");
    await this.db.insert(auditLogs).values({
      organizationId: actor.organizationId,
      actorMembershipId: actor.membershipId,
      action: "org_unit.created",
      entityType: "org_unit",
      entityId: unit.id,
      after: unit,
    });
    return unit;
  }

  async updateUnit(
    actor: OrganizationActor,
    unitId: string,
    expectedVersion: number,
    input: {
      name?: string | undefined;
      description?: string | null | undefined;
      parentId?: string | null | undefined;
      leaderMembershipId?: string | null | undefined;
    },
  ) {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(orgUnits)
        .where(
          and(
            eq(orgUnits.id, unitId),
            eq(orgUnits.organizationId, actor.organizationId),
            isNull(orgUnits.archivedAt),
          ),
        )
        .for("update")
        .limit(1);
      if (!current || current.version !== expectedVersion)
        throw new OrganizationConflictError(
          "组织单元已被更新、归档或不存在，请刷新后重试。",
        );
      const parentId =
        input.parentId === undefined ? current.parentId : input.parentId;
      const leaderMembershipId =
        input.leaderMembershipId === undefined
          ? current.leaderMembershipId
          : input.leaderMembershipId;
      await this.assertUnitParent(actor.organizationId, unitId, parentId);
      await this.assertMember(actor.organizationId, leaderMembershipId);
      const [updated] = await tx
        .update(orgUnits)
        .set({
          name: input.name ?? current.name,
          description:
            input.description === undefined
              ? current.description
              : input.description,
          parentId,
          leaderMembershipId,
          version: current.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(eq(orgUnits.id, unitId), eq(orgUnits.version, expectedVersion)),
        )
        .returning();
      if (!updated)
        throw new OrganizationConflictError(
          "组织单元已被其他成员更新，请刷新后重试。",
        );
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "org_unit.updated",
        entityType: "org_unit",
        entityId: unitId,
        before: current,
        after: updated,
      });
      return updated;
    });
  }

  async archiveUnit(
    actor: OrganizationActor,
    unitId: string,
    expectedVersion: number,
  ) {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(orgUnits)
        .where(
          and(
            eq(orgUnits.id, unitId),
            eq(orgUnits.organizationId, actor.organizationId),
            isNull(orgUnits.archivedAt),
          ),
        )
        .for("update")
        .limit(1);
      if (!current || current.version !== expectedVersion)
        throw new OrganizationConflictError(
          "组织单元已被更新、归档或不存在，请刷新后重试。",
        );
      const [child] = await tx
        .select({ id: orgUnits.id })
        .from(orgUnits)
        .where(and(eq(orgUnits.parentId, unitId), isNull(orgUnits.archivedAt)))
        .limit(1);
      if (child)
        throw new OrganizationConflictError(
          "请先移动或归档子组织单元，再归档当前单元。",
        );
      const [member] = await tx
        .select({ id: orgMemberships.id })
        .from(orgMemberships)
        .where(
          and(
            eq(orgMemberships.organizationId, actor.organizationId),
            eq(orgMemberships.orgUnitId, unitId),
            ne(orgMemberships.status, "inactive"),
          ),
        )
        .limit(1);
      if (member)
        throw new OrganizationConflictError(
          "请先将该组织单元中的成员移动到其他单元，再归档。",
        );
      const now = new Date();
      const [updated] = await tx
        .update(orgUnits)
        .set({ archivedAt: now, version: current.version + 1, updatedAt: now })
        .where(
          and(eq(orgUnits.id, unitId), eq(orgUnits.version, expectedVersion)),
        )
        .returning();
      if (!updated)
        throw new OrganizationConflictError(
          "组织单元已被其他成员更新，请刷新后重试。",
        );
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "org_unit.archived",
        entityType: "org_unit",
        entityId: unitId,
        before: current,
        after: updated,
      });
      return updated;
    });
  }

  async updateMember(
    actor: OrganizationActor,
    membershipId: string,
    input: {
      positionTitle?: string | null | undefined;
      orgUnitId?: string | null | undefined;
    },
  ) {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(orgMemberships)
        .where(
          and(
            eq(orgMemberships.id, membershipId),
            eq(orgMemberships.organizationId, actor.organizationId),
          ),
        )
        .for("update")
        .limit(1);
      if (!current)
        throw new OrganizationConflictError("成员不存在或不属于当前组织。");
      const orgUnitId =
        input.orgUnitId === undefined ? current.orgUnitId : input.orgUnitId;
      if (orgUnitId) {
        const [unit] = await tx
          .select({ id: orgUnits.id })
          .from(orgUnits)
          .where(
            and(
              eq(orgUnits.id, orgUnitId),
              eq(orgUnits.organizationId, actor.organizationId),
              isNull(orgUnits.archivedAt),
            ),
          )
          .limit(1);
        if (!unit)
          throw new OrganizationConflictError("目标组织单元不存在或已归档。");
      }
      const [updated] = await tx
        .update(orgMemberships)
        .set({
          positionTitle:
            input.positionTitle === undefined
              ? current.positionTitle
              : input.positionTitle,
          orgUnitId,
          updatedAt: new Date(),
        })
        .where(eq(orgMemberships.id, membershipId))
        .returning();
      if (!updated) throw new OrganizationConflictError("成员信息更新失败。");
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "member.profile_updated",
        entityType: "org_membership",
        entityId: membershipId,
        before: current,
        after: updated,
      });
      return updated;
    });
  }

  async replaceMemberRoles(
    actor: OrganizationActor,
    membershipId: string,
    grants: Array<{
      roleId: string;
      scopeKind: ScopeKind;
      scopeId: string | null;
    }>,
  ) {
    await this.ensureSystemAccessRoles(actor.organizationId);
    if (membershipId === actor.membershipId)
      throw new OrganizationConflictError(
        "为避免误锁定当前会话，请由另一位有管理权限的成员调整自己的访问角色。",
      );
    return this.db.transaction(async (tx) => {
      const [member] = await tx
        .select()
        .from(orgMemberships)
        .where(
          and(
            eq(orgMemberships.id, membershipId),
            eq(orgMemberships.organizationId, actor.organizationId),
          ),
        )
        .for("update")
        .limit(1);
      if (!member)
        throw new OrganizationConflictError("成员不存在或不属于当前组织。");
      const [owner] = await tx
        .select({ membershipId: organizationOwners.membershipId })
        .from(organizationOwners)
        .where(
          and(
            eq(organizationOwners.organizationId, actor.organizationId),
            eq(organizationOwners.membershipId, membershipId),
          ),
        )
        .limit(1);
      if (owner)
        throw new OrganizationConflictError(
          "Owner 的权限不能在成员面板直接修改；请使用双向确认的所有权转移流程。",
        );
      const allRoles = await tx
        .select()
        .from(accessRoles)
        .where(eq(accessRoles.organizationId, actor.organizationId));
      const roleById = new Map(allRoles.map((role) => [role.id, role]));
      const seen = new Set<string>();
      for (const grant of grants) {
        const role = roleById.get(grant.roleId);
        if (!role || role.kind === "owner")
          throw new OrganizationConflictError(
            "访问角色不存在，或 Owner 角色只能通过所有权转移授予。",
          );
        const key = `${grant.roleId}:${grant.scopeKind}:${grant.scopeId ?? ""}`;
        if (seen.has(key))
          throw new OrganizationConflictError("同一角色和范围不能重复授予。");
        seen.add(key);
        if (role.kind === "member" && grant.scopeKind !== "self")
          throw new OrganizationConflictError(
            "Member 访问角色只能在本人范围内授予。",
          );
        if (grant.scopeKind === "organization" && grant.scopeId !== null)
          throw new OrganizationConflictError(
            "组织范围的角色不应携带范围 ID。",
          );
        if (grant.scopeKind === "self" && grant.scopeId !== membershipId)
          throw new OrganizationConflictError("本人范围必须指向被授权的成员。");
        if (grant.scopeKind === "org_unit") {
          if (!grant.scopeId)
            throw new OrganizationConflictError(
              "组织单元范围必须选择一个组织单元。",
            );
          const [unit] = await tx
            .select({ id: orgUnits.id })
            .from(orgUnits)
            .where(
              and(
                eq(orgUnits.id, grant.scopeId),
                eq(orgUnits.organizationId, actor.organizationId),
                isNull(orgUnits.archivedAt),
              ),
            )
            .limit(1);
          if (!unit)
            throw new OrganizationConflictError(
              "访问角色的组织单元范围不存在或已归档。",
            );
        }
        if (grant.scopeKind === "project") {
          if (!grant.scopeId)
            throw new OrganizationConflictError("项目范围必须选择一个项目。");
          const [project] = await tx
            .select({ id: projects.id })
            .from(projects)
            .where(
              and(
                eq(projects.id, grant.scopeId),
                eq(projects.organizationId, actor.organizationId),
                isNull(projects.deletedAt),
              ),
            )
            .limit(1);
          if (!project)
            throw new OrganizationConflictError(
              "访问角色的项目范围不存在或已删除。",
            );
        }
      }
      const before = await tx
        .select()
        .from(memberRoles)
        .where(eq(memberRoles.membershipId, membershipId));
      await tx
        .delete(memberRoles)
        .where(eq(memberRoles.membershipId, membershipId));
      if (grants.length)
        await tx.insert(memberRoles).values(
          grants.map((grant) => ({
            membershipId,
            roleId: grant.roleId,
            scopeKind: grant.scopeKind,
            scopeId: grant.scopeKind === "self" ? membershipId : grant.scopeId,
            grantedBy: actor.membershipId,
          })),
        );
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "member.roles_replaced",
        entityType: "org_membership",
        entityId: membershipId,
        before,
        after: grants,
      });
      return true;
    });
  }

  async createProfessionalIdentity(
    actor: OrganizationActor,
    input: { name: string; description?: string | undefined },
  ) {
    const normalizedName = input.name.trim().toLocaleLowerCase();
    const [existing] = await this.db
      .select({ id: professionalIdentities.id })
      .from(professionalIdentities)
      .where(
        and(
          eq(professionalIdentities.organizationId, actor.organizationId),
          eq(professionalIdentities.normalizedName, normalizedName),
        ),
      )
      .limit(1);
    if (existing)
      throw new OrganizationConflictError(
        "同名专业身份已存在；请直接为成员分配已有身份。",
      );
    const [identity] = await this.db
      .insert(professionalIdentities)
      .values({
        organizationId: actor.organizationId,
        name: input.name.trim(),
        normalizedName,
        description: input.description,
        isCustom: true,
      })
      .returning();
    if (!identity) throw new Error("Failed to create professional identity");
    await this.db.insert(auditLogs).values({
      organizationId: actor.organizationId,
      actorMembershipId: actor.membershipId,
      action: "professional_identity.created",
      entityType: "professional_identity",
      entityId: identity.id,
      after: identity,
    });
    return identity;
  }

  async myIdentityProfile(actor: OrganizationActor) {
    const [membership] = await this.db
      .select({ id: orgMemberships.id })
      .from(orgMemberships)
      .where(
        and(
          eq(orgMemberships.id, actor.membershipId),
          eq(orgMemberships.organizationId, actor.organizationId),
          eq(orgMemberships.status, "active"),
        ),
      )
      .limit(1);
    if (!membership)
      throw new OrganizationConflictError("当前成员身份已失效。");
    const [identities, availableIdentities, requests] = await Promise.all([
      this.db
        .select({
          identityId: professionalIdentities.id,
          identityName: professionalIdentities.name,
          description: professionalIdentities.description,
          source: memberIdentities.source,
          verifiedAt: memberIdentities.verifiedAt,
        })
        .from(memberIdentities)
        .innerJoin(
          professionalIdentities,
          eq(professionalIdentities.id, memberIdentities.identityId),
        )
        .where(eq(memberIdentities.membershipId, actor.membershipId))
        .orderBy(asc(professionalIdentities.name)),
      this.db
        .select({
          id: professionalIdentities.id,
          name: professionalIdentities.name,
          description: professionalIdentities.description,
        })
        .from(professionalIdentities)
        .where(
          and(
            eq(professionalIdentities.organizationId, actor.organizationId),
            isNull(professionalIdentities.archivedAt),
          ),
        )
        .orderBy(asc(professionalIdentities.name)),
      this.db
        .select({
          id: identityChangeRequests.id,
          action: identityChangeRequests.action,
          requestedName: identityChangeRequests.requestedName,
          requestedIdentityId: identityChangeRequests.requestedIdentityId,
          reason: identityChangeRequests.reason,
          status: identityChangeRequests.status,
          reviewNote: identityChangeRequests.reviewNote,
          createdAt: identityChangeRequests.createdAt,
          reviewedAt: identityChangeRequests.reviewedAt,
        })
        .from(identityChangeRequests)
        .where(eq(identityChangeRequests.membershipId, actor.membershipId))
        .orderBy(desc(identityChangeRequests.createdAt))
        .limit(30),
    ]);
    return { identities, availableIdentities, requests };
  }

  async identityChangeRequests(actor: OrganizationActor) {
    return this.db
      .select({
        id: identityChangeRequests.id,
        membershipId: identityChangeRequests.membershipId,
        memberName: users.displayName,
        action: identityChangeRequests.action,
        requestedName: identityChangeRequests.requestedName,
        requestedIdentityId: identityChangeRequests.requestedIdentityId,
        reason: identityChangeRequests.reason,
        status: identityChangeRequests.status,
        reviewNote: identityChangeRequests.reviewNote,
        createdAt: identityChangeRequests.createdAt,
      })
      .from(identityChangeRequests)
      .innerJoin(
        orgMemberships,
        eq(orgMemberships.id, identityChangeRequests.membershipId),
      )
      .innerJoin(users, eq(users.id, orgMemberships.userId))
      .where(
        and(
          eq(orgMemberships.organizationId, actor.organizationId),
          eq(identityChangeRequests.status, "pending"),
        ),
      )
      .orderBy(desc(identityChangeRequests.createdAt))
      .limit(100);
  }

  async requestIdentityChange(
    actor: OrganizationActor,
    input: {
      action: "add" | "remove";
      identityId?: string | undefined;
      requestedName?: string | undefined;
      reason?: string | undefined;
    },
  ) {
    const customName = input.requestedName?.trim();
    if (input.action === "add" && !input.identityId && !customName) {
      throw new OrganizationConflictError(
        "请选择已有身份，或填写希望新增的专业身份名称。",
      );
    }
    if (input.action === "remove" && !input.identityId) {
      throw new OrganizationConflictError("移除申请必须明确对应的专业身份。");
    }
    return this.db.transaction(async (tx) => {
      const [member] = await tx
        .select({ id: orgMemberships.id })
        .from(orgMemberships)
        .where(
          and(
            eq(orgMemberships.id, actor.membershipId),
            eq(orgMemberships.organizationId, actor.organizationId),
            eq(orgMemberships.status, "active"),
          ),
        )
        .for("update")
        .limit(1);
      if (!member) throw new OrganizationConflictError("当前成员身份已失效。");

      let identityId = input.identityId;
      let requestedName = customName;
      if (identityId) {
        const [identity] = await tx
          .select({
            id: professionalIdentities.id,
            name: professionalIdentities.name,
          })
          .from(professionalIdentities)
          .where(
            and(
              eq(professionalIdentities.id, identityId),
              eq(professionalIdentities.organizationId, actor.organizationId),
              isNull(professionalIdentities.archivedAt),
            ),
          )
          .limit(1);
        if (!identity) {
          throw new OrganizationConflictError(
            "专业身份不存在、已归档或不属于当前组织。",
          );
        }
        requestedName = identity.name;
      } else if (customName) {
        const [existingIdentity] = await tx
          .select({
            id: professionalIdentities.id,
            name: professionalIdentities.name,
          })
          .from(professionalIdentities)
          .where(
            and(
              eq(professionalIdentities.organizationId, actor.organizationId),
              eq(
                professionalIdentities.normalizedName,
                customName.toLocaleLowerCase(),
              ),
              isNull(professionalIdentities.archivedAt),
            ),
          )
          .limit(1);
        if (existingIdentity) {
          identityId = existingIdentity.id;
          requestedName = existingIdentity.name;
        }
      }
      if (!requestedName) {
        throw new OrganizationConflictError("无法确认申请的专业身份名称。");
      }

      const [assigned] = identityId
        ? await tx
            .select({ id: memberIdentities.id })
            .from(memberIdentities)
            .where(
              and(
                eq(memberIdentities.membershipId, actor.membershipId),
                eq(memberIdentities.identityId, identityId),
              ),
            )
            .limit(1)
        : [undefined];
      if (input.action === "add" && assigned) {
        throw new OrganizationConflictError("该专业身份已经在你的身份列表中。");
      }
      if (input.action === "remove" && !assigned) {
        throw new OrganizationConflictError("该专业身份当前并未分配给你。");
      }
      const [pending] = await tx
        .select({ id: identityChangeRequests.id })
        .from(identityChangeRequests)
        .where(
          and(
            eq(identityChangeRequests.membershipId, actor.membershipId),
            eq(identityChangeRequests.action, input.action),
            eq(identityChangeRequests.requestedName, requestedName),
            eq(identityChangeRequests.status, "pending"),
          ),
        )
        .limit(1);
      if (pending) {
        throw new OrganizationConflictError(
          "该专业身份已有一笔待审核的相同申请。",
        );
      }
      const [request] = await tx
        .insert(identityChangeRequests)
        .values({
          membershipId: actor.membershipId,
          requestedName,
          requestedIdentityId: identityId,
          action: input.action,
          reason: input.reason?.trim() || null,
        })
        .returning();
      if (!request) throw new Error("Failed to create identity change request");
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "member.identity_change_requested",
        entityType: "identity_change_request",
        entityId: request.id,
        after: request,
      });
      return request;
    });
  }

  async reviewIdentityChange(
    actor: OrganizationActor,
    requestId: string,
    input: {
      decision: "approved" | "rejected";
      reviewNote?: string | undefined;
    },
  ) {
    return this.db.transaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(identityChangeRequests)
        .where(eq(identityChangeRequests.id, requestId))
        .for("update")
        .limit(1);
      if (!request || request.status !== "pending") {
        throw new OrganizationConflictError("该身份申请不存在或已经处理。");
      }
      const [member] = await tx
        .select({ id: orgMemberships.id })
        .from(orgMemberships)
        .where(
          and(
            eq(orgMemberships.id, request.membershipId),
            eq(orgMemberships.organizationId, actor.organizationId),
          ),
        )
        .limit(1);
      if (!member) {
        throw new OrganizationConflictError("申请人不属于当前组织。");
      }

      if (input.decision === "approved") {
        if (request.action === "add") {
          let identityId = request.requestedIdentityId;
          if (!identityId) {
            const normalizedName = request.requestedName.toLocaleLowerCase();
            const [existingIdentity] = await tx
              .select({ id: professionalIdentities.id })
              .from(professionalIdentities)
              .where(
                and(
                  eq(
                    professionalIdentities.organizationId,
                    actor.organizationId,
                  ),
                  eq(professionalIdentities.normalizedName, normalizedName),
                  isNull(professionalIdentities.archivedAt),
                ),
              )
              .limit(1);
            if (existingIdentity) {
              identityId = existingIdentity.id;
            } else {
              const [createdIdentity] = await tx
                .insert(professionalIdentities)
                .values({
                  organizationId: actor.organizationId,
                  name: request.requestedName,
                  normalizedName,
                  isCustom: true,
                })
                .returning();
              if (!createdIdentity)
                throw new Error(
                  "Failed to create requested professional identity",
                );
              identityId = createdIdentity.id;
            }
          }
          await tx
            .insert(memberIdentities)
            .values({
              membershipId: request.membershipId,
              identityId,
              source: "self_declared",
              verifiedAt: new Date(),
            })
            .onConflictDoNothing();
        } else if (request.action === "remove" && request.requestedIdentityId) {
          await tx
            .delete(memberIdentities)
            .where(
              and(
                eq(memberIdentities.membershipId, request.membershipId),
                eq(memberIdentities.identityId, request.requestedIdentityId),
              ),
            );
        } else {
          throw new OrganizationConflictError("该身份申请的操作类型无效。");
        }
      }
      const now = new Date();
      const [reviewed] = await tx
        .update(identityChangeRequests)
        .set({
          status: input.decision,
          reviewedBy: actor.membershipId,
          reviewedAt: now,
          reviewNote: input.reviewNote?.trim() || null,
        })
        .where(eq(identityChangeRequests.id, requestId))
        .returning();
      if (!reviewed)
        throw new Error("Failed to review identity change request");
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: `member.identity_change_${input.decision}`,
        entityType: "identity_change_request",
        entityId: request.id,
        before: request,
        after: reviewed,
      });
      return reviewed;
    });
  }

  async replaceMemberIdentities(
    actor: OrganizationActor,
    membershipId: string,
    identityIds: string[],
  ) {
    return this.db.transaction(async (tx) => {
      const [member] = await tx
        .select({ id: orgMemberships.id })
        .from(orgMemberships)
        .where(
          and(
            eq(orgMemberships.id, membershipId),
            eq(orgMemberships.organizationId, actor.organizationId),
          ),
        )
        .for("update")
        .limit(1);
      if (!member)
        throw new OrganizationConflictError("成员不存在或不属于当前组织。");
      const uniqueIds = [...new Set(identityIds)];
      if (uniqueIds.length !== identityIds.length)
        throw new OrganizationConflictError("专业身份不能重复分配。");
      for (const identityId of uniqueIds) {
        const [identity] = await tx
          .select({ id: professionalIdentities.id })
          .from(professionalIdentities)
          .where(
            and(
              eq(professionalIdentities.id, identityId),
              eq(professionalIdentities.organizationId, actor.organizationId),
              isNull(professionalIdentities.archivedAt),
            ),
          )
          .limit(1);
        if (!identity)
          throw new OrganizationConflictError(
            "专业身份不存在、已归档或不属于当前组织。",
          );
      }
      const before = await tx
        .select()
        .from(memberIdentities)
        .where(eq(memberIdentities.membershipId, membershipId));
      await tx
        .delete(memberIdentities)
        .where(eq(memberIdentities.membershipId, membershipId));
      if (uniqueIds.length)
        await tx.insert(memberIdentities).values(
          uniqueIds.map((identityId) => ({
            membershipId,
            identityId,
            source: "organization" as const,
            verifiedAt: new Date(),
          })),
        );
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "member.identities_replaced",
        entityType: "org_membership",
        entityId: membershipId,
        before,
        after: uniqueIds,
      });
      return true;
    });
  }

  async setMemberStatus(
    actor: OrganizationActor,
    membershipId: string,
    status: "active" | "inactive",
  ) {
    if (membershipId === actor.membershipId)
      throw new OrganizationConflictError("不能在当前会话中停用或恢复自己。");
    return this.db.transaction(async (tx) => {
      const [member] = await tx
        .select({ membership: orgMemberships })
        .from(orgMemberships)
        .where(
          and(
            eq(orgMemberships.id, membershipId),
            eq(orgMemberships.organizationId, actor.organizationId),
          ),
        )
        .for("update")
        .limit(1);
      if (!member)
        throw new OrganizationConflictError("成员不存在或不属于当前组织。");
      const [ownerRole] = await tx
        .select({ id: memberRoles.id })
        .from(memberRoles)
        .innerJoin(accessRoles, eq(accessRoles.id, memberRoles.roleId))
        .where(
          and(
            eq(memberRoles.membershipId, membershipId),
            eq(accessRoles.kind, "owner"),
          ),
        )
        .limit(1);
      if (ownerRole)
        throw new OrganizationConflictError(
          "Owner 不能在此处停用；请先完成所有权转移。",
        );
      if (member.membership.status === status) return member.membership;
      const now = new Date();
      const [updated] = await tx
        .update(orgMemberships)
        .set({
          status,
          leftAt: status === "inactive" ? now : null,
          updatedAt: now,
        })
        .where(eq(orgMemberships.id, membershipId))
        .returning();
      if (!updated) throw new OrganizationConflictError("成员状态更新失败。");
      if (status === "inactive")
        await tx
          .update(sessions)
          .set({ revokedAt: now, revokeReason: "membership_deactivated" })
          .where(
            and(
              eq(sessions.userId, member.membership.userId),
              isNull(sessions.revokedAt),
            ),
          );
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: `member.${status === "inactive" ? "deactivated" : "reactivated"}`,
        entityType: "org_membership",
        entityId: membershipId,
        before: { status: member.membership.status },
        after: { status },
      });
      return updated;
    });
  }

  private requestedInvitationCredentials(input: InvitationInput) {
    const credentials: Array<{
      kind: CredentialDeliveryKind;
      normalizedIdentifier: string;
    }> = [];
    if (input.email?.trim()) {
      credentials.push({
        kind: "email",
        normalizedIdentifier: normalizeLoginIdentifier(input.email),
      });
    }
    if (input.phone?.trim()) {
      credentials.push({
        kind: "phone",
        normalizedIdentifier: normalizeLoginIdentifier(input.phone),
      });
    }
    if (!credentials.length)
      throw new OrganizationConflictError("邀请至少需要填写一个邮箱或手机号。");
    return credentials;
  }

  private invitationDeliveryCredential(
    deliveryMode: InvitationDeliveryMode,
    credentials: Array<{
      kind: CredentialDeliveryKind;
      normalizedIdentifier: string;
    }>,
  ) {
    const preferredKind: CredentialDeliveryKind =
      deliveryMode === "manual"
        ? credentials.some((item) => item.kind === "email")
          ? "email"
          : "phone"
        : deliveryMode;
    const credential = credentials.find((item) => item.kind === preferredKind);
    if (!credential) {
      throw new OrganizationConflictError(
        preferredKind === "email"
          ? "选择邮件投递时必须填写邮箱。"
          : "选择短信投递时必须填写手机号。",
      );
    }
    return credential;
  }

  async invite(actor: OrganizationActor, input: InvitationInput) {
    await this.ensureSystemAccessRoles(actor.organizationId);
    const requestedCredentials = this.requestedInvitationCredentials(input);
    const deliveryCredential = this.invitationDeliveryCredential(
      input.deliveryMode,
      requestedCredentials,
    );
    const [existing] = await this.db
      .select({ id: userCredentials.id })
      .from(userCredentials)
      .where(
        or(
          ...requestedCredentials.map((credential) =>
            eq(
              userCredentials.normalizedIdentifier,
              credential.normalizedIdentifier,
            ),
          ),
        ),
      )
      .limit(1);
    if (existing)
      throw new OrganizationConflictError(
        "该邮箱或手机号已经绑定账号，不能重复加入白名单。",
      );
    const [role] = await this.db
      .select()
      .from(accessRoles)
      .where(
        input.roleId
          ? and(
              eq(accessRoles.id, input.roleId),
              eq(accessRoles.organizationId, actor.organizationId),
            )
          : and(
              eq(accessRoles.kind, "member"),
              eq(accessRoles.organizationId, actor.organizationId),
            ),
      )
      .limit(1);
    if (!role || role.kind === "owner")
      throw new OrganizationConflictError(
        "邀请时不能授予 Owner；所有权必须走双向确认转移。",
      );
    if (input.orgUnitId) {
      const [unit] = await this.db
        .select({ id: orgUnits.id })
        .from(orgUnits)
        .where(
          and(
            eq(orgUnits.id, input.orgUnitId),
            eq(orgUnits.organizationId, actor.organizationId),
            isNull(orgUnits.archivedAt),
          ),
        )
        .limit(1);
      if (!unit)
        throw new OrganizationConflictError("组织单元不存在或已归档。");
    }
    // Manual capability links are the default production path: they need no
    // third-party service and are only revealed to the authorized manager in
    // this response. Automatic delivery remains opt-in and must be configured
    // before a pending identity is created.
    if (input.deliveryMode !== "manual")
      this.mailer.assertDeliveryConfigured(deliveryCredential.kind);
    const invitationToken = createOpaqueToken();
    const expiresAt = new Date(Date.now() + 7 * 86_400_000);
    const unusablePasswordHash = await hashPassword(createOpaqueToken(48));
    const result = await this.db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ displayName: input.displayName })
        .returning();
      if (!user) throw new Error("Failed to create invited user");
      const credentials = await tx
        .insert(userCredentials)
        .values(
          requestedCredentials.map((credential) => ({
            userId: user.id,
            kind: credential.kind,
            normalizedIdentifier: credential.normalizedIdentifier,
            passwordHash: unusablePasswordHash,
          })),
        )
        .onConflictDoNothing()
        .returning();
      if (credentials.length !== requestedCredentials.length)
        throw new OrganizationConflictError(
          "邮箱或手机号刚刚被其他账号绑定，请刷新后再检查。",
        );
      const deliveryCredentialRecord = credentials.find(
        (credential) => credential.kind === deliveryCredential.kind,
      );
      if (!deliveryCredentialRecord)
        throw new Error("Failed to create invitation delivery credential");
      const [membership] = await tx
        .insert(orgMemberships)
        .values({
          organizationId: actor.organizationId,
          userId: user.id,
          orgUnitId: input.orgUnitId,
          status: "invited",
          positionTitle: input.positionTitle,
        })
        .returning();
      if (!membership) throw new Error("Failed to create invited membership");
      await tx.insert(memberRoles).values({
        membershipId: membership.id,
        roleId: role.id,
        scopeKind:
          role.kind === "member"
            ? "self"
            : input.orgUnitId
              ? "org_unit"
              : "organization",
        scopeId: role.kind === "member" ? membership.id : input.orgUnitId,
        grantedBy: actor.membershipId,
      });
      await tx.insert(verificationTokens).values({
        credentialId: deliveryCredentialRecord.id,
        purpose: "invitation",
        tokenHash: hashOpaqueToken(invitationToken),
        expiresAt,
      });
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "member.invited",
        entityType: "org_membership",
        entityId: membership.id,
        after: {
          displayName: input.displayName,
          credentials: requestedCredentials.map((credential) => ({
            kind: credential.kind,
            identifierHash: hashOpaqueToken(credential.normalizedIdentifier),
          })),
          deliveryMode: input.deliveryMode,
          roleId: role.id,
          orgUnitId: input.orgUnitId,
        },
      });
      return { membership, deliveryCredential: deliveryCredentialRecord };
    });
    return {
      membership: result.membership,
      deliveryCredential: result.deliveryCredential,
      credentialKinds: requestedCredentials.map((credential) => credential.kind),
      invitationToken,
      expiresAt,
    };
  }

  async deliverInvitation(
    invitation: Awaited<ReturnType<OrganizationService["invite"]>>,
    displayName: string,
    deliveryMode: InvitationDeliveryMode,
  ) {
    if (deliveryMode === "manual") {
      return {
        membership: invitation.membership,
        delivery: {
          mode: "manual" as const,
          expiresAt: invitation.expiresAt,
          credentialKinds: invitation.credentialKinds,
        },
        // Deliberately ephemeral: never stored in the database, audit log, or
        // query cache. Its token stays in the URL fragment to avoid HTTP logs.
        manualLink: this.mailer.invitationUrl(invitation.invitationToken),
      };
    }
    await this.mailer.sendInvitation({
      displayName,
      identifier: invitation.deliveryCredential.normalizedIdentifier,
      kind: invitation.deliveryCredential.kind,
      token: invitation.invitationToken,
      expiresAt: invitation.expiresAt,
    });
    return {
      membership: invitation.membership,
      delivery: {
        mode: "automatic" as const,
        kind: invitation.deliveryCredential.kind,
        expiresAt: invitation.expiresAt,
        credentialKinds: invitation.credentialKinds,
      },
    };
  }

  async resendInvitation(
    actor: OrganizationActor,
    membershipId: string,
    deliveryMode: InvitationDeliveryMode = "manual",
  ) {
    const now = new Date();
    const result = await this.db.transaction(async (tx) => {
      const [record] = await tx
        .select({
          membership: orgMemberships,
          user: users,
        })
        .from(orgMemberships)
        .innerJoin(users, eq(users.id, orgMemberships.userId))
        .where(
          and(
            eq(orgMemberships.id, membershipId),
            eq(orgMemberships.organizationId, actor.organizationId),
            eq(orgMemberships.status, "invited"),
          ),
        )
        .for("update")
        .limit(1);
      if (!record) {
        throw new OrganizationConflictError("只能重新发送当前组织中仍待加入的白名单邀请。");
      }
      const credentials = await tx
        .select()
        .from(userCredentials)
        .where(eq(userCredentials.userId, record.user.id))
        .for("update");
      const preferredKind: CredentialDeliveryKind =
        deliveryMode === "manual"
          ? credentials.some((credential) => credential.kind === "email")
            ? "email"
            : "phone"
          : deliveryMode;
      const credential = credentials.find(
        (candidate) => candidate.kind === preferredKind,
      );
      if (!credential)
        throw new OrganizationConflictError(
          preferredKind === "email"
            ? "该成员没有已登记的邮箱白名单。"
            : "该成员没有已登记的手机号白名单。",
        );
      if (deliveryMode !== "manual")
        this.mailer.assertDeliveryConfigured(credential.kind);

      const invitationToken = createOpaqueToken();
      const expiresAt = new Date(now.getTime() + 7 * 86_400_000);
      await tx
        .update(verificationTokens)
        .set({ consumedAt: now })
        .where(
          and(
            inArray(
              verificationTokens.credentialId,
              credentials.map((candidate) => candidate.id),
            ),
            eq(verificationTokens.purpose, "invitation"),
            isNull(verificationTokens.consumedAt),
          ),
        );
      await tx.insert(verificationTokens).values({
        credentialId: credential.id,
        purpose: "invitation",
        tokenHash: hashOpaqueToken(invitationToken),
        expiresAt,
      });
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "member.invitation_resent",
        entityType: "org_membership",
        entityId: membershipId,
        after: {
          deliveryMode,
          credentialKind: credential.kind,
          credentialKinds: credentials.map((candidate) => candidate.kind),
        },
      });
      return { record, credential, credentials, invitationToken, expiresAt };
    });

    if (deliveryMode === "manual") {
      return {
        membership: result.record.membership,
        delivery: {
          mode: "manual" as const,
          expiresAt: result.expiresAt,
          credentialKinds: result.credentials.map((credential) => credential.kind),
        },
        manualLink: this.mailer.invitationUrl(result.invitationToken),
      };
    }
    await this.mailer.sendInvitation({
      displayName: result.record.user.displayName,
      identifier: result.credential.normalizedIdentifier,
      kind: result.credential.kind,
      token: result.invitationToken,
      expiresAt: result.expiresAt,
    });
    return {
      membership: result.record.membership,
      delivery: {
        mode: "automatic" as const,
        kind: result.credential.kind,
        expiresAt: result.expiresAt,
        credentialKinds: result.credentials.map((credential) => credential.kind),
      },
    };
  }

  async acceptInvitation(token: string, password: string) {
    const tokenHash = hashOpaqueToken(token);
    const passwordHash = await hashPassword(password);
    return this.db.transaction(async (tx) => {
      const [record] = await tx
        .select({
          verification: verificationTokens,
          credential: userCredentials,
          membership: orgMemberships,
        })
        .from(verificationTokens)
        .innerJoin(
          userCredentials,
          eq(userCredentials.id, verificationTokens.credentialId),
        )
        .innerJoin(
          orgMemberships,
          eq(orgMemberships.userId, userCredentials.userId),
        )
        .where(
          and(
            eq(verificationTokens.tokenHash, tokenHash),
            eq(verificationTokens.purpose, "invitation"),
            isNull(verificationTokens.consumedAt),
            gt(verificationTokens.expiresAt, new Date()),
            eq(orgMemberships.status, "invited"),
          ),
        )
        .for("update")
        .limit(1);
      if (!record)
        throw new OrganizationConflictError("邀请链接无效、已使用或已过期。");
      const now = new Date();
      const credentials = await tx
        .select({ id: userCredentials.id })
        .from(userCredentials)
        .where(eq(userCredentials.userId, record.credential.userId))
        .for("update");
      await tx
        .update(userCredentials)
        .set({
          passwordHash,
          verifiedAt: now,
          passwordChangedAt: now,
          updatedAt: now,
        })
        // One organization-controlled invitation activates every identifier
        // supplied by the Owner. Either the whitelisted email or phone can
        // therefore be used for the same password after the first acceptance.
        .where(eq(userCredentials.userId, record.credential.userId));
      const [membership] = await tx
        .update(orgMemberships)
        .set({ status: "active", joinedAt: now, updatedAt: now })
        .where(eq(orgMemberships.id, record.membership.id))
        .returning();
      await tx
        .update(verificationTokens)
        .set({ consumedAt: now })
        .where(
          and(
            eq(verificationTokens.purpose, "invitation"),
            isNull(verificationTokens.consumedAt),
            inArray(
              verificationTokens.credentialId,
              credentials.map((credential) => credential.id),
            ),
          ),
        );
      await tx.insert(auditLogs).values({
        organizationId: record.membership.organizationId,
        actorMembershipId: record.membership.id,
        action: "member.invitation_accepted",
        entityType: "org_membership",
        entityId: record.membership.id,
      });
      await tx.insert(outboxEvents).values({
        organizationId: record.membership.organizationId,
        eventType: "organization.member.activated",
        entityType: "org_membership",
        entityId: record.membership.id,
        entityVersion: 1,
        payload: { membershipId: record.membership.id },
      });
      return membership;
    });
  }

  private async assertMember(
    organizationId: string,
    membershipId: string | null,
    db: Database = this.db,
  ) {
    if (!membershipId) return;
    const [member] = await db
      .select({ id: orgMemberships.id })
      .from(orgMemberships)
      .where(
        and(
          eq(orgMemberships.id, membershipId),
          eq(orgMemberships.organizationId, organizationId),
          ne(orgMemberships.status, "inactive"),
        ),
      )
      .limit(1);
    if (!member)
      throw new OrganizationConflictError(
        "负责人必须是当前组织中未停用的成员。",
      );
  }

  private async assertUnitParent(
    organizationId: string,
    unitId: string | null,
    parentId: string | null,
    db: Database = this.db,
  ) {
    if (!parentId) return;
    if (parentId === unitId)
      throw new OrganizationConflictError("组织单元不能成为自己的上级。");
    const units = await db
      .select({ id: orgUnits.id, parentId: orgUnits.parentId })
      .from(orgUnits)
      .where(
        and(
          eq(orgUnits.organizationId, organizationId),
          isNull(orgUnits.archivedAt),
        ),
      );
    const parentById = new Map(units.map((unit) => [unit.id, unit.parentId]));
    if (!parentById.has(parentId))
      throw new OrganizationConflictError("父组织单元不存在或已归档。");
    let cursor: string | null = parentId;
    while (cursor) {
      if (cursor === unitId)
        throw new OrganizationConflictError("移动会造成组织结构循环。");
      cursor = parentById.get(cursor) ?? null;
    }
  }
}
