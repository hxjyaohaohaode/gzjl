import { sql } from "drizzle-orm";
import {
  bigint,
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

export const compensationTypeEnum = pgEnum("compensation_type", [
  "hourly",
  "daily",
  "monthly",
  "fixed_period",
  "project_based",
  "hybrid",
]);
export const rateRuleTypeEnum = pgEnum("rate_rule_type", [
  "weekday",
  "weekend",
  "holiday",
  "night_window",
  "overtime",
  "allowance",
  "bonus",
  "deduction",
  "rounding",
  "minimum_billable_unit",
]);
export const payPeriodStatusEnum = pgEnum("pay_period_status", [
  "open",
  "calculating",
  "pending_confirmation",
  "settled",
  "locked",
]);
export const payrollRunStatusEnum = pgEnum("payroll_run_status", [
  "queued",
  "calculating",
  "review_required",
  "ready",
  "settled",
  "failed",
  "cancelled",
]);
export const payrollComponentTypeEnum = pgEnum("payroll_component_type", [
  "base",
  "weekday",
  "weekend",
  "holiday",
  "night",
  "overtime",
  "project",
  "allowance",
  "bonus",
  "deduction",
  "rounding",
  "correction",
]);

export const compensationPlans = pgTable(
  "compensation_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    type: compensationTypeEnum("type").notNull(),
    currency: text("currency").notNull().default("CNY"),
    activeVersion: integer("active_version").notNull().default(1),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("compensation_plans_member_name_uidx").on(table.membershipId, table.name),
    index("compensation_plans_org_member_idx").on(table.organizationId, table.membershipId),
  ],
);

export const compensationPlanVersions = pgTable(
  "compensation_plan_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    compensationPlanId: uuid("compensation_plan_id")
      .notNull()
      .references(() => compensationPlans.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    type: compensationTypeEnum("type").notNull(),
    baseAmount: numeric("base_amount", { precision: 20, scale: 6 }).notNull().default("0"),
    baseUnit: text("base_unit").notNull(),
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
    pendingReviewCountsInEstimate: boolean("pending_review_counts_in_estimate")
      .notNull()
      .default(true),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("compensation_plan_versions_plan_version_uidx").on(
      table.compensationPlanId,
      table.version,
    ),
    index("compensation_plan_versions_effective_idx").on(
      table.compensationPlanId,
      table.effectiveFrom,
    ),
  ],
);

export const rateRules = pgTable(
  "rate_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    compensationPlanVersionId: uuid("compensation_plan_version_id")
      .notNull()
      .references(() => compensationPlanVersions.id, { onDelete: "cascade" }),
    type: rateRuleTypeEnum("type").notNull(),
    priority: integer("priority").notNull().default(100),
    conditions: jsonb("conditions").notNull().default(sql`'{}'::jsonb`),
    calculation: jsonb("calculation").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("rate_rules_plan_priority_idx").on(table.compensationPlanVersionId, table.priority)],
);

export const payPeriods = pgTable(
  "pay_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    timezone: text("timezone").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    cutoffAt: timestamp("cutoff_at", { withTimezone: true }).notNull(),
    status: payPeriodStatusEnum("status").notNull().default("open"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("pay_periods_org_range_uidx").on(
      table.organizationId,
      table.startsAt,
      table.endsAt,
    ),
    index("pay_periods_org_status_idx").on(table.organizationId, table.status),
    check("pay_periods_time_order_check", sql`${table.endsAt} > ${table.startsAt}`),
  ],
);

export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    payPeriodId: uuid("pay_period_id")
      .notNull()
      .references(() => payPeriods.id, { onDelete: "restrict" }),
    runNumber: integer("run_number").notNull(),
    status: payrollRunStatusEnum("status").notNull().default("queued"),
    calculationVersion: text("calculation_version").notNull(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    inputHash: text("input_hash").notNull(),
    errorSummary: text("error_summary"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("payroll_runs_period_number_uidx").on(table.payPeriodId, table.runNumber),
    uniqueIndex("payroll_runs_period_input_hash_uidx").on(table.payPeriodId, table.inputHash),
  ],
);

export const payrollItems = pgTable(
  "payroll_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    payrollRunId: uuid("payroll_run_id")
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "restrict" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    compensationPlanVersionId: uuid("compensation_plan_version_id")
      .notNull()
      .references(() => compensationPlanVersions.id, { onDelete: "restrict" }),
    currency: text("currency").notNull(),
    approvedSeconds: bigint("approved_seconds", { mode: "number" }).notNull().default(0),
    pendingSeconds: bigint("pending_seconds", { mode: "number" }).notNull().default(0),
    grossAmount: numeric("gross_amount", { precision: 20, scale: 6 }).notNull(),
    adjustmentAmount: numeric("adjustment_amount", { precision: 20, scale: 6 })
      .notNull()
      .default("0"),
    finalAmount: numeric("final_amount", { precision: 20, scale: 6 }).notNull(),
    estimate: boolean("estimate").notNull().default(false),
    needsReview: boolean("needs_review").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("payroll_items_run_member_uidx").on(table.payrollRunId, table.membershipId),
    index("payroll_items_member_idx").on(table.membershipId, table.createdAt),
    check(
      "payroll_items_amount_consistency_check",
      sql`${table.finalAmount} = ${table.grossAmount} + ${table.adjustmentAmount}`,
    ),
  ],
);

export const payrollItemComponents = pgTable(
  "payroll_item_components",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    payrollItemId: uuid("payroll_item_id")
      .notNull()
      .references(() => payrollItems.id, { onDelete: "restrict" }),
    type: payrollComponentTypeEnum("type").notNull(),
    label: text("label").notNull(),
    sourceEntityType: text("source_entity_type"),
    sourceEntityId: uuid("source_entity_id"),
    sourceVersion: text("source_version"),
    quantity: numeric("quantity", { precision: 20, scale: 6 }),
    unit: text("unit"),
    rate: numeric("rate", { precision: 20, scale: 6 }),
    multiplier: numeric("multiplier", { precision: 12, scale: 6 }),
    amount: numeric("amount", { precision: 20, scale: 6 }).notNull(),
    calculationTrace: jsonb("calculation_trace").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("payroll_item_components_item_idx").on(table.payrollItemId, table.type)],
);

export const payrollAdjustments = pgTable(
  "payroll_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    payPeriodId: uuid("pay_period_id")
      .notNull()
      .references(() => payPeriods.id, { onDelete: "restrict" }),
    amount: numeric("amount", { precision: 20, scale: 6 }).notNull(),
    currency: text("currency").notNull(),
    reason: text("reason").notNull(),
    sourceEntityType: text("source_entity_type"),
    sourceEntityId: uuid("source_entity_id"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    approvedBy: uuid("approved_by").references(() => orgMemberships.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("payroll_adjustments_period_member_idx").on(table.payPeriodId, table.membershipId)],
);

export const payrollSnapshots = pgTable(
  "payroll_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    payrollRunId: uuid("payroll_run_id")
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "restrict" }),
    snapshotHash: text("snapshot_hash").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("payroll_snapshots_run_uidx").on(table.payrollRunId)],
);

export const payslips = pgTable(
  "payslips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    payrollItemId: uuid("payroll_item_id")
      .notNull()
      .references(() => payrollItems.id, { onDelete: "restrict" }),
    documentAttachmentId: uuid("document_attachment_id"),
    documentHash: text("document_hash").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("payslips_item_uidx").on(table.payrollItemId)],
);
