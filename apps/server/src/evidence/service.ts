import { createHash, randomUUID } from "node:crypto";

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@workbench/db";
import {
  attachmentLinks,
  attachmentVersions,
  attachments,
  auditLogs,
  orgMemberships,
  outboxEvents,
  workSessionProjectLinks,
  workSessions,
} from "@workbench/db/schema";
import { hasPermission } from "@workbench/shared";

import type { AuthContext } from "../auth/service.js";
import type { ServerConfig } from "../config.js";

export type EvidenceVisibility = "private" | "management_only" | "project_visible";
type Attachment = typeof attachments.$inferSelect;

const genericBinaryMimeType = "application/octet-stream";

/**
 * Browsers often omit a MIME type for source code, uncommon office files, and
 * specialized evidence. Store such files as opaque binary instead of
 * mislabeling them as text/plain or rejecting them solely for being uncommon.
 * The declared MIME type is still retained as metadata for people and future
 * tooling, but downloads are always forced to binary attachments.
 */
function normalizeMimeType(value: string): string {
  const normalized = value.trim().split(";", 1)[0]?.toLowerCase();
  if (
    !normalized ||
    !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(normalized)
  ) {
    return genericBinaryMimeType;
  }
  return normalized;
}

export class EvidenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceValidationError";
  }
}

export class EvidenceForbiddenError extends Error {
  constructor(message = "当前账号无权访问该证据。") {
    super(message);
    this.name = "EvidenceForbiddenError";
  }
}

export class EvidenceNotFoundError extends Error {
  constructor(message = "证据不存在。") {
    super(message);
    this.name = "EvidenceNotFoundError";
  }
}

interface ObjectStoreConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  uploadIntegrityMode: "provider_checksum" | "download_sha256";
  signedUrlTtlSeconds: number;
}

class ObjectStore {
  readonly client: S3Client;

