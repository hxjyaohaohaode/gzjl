import { createHash } from "node:crypto";

import { and, desc, eq, gte, isNull, lt } from "drizzle-orm";
import type { Database } from "@workbench/db";
import {
  auditLogs,
  exports as exportJobs,
  imports as importJobs,
  orgMemberships,
  users,
  workSessions,
} from "@workbench/db/schema";
import {
  createWorkSessionSchema,
  parseCsv,
  stringifyCsv,
  type CreateWorkSessionInput,
} from "@workbench/shared";

import type { AnalyticsActor, AnalyticsService } from "../analytics/service.js";
import type { WorkSessionService } from "../work/service.js";

export class ImportValidationError extends Error {
  constructor(message: string) { super(message); this.name = "ImportValidationError"; }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const requiredHeaders = ["startAt", "endAt", "content"] as const;

export interface ImportPreview {
  hash: string;
  rowCount: number;
  validCount: number;
  errors: Array<{ row: number; field: string; message: string }>;
  records: CreateWorkSessionInput[];
}

export function previewWorkSessionCsv(csv: string): ImportPreview {
  if (Buffer.byteLength(csv, "utf8") > 5 * 1024 * 1024) {
    throw new ImportValidationError("CSV 文件不能超过 5 MB。")
  }
  const rows = parseCsv(csv);
  if (rows.length === 0) throw new ImportValidationError("CSV 内容为空。")
  if (rows.length > 10_001) throw new ImportValidationError("单次最多导入 10,000 条记录。")
  const headers = rows[0]!.map((value) => value.trim());
  for (const header of requiredHeaders) {
    if (!headers.includes(header)) throw new ImportValidationError(`缺少必需列 ${header}。`);
  }
  const errors: ImportPreview["errors"] = [];
  const records: CreateWorkSessionInput[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index]!;
    const value = (name: string) => row[headers.indexOf(name)]?.trim() ?? "";
    const parsed = createWorkSessionSchema.safeParse({
      startAt: value("startAt"),
      endAt: value("endAt"),
      timezone: value("timezone") || "Asia/Shanghai",
      source: "import",
      content: value("content"),
      result: value("result"),
      blockers: value("blockers"),
      nextStep: value("nextStep"),
      primaryProjectNodeId: value("primaryProjectNodeId") || null,
      visibility: value("visibility") || "management_only",
      parallelWork: ["true", "1", "yes"].includes(value("parallelWork").toLowerCase()),
      breaks: [],
    });
    if (parsed.success) records.push(parsed.data);
    else {
      for (const issue of parsed.error.issues) {
        errors.push({ row: index + 1, field: issue.path.join("."), message: issue.message });
      }
    }
  }
  return { hash: sha256(csv), rowCount: rows.length - 1, validCount: records.length, errors, records };
}

export class OperationsService {
  constructor(private readonly db: Database, private readonly analytics: AnalyticsService, private readonly work: WorkSessionService) {}

