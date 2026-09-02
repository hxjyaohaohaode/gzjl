import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const userStatusEnum = pgEnum("user_status", ["active", "disabled"]);
export const membershipStatusEnum = pgEnum("membership_status", [
  "invited",
  "active",
  "inactive",
]);
export const credentialKindEnum = pgEnum("credential_kind", ["email", "phone"]);
export const accessRoleKindEnum = pgEnum("access_role_kind", [
  "owner",
  "manager",
  "member",
  "custom",
]);
export const scopeKindEnum = pgEnum("scope_kind", [
  "organization",
  "org_unit",
  "project",
  "self",
]);
export const requestStatusEnum = pgEnum("request_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);
export const identitySourceEnum = pgEnum("identity_source", [
  "organization",
  "self_declared",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    locale: text("locale").notNull().default("zh-CN"),
    timezone: text("timezone").notNull().default("Asia/Shanghai"),
    status: userStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("users_status_idx").on(table.status)],
);

export const userCredentials = pgTable(
  "user_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: credentialKindEnum("kind").notNull(),
    normalizedIdentifier: text("normalized_identifier").notNull(),
    passwordHash: text("password_hash").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("user_credentials_identifier_uidx").on(table.normalizedIdentifier),
    index("user_credentials_user_idx").on(table.userId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    csrfSecretHash: text("csrf_secret_hash").notNull(),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokeReason: text("revoke_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_uidx").on(table.tokenHash),
    index("sessions_user_active_idx").on(table.userId, table.expiresAt),
  ],
);

/** One encrypted RFC 6238 factor per user. The raw shared secret never reaches PostgreSQL. */
export const userTotpFactors = pgTable(
  "user_totp_factors",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    secretCiphertext: text("secret_ciphertext").notNull(),
    enabledAt: timestamp("enabled_at", { withTimezone: true }),
    lastUsedCounter: bigint("last_used_counter", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("user_totp_factors_enabled_idx").on(table.enabledAt)],
);

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    credentialId: uuid("credential_id")
      .notNull()
      .references(() => userCredentials.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("verification_tokens_hash_uidx").on(table.tokenHash),
    index("verification_tokens_credential_idx").on(table.credentialId, table.purpose),
  ],
);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    timezone: text("timezone").notNull().default("Asia/Shanghai"),
    payrollCutoffDay: integer("payroll_cutoff_day").notNull().default(10),
    settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "organizations_payroll_cutoff_day_check",
      sql`${table.payrollCutoffDay} between 1 and 28`,
    ),
  ],
);

export const orgUnits = pgTable(
  "org_units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => orgUnits.id, {
      onDelete: "restrict",
    }),
    name: text("name").notNull(),
    description: text("description"),
    leaderMembershipId: uuid("leader_membership_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    version: integer("version").notNull().default(1),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("org_units_org_parent_name_uidx").on(
      table.organizationId,
      table.parentId,
      table.name,
    ),
    index("org_units_org_parent_idx").on(table.organizationId, table.parentId),
  ],
);

export const orgMemberships = pgTable(
  "org_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    orgUnitId: uuid("org_unit_id").references(() => orgUnits.id, {
      onDelete: "set null",
    }),
    status: membershipStatusEnum("status").notNull().default("invited"),
    positionTitle: text("position_title"),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    leftAt: timestamp("left_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("org_memberships_org_user_uidx").on(
      table.organizationId,
      table.userId,
    ),
    index("org_memberships_user_idx").on(table.userId),
  ],
);

export const accessRoles = pgTable(
  "access_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: accessRoleKindEnum("kind").notNull().default("custom"),
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("access_roles_org_name_uidx").on(table.organizationId, table.name),
  ],
);

export const permissionDefinitions = pgTable("permissions", {
  code: text("code").primaryKey(),
  description: text("description").notNull(),
  sensitivity: text("sensitivity").notNull().default("normal"),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => accessRoles.id, { onDelete: "cascade" }),
    permissionCode: text("permission_code")
      .notNull()
      .references(() => permissionDefinitions.code, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("role_permissions_role_code_uidx").on(
      table.roleId,
      table.permissionCode,
    ),
  ],
);

export const memberRoles = pgTable(
  "member_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => accessRoles.id, { onDelete: "cascade" }),
    scopeKind: scopeKindEnum("scope_kind").notNull(),
    scopeId: uuid("scope_id"),
    grantedBy: uuid("granted_by").references(() => orgMemberships.id, {
      onDelete: "set null",
    }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("member_roles_grant_uidx").on(
      table.membershipId,
      table.roleId,
      table.scopeKind,
      table.scopeId,
    ),
    index("member_roles_membership_idx").on(table.membershipId),
  ],
);

export const professionalIdentities = pgTable(
  "professional_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    description: text("description"),
    isCustom: boolean("is_custom").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("professional_identities_org_name_uidx").on(
      table.organizationId,
      table.normalizedName,
    ),
  ],
);

export const memberIdentities = pgTable(
  "member_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "cascade" }),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => professionalIdentities.id, { onDelete: "restrict" }),
    source: identitySourceEnum("source").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("member_identities_member_identity_uidx").on(
      table.membershipId,
      table.identityId,
    ),
  ],
);

export const identityChangeRequests = pgTable(
  "identity_change_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "cascade" }),
    requestedName: text("requested_name").notNull(),
    requestedIdentityId: uuid("requested_identity_id").references(
      () => professionalIdentities.id,
      { onDelete: "set null" },
    ),
    action: text("action").notNull(),
    reason: text("reason"),
    status: requestStatusEnum("status").notNull().default("pending"),
    reviewedBy: uuid("reviewed_by").references(() => orgMemberships.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("identity_change_requests_status_idx").on(table.status, table.createdAt)],
);

// One row per organization is the database-level invariant for the unique Owner.
export const organizationOwners = pgTable(
  "organization_owners",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "restrict" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("organization_owners_membership_uidx").on(table.membershipId)],
);

export const ownershipTransferEvents = pgTable(
  "ownership_transfer_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    fromMembershipId: uuid("from_membership_id")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    toMembershipId: uuid("to_membership_id")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    status: requestStatusEnum("status").notNull().default("pending"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  },
  (table) => [index("ownership_transfer_events_org_status_idx").on(table.organizationId, table.status)],
);