  constructor(readonly config: ObjectStoreConfig) {
    this.client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async createUploadUrl(
    objectKey: string,
    declaredMimeType: string,
    sizeBytes: number,
    sha256Hex: string,
  ) {
    const checksum = Buffer.from(sha256Hex, "hex").toString("base64");
    const useProviderChecksum =
      this.config.uploadIntegrityMode === "provider_checksum";
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: objectKey,
      // Never allow an uploaded file to acquire an executable/renderable
      // response type simply because its browser-provided MIME says HTML,
      // SVG, JavaScript, or another active format. The original type remains
      // available in authenticated metadata, while the object is opaque.
      ContentType: genericBinaryMimeType,
      ContentLength: sizeBytes,
      ...(useProviderChecksum ? { ChecksumSHA256: checksum } : {}),
      Metadata: { sha256: sha256Hex, "declared-mime": declaredMimeType },
    });
    return {
      uploadUrl: await getSignedUrl(this.client, command, {
        expiresIn: this.config.signedUrlTtlSeconds,
      }),
      requiredHeaders: {
        "content-type": genericBinaryMimeType,
        ...(useProviderChecksum
          ? { "x-amz-checksum-sha256": checksum }
          : {}),
        // Metadata is part of the signed PutObject command. Returning every
        // signed header is essential: omitting one lets some S3-compatible
        // providers reject the browser PUT with SignatureDoesNotMatch.
        "x-amz-meta-sha256": sha256Hex,
        "x-amz-meta-declared-mime": declaredMimeType,
      },
      expiresInSeconds: this.config.signedUrlTtlSeconds,
    };
  }

  async verify(objectKey: string, sizeBytes: number, sha256Hex: string): Promise<void> {
    const result = await this.client.send(
      new HeadObjectCommand({ Bucket: this.config.bucket, Key: objectKey }),
    );
    if (result.ContentLength !== sizeBytes) {
      throw new EvidenceValidationError("上传文件大小与登记信息不一致。");
    }
    if (result.Metadata?.sha256 !== sha256Hex) {
      throw new EvidenceValidationError("对象存储中的 SHA-256 元数据与登记信息不一致。");
    }
    if (this.config.uploadIntegrityMode === "provider_checksum") {
      const expectedChecksum = Buffer.from(sha256Hex, "hex").toString("base64");
      if (result.ChecksumSHA256 !== expectedChecksum) {
        throw new EvidenceValidationError("对象存储未返回匹配的 SHA-256 校验值，文件已隔离。");
      }
      return;
    }

    // Some S3-compatible providers (including Backblaze B2) implement the
    // common object operations but do not advertise x-amz-checksum-sha256 on
    // presigned PUT/HEAD. Stream the just-uploaded object through the API and
    // compare its actual bytes with the browser's digest instead of weakening
    // verification to metadata-only trust.
    const downloaded = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: objectKey }),
    );
    if (!downloaded.Body) {
      throw new EvidenceValidationError("对象存储未返回可校验的文件内容。");
    }
    const bodyStream = downloaded.Body as unknown as AsyncIterable<Uint8Array>;
    if (typeof bodyStream[Symbol.asyncIterator] !== "function") {
      throw new EvidenceValidationError("对象存储返回的文件内容无法进行流式校验。");
    }
    const hash = createHash("sha256");
    for await (const chunk of bodyStream) hash.update(chunk);
    if (hash.digest("hex") !== sha256Hex) {
      throw new EvidenceValidationError("对象存储中的文件内容与登记的 SHA-256 不一致。");
    }
  }

  async createDownloadUrl(objectKey: string, originalName: string | null) {
    // Downloads only need a short capability. Keep them at five minutes or
    // less even if a deployment chooses a longer upload retry window.
    const expiresInSeconds = Math.min(this.config.signedUrlTtlSeconds, 5 * 60);
    return {
      url: await getSignedUrl(
        this.client,
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: objectKey,
          // Evidence is always an attachment; never let a browser execute or
          // render an uploaded file in the application origin.
          ResponseContentDisposition: `attachment; filename="${safeName(originalName ?? "evidence")}"`,
          ResponseContentType: genericBinaryMimeType,
        }),
        { expiresIn: expiresInSeconds },
      ),
      expiresInSeconds,
    };
  }
}

function safeName(name: string): string {
  return (
    name
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "evidence"
  );
}

export class EvidenceService {
  private readonly store: ObjectStore | null;
  private readonly storageUnavailableReason: string | null;

  constructor(
    private readonly db: Database,
    private readonly config: ServerConfig,
  ) {
    const hasStorageCredentials = Boolean(
      config.S3_BUCKET && config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY,
    );
    // The PWA uploads direct to a pre-signed storage URL. Production CSP must
    // know the exact public origin in advance; without it a partly configured
    // bucket would look available in the UI but the browser would block PUT.
    const hasBrowserUploadOrigin =
      config.NODE_ENV !== "production" || Boolean(config.S3_BROWSER_ORIGIN);
    const configured = hasStorageCredentials && hasBrowserUploadOrigin;
    this.storageUnavailableReason = !hasStorageCredentials
      ? "对象存储凭据尚未完整配置。"
      : !hasBrowserUploadOrigin
        ? "对象存储浏览器直传 origin 尚未配置。"
        : null;
    this.store = configured
      ? new ObjectStore({
          ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
          region: config.S3_REGION,
          bucket: config.S3_BUCKET!,
          accessKeyId: config.S3_ACCESS_KEY_ID!,
          secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
          forcePathStyle: config.S3_FORCE_PATH_STYLE,
          uploadIntegrityMode: config.S3_UPLOAD_INTEGRITY_MODE,
          signedUrlTtlSeconds: config.SIGNED_URL_TTL_SECONDS,
        })
      : null;
  }

