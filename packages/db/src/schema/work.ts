import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
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

import { organizations, orgMemberships } from "./core.js";
import { projectBranches, projectNodes, projects } from "./projects.js";

export const workSessionSourceEnum = pgEnum("work_session_source", [
  "manual",
  "timer",
  "import",
]);
export const workVisibilityEnum = pgEnum("work_visibility", [
  "private",
  "management_only",
  "project_visible",
]);
export const submissionStatusEnum = pgEnum("submission_status", ["draft", "submitted"]);
export const approvalStatusEnum = pgEnum("approval_status", [
  "not_requested",
  "pending_review",
  "approved",
  "returned",
  "locked",
]);
export const timerStatusEnum = pgEnum("timer_status", [
  "running",
  "paused",
  "on_break",
  "stopped",
]);
export const correctionStatusEnum = pgEnum("correction_status", [
  "pending",
  "approved",
  "rejected",
  "applied_next_period",
]);

export const workTypes = pgTable(
  "work_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#3468f5"),
    description: text("description"),
    billableByDefault: boolean("billable_by_default").notNull().default(true),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("work_types_org_name_uidx").on(table.organizationId, table.name)],
);

export const workExpectationProfiles = pgTable(
  "work_expectation_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "cascade" }),
    timezone: text("timezone").notNull(),
    referenceWindows: jsonb("reference_windows").notNull().default(sql`'[]'::jsonb`),
    targetSecondsPerWeek: bigint("target_seconds_per_week", { mode: "number" }),
    manualEntryLookbackDays: integer("manual_entry_lookback_days").notNull().default(7),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("work_expectation_profiles_member_effective_idx").on(
      table.membershipId,
      table.effectiveFrom,
    ),
    check(
      "work_expectation_profiles_lookback_check",
      sql`${table.manualEntryLookbackDays} between 0 and 365`,
    ),
  ],
);

export const workSessions = pgTable(
  "work_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    timezone: text("timezone").notNull(),
    grossSeconds: bigint("gross_seconds", { mode: "number" }).notNull(),
    breakSeconds: bigint("break_seconds", { mode: "number" }).notNull().default(0),
    netSeconds: bigint("net_seconds", { mode: "number" }).notNull(),
    billableSeconds: bigint("billable_seconds", { mode: "number" }),
    source: workSessionSourceEnum("source").notNull(),
    content: text("content").notNull(),
    result: text("result").notNull().default(""),
    blockers: text("blockers").notNull().default(""),
    nextStep: text("next_step").notNull().default(""),
    primaryProjectNodeId: uuid("primary_project_node_id").references(() => projectNodes.id, {
      onDelete: "restrict",
    }),
    workTypeId: uuid("work_type_id").references(() => workTypes.id, {
      onDelete: "set null",
    }),
    visibility: workVisibilityEnum("visibility").notNull().default("management_only"),
    parallelWork: boolean("parallel_work").notNull().default(false),
    submissionStatus: submissionStatusEnum("submission_status").notNull().default("draft"),
    approvalStatus: approvalStatusEnum("approval_status")
      .notNull()
      .default("not_requested"),
    anomalyFlags: jsonb("anomaly_flags").notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("work_sessions_member_start_idx").on(table.membershipId, table.startAt),
    index("work_sessions_org_approval_idx").on(table.organizationId, table.approvalStatus),
    index("work_sessions_primary_node_idx").on(table.primaryProjectNodeId),
    check("work_sessions_time_order_check", sql`${table.endAt} > ${table.startAt}`),
    check("work_sessions_gross_nonnegative_check", sql`${table.grossSeconds} > 0`),
    check(
      "work_sessions_duration_consistency_check",
      sql`${table.netSeconds} = ${table.grossSeconds} - ${table.breakSeconds}`,
    ),
    check("work_sessions_break_bounds_check", sql`${table.breakSeconds} >= 0 and ${table.breakSeconds} < ${table.grossSeconds}`),
  ],
);

export const workBreaks = pgTable(
  "work_breaks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workSessionId: uuid("work_session_id")
      .notNull()
      .references(() => workSessions.id, { onDelete: "cascade" }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("work_breaks_session_start_idx").on(table.workSessionId, table.startAt),
    check("work_breaks_time_order_check", sql`${table.endAt} > ${table.startAt}`),
  ],
);

export const workSessionProjectLinks = pgTable(
  "work_session_project_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workSessionId: uuid("work_session_id")
      .notNull()
      .references(() => workSessions.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    projectNodeId: uuid("project_node_id")
      .notNull()
      .references(() => projectNodes.id, { onDelete: "restrict" }),
    projectBranchId: uuid("project_branch_id")
      .notNull()
      .references(() => projectBranches.id, { onDelete: "restrict" }),
    isPrimary: boolean("is_primary").notNull().default(false),
    allocationBasisPoints: integer("allocation_basis_points").notNull().default(10_000),
  },
  (table) => [
    uniqueIndex("work_session_project_links_session_node_uidx").on(
      table.workSessionId,
      table.projectNodeId,
    ),
    index("work_session_project_links_node_idx").on(table.projectNodeId),
    check(
      "work_session_project_links_allocation_check",
      sql`${table.allocationBasisPoints} between 0 and 10000`,
    ),
  ],
);

export const workSessionTags = pgTable(
  "work_session_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workSessionId: uuid("work_session_id")
      .notNull()
      .references(() => workSessions.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (table) => [uniqueIndex("work_session_tags_session_tag_uidx").on(table.workSessionId, table.tag)],
);

export const workSessionVersions = pgTable(
  "work_session_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workSessionId: uuid("work_session_id")
      .notNull()
      .references(() => workSessions.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    changeReason: text("change_reason"),
    changedBy: uuid("changed_by")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("work_session_versions_session_version_uidx").on(table.workSessionId, table.version)],
);

export const timerStates = pgTable(
  "timer_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    workSessionId: uuid("work_session_id").references(() => workSessions.id, {
      onDelete: "set null",
    }),
    status: timerStatusEnum("status").notNull(),
    isPrimary: boolean("is_primary").notNull().default(true),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    stateChangedAt: timestamp("state_changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    accumulatedSeconds: bigint("accumulated_seconds", { mode: "number" }).notNull().default(0),
    clientEventCursor: text("client_event_cursor"),
    version: integer("version").notNull().default(1),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("timer_states_one_primary_active_uidx")
      .on(table.membershipId)
      .where(sql`${table.isPrimary} = true and ${table.status} in ('running', 'paused', 'on_break')`),
    index("timer_states_member_idx").on(table.membershipId, table.updatedAt),
  ],
);

export const timerEvents = pgTable(
  "timer_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    timerStateId: uuid("timer_state_id")
      .notNull()
      .references(() => timerStates.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  },
  (table) => [
    uniqueIndex("timer_events_state_event_uidx").on(table.timerStateId, table.eventId),
    index("timer_events_state_occurred_idx").on(table.timerStateId, table.occurredAt),
  ],
);

export const workSessionCorrections = pgTable(
  "work_session_corrections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workSessionId: uuid("work_session_id")
      .notNull()
      .references(() => workSessions.id, { onDelete: "restrict" }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    baseVersion: integer("base_version").notNull(),
    proposedSnapshot: jsonb("proposed_snapshot").notNull(),
    reason: text("reason").notNull(),
    status: correctionStatusEnum("status").notNull().default("pending"),
    reviewedBy: uuid("reviewed_by").references(() => orgMemberships.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("work_session_corrections_status_idx").on(table.status, table.createdAt)],
);
