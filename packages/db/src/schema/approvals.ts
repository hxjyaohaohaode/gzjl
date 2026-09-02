import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { organizations, orgMemberships } from "./core.js";

export const approvalRequestStatusEnum = pgEnum("approval_request_status", [
  "pending",
  "approved",
  "returned",
  "cancelled",
]);
export const approvalActionEnum = pgEnum("approval_action", [
  "submitted",
  "approved",
  "returned",
  "cancelled",
  "management_corrected",
  "commented",
]);

export const approvalRules = pgTable(
  "approval_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    entityType: text("entity_type").notNull(),
    conditions: jsonb("conditions").notNull().default(sql`'{}'::jsonb`),
    reviewerScope: jsonb("reviewer_scope").notNull().default(sql`'{}'::jsonb`),
    priority: text("priority").notNull().default("normal"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("approval_rules_org_name_uidx").on(table.organizationId, table.name)],
);

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    ruleId: uuid("rule_id").references(() => approvalRules.id, { onDelete: "set null" }),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    entityVersion: text("entity_version").notNull(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    assignedReviewerId: uuid("assigned_reviewer_id").references(
      () => orgMemberships.id,
      { onDelete: "set null" },
    ),
    status: approvalRequestStatusEnum("status").notNull().default("pending"),
    priority: text("priority").notNull().default("normal"),
    anomalyFlags: jsonb("anomaly_flags").notNull().default(sql`'[]'::jsonb`),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("approval_requests_entity_version_uidx").on(
      table.entityType,
      table.entityId,
      table.entityVersion,
    ),
    index("approval_requests_org_status_priority_idx").on(
      table.organizationId,
      table.status,
      table.priority,
    ),
  ],
);

export const approvalActions = pgTable(
  "approval_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    approvalRequestId: uuid("approval_request_id")
      .notNull()
      .references(() => approvalRequests.id, { onDelete: "restrict" }),
    actorMembershipId: uuid("actor_membership_id")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    action: approvalActionEnum("action").notNull(),
    reason: text("reason"),
    beforeSnapshot: jsonb("before_snapshot"),
    afterSnapshot: jsonb("after_snapshot"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("approval_actions_request_created_idx").on(table.approvalRequestId, table.createdAt)],
);