  capabilities() {
    return {
      fileUploads: {
        available: Boolean(this.store),
        maxBytes: this.config.ATTACHMENT_MAX_BYTES,
        ...(this.store
          ? {}
          : { unavailableReason: this.storageUnavailableReason ?? "文件对象存储不可用。" }),
        // File bytes are deliberately stored and downloaded as opaque binary;
        // legitimate work artefacts therefore do not need to match a brittle
        // front-end MIME whitelist.
        acceptsArbitraryFormats: true,
      },
      references: { url: true, text: true },
    };
  }

  private canManage(actor: AuthContext): boolean {
    return hasPermission(actor.grants, "evidence.view_management", {
      scopeKind: "organization",
    });
  }

  private async session(actor: AuthContext, sessionId: string) {
    const [session] = await this.db
      .select()
      .from(workSessions)
      .where(
        and(
          eq(workSessions.id, sessionId),
          eq(workSessions.organizationId, actor.organizationId),
          eq(workSessions.recordKind, "fact"),
          isNull(workSessions.deletedAt),
        ),
      )
      .limit(1);
    if (!session) throw new EvidenceNotFoundError("关联的工时记录不存在。");
    return session;
  }

  private async canViewProjectEvidence(actor: AuthContext, sessionId: string): Promise<boolean> {
    if (
      hasPermission(actor.grants, "work.view_project_public", {
        scopeKind: "organization",
      })
    ) {
      return true;
    }
    const links = await this.db
      .select({ projectId: workSessionProjectLinks.projectId })
      .from(workSessionProjectLinks)
      .where(eq(workSessionProjectLinks.workSessionId, sessionId));
    return links.some(({ projectId }) =>
      hasPermission(actor.grants, "work.view_project_public", {
        scopeKind: "project",
        scopeId: projectId,
      }),
    );
  }

  private async canReviewSession(
    actor: AuthContext,
    sessionId: string,
    membershipId: string,
  ): Promise<boolean> {
    const grants = actor.grants.filter((grant) => grant.permission === "work.review");
    if (grants.some((grant) => grant.scopeKind === "organization")) return true;
    const orgUnitGrants = grants.filter(
      (grant) => grant.scopeKind === "org_unit" && grant.scopeId,
    );
    if (orgUnitGrants.length) {
      const [membership] = await this.db
        .select({ orgUnitId: orgMemberships.orgUnitId })
        .from(orgMemberships)
        .where(eq(orgMemberships.id, membershipId))
        .limit(1);
      if (
        membership?.orgUnitId &&
        orgUnitGrants.some((grant) => grant.scopeId === membership.orgUnitId)
      ) {
        return true;
      }
    }
    const projectIds = grants
      .filter((grant) => grant.scopeKind === "project" && grant.scopeId)
      .map((grant) => grant.scopeId!);
    if (!projectIds.length) return false;
    const links = await this.db
      .select({ projectId: workSessionProjectLinks.projectId })
      .from(workSessionProjectLinks)
      .where(eq(workSessionProjectLinks.workSessionId, sessionId));
    return links.some((link) => projectIds.includes(link.projectId));
  }

  private async assertVisible(actor: AuthContext, attachment: Attachment, sessionId: string) {
    const session = await this.session(actor, sessionId);
    if (session.membershipId === actor.membershipId) return;
    if (
      attachment.visibility !== "private" &&
      session.approvalStatus === "pending_review" &&
      (await this.canReviewSession(actor, sessionId, session.membershipId))
    ) {
      return;
    }
    if (attachment.visibility === "management_only" && this.canManage(actor)) return;
    if (
      attachment.visibility === "project_visible" &&
      (await this.canViewProjectEvidence(actor, sessionId))
    ) {
      return;
    }
    throw new EvidenceForbiddenError();
  }