  async exportWorkSessions(actor: AnalyticsActor, from: Date, to: Date) {
    const access = await this.analytics.buildAccessCondition(actor);
    const rows = await this.db
      .select({ session: workSessions, displayName: users.displayName })
      .from(workSessions)
      .innerJoin(orgMemberships, eq(orgMemberships.id, workSessions.membershipId))
      .innerJoin(users, eq(users.id, orgMemberships.userId))
      .where(and(access, gte(workSessions.startAt, from), lt(workSessions.startAt, to), isNull(workSessions.deletedAt)))
      .orderBy(workSessions.startAt);
    const includeContent = actor.grants.some((grant) => grant.permission === "work.view_full_scope" && grant.scopeKind === "organization");
    const csv = stringifyCsv([
      ["id", "member", "startAt", "endAt", "timezone", "grossSeconds", "breakSeconds", "netSeconds", "source", "content", "result", "visibility", "submissionStatus", "approvalStatus", "version"],
      ...rows.map(({ session, displayName }) => [session.id, displayName, session.startAt.toISOString(), session.endAt.toISOString(), session.timezone, session.grossSeconds, session.breakSeconds, session.netSeconds, session.source, includeContent || session.membershipId === actor.membershipId ? session.content : "[按字段策略隐藏]", includeContent || session.membershipId === actor.membershipId ? session.result : "[按字段策略隐藏]", session.visibility, session.submissionStatus, session.approvalStatus, session.version]),
    ]);
    const digest = sha256(csv);
    const [job] = await this.db.insert(exportJobs).values({ organizationId: actor.organizationId, requestedBy: actor.membershipId, format: "csv", exportType: "work_sessions", scope: { from, to }, fieldPolicySnapshot: { includeContent }, status: "completed", sha256: digest, completedAt: new Date(), expiresAt: new Date(Date.now() + 24 * 60 * 60_000) }).returning();
    if (job) await this.db.insert(auditLogs).values({ organizationId: actor.organizationId, actorMembershipId: actor.membershipId, action: "export.work_sessions", entityType: "export", entityId: job.id, after: { rowCount: rows.length, sha256: digest, includeContent } });
    return { csv, sha256: digest, rowCount: rows.length };
  }

  async createImportPreview(actor: AnalyticsActor, csv: string) {
    const preview = previewWorkSessionCsv(csv);
    const [job] = await this.db.insert(importJobs).values({ organizationId: actor.organizationId, requestedBy: actor.membershipId, importType: "work_sessions_csv", sourceObjectKey: `inline://${preview.hash}`, sourceHash: preview.hash, status: "preview_ready", validationSummary: { rowCount: preview.rowCount, validCount: preview.validCount, errors: preview.errors.slice(0, 500) } }).onConflictDoUpdate({ target: [importJobs.organizationId, importJobs.sourceHash], set: { validationSummary: { rowCount: preview.rowCount, validCount: preview.validCount, errors: preview.errors.slice(0, 500) }, status: "preview_ready" } }).returning();
    return { importId: job?.id, hash: preview.hash, rowCount: preview.rowCount, validCount: preview.validCount, errors: preview.errors };
  }

  async confirmImport(actor: AnalyticsActor, importId: string, csv: string) {
    const preview = previewWorkSessionCsv(csv);
    if (preview.errors.length > 0) throw new ImportValidationError("预览仍包含错误，不能确认导入。")
    const [job] = await this.db.select().from(importJobs).where(and(eq(importJobs.id, importId), eq(importJobs.organizationId, actor.organizationId), eq(importJobs.requestedBy, actor.membershipId))).limit(1);
    if (!job || job.sourceHash !== preview.hash || job.status !== "preview_ready") throw new ImportValidationError("导入内容与预览不一致，或该任务已被处理。")
    await this.db.update(importJobs).set({ status: "importing", confirmedAt: new Date() }).where(eq(importJobs.id, job.id));
    let importedCount = 0;
    try {
      for (const record of preview.records) {
        await this.work.createManual(actor, record);
        importedCount += 1;
      }
      await this.db.update(importJobs).set({ status: "completed", completedAt: new Date(), validationSummary: { ...preview, records: undefined, importedCount } }).where(eq(importJobs.id, job.id));
      await this.db.insert(auditLogs).values({ organizationId: actor.organizationId, actorMembershipId: actor.membershipId, action: "import.work_sessions", entityType: "import", entityId: job.id, after: { importedCount, sourceHash: preview.hash } });
      return { importedCount };
    } catch (error) {
      await this.db.update(importJobs).set({ status: "failed", completedAt: new Date(), validationSummary: { importedCount, error: error instanceof Error ? error.message : "Unknown import error" } }).where(eq(importJobs.id, job.id));
      throw error;
    }
  }

  async audit(actor: AnalyticsActor, limit: number, before?: Date) {
    return this.db.select().from(auditLogs).where(and(eq(auditLogs.organizationId, actor.organizationId), before ? lt(auditLogs.createdAt, before) : undefined)).orderBy(desc(auditLogs.createdAt)).limit(limit);
  }
}
