import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { organizations, orgMemberships } from "./core.js";

export const projectStatusEnum = pgEnum("project_status", [
  "planned",
  "active",
  "paused",
  "completed",
  "archived",
]);
export const projectMemberRoleEnum = pgEnum("project_member_role", [
  "lead",
  "member",
  "observer",
]);
export const projectNodeTypeEnum = pgEnum("project_node_type", [
  "phase",
  "milestone",
  "task",
  "deliverable",
  "decision",
]);
export const projectNodeStatusEnum = pgEnum("project_node_status", [
  "not_started",
  "in_progress",
  "blocked",
  "in_review",
  "completed",
  "cancelled",
]);
export const progressModeEnum = pgEnum("progress_mode", [
  "manual",
  "weighted_children",
  "time_weighted_children",
  "milestone_based",
]);
export const projectEdgeTypeEnum = pgEnum("project_edge_type", [
  "depends_on",
  "blocks",
  "relates_to",
  "replaces",
  "merges_into",
]);
export const projectActivityTypeEnum = pgEnum("project_activity_type", [
  "created",
  "updated",
  "moved",
  "branched",
  "merged",
  "archived",
  "deleted",
  "restored",
  "rolled_back",
]);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    color: text("color").notNull().default("#3468f5"),
    status: projectStatusEnum("status").notNull().default("planned"),
    visibility: text("visibility").notNull().default("members"),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    startAt: timestamp("start_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("projects_org_key_uidx").on(table.organizationId, table.key),
    index("projects_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const projectMembers = pgTable(
  "project_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    role: projectMemberRoleEnum("role").notNull().default("member"),
    publicActivityVisible: boolean("public_activity_visible").notNull().default(true),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("project_members_project_member_uidx").on(
      table.projectId,
      table.membershipId,
    ),
    index("project_members_membership_idx").on(table.membershipId),
  ],
);

export const projectBranches = pgTable(
  "project_branches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    parentBranchId: uuid("parent_branch_id").references(
      (): AnyPgColumn => projectBranches.id,
      { onDelete: "restrict" },
    ),
    name: text("name").notNull(),
    description: text("description"),
    sourceNodeId: uuid("source_node_id"),
    isDefault: boolean("is_default").notNull().default(false),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    mergedIntoBranchId: uuid("merged_into_branch_id").references(
      (): AnyPgColumn => projectBranches.id,
      { onDelete: "restrict" },
    ),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("project_branches_project_name_uidx").on(table.projectId, table.name),
    index("project_branches_project_idx").on(table.projectId, table.archivedAt),
  ],
);

export const projectNodes = pgTable(
  "project_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => projectBranches.id, { onDelete: "restrict" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => projectNodes.id, {
      onDelete: "restrict",
    }),
    type: projectNodeTypeEnum("type").notNull().default("task"),
    title: text("title").notNull(),
    description: text("description"),
    status: projectNodeStatusEnum("status").notNull().default("not_started"),
    progress: numeric("progress", { precision: 5, scale: 2 }).notNull().default("0"),
    progressMode: progressModeEnum("progress_mode").notNull().default("manual"),
    weight: numeric("weight", { precision: 12, scale: 4 }).notNull().default("1"),
    sortOrder: integer("sort_order").notNull().default(0),
    startAt: timestamp("start_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    version: integer("version").notNull().default(1),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("project_nodes_branch_parent_idx").on(table.branchId, table.parentId),
    index("project_nodes_project_status_idx").on(table.projectId, table.status),
    check("project_nodes_progress_check", sql`${table.progress} between 0 and 100`),
    check("project_nodes_weight_check", sql`${table.weight} >= 0`),
  ],
);

export const projectEdges = pgTable(
  "project_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceNodeId: uuid("source_node_id")
      .notNull()
      .references(() => projectNodes.id, { onDelete: "restrict" }),
    targetNodeId: uuid("target_node_id")
      .notNull()
      .references(() => projectNodes.id, { onDelete: "restrict" }),
    type: projectEdgeTypeEnum("type").notNull(),
    label: text("label"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("project_edges_unique_uidx").on(
      table.sourceNodeId,
      table.targetNodeId,
      table.type,
    ),
    check("project_edges_distinct_nodes_check", sql`${table.sourceNodeId} <> ${table.targetNodeId}`),
  ],
);

export const projectNodeVersions = pgTable(
  "project_node_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => projectNodes.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    changeSummary: text("change_summary"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("project_node_versions_node_version_uidx").on(table.nodeId, table.version)],
);

export const projectBranchVersions = pgTable(
  "project_branch_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => projectBranches.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    changeSummary: text("change_summary"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("project_branch_versions_branch_version_uidx").on(table.branchId, table.version)],
);

export const projectNodeAssignees = pgTable(
  "project_node_assignees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => projectNodes.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    isResponsible: boolean("is_responsible").notNull().default(false),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("project_node_assignees_node_member_uidx").on(table.nodeId, table.membershipId)],
);

export const projectMilestones = pgTable(
  "project_milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    nodeId: uuid("node_id").references(() => projectNodes.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("project_milestones_project_due_idx").on(table.projectId, table.dueAt)],
);

export const projectActivityLog = pgTable(
  "project_activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    actorMembershipId: uuid("actor_membership_id")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    activityType: projectActivityTypeEnum("activity_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    entityVersion: integer("entity_version"),
    details: jsonb("details").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("project_activity_log_project_created_idx").on(table.projectId, table.createdAt)],
);

export const recycleBinEntries = pgTable(
  "recycle_bin_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    deletedBy: uuid("deleted_by")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
    restoreUntil: timestamp("restore_until", { withTimezone: true }),
    restoredBy: uuid("restored_by").references(() => orgMemberships.id, {
      onDelete: "set null",
    }),
    restoredAt: timestamp("restored_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("recycle_bin_entity_uidx").on(table.entityType, table.entityId),
    index("recycle_bin_org_deleted_idx").on(table.organizationId, table.deletedAt),
  ],
);