  async initiateFile(
    actor: AuthContext,
    sessionId: string,
    input: {
      originalName: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
      visibility: EvidenceVisibility;
      note?: string | undefined;
    },
  ) {
    if (!this.store) {
      throw new EvidenceValidationError("对象存储尚未配置，暂时不能上传文件证据。");
    }
    const session = await this.session(actor, sessionId);
    if (session.membershipId !== actor.membershipId && !this.canManage(actor)) {
      throw new EvidenceForbiddenError("只能为自己的工时记录上传证据。");
    }
    if (input.sizeBytes > this.config.ATTACHMENT_MAX_BYTES) {
      throw new EvidenceValidationError(
        `文件不能超过 ${Math.floor(this.config.ATTACHMENT_MAX_BYTES / 1024 / 1024)} MB。`,
      );
    }
    const mimeType = normalizeMimeType(input.mimeType);
    const objectKey = `${actor.organizationId}/${actor.membershipId}/${randomUUID()}/${safeName(input.originalName)}`;
    const attachment = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(attachments)
        .values({
          organizationId: actor.organizationId,
          uploadedBy: actor.membershipId,
          kind: "file",
          objectKey,
          originalName: input.originalName,
          mimeType,
          sizeBytes: input.sizeBytes,
          sha256: input.sha256,
          visibility: input.visibility,
          note: input.note,
          metadata: {
            declaredMimeType: mimeType,
            storageContentType: genericBinaryMimeType,
          },
        })
        .returning();
      if (!created) throw new EvidenceValidationError("无法创建上传任务。");
      await tx.insert(attachmentLinks).values({
        attachmentId: created.id,
        entityType: "work_session",
        entityId: sessionId,
        createdBy: actor.membershipId,
      });
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "evidence.upload_initiated",
        entityType: "attachment",
        entityId: created.id,
        after: {
          sessionId,
          originalName: input.originalName,
          mimeType,
          sizeBytes: input.sizeBytes,
          sha256: input.sha256,
          visibility: input.visibility,
        },
      });
      await tx.insert(outboxEvents).values({
        organizationId: actor.organizationId,
        eventType: "evidence.changed",
        entityType: "work_session",
        entityId: sessionId,
        entityVersion: created.version,
        payload: { change: "upload_initiated" },
      });
      return created;
    });
    return {
      attachment,
      ...(await this.store.createUploadUrl(
        objectKey,
        mimeType,
        input.sizeBytes,
        input.sha256,
      )),
    };
  }

  async initiateReplacement(
    actor: AuthContext,
    attachmentId: string,
    input: {
      originalName: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
      note?: string | undefined;
      reason: string;
    },
  ) {
    if (!this.store) throw new EvidenceValidationError("对象存储尚未配置，暂时不能替换文件证据。");
    if (input.sizeBytes > this.config.ATTACHMENT_MAX_BYTES) {
      throw new EvidenceValidationError(`文件不能超过 ${Math.floor(this.config.ATTACHMENT_MAX_BYTES / 1024 / 1024)} MB。`);
    }
    const mimeType = normalizeMimeType(input.mimeType);
    const row = await this.linkedAttachment(actor, attachmentId);
    if (row.attachment.kind !== "file") throw new EvidenceValidationError("只有文件证据可以替换；链接和文本请新增一条证据。");
    if (row.attachment.uploadedBy !== actor.membershipId && !this.canManage(actor)) throw new EvidenceForbiddenError();
    const objectKey = `${actor.organizationId}/${actor.membershipId}/${randomUUID()}/${safeName(input.originalName)}`;
    const attachment = await this.db.transaction(async (tx) => {
      await tx.insert(attachmentVersions).values({
        attachmentId: row.attachment.id,
        version: row.attachment.version,
        snapshot: row.attachment,
        objectKey: row.attachment.objectKey,
        sha256: row.attachment.sha256,
        replacedBy: actor.membershipId,
        reason: input.reason,
      });
      const [updated] = await tx.update(attachments).set({
        status: "pending_upload",
        originalName: input.originalName,
        objectKey,
        mimeType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        note: input.note ?? row.attachment.note,
        metadata: {
          declaredMimeType: mimeType,
          storageContentType: genericBinaryMimeType,
        },
        uploadedBy: actor.membershipId,
        version: row.attachment.version + 1,
        updatedAt: new Date(),
      }).where(and(eq(attachments.id, attachmentId), eq(attachments.version, row.attachment.version))).returning();
      if (!updated) throw new EvidenceValidationError("证据刚刚被其他操作更新，请刷新后重试。");
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "evidence.replacement_initiated",
        entityType: "attachment",
        entityId: attachmentId,
        before: { version: row.attachment.version, sha256: row.attachment.sha256, objectKey: row.attachment.objectKey },
        after: { version: updated.version, sha256: input.sha256, sizeBytes: input.sizeBytes, reason: input.reason },
      });
      await tx.insert(outboxEvents).values({
        organizationId: actor.organizationId,
        eventType: "evidence.changed",
        entityType: "work_session",
        entityId: row.link.entityId,
        entityVersion: updated.version,
        payload: { change: "replacement_initiated" },
      });
      return updated;
    });
    if (!attachment) throw new EvidenceValidationError("无法创建证据替换任务。");
    return { attachment, ...(await this.store.createUploadUrl(objectKey, mimeType, input.sizeBytes, input.sha256)) };
  }

  /**
   * A browser can lose its network after the durable upload intent exists but
   * before the direct PUT or completion confirmation succeeds. Reissuing a
   * short-lived URL against that same attachment avoids duplicate evidence
   * records and lets a user retry without weakening integrity verification.
   */
  async renewFileUploadUrl(actor: AuthContext, attachmentId: string) {
    if (!this.store) {
      throw new EvidenceValidationError("对象存储尚未配置，暂时不能继续上传文件证据。");
    }
    const row = await this.linkedAttachment(actor, attachmentId);
    if (row.attachment.uploadedBy !== actor.membershipId && !this.canManage(actor)) {
      throw new EvidenceForbiddenError();
    }
    const attachment = row.attachment;
    if (
      attachment.kind !== "file" ||
      !attachment.objectKey ||
      attachment.sizeBytes === null ||
      !attachment.sha256 ||
      !attachment.mimeType
    ) {
      throw new EvidenceValidationError("该证据没有可继续的文件上传任务。");
    }
    if (attachment.status === "available") {
      throw new EvidenceValidationError("该文件已经完成并通过完整性校验，无需重新上传。");
    }
    if (attachment.status === "quarantined") {
      throw new EvidenceValidationError("该文件未通过完整性校验，请使用“替换”重新提交并说明原因。");
    }
    if (attachment.status !== "pending_upload" && attachment.status !== "upload_failed") {
      throw new EvidenceValidationError("该文件当前不能继续上传。");
    }
    const [updated] = await this.db
      .update(attachments)
      .set({ status: "pending_upload", updatedAt: new Date() })
      .where(and(eq(attachments.id, attachmentId), isNull(attachments.deletedAt)))
      .returning();
    if (!updated) throw new EvidenceNotFoundError();
    await this.db.insert(auditLogs).values({
      organizationId: actor.organizationId,
      actorMembershipId: actor.membershipId,
      action: "evidence.upload_url_renewed",
      entityType: "attachment",
      entityId: attachmentId,
      after: { version: updated.version, sha256: updated.sha256 },
    });
    return {
      attachment: updated,
      ...(await this.store.createUploadUrl(
        updated.objectKey!,
        updated.mimeType!,
        updated.sizeBytes!,
        updated.sha256!,
      )),
    };
  }

  private async linkedAttachment(actor: AuthContext, attachmentId: string) {
    const [row] = await this.db
      .select({ attachment: attachments, link: attachmentLinks })
      .from(attachments)
      .innerJoin(attachmentLinks, eq(attachmentLinks.attachmentId, attachments.id))
      .where(
        and(
          eq(attachments.id, attachmentId),
          eq(attachments.organizationId, actor.organizationId),
          eq(attachmentLinks.entityType, "work_session"),
          isNull(attachments.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new EvidenceNotFoundError();
    return row;
  }

  async completeFile(actor: AuthContext, attachmentId: string) {
    if (!this.store) throw new EvidenceValidationError("对象存储尚未配置。");
    const row = await this.linkedAttachment(actor, attachmentId);
    if (row.attachment.uploadedBy !== actor.membershipId && !this.canManage(actor)) {
      throw new EvidenceForbiddenError();
    }
    const attachment = row.attachment;
    if (
      attachment.kind !== "file" ||
      !attachment.objectKey ||
      attachment.sizeBytes === null ||
      !attachment.sha256
    ) {
      throw new EvidenceValidationError("该证据不是待完成的文件上传。");
    }
    if (attachment.status !== "pending_upload") return { attachment };
    try {
      await this.store.verify(attachment.objectKey, attachment.sizeBytes, attachment.sha256);
    } catch (error) {
      // A verified checksum/size mismatch is a genuine integrity failure and
      // must be quarantined. A transient S3 failure (including an object that
      // has not become visible yet) is not evidence corruption: retain
      // pending_upload so the browser can retry completion or renew its
      // signed URL safely.
      if (error instanceof EvidenceValidationError) {
        await this.db
          .update(attachments)
          .set({ status: "quarantined", updatedAt: new Date() })
          .where(eq(attachments.id, attachmentId));
      }
      throw error;
    }
    const [updated] = await this.db
      .update(attachments)
      .set({ status: "available", updatedAt: new Date() })
      .where(and(eq(attachments.id, attachmentId), eq(attachments.status, "pending_upload")))
      .returning();
    await this.db.insert(auditLogs).values({
      organizationId: actor.organizationId,
      actorMembershipId: actor.membershipId,
      action: "evidence.upload_completed",
      entityType: "attachment",
      entityId: attachmentId,
      after: { sha256: attachment.sha256, sizeBytes: attachment.sizeBytes },
    });
    await this.db.insert(outboxEvents).values({
      organizationId: actor.organizationId,
      eventType: "evidence.changed",
      entityType: "work_session",
      entityId: row.link.entityId,
      entityVersion: (updated ?? attachment).version,
      payload: { change: "upload_completed" },
    });
    return { attachment: updated ?? attachment };
  }

  async createReference(
    actor: AuthContext,
    sessionId: string,
    input: {
      kind: "url" | "text";
      externalUrl?: string | undefined;
      textContent?: string | undefined;
      visibility: EvidenceVisibility;
      note?: string | undefined;
    },
  ) {
    const session = await this.session(actor, sessionId);
    if (session.membershipId !== actor.membershipId && !this.canManage(actor)) {
      throw new EvidenceForbiddenError("只能为自己的工时记录添加证据。");
    }
    const attachment = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(attachments)
        .values({
          organizationId: actor.organizationId,
          uploadedBy: actor.membershipId,
          kind: input.kind,
          status: "available",
          externalUrl: input.externalUrl,
          textContent: input.textContent,
          visibility: input.visibility,
          note: input.note,
        })
        .returning();
      if (!created) throw new EvidenceValidationError("无法创建证据。");
      await tx.insert(attachmentLinks).values({
        attachmentId: created.id,
        entityType: "work_session",
        entityId: sessionId,
        createdBy: actor.membershipId,
      });
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "evidence.reference_created",
        entityType: "attachment",
        entityId: created.id,
        after: { sessionId, kind: input.kind, visibility: input.visibility },
      });
      await tx.insert(outboxEvents).values({
        organizationId: actor.organizationId,
        eventType: "evidence.changed",
        entityType: "work_session",
        entityId: sessionId,
        entityVersion: created.version,
        payload: { change: "reference_created" },
      });
      return created;
    });
    return { attachment };
  }

  async listForSession(actor: AuthContext, sessionId: string) {
    await this.session(actor, sessionId);
    const rows = await this.db
      .select({ attachment: attachments })
      .from(attachmentLinks)
      .innerJoin(attachments, eq(attachments.id, attachmentLinks.attachmentId))
      .where(
        and(
          eq(attachmentLinks.entityType, "work_session"),
          eq(attachmentLinks.entityId, sessionId),
          eq(attachments.organizationId, actor.organizationId),
          isNull(attachments.deletedAt),
        ),
      );
    const visible: Attachment[] = [];
    for (const row of rows) {
      try {
        await this.assertVisible(actor, row.attachment, sessionId);
        visible.push(row.attachment);
      } catch (error) {
        if (!(error instanceof EvidenceForbiddenError)) throw error;
      }
    }
    return visible.map((attachment) => ({
      id: attachment.id,
      organizationId: attachment.organizationId,
      uploadedBy: attachment.uploadedBy,
      kind: attachment.kind,
      status: attachment.status,
      originalName: attachment.originalName,
      externalUrl: attachment.externalUrl,
      ...(attachment.kind === "text" ? { textContent: attachment.textContent } : {}),
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      sha256: attachment.sha256,
      visibility: attachment.visibility,
      note: attachment.note,
      metadata: attachment.metadata,
      version: attachment.version,
      uploadedAt: attachment.uploadedAt,
      createdAt: attachment.createdAt,
      updatedAt: attachment.updatedAt,
    }));
  }

  async download(actor: AuthContext, attachmentId: string) {
    const row = await this.linkedAttachment(actor, attachmentId);
    await this.assertVisible(actor, row.attachment, row.link.entityId);
    if (row.attachment.status !== "available") {
      throw new EvidenceValidationError("文件尚未通过完整性校验。");
    }
    if (
      row.attachment.kind !== "file" ||
      !row.attachment.objectKey ||
      !this.store
    ) {
      throw new EvidenceValidationError("该证据没有可下载文件。");
    }
    return {
      ...(await this.store.createDownloadUrl(
        row.attachment.objectKey,
        row.attachment.originalName,
      )),
      sha256: row.attachment.sha256,
      originalName: row.attachment.originalName,
    };
  }

  async listVersions(actor: AuthContext, attachmentId: string) {
    const row = await this.linkedAttachment(actor, attachmentId);
    await this.assertVisible(actor, row.attachment, row.link.entityId);
    return this.db.select({
      version: attachmentVersions.version,
      sha256: attachmentVersions.sha256,
      reason: attachmentVersions.reason,
      replacedBy: attachmentVersions.replacedBy,
      createdAt: attachmentVersions.createdAt,
    }).from(attachmentVersions).where(eq(attachmentVersions.attachmentId, attachmentId)).orderBy(attachmentVersions.version);
  }

  async remove(actor: AuthContext, attachmentId: string, reason: string) {
    const row = await this.linkedAttachment(actor, attachmentId);
    if (row.attachment.uploadedBy !== actor.membershipId && !this.canManage(actor)) throw new EvidenceForbiddenError();
    await this.db.transaction(async (tx) => {
      const [removed] = await tx.update(attachments).set({
        status: "deleted",
        deletedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(eq(attachments.id, attachmentId), isNull(attachments.deletedAt))).returning();
      if (!removed) throw new EvidenceNotFoundError();
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "evidence.deleted",
        entityType: "attachment",
        entityId: attachmentId,
        before: { version: row.attachment.version, sha256: row.attachment.sha256 },
        reason,
      });
      await tx.insert(outboxEvents).values({
        organizationId: actor.organizationId,
        eventType: "evidence.changed",
        entityType: "work_session",
        entityId: row.link.entityId,
        entityVersion: removed.version,
        payload: { change: "deleted" },
      });
    });
    return { deleted: true };
  }
}
