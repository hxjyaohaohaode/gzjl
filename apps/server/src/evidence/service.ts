import { randomUUID } from "node:crypto";

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
  attachments,
  auditLogs,
  workSessionProjectLinks,
  workSessions,
} from "@workbench/db/schema";
import { hasPermission } from "@workbench/shared";

import type { AuthContext } from "../auth/service.js";
import type { ServerConfig } from "../config.js";

const allowedMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
  "text/csv",
]);

export type EvidenceVisibility = "private" | "management_only" | "project_visible";
type Attachment = typeof attachments.$inferSelect;

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
    mimeType: string,
    sizeBytes: number,
    sha256Hex: string,
  ) {
    const checksum = Buffer.from(sha256Hex, "hex").toString("base64");
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: objectKey,
      ContentType: mimeType,
      ContentLength: sizeBytes,
      ChecksumSHA256: checksum,
      Metadata: { sha256: sha256Hex },
    });
    return {
      uploadUrl: await getSignedUrl(this.client, command, { expiresIn: 15 * 60 }),
      requiredHeaders: {
        "content-type": mimeType,
        "x-amz-checksum-sha256": checksum,
      },
      expiresInSeconds: 15 * 60,
    };
  }

  async verify(objectKey: string, sizeBytes: number, sha256Hex: string): Promise<void> {
    const result = await this.client.send(
      new HeadObjectCommand({ Bucket: this.config.bucket, Key: objectKey }),
    );
    const expectedChecksum = Buffer.from(sha256Hex, "hex").toString("base64");
    if (result.ContentLength !== sizeBytes) {
      throw new EvidenceValidationError("上传文件大小与登记信息不一致。");
    }
    if (result.ChecksumSHA256 !== expectedChecksum && result.Metadata?.sha256 !== sha256Hex) {
      throw new EvidenceValidationError("对象存储未返回可验证的 SHA-256，文件已隔离。");
    }
  }

  async createDownloadUrl(objectKey: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: objectKey }),
      { expiresIn: 5 * 60 },
    );
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

  constructor(
    private readonly db: Database,
    private readonly config: ServerConfig,
  ) {
    const configured =
      config.S3_BUCKET && config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY;
    this.store = configured
      ? new ObjectStore({
          ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
          region: config.S3_REGION,
          bucket: config.S3_BUCKET!,
          accessKeyId: config.S3_ACCESS_KEY_ID!,
          secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
          forcePathStyle: config.S3_FORCE_PATH_STYLE,
        })
      : null;
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

  private async assertVisible(actor: AuthContext, attachment: Attachment, sessionId: string) {
    const session = await this.session(actor, sessionId);
    if (session.membershipId === actor.membershipId) return;
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
    if (!allowedMimeTypes.has(input.mimeType)) {
      throw new EvidenceValidationError("仅支持 PDF、图片、纯文本和 CSV 文件。");
    }
    if (input.sizeBytes > this.config.ATTACHMENT_MAX_BYTES) {
      throw new EvidenceValidationError(
        `文件不能超过 ${Math.floor(this.config.ATTACHMENT_MAX_BYTES / 1024 / 1024)} MB。`,
      );
    }
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
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          sha256: input.sha256,
          visibility: input.visibility,
          note: input.note,
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
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          sha256: input.sha256,
          visibility: input.visibility,
        },
      });
      return created;
    });
    return {
      attachment,
      ...(await this.store.createUploadUrl(
        objectKey,
        input.mimeType,
        input.sizeBytes,
        input.sha256,
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
      await this.db
        .update(attachments)
        .set({ status: "quarantined", updatedAt: new Date() })
        .where(eq(attachments.id, attachmentId));
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
      url: await this.store.createDownloadUrl(row.attachment.objectKey),
      expiresInSeconds: 5 * 60,
      sha256: row.attachment.sha256,
      originalName: row.attachment.originalName,
    };
  }
}
