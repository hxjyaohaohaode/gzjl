import { sql } from "drizzle-orm";
import {
  boolean,
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

export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export const notificationSeverityEnum = pgEnum("notification_severity", [
  "info",
  "warning",
  "high",
  "critical",
]);
export const notificationChannelEnum = pgEnum("notification_channel", [
  "in_app",
  "web_push",
  "email",
  "sms",
]);
export const transferFormatEnum = pgEnum("transfer_format", [
  "csv",
  "xlsx",
  "pdf",
  "json",
]);
export const importStatusEnum = pgEnum("import_status", [
  "uploaded",
  "validating",
  "preview_ready",
  "confirmed",
  "importing",
  "completed",
  "failed",
  "cancelled",
]);

export const aiJobs = pgTable(
  "ai_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    scope: jsonb("scope").notNull(),
    taskType: text("task_type").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptTemplateVersion: text("prompt_template_version").notNull(),
    inputHash: text("input_hash").notNull(),
    sourceSummary: jsonb("source_summary").notNull(),
    status: jobStatusEnum("status").notNull().default("queued"),
    attempt: integer("attempt").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    errorSummary: text("error_summary"),
    maxOutputTokens: integer("max_output_tokens").notNull().default(1_200),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    providerRequestId: text("provider_request_id"),
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("ai_jobs_scope_input_uidx").on(
      table.organizationId,
      table.taskType,
      table.inputHash,
    ),
    index("ai_jobs_status_queued_idx").on(table.status, table.queuedAt),
  ],
);

export const aiReports = pgTable(
  "ai_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    aiJobId: uuid("ai_job_id")
      .notNull()
      .references(() => aiJobs.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    structuredOutput: jsonb("structured_output").notNull(),
    sourceCount: integer("source_count").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("ai_reports_job_uidx").on(table.aiJobId)],
);

export const aiReportSources = pgTable(
  "ai_report_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    aiReportId: uuid("ai_report_id")
      .notNull()
      .references(() => aiReports.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    entityVersion: text("entity_version"),
    label: text("label").notNull(),
  },
  (table) => [
    uniqueIndex("ai_report_sources_report_entity_uidx").on(
      table.aiReportId,
      table.entityType,
      table.entityId,
    ),
  ],
);

export const reminderRules = pgTable(
  "reminder_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    severity: notificationSeverityEnum("severity").notNull().default("info"),
    conditions: jsonb("conditions").notNull().default(sql`'{}'::jsonb`),
    cooldownSeconds: integer("cooldown_seconds").notNull().default(3_600),
    channels: jsonb("channels").notNull().default(sql`'["in_app"]'::jsonb`),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("reminder_rules_org_category_name_uidx").on(table.organizationId, table.category, table.name)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    recipientMembershipId: uuid("recipient_membership_id")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "cascade" }),
    reminderRuleId: uuid("reminder_rule_id").references(() => reminderRules.id, {
      onDelete: "set null",
    }),
    category: text("category").notNull(),
    severity: notificationSeverityEnum("severity").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    actionUrl: text("action_url"),
    dedupeKey: text("dedupe_key").notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    handledAt: timestamp("handled_at", { withTimezone: true }),
    ignoredAt: timestamp("ignored_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("notifications_recipient_dedupe_uidx").on(
      table.recipientMembershipId,
      table.dedupeKey,
    ),
    index("notifications_recipient_unread_idx").on(table.recipientMembershipId, table.readAt),
  ],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    inAppEnabled: boolean("in_app_enabled").notNull().default(true),
    pushEnabled: boolean("push_enabled").notNull().default(false),
    emailEnabled: boolean("email_enabled").notNull().default(false),
    quietHours: jsonb("quiet_hours").notNull().default(sql`'{}'::jsonb`),
    mutedUntil: timestamp("muted_until", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("notification_preferences_member_category_uidx").on(table.membershipId, table.category)],
);

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "cascade" }),
    endpointHash: text("endpoint_hash").notNull(),
    endpointCiphertext: text("endpoint_ciphertext").notNull(),
    p256dhCiphertext: text("p256dh_ciphertext").notNull(),
    authCiphertext: text("auth_ciphertext").notNull(),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("push_subscriptions_endpoint_uidx").on(table.endpointHash)],
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    pushSubscriptionId: uuid("push_subscription_id")
      .notNull()
      .references(() => pushSubscriptions.id, { onDelete: "cascade" }),
    channel: notificationChannelEnum("channel").notNull(),
    status: jobStatusEnum("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    errorSummary: text("error_summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("notification_deliveries_notification_subscription_uidx").on(
      table.notificationId,
      table.pushSubscriptionId,
      table.channel,
    ),
    index("notification_deliveries_dispatch_idx").on(
      table.channel,
      table.status,
      table.nextAttemptAt,
    ),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    actorMembershipId: uuid("actor_membership_id").references(() => orgMemberships.id, {
      onDelete: "set null",
    }),
    actorType: text("actor_type").notNull().default("user"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    requestId: text("request_id"),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_org_created_idx").on(table.organizationId, table.createdAt),
    index("audit_logs_entity_idx").on(table.entityType, table.entityId),
  ],
);

export const exports = pgTable(
  "exports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    format: transferFormatEnum("format").notNull(),
    exportType: text("export_type").notNull(),
    deliveryMode: text("delivery_mode").notNull().default("inline"),
    scope: jsonb("scope").notNull(),
    fieldPolicySnapshot: jsonb("field_policy_snapshot").notNull(),
    status: jobStatusEnum("status").notNull().default("queued"),
    progress: integer("progress").notNull().default(0),
    attempt: integer("attempt").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    objectKey: text("object_key"),
    fileName: text("file_name"),
    contentType: text("content_type"),
    byteSize: integer("byte_size"),
    rowCount: integer("row_count"),
    sha256: text("sha256"),
    errorSummary: text("error_summary"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("exports_requester_status_idx").on(table.requestedBy, table.status),
    index("exports_dispatch_idx").on(table.status, table.createdAt),
    index("exports_expiry_idx").on(table.status, table.expiresAt),
  ],
);

export const imports = pgTable(
  "imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    importType: text("import_type").notNull(),
    sourceObjectKey: text("source_object_key").notNull(),
    sourceHash: text("source_hash").notNull(),
    status: importStatusEnum("status").notNull().default("uploaded"),
    validationSummary: jsonb("validation_summary").notNull().default(sql`'{}'::jsonb`),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("imports_org_source_hash_uidx").on(table.organizationId, table.sourceHash)],
);

export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ownerMembershipId: uuid("owner_membership_id")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "cascade" }),
    page: text("page").notNull(),
    name: text("name").notNull(),
    filters: jsonb("filters").notNull(),
    layout: jsonb("layout").notNull().default(sql`'{}'::jsonb`),
    shared: boolean("shared").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("saved_views_owner_page_name_uidx").on(table.ownerMembershipId, table.page, table.name)],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    entityVersion: integer("entity_version").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    attempt: integer("attempt").notNull().default(0),
  },
  (table) => [
    index("outbox_events_unpublished_idx").on(table.publishedAt, table.createdAt),
    // WebSocket clients consume by organization and a stable time/id cursor.
    // This prevents a growing multi-tenant outbox from becoming a table scan.
    index("outbox_events_org_created_idx").on(
      table.organizationId,
      table.createdAt,
      table.id,
    ),
  ],
);
