import { createHash } from "node:crypto";

import { and, desc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@workbench/db";
import {
  auditLogs,
  exports as exportJobs,
  imports as importJobs,
  orgMemberships,
  outboxEvents,
  users,
  workSessions,
} from "@workbench/db/schema";
import {
  createWorkSessionSchema,
  parseCsv,
  stringifyCsv,
} from "@workbench/shared";

import type { AnalyticsActor, AnalyticsService } from "../analytics/service.js";
import type {
  ImportedWorkSessionInput,
  WorkSessionService,
} from "../work/service.js";
import type { ExportArtifactAccess } from "./artifact-store.js";

export class ImportValidationError extends Error {
  constructor(message: string) { super(message); this.name = "ImportValidationError"; }
}

export class ExportJobError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 409,
  ) {
    super(message);
    this.name = "ExportJobError";
  }
}

export type BackgroundExportFormat = "csv" | "json" | "xlsx" | "pdf";

export interface CreateBackgroundExportInput {
  exportType: "work_sessions";
  format: BackgroundExportFormat;
  from: Date;
  to: Date;
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
  records: ImportedWorkSessionInput[];
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
  const records: ImportedWorkSessionInput[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index]!;
    const value = (name: string) => row[headers.indexOf(name)]?.trim() ?? "";
    const membershipIdValue = value("membershipId");
    const membershipId = membershipIdValue
      ? z.uuid().safeParse(membershipIdValue)
      : null;
    if (membershipId && !membershipId.success) {
      errors.push({
        row: index + 1,
        field: "membershipId",
        message: "membershipId 必须是有效 UUID，或留空以导入到当前操作账号。",
      });
      continue;
    }
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
    if (parsed.success) {
      records.push({
        input: parsed.data,
        ...(membershipId?.success ? { membershipId: membershipId.data } : {}),
      });
    }
    else {
      for (const issue of parsed.error.issues) {
        errors.push({ row: index + 1, field: issue.path.join("."), message: issue.message });
      }
    }
  }
  return { hash: sha256(csv), rowCount: rows.length - 1, validCount: records.length, errors, records };
}

export class OperationsService {
  constructor(
    private readonly db: Database,
    private readonly analytics: AnalyticsService,
    private readonly work: WorkSessionService,
    private readonly exportStore: ExportArtifactAccess,
  ) {}

  exportCapabilities() {
    return this.exportStore.capabilities();
  }

  private exportSummary(job: typeof exportJobs.$inferSelect) {
    const expired = Boolean(
      job.status === "completed" &&
        job.expiresAt &&
        job.expiresAt.getTime() <= Date.now(),
    );
    return {
      id: job.id,
      exportType: job.exportType,
      format: job.format,
      status: expired ? "expired" : job.status,
      progress: expired ? 100 : job.progress,
      attempt: job.attempt,
      maxAttempts: job.maxAttempts,
      fileName: job.fileName,
      contentType: job.contentType,
      byteSize: job.byteSize,
      rowCount: job.rowCount,
      sha256: job.sha256,
      errorCode: job.errorSummary,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      expiresAt: job.expiresAt,
      downloadReady: Boolean(
        !expired &&
          job.status === "completed" &&
          job.objectKey &&
          job.contentType &&
          job.fileName,
      ),
    };
  }

  private async ownedBackgroundExport(actor: AnalyticsActor, exportId: string) {
    const [job] = await this.db
      .select()
      .from(exportJobs)
      .where(
        and(
          eq(exportJobs.id, exportId),
          eq(exportJobs.organizationId, actor.organizationId),
          eq(exportJobs.requestedBy, actor.membershipId),
          eq(exportJobs.deliveryMode, "background"),
        ),
      )
      .limit(1);
    if (!job) {
      throw new ExportJobError("export_not_found", "导出任务不存在。", 404);
    }
    return job;
  }

