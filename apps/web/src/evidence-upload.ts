import { api, ApiError } from "./api";

export interface EvidenceUploadReceipt {
  attachmentId?: string;
  bytesUploaded?: boolean;
}

export async function completeEvidenceUpload(attachmentId: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await api<{ attachment: { status: string } }>(`/api/attachments/${attachmentId}/complete`, {
        method: "POST",
      });
      if (result.attachment.status !== "available") {
        throw new Error("文件尚未通过核验，暂不能作为提交证据；请检查文件或重新选择上传。");
      }
      return;
    } catch (error) {
      // Completion is idempotent. Retry transport/server failures, never failed
      // integrity checks or a new upload intent (which would duplicate evidence).
      const retryable = error instanceof TypeError ||
        (error instanceof ApiError && [429, 500, 502, 503, 504].includes(error.status));
      if (!retryable || attempt === 2) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}

export async function putEvidenceFile(url: string, headers: Record<string, string>, file: File): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, { method: "PUT", headers, body: file, signal: AbortSignal.timeout(120_000) });
  } catch {
    throw new Error(`“${file.name}”未完成上传，请检查网络后重试；若持续失败，请管理员检查对象存储的跨域设置。`);
  }
  if (!response.ok) throw new Error(`“${file.name}”上传失败（HTTP ${response.status}），可重试此文件。`);
}
