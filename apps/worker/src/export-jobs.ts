import { createHash } from "node:crypto";

import { DeleteObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { and, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import type { Database } from "@workbench/db";
import {
  auditLogs,
  exports as exportJobs,
  notificationPreferences,
  notifications,
  orgMemberships,
  outboxEvents,
  projectNodes,
  projects,
  users,
  workSessionProjectLinks,
  workSessions,
  workTypes,
} from "@workbench/db/schema";

import {
  renderWorkSessionExport,
  type BackgroundExportFormat,
  type WorkSessionExportDocument,
  type WorkSessionExportRow,
} from "./export-files.js";

const MAX_EXPORT_ROWS = 50_000;
const MAX_EXPORT_TEXT_BYTES = 25 * 1024 * 1024;
const EXPORT_RETENTION_MS = 24 * 60 * 60_000;

const scopeSchema = z.object({
  version: z.literal(1),
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  snapshotAt: z.iso.datetime({ offset: true }),
});

const fieldPolicySchema = z.object({
  version: z.literal(1),
  requestedBy: z.uuid(),
  includeContent: z.boolean(),
  contentOrganizationWide: z.boolean().default(false),
  contentOrgUnitIds: z.array(z.uuid()).default([]),
  contentProjectIds: z.array(z.uuid()).default([]),
  organizationWide: z.boolean(),
  orgUnitIds: z.array(z.uuid()),
  projectIds: z.array(z.uuid()),
  exportOrganizationWide: z.boolean(),
  exportSelf: z.boolean(),
  exportOrgUnitIds: z.array(z.uuid()),
  exportProjectIds: z.array(z.uuid()),
});

const formatSchema = z.enum(["csv", "json", "xlsx", "pdf"]);

class WorkerExportError extends Error {
  constructor(
    readonly code: string,
    readonly permanent: boolean,
  ) {
    super(code);
    this.name = "WorkerExportError";
  }
}

export interface ExportObjectStore {
  client: S3Client;
  bucket: string;
}

async function eventEnabled(db: Database, membershipId: string, category: string) {
  const [preference] = await db
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.membershipId, membershipId),
        eq(notificationPreferences.category, category),
      ),
    )
    .limit(1);
  if (!preference) return true;
  if (preference.mutedUntil && preference.mutedUntil > new Date()) return false;
  return preference.inAppEnabled || preference.pushEnabled;
}

function messageForError(code: string): string {
  switch (code) {
    case "export_storage_unavailable":
      return "后台导出存储尚未配置，请联系 Owner 完成对象存储设置。";
    case "export_too_large":
      return `本次范围超过 ${MAX_EXPORT_ROWS.toLocaleString("zh-CN")} 条或文本体积超过 25 MiB，请缩小时间范围后重试。`;
    case "export_job_invalid":
      return "导出任务参数无效，请重新创建任务。";
    default:
      return "导出生成失败，真实业务数据未受影响，可以稍后重试。";
  }
}

async function deleteObjectQuietly(store: ExportObjectStore, objectKey: string) {
  try {
    await store.client.send(
      new DeleteObjectCommand({ Bucket: store.bucket, Key: objectKey }),
    );
  } catch {
    // The periodic expiry cleanup will retry any object that is still attached
    // to a completed job. For a failed pre-completion upload, the bucket's own
    // lifecycle policy is the final safety net.
  }
}