  async createBackgroundExport(
    actor: AnalyticsActor,
    input: CreateBackgroundExportInput,
  ) {
    const capabilities = this.exportStore.capabilities();
    if (!capabilities.available) {
      throw new ExportJobError(
        "export_storage_unavailable",
        capabilities.unavailableReason ?? "后台导出对象存储不可用。",
        503,
      );
    }
    const duration = input.to.getTime() - input.from.getTime();
    if (duration <= 0 || duration > 366 * 86_400_000) {
      throw new ExportJobError(
        "invalid_export_range",
        "导出时间范围必须大于零且不能超过 366 天。",
        400,
      );
    }
    const broadGrants = actor.grants.filter((grant) =>
      ["work.view_full_scope", "analytics.view_team"].includes(grant.permission),
    );
    const contentGrants = actor.grants.filter(
      (grant) => grant.permission === "work.view_full_scope",
    );
    const exportGrants = actor.grants.filter(
      (grant) => grant.permission === "export.scope",
    );
    const fieldPolicySnapshot = {
      version: 1,
      requestedBy: actor.membershipId,
      includeContent: contentGrants.some(
        (grant) => grant.scopeKind === "organization",
      ),
      contentOrganizationWide: contentGrants.some(
        (grant) => grant.scopeKind === "organization",
      ),
      contentOrgUnitIds: contentGrants
        .filter((grant) => grant.scopeKind === "org_unit" && grant.scopeId)
        .map((grant) => grant.scopeId!),
      contentProjectIds: contentGrants
        .filter((grant) => grant.scopeKind === "project" && grant.scopeId)
        .map((grant) => grant.scopeId!),
      organizationWide: broadGrants.some(
        (grant) => grant.scopeKind === "organization",
      ),
      orgUnitIds: broadGrants
        .filter((grant) => grant.scopeKind === "org_unit" && grant.scopeId)
        .map((grant) => grant.scopeId!),
      projectIds: broadGrants
        .filter((grant) => grant.scopeKind === "project" && grant.scopeId)
        .map((grant) => grant.scopeId!),
      exportOrganizationWide: exportGrants.some(
        (grant) => grant.scopeKind === "organization",
      ),
      exportSelf: exportGrants.some((grant) => grant.scopeKind === "self"),
      exportOrgUnitIds: exportGrants
        .filter((grant) => grant.scopeKind === "org_unit" && grant.scopeId)
        .map((grant) => grant.scopeId!),
      exportProjectIds: exportGrants
        .filter((grant) => grant.scopeKind === "project" && grant.scopeId)
        .map((grant) => grant.scopeId!),
    };
    const scope = {
      version: 1,
      from: input.from.toISOString(),
      to: input.to.toISOString(),
      snapshotAt: new Date().toISOString(),
    };
    const job = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(exportJobs)
        .values({
          organizationId: actor.organizationId,
          requestedBy: actor.membershipId,
          format: input.format,
          exportType: input.exportType,
          deliveryMode: "background",
          scope,
          fieldPolicySnapshot,
          status: "queued",
          progress: 0,
        })
        .returning();
      if (!created) {
        throw new ExportJobError(
          "export_enqueue_failed",
          "无法创建后台导出任务，请稍后重试。",
          500,
        );
      }
      await tx.insert(outboxEvents).values({
        organizationId: actor.organizationId,
        eventType: "export.job.queued",
        entityType: "export",
        entityId: created.id,
        entityVersion: 1,
        payload: { format: input.format, exportType: input.exportType },
      });
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "export.background_requested",
        entityType: "export",
        entityId: created.id,
        after: {
          exportType: input.exportType,
          format: input.format,
          scope,
          includeContent: fieldPolicySnapshot.includeContent,
          exportScope: {
            organizationWide: fieldPolicySnapshot.exportOrganizationWide,
            self: fieldPolicySnapshot.exportSelf,
            orgUnitCount: fieldPolicySnapshot.exportOrgUnitIds.length,
            projectCount: fieldPolicySnapshot.exportProjectIds.length,
          },
        },
      });
      return created;
    });
    return this.exportSummary(job);
  }

  async listBackgroundExports(actor: AnalyticsActor) {
    const jobs = await this.db
      .select()
      .from(exportJobs)
      .where(
        and(
          eq(exportJobs.organizationId, actor.organizationId),
          eq(exportJobs.requestedBy, actor.membershipId),
          eq(exportJobs.deliveryMode, "background"),
        ),
      )
      .orderBy(desc(exportJobs.createdAt))
      .limit(50);
    return jobs.map((job) => this.exportSummary(job));
  }

  async cancelBackgroundExport(actor: AnalyticsActor, exportId: string) {
    await this.ownedBackgroundExport(actor, exportId);
    const updated = await this.db.transaction(async (tx) => {
      const [cancelled] = await tx
        .update(exportJobs)
        .set({ status: "cancelled", completedAt: new Date() })
        .where(
          and(
            eq(exportJobs.id, exportId),
            eq(exportJobs.organizationId, actor.organizationId),
            eq(exportJobs.requestedBy, actor.membershipId),
            eq(exportJobs.deliveryMode, "background"),
            inArray(exportJobs.status, ["queued", "running"]),
          ),
        )
        .returning();
      if (!cancelled) return null;
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "export.background_cancelled",
        entityType: "export",
        entityId: exportId,
      });
      return cancelled;
    });
    if (!updated) {
      throw new ExportJobError(
        "export_not_cancellable",
        "该导出任务已结束，不能再取消。",
      );
    }
    return this.exportSummary(updated);
  }

  async retryBackgroundExport(actor: AnalyticsActor, exportId: string) {
    const existing = await this.ownedBackgroundExport(actor, exportId);
    const updated = await this.db.transaction(async (tx) => {
      const [retried] = await tx
        .update(exportJobs)
        .set({
          status: "queued",
          progress: 0,
          attempt: 0,
          errorSummary: null,
          startedAt: null,
          completedAt: null,
        })
        .where(
          and(
            eq(exportJobs.id, exportId),
            eq(exportJobs.status, "failed"),
          ),
        )
        .returning();
      if (!retried) return null;
      await tx.insert(outboxEvents).values({
        organizationId: actor.organizationId,
        eventType: "export.job.queued",
        entityType: "export",
        entityId: exportId,
        entityVersion: existing.attempt + 1,
        payload: { retry: true },
      });
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "export.background_retried",
        entityType: "export",
        entityId: exportId,
      });
      return retried;
    });
    if (!updated) {
      throw new ExportJobError(
        "export_not_retryable",
        "只有失败的导出任务可以重试。",
      );
    }
    return this.exportSummary(updated);
  }

  async backgroundExportDownload(actor: AnalyticsActor, exportId: string) {
    const job = await this.ownedBackgroundExport(actor, exportId);
    const exportScope = z
      .object({
        exportOrganizationWide: z.boolean(),
        exportSelf: z.boolean(),
        exportOrgUnitIds: z.array(z.uuid()),
        exportProjectIds: z.array(z.uuid()),
      })
      .safeParse(job.fieldPolicySnapshot);
    if (!exportScope.success) {
      throw new ExportJobError(
        "export_policy_invalid",
        "导出任务的权限快照无效，请重新创建任务。",
      );
    }
    const currentExportGrants = actor.grants.filter(
      (grant) => grant.permission === "export.scope",
    );
    const currentOrganizationWide = currentExportGrants.some(
      (grant) => grant.scopeKind === "organization",
    );
    const currentSelf = currentExportGrants.some(
      (grant) => grant.scopeKind === "self",
    );
    const currentOrgUnits = new Set(
      currentExportGrants
        .filter((grant) => grant.scopeKind === "org_unit" && grant.scopeId)
        .map((grant) => grant.scopeId!),
    );
    const currentProjects = new Set(
      currentExportGrants
        .filter((grant) => grant.scopeKind === "project" && grant.scopeId)
        .map((grant) => grant.scopeId!),
    );
    const snapshot = exportScope.data;
    const scopeStillAuthorized =
      currentOrganizationWide ||
      (!snapshot.exportOrganizationWide &&
        (!snapshot.exportSelf || currentSelf) &&
        snapshot.exportOrgUnitIds.every((id) => currentOrgUnits.has(id)) &&
        snapshot.exportProjectIds.every((id) => currentProjects.has(id)));
    if (!scopeStillAuthorized) {
      throw new ExportJobError(
        "export_scope_revoked",
        "当前导出权限已不能覆盖该任务的原始范围，请重新创建任务。",
        403,
      );
    }
    if (job.status !== "completed" || !job.objectKey || !job.fileName || !job.contentType) {
      throw new ExportJobError(
        "export_not_ready",
        "导出文件尚未生成完成。",
      );
    }
    if (!job.expiresAt || job.expiresAt.getTime() <= Date.now()) {
      throw new ExportJobError(
        "export_expired",
        "导出文件已过期，请重新创建任务。",
        410,
      );
    }
    let signed: { url: string; expiresInSeconds: number };
    try {
      signed = await this.exportStore.createDownloadUrl(
        job.objectKey,
        job.fileName,
        job.contentType,
      );
    } catch {
      throw new ExportJobError(
        "export_download_unavailable",
        "暂时无法授权下载，请稍后重试。",
        503,
      );
    }
    await this.db.insert(auditLogs).values({
      organizationId: actor.organizationId,
      actorMembershipId: actor.membershipId,
      action: "export.background_download_authorized",
      entityType: "export",
      entityId: job.id,
      after: { expiresInSeconds: signed.expiresInSeconds },
    });
    return { ...signed, fileName: job.fileName, sha256: job.sha256 };
  }

  async exportWorkSessions(actor: AnalyticsActor, from: Date, to: Date) {
    const access = await this.analytics.buildAccessCondition(actor);
    const rows = await this.db
      .select({
        session: workSessions,
        membershipId: workSessions.membershipId,
        displayName: users.displayName,
      })
      .from(workSessions)
      .innerJoin(orgMemberships, eq(orgMemberships.id, workSessions.membershipId))
      .innerJoin(users, eq(users.id, orgMemberships.userId))
      .where(and(access, gte(workSessions.startAt, from), lt(workSessions.startAt, to), eq(workSessions.recordKind, "fact"), isNull(workSessions.deletedAt)))
      .orderBy(workSessions.startAt);
    const includeContent = actor.grants.some((grant) => grant.permission === "work.view_full_scope" && grant.scopeKind === "organization");
    const csv = stringifyCsv([
      ["id", "membershipId", "member", "startAt", "endAt", "timezone", "grossSeconds", "breakSeconds", "netSeconds", "source", "content", "result", "visibility", "submissionStatus", "approvalStatus", "version"],
      ...rows.map(({ session, membershipId, displayName }) => [session.id, membershipId, displayName, session.startAt.toISOString(), session.endAt.toISOString(), session.timezone, session.grossSeconds, session.breakSeconds, session.netSeconds, session.source, includeContent || session.membershipId === actor.membershipId ? session.content : "[按字段策略隐藏]", includeContent || session.membershipId === actor.membershipId ? session.result : "[按字段策略隐藏]", session.visibility, session.submissionStatus, session.approvalStatus, session.version]),
    ]);
    const digest = sha256(csv);
    const [job] = await this.db.insert(exportJobs).values({ organizationId: actor.organizationId, requestedBy: actor.membershipId, format: "csv", exportType: "work_sessions", scope: { from, to }, fieldPolicySnapshot: { includeContent }, status: "completed", sha256: digest, completedAt: new Date(), expiresAt: new Date(Date.now() + 24 * 60 * 60_000) }).returning();
    if (job) await this.db.insert(auditLogs).values({ organizationId: actor.organizationId, actorMembershipId: actor.membershipId, action: "export.work_sessions", entityType: "export", entityId: job.id, after: { rowCount: rows.length, sha256: digest, includeContent } });
    return { csv, sha256: digest, rowCount: rows.length };
  }

  async exportWorkSessionsJson(actor: AnalyticsActor, from: Date, to: Date) {
    const access = await this.analytics.buildAccessCondition(actor);
    const rows = await this.db
      .select({ session: workSessions, membershipId: workSessions.membershipId, displayName: users.displayName })
      .from(workSessions)
      .innerJoin(orgMemberships, eq(orgMemberships.id, workSessions.membershipId))
      .innerJoin(users, eq(users.id, orgMemberships.userId))
      .where(and(access, gte(workSessions.startAt, from), lt(workSessions.startAt, to), eq(workSessions.recordKind, "fact"), isNull(workSessions.deletedAt)))
      .orderBy(workSessions.startAt);
    const includeContent = actor.grants.some((grant) => grant.permission === "work.view_full_scope" && grant.scopeKind === "organization");
    const payload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      range: { from: from.toISOString(), to: to.toISOString() },
      rowCount: rows.length,
      items: rows.map(({ session, membershipId, displayName }) => ({
        id: session.id,
        membershipId,
        member: displayName,
        startAt: session.startAt.toISOString(),
        endAt: session.endAt.toISOString(),
        timezone: session.timezone,
        grossSeconds: session.grossSeconds,
        breakSeconds: session.breakSeconds,
        netSeconds: session.netSeconds,
        source: session.source,
        content: includeContent || membershipId === actor.membershipId ? session.content : "[按字段策略隐藏]",
        result: includeContent || membershipId === actor.membershipId ? session.result : "[按字段策略隐藏]",
        visibility: session.visibility,
        submissionStatus: session.submissionStatus,
        approvalStatus: session.approvalStatus,
        version: session.version,
      })),
    };
    const json = JSON.stringify(payload, null, 2);
    const digest = sha256(json);
    const [job] = await this.db.insert(exportJobs).values({ organizationId: actor.organizationId, requestedBy: actor.membershipId, format: "json", exportType: "work_sessions", scope: { from, to }, fieldPolicySnapshot: { includeContent }, status: "completed", sha256: digest, completedAt: new Date(), expiresAt: new Date(Date.now() + 24 * 60 * 60_000) }).returning();
    if (job) await this.db.insert(auditLogs).values({ organizationId: actor.organizationId, actorMembershipId: actor.membershipId, action: "export.work_sessions_json", entityType: "export", entityId: job.id, after: { rowCount: rows.length, sha256: digest, includeContent } });
    return { json, sha256: digest, rowCount: rows.length };
  }

  async createImportPreview(actor: AnalyticsActor, csv: string) {
    const preview = previewWorkSessionCsv(csv);
    if (preview.rowCount === 0) {
      throw new ImportValidationError("CSV 至少需要包含一条数据记录。")
    }
    const validationSummary = {
      rowCount: preview.rowCount,
      validCount: preview.validCount,
      errors: preview.errors.slice(0, 500),
    };
    const [created] = await this.db
      .insert(importJobs)
      .values({
        organizationId: actor.organizationId,
        requestedBy: actor.membershipId,
        importType: "work_sessions_csv",
        sourceObjectKey: `inline://${preview.hash}`,
        sourceHash: preview.hash,
        status: "preview_ready",
        validationSummary,
      })
      .onConflictDoNothing()
      .returning();
    if (created) {
      return {
        importId: created.id,
        hash: preview.hash,
        rowCount: preview.rowCount,
        validCount: preview.validCount,
        errors: preview.errors,
      };
    }
    const [existing] = await this.db
      .select()
      .from(importJobs)
      .where(
        and(
          eq(importJobs.organizationId, actor.organizationId),
          eq(importJobs.sourceHash, preview.hash),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new ImportValidationError("导入预览创建冲突，请重新选择文件后再试。")
    }
    if (existing.requestedBy !== actor.membershipId) {
      throw new ImportValidationError(
        "相同内容正在由其他受权操作处理；请勿并发重复导入。",
      );
    }
    if (existing.status === "completed") {
      throw new ImportValidationError(
        "该文件已经成功导入。为避免重复事实，请修正源文件后重新预览。",
      );
    }
    if (existing.status === "importing") {
      throw new ImportValidationError("该文件正在原子导入，请等待当前操作完成。")
    }
    const [job] = await this.db
      .update(importJobs)
      .set({ status: "preview_ready", validationSummary, completedAt: null })
      .where(
        and(
          eq(importJobs.id, existing.id),
          eq(importJobs.requestedBy, actor.membershipId),
          eq(importJobs.status, "failed"),
        ),
      )
      .returning();
    if (!job && existing.status !== "preview_ready") {
      throw new ImportValidationError("导入任务状态已变化，请刷新预览后再试。")
    }
    return {
      importId: job?.id ?? existing.id,
      hash: preview.hash,
      rowCount: preview.rowCount,
      validCount: preview.validCount,
      errors: preview.errors,
    };
  }

  async confirmImport(actor: AnalyticsActor, importId: string, csv: string) {
    const preview = previewWorkSessionCsv(csv);
    if (preview.rowCount === 0) {
      throw new ImportValidationError("CSV 至少需要包含一条数据记录。")
    }
    if (preview.errors.length > 0) throw new ImportValidationError("预览仍包含错误，不能确认导入。")
    // Claim the preview with a compare-and-set transition. Two browser tabs
    // cannot both turn the same preview into independent batches of facts.
    let claimed = false;
    try {
      const importedCount = await this.db.transaction(async (tx) => {
        const [job] = await tx
          .update(importJobs)
          .set({ status: "importing", confirmedAt: new Date() })
          .where(
            and(
              eq(importJobs.id, importId),
              eq(importJobs.organizationId, actor.organizationId),
              eq(importJobs.requestedBy, actor.membershipId),
              eq(importJobs.sourceHash, preview.hash),
              eq(importJobs.status, "preview_ready"),
            ),
          )
          .returning();
        if (!job) {
          throw new ImportValidationError(
            "导入内容与预览不一致，或该任务已被处理。",
          );
        }
        claimed = true;
        const created = await this.work.createManualBatchForMembersWithExecutor(
          tx,
          actor,
          preview.records,
        );
        await tx
          .update(importJobs)
          .set({
            status: "completed",
            completedAt: new Date(),
            validationSummary: {
              rowCount: preview.rowCount,
              validCount: preview.validCount,
              errors: preview.errors.slice(0, 500),
              importedCount: created.length,
            },
          })
          .where(eq(importJobs.id, job.id));
        await tx.insert(auditLogs).values({
          organizationId: actor.organizationId,
          actorMembershipId: actor.membershipId,
          action: "import.work_sessions",
          entityType: "import",
          entityId: job.id,
          after: { importedCount: created.length, sourceHash: preview.hash },
        });
        return created.length;
      });
      return { importedCount };
    } catch (error) {
      if (claimed) {
        await this.db
          .update(importJobs)
          .set({
            status: "failed",
            completedAt: new Date(),
            validationSummary: {
              rowCount: preview.rowCount,
              validCount: preview.validCount,
              errors: preview.errors.slice(0, 500),
              error:
                error instanceof Error ? error.message : "Unknown import error",
            },
          })
          .where(
            and(
              eq(importJobs.id, importId),
              eq(importJobs.organizationId, actor.organizationId),
              eq(importJobs.status, "importing"),
            ),
          );
      }
      throw error;
    }
  }

  async audit(actor: AnalyticsActor, limit: number, before?: Date) {
    return this.db.select().from(auditLogs).where(and(eq(auditLogs.organizationId, actor.organizationId), before ? lt(auditLogs.createdAt, before) : undefined)).orderBy(desc(auditLogs.createdAt)).limit(limit);
  }
}
