import { sql } from "drizzle-orm";
import {
  bigint,
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

export const attachmentKindEnum = pgEnum("attachment_kind", ["file", "url", "text"]);
export const attachmentVisibilityEnum = pgEnum("attachment_visibility", [
  "private",
  "management_only",
  "project_visible",
]);
export const attachmentStatusEnum = pgEnum("attachment_status", [
  "pending_upload",
  "available",
  "upload_failed",
  "quarantined",
  "deleted",
]);

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    kind: attachmentKindEnum("kind").notNull(),
    status: attachmentStatusEnum("status").notNull().default("pending_upload"),
    originalName: text("original_name"),
    objectKey: text("object_key"),
    externalUrl: text("external_url"),
    textContent: text("text_content"),
    mimeType: text("mime_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    sha256: text("sha256"),
    visibility: attachmentVisibilityEnum("visibility")
      .notNull()
      .default("management_only"),
    note: text("note"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    version: integer("version").notNull().default(1),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("attachments_object_key_uidx").on(table.objectKey),
    index("attachments_org_status_idx").on(table.organizationId, table.status),
    index("attachments_uploaded_by_idx").on(table.uploadedBy, table.uploadedAt),
  ],
);

export const attachmentVersions = pgTable(
  "attachment_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attachmentId: uuid("attachment_id")
      .notNull()
      .references(() => attachments.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    objectKey: text("object_key"),
    sha256: text("sha256"),
    replacedBy: uuid("replaced_by")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("attachment_versions_attachment_version_uidx").on(table.attachmentId, table.version)],
);

export const attachmentLinks = pgTable(
  "attachment_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attachmentId: uuid("attachment_id")
      .notNull()
      .references(() => attachments.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => orgMemberships.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("attachment_links_attachment_entity_uidx").on(
      table.attachmentId,
      table.entityType,
      table.entityId,
    ),
    index("attachment_links_entity_idx").on(table.entityType, table.entityId),
  ],
);