export function createExportJobRuntime(
  db: Database,
  boss: PgBoss,
  store: ExportObjectStore | null,
) {
  async function enqueue(jobId: string): Promise<void> {
    const [job] = await db
      .select({
        id: exportJobs.id,
        status: exportJobs.status,
        deliveryMode: exportJobs.deliveryMode,
        maxAttempts: exportJobs.maxAttempts,
      })
      .from(exportJobs)
      .where(eq(exportJobs.id, jobId))
      .limit(1);
    if (!job || job.deliveryMode !== "background" || job.status !== "queued") return;
    await boss.send(
      "export-generate",
      { jobId: job.id },
      {
        singletonKey: job.id,
        retryLimit: Math.max(0, job.maxAttempts - 1),
        retryDelay: 30,
      },
    );
  }

  async function recoverExpiredLeases(): Promise<void> {
    await db
      .update(exportJobs)
      .set({
        status: "queued",
        progress: 0,
        errorSummary: "export_lease_expired",
        startedAt: null,
      })
      .where(
        and(
          eq(exportJobs.deliveryMode, "background"),
          eq(exportJobs.status, "running"),
          lt(exportJobs.startedAt, new Date(Date.now() - 15 * 60_000)),
        ),
      );
  }

  async function dispatch(): Promise<void> {
    await recoverExpiredLeases();
    const queued = await db
      .select({ id: exportJobs.id })
      .from(exportJobs)
      .where(
        and(
          eq(exportJobs.deliveryMode, "background"),
          eq(exportJobs.status, "queued"),
        ),
      )
      .limit(50);
    for (const job of queued) await enqueue(job.id);
  }

  async function updateProgress(jobId: string, progress: number) {
    await db
      .update(exportJobs)
      .set({ progress })
      .where(and(eq(exportJobs.id, jobId), eq(exportJobs.status, "running")));
  }

  async function process(jobId: string): Promise<void> {
    const [claimed] = await db
      .update(exportJobs)
      .set({
        status: "running",
        progress: 5,
        attempt: sql`${exportJobs.attempt} + 1`,
        startedAt: new Date(),
        completedAt: null,
        errorSummary: null,
      })
      .where(
        and(
          eq(exportJobs.id, jobId),
          eq(exportJobs.deliveryMode, "background"),
          eq(exportJobs.status, "queued"),
        ),
      )
      .returning();
    if (!claimed) return;

    let uploadedObjectKey: string | null = null;
    try {
      if (!store) throw new WorkerExportError("export_storage_unavailable", true);
      if (claimed.exportType !== "work_sessions") {
        throw new WorkerExportError("export_job_invalid", true);
      }
      const parsedScope = scopeSchema.safeParse(claimed.scope);
      const parsedPolicy = fieldPolicySchema.safeParse(claimed.fieldPolicySnapshot);
      const parsedFormat = formatSchema.safeParse(claimed.format);
      if (
        !parsedScope.success ||
        !parsedPolicy.success ||
        !parsedFormat.success ||
        parsedPolicy.data.requestedBy !== claimed.requestedBy
      ) {
        throw new WorkerExportError("export_job_invalid", true);
      }
      const scope = parsedScope.data;
      const policy = parsedPolicy.data;
      const format: BackgroundExportFormat = parsedFormat.data;
      if (
        !policy.exportOrganizationWide &&
        !policy.exportSelf &&
        policy.exportOrgUnitIds.length === 0 &&
        policy.exportProjectIds.length === 0
      ) {
        throw new WorkerExportError("export_job_invalid", true);
      }

      const dataAccessConditions = [eq(workSessions.membershipId, policy.requestedBy)];
      if (!policy.organizationWide && policy.orgUnitIds.length > 0) {
        const members = await db
          .select({ id: orgMemberships.id })
          .from(orgMemberships)
          .where(
            and(
              eq(orgMemberships.organizationId, claimed.organizationId),
              inArray(orgMemberships.orgUnitId, policy.orgUnitIds),
            ),
          );
        if (members.length > 0) {
          dataAccessConditions.push(
            inArray(workSessions.membershipId, members.map((member) => member.id)),
          );
        }
      }
      if (!policy.organizationWide && policy.projectIds.length > 0) {
        const linkedSessions = await db
          .select({ id: workSessionProjectLinks.workSessionId })
          .from(workSessionProjectLinks)
          .where(inArray(workSessionProjectLinks.projectId, policy.projectIds));
        if (linkedSessions.length > 0) {
          dataAccessConditions.push(
            inArray(workSessions.id, linkedSessions.map((session) => session.id)),
          );
        }
      }

      const exportAccessConditions = policy.exportSelf
        ? [eq(workSessions.membershipId, policy.requestedBy)]
        : [];
      if (!policy.exportOrganizationWide && policy.exportOrgUnitIds.length > 0) {
        const members = await db
          .select({ id: orgMemberships.id })
          .from(orgMemberships)
          .where(
            and(
              eq(orgMemberships.organizationId, claimed.organizationId),
              inArray(orgMemberships.orgUnitId, policy.exportOrgUnitIds),
            ),
          );
        if (members.length > 0) {
          exportAccessConditions.push(
            inArray(workSessions.membershipId, members.map((member) => member.id)),
          );
        }
      }
      if (!policy.exportOrganizationWide && policy.exportProjectIds.length > 0) {
        const linkedSessions = await db
          .select({ id: workSessionProjectLinks.workSessionId })
          .from(workSessionProjectLinks)
          .where(
            inArray(workSessionProjectLinks.projectId, policy.exportProjectIds),
          );
        if (linkedSessions.length > 0) {
          exportAccessConditions.push(
            inArray(workSessions.id, linkedSessions.map((session) => session.id)),
          );
        }
      }

      const contentMembershipIds = new Set<string>();
      if (!policy.contentOrganizationWide && policy.contentOrgUnitIds.length > 0) {
        const members = await db
          .select({ id: orgMemberships.id })
          .from(orgMemberships)
          .where(
            and(
              eq(orgMemberships.organizationId, claimed.organizationId),
              inArray(orgMemberships.orgUnitId, policy.contentOrgUnitIds),
            ),
          );
        for (const member of members) contentMembershipIds.add(member.id);
      }
      const contentSessionIds = new Set<string>();
      if (!policy.contentOrganizationWide && policy.contentProjectIds.length > 0) {
        const sessions = await db
          .select({ id: workSessionProjectLinks.workSessionId })
          .from(workSessionProjectLinks)
          .where(
            inArray(workSessionProjectLinks.projectId, policy.contentProjectIds),
          );
        for (const session of sessions) contentSessionIds.add(session.id);
      }

      await updateProgress(claimed.id, 20);
      const workFilter = and(
        eq(workSessions.organizationId, claimed.organizationId),
        policy.organizationWide ? undefined : or(...dataAccessConditions),
        policy.exportOrganizationWide ? undefined : or(...exportAccessConditions),
        gte(workSessions.startAt, new Date(scope.from)),
        lt(workSessions.startAt, new Date(scope.to)),
        lte(workSessions.createdAt, new Date(scope.snapshotAt)),
        eq(workSessions.recordKind, "fact"),
        isNull(workSessions.deletedAt),
      );
      const [size] = await db
        .select({
          rowCount: sql<number>`count(*)::int`,
          textBytes: sql<number>`coalesce(sum(octet_length(${workSessions.content}) + octet_length(${workSessions.result}) + octet_length(${workSessions.blockers}) + octet_length(${workSessions.nextStep})), 0)::bigint`,
        })
        .from(workSessions)
        .where(workFilter);
      if (
        Number(size?.rowCount ?? 0) > MAX_EXPORT_ROWS ||
        Number(size?.textBytes ?? 0) > MAX_EXPORT_TEXT_BYTES
      ) {
        throw new WorkerExportError("export_too_large", true);
      }
      const rows = await db
        .select({
          session: workSessions,
          displayName: users.displayName,
          projectName: projects.name,
          projectNodeTitle: projectNodes.title,
          workTypeName: workTypes.name,
        })
        .from(workSessions)
        .innerJoin(orgMemberships, eq(orgMemberships.id, workSessions.membershipId))
        .innerJoin(users, eq(users.id, orgMemberships.userId))
        .leftJoin(projectNodes, eq(projectNodes.id, workSessions.primaryProjectNodeId))
        .leftJoin(projects, eq(projects.id, projectNodes.projectId))
        .leftJoin(workTypes, eq(workTypes.id, workSessions.workTypeId))
        .where(workFilter)
        .orderBy(workSessions.startAt)
        .limit(MAX_EXPORT_ROWS);

      const items: WorkSessionExportRow[] = rows.map(({
        session,
        displayName,
        projectName,
        projectNodeTitle,
        workTypeName,
      }) => {
        const canReadSensitive =
          policy.contentOrganizationWide ||
          policy.includeContent ||
          session.membershipId === policy.requestedBy ||
          contentMembershipIds.has(session.membershipId) ||
          contentSessionIds.has(session.id);
        const protectedValue = (value: string) =>
          canReadSensitive ? value : "[按字段策略隐藏]";
        return {
          id: session.id,
          membershipId: session.membershipId,
          member: displayName,
          startAt: session.startAt.toISOString(),
          endAt: session.endAt.toISOString(),
          timezone: session.timezone,
          grossSeconds: session.grossSeconds,
          breakSeconds: session.breakSeconds,
          netSeconds: session.netSeconds,
          billableSeconds: session.billableSeconds,
          source: session.source,
          content: protectedValue(session.content),
          result: protectedValue(session.result),
          blockers: protectedValue(session.blockers),
          nextStep: protectedValue(session.nextStep),
          projectName,
          projectNodeTitle,
          workTypeName,
          primaryProjectNodeId: session.primaryProjectNodeId,
          workTypeId: session.workTypeId,
          visibility: session.visibility,
          parallelWork: session.parallelWork,
          submissionStatus: session.submissionStatus,
          approvalStatus: session.approvalStatus,
          anomalyFlags: session.anomalyFlags,
          version: session.version,
          createdAt: session.createdAt.toISOString(),
          updatedAt: session.updatedAt.toISOString(),
        };
      });
      const document: WorkSessionExportDocument = {
        schemaVersion: 1,
        title: "工作记录导出",
        generatedAt: new Date().toISOString(),
        range: { from: scope.from, to: scope.to },
        fieldPolicyDescription:
          policy.contentOrganizationWide ||
          policy.includeContent ||
          contentMembershipIds.size > 0 ||
          contentSessionIds.size > 0
            ? "仅在字段级授权范围内包含工作内容，其他记录已隐藏敏感字段"
            : "非本人记录的工作内容字段已按权限策略隐藏",
        items,
      };

      await updateProgress(claimed.id, 55);
      let rendered;
      try {
        rendered = await renderWorkSessionExport(document, format);
      } catch {
        throw new WorkerExportError("export_render_failed", false);
      }
      const digest = createHash("sha256").update(rendered.body).digest("hex");
      const objectKey = `exports/${claimed.organizationId}/${claimed.requestedBy}/${claimed.id}/${rendered.fileName}`;
      await updateProgress(claimed.id, 80);
      try {
        await store.client.send(
          new PutObjectCommand({
            Bucket: store.bucket,
            Key: objectKey,
            Body: rendered.body,
            ContentType: rendered.contentType,
            ContentDisposition: `attachment; filename="${rendered.fileName}"`,
            CacheControl: "private, no-store",
            Metadata: { sha256: digest, exportjobid: claimed.id },
          }),
        );
      } catch {
        throw new WorkerExportError("export_upload_failed", false);
      }
      uploadedObjectKey = objectKey;

      const notificationAllowed = await eventEnabled(
        db,
        claimed.requestedBy,
        "export_ready",
      );
      const expiresAt = new Date(Date.now() + EXPORT_RETENTION_MS);
      const completion = await db.transaction(async (tx) => {
        const [completed] = await tx
          .update(exportJobs)
          .set({
            status: "completed",
            progress: 100,
            objectKey,
            fileName: rendered.fileName,
            contentType: rendered.contentType,
            byteSize: rendered.body.byteLength,
            rowCount: items.length,
            sha256: digest,
            errorSummary: null,
            expiresAt,
            completedAt: new Date(),
          })
          .where(
            and(
              eq(exportJobs.id, claimed.id),
              eq(exportJobs.status, "running"),
            ),
          )
          .returning({ id: exportJobs.id });
        if (!completed) return false;
        await tx.insert(outboxEvents).values({
          organizationId: claimed.organizationId,
          eventType: "export.job.completed",
          entityType: "export",
          entityId: claimed.id,
          entityVersion: claimed.attempt,
          payload: { format, rowCount: items.length },
        });
        await tx.insert(auditLogs).values({
          organizationId: claimed.organizationId,
          actorMembershipId: claimed.requestedBy,
          actorType: "worker",
          action: "export.background_completed",
          entityType: "export",
          entityId: claimed.id,
          after: {
            format,
            rowCount: items.length,
            byteSize: rendered.body.byteLength,
            sha256: digest,
            expiresAt: expiresAt.toISOString(),
          },
        });
        if (notificationAllowed) {
          await tx
            .insert(notifications)
            .values({
              organizationId: claimed.organizationId,
              recipientMembershipId: claimed.requestedBy,
              category: "export_ready",
              severity: "info",
              title: "后台导出已完成",
              body: `${items.length.toLocaleString("zh-CN")} 条工作记录已生成，可以安全下载。`,
              actionUrl: `/analytics?export=${claimed.id}`,
              dedupeKey: `export-ready:${claimed.id}:${claimed.attempt}`,
              validUntil: expiresAt,
            })
            .onConflictDoNothing();
        }
        return true;
      });
      if (!completion) {
        await deleteObjectQuietly(store, objectKey);
      }
      uploadedObjectKey = null;
    } catch (error) {
      if (store && uploadedObjectKey) {
        await deleteObjectQuietly(store, uploadedObjectKey);
      }
      const normalized =
        error instanceof WorkerExportError
          ? error
          : new WorkerExportError("export_generation_failed", false);
      const retryable = !normalized.permanent && claimed.attempt < claimed.maxAttempts;
      const notificationAllowed =
        !retryable &&
        (await eventEnabled(db, claimed.requestedBy, "export_failed"));
      const failureRecorded = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(exportJobs)
          .set({
            status: retryable ? "queued" : "failed",
            progress: 0,
            errorSummary: normalized.code,
            startedAt: retryable ? null : claimed.startedAt,
            completedAt: retryable ? null : new Date(),
          })
          .where(
            and(
              eq(exportJobs.id, claimed.id),
              eq(exportJobs.status, "running"),
            ),
          )
          .returning({ id: exportJobs.id });
        if (!updated || retryable) return Boolean(updated);
        await tx.insert(outboxEvents).values({
          organizationId: claimed.organizationId,
          eventType: "export.job.failed",
          entityType: "export",
          entityId: claimed.id,
          entityVersion: claimed.attempt,
          payload: { errorCode: normalized.code },
        });
        await tx.insert(auditLogs).values({
          organizationId: claimed.organizationId,
          actorMembershipId: claimed.requestedBy,
          actorType: "worker",
          action: "export.background_failed",
          entityType: "export",
          entityId: claimed.id,
          after: { errorCode: normalized.code, attempt: claimed.attempt },
        });
        if (notificationAllowed) {
          await tx
            .insert(notifications)
            .values({
              organizationId: claimed.organizationId,
              recipientMembershipId: claimed.requestedBy,
              category: "export_failed",
              severity: "warning",
              title: "后台导出未完成",
              body: messageForError(normalized.code),
              actionUrl: `/analytics?export=${claimed.id}`,
              dedupeKey: `export-failed:${claimed.id}:${claimed.attempt}`,
            })
            .onConflictDoNothing();
        }
        return true;
      });
      if (!failureRecorded || !retryable) return;
      throw normalized;
    }
  }

  async function cleanupExpired(): Promise<void> {
    if (!store) return;
    const expired = await db
      .select()
      .from(exportJobs)
      .where(
        and(
          eq(exportJobs.deliveryMode, "background"),
          eq(exportJobs.status, "completed"),
          lte(exportJobs.expiresAt, new Date()),
          isNotNull(exportJobs.objectKey),
        ),
      )
      .limit(50);
    for (const job of expired) {
      if (!job.objectKey) continue;
      await store.client.send(
        new DeleteObjectCommand({ Bucket: store.bucket, Key: job.objectKey }),
      );
      const [cleared] = await db
        .update(exportJobs)
        .set({ objectKey: null })
        .where(
          and(
            eq(exportJobs.id, job.id),
            eq(exportJobs.objectKey, job.objectKey),
          ),
        )
        .returning({ id: exportJobs.id });
      if (cleared) {
        await db.insert(auditLogs).values({
          organizationId: job.organizationId,
          actorType: "worker",
          action: "export.expired_object_deleted",
          entityType: "export",
          entityId: job.id,
        });
      }
    }
  }

  return { enqueue, dispatch, process, cleanupExpired, recoverExpiredLeases };
}
