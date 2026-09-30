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

export async function putEvidenceFile(url: string, headers: Record<string, string>, file: File, options?: { onProgress?: (percentage: number) => void; signal?: AbortSignal }): Promise<void> {
  const timeout = Math.min(15 * 60_000, Math.max(120_000, Math.ceil(file.size / 1_048_576) * 10_000));
  if (options?.onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const cancel = () => xhr.abort();
      const finish = (error?: Error) => { options.signal?.removeEventListener("abort", cancel); if (error) reject(error); else resolve(); };
      xhr.open("PUT", url); xhr.timeout = timeout;
      for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
      xhr.upload.onprogress = (event) => { if (event.lengthComputable) options.onProgress?.(Math.round(event.loaded / event.total * 100)); };
      xhr.onload = () => finish(xhr.status >= 200 && xhr.status < 300 ? undefined : new Error(`“${file.name}”上传失败（HTTP ${xhr.status}），可重试此文件。`));
      xhr.onerror = () => finish(new Error(`“${file.name}”上传连接中断，请检查网络或对象存储跨域配置后重试。`));
      xhr.ontimeout = () => finish(new Error(`“${file.name}”上传超时，可逐件重试或补充链接、文字证据。`));
      xhr.onabort = () => finish(new Error("文件上传已取消，当前文件可重新尝试。"));
      options.signal?.addEventListener("abort", cancel, { once: true });
      if (options.signal?.aborted) { finish(new Error("文件上传已取消。")); return; }
      xhr.send(file);
    });
  }
  let response: Response;
  try {
    response = await fetch(url, { method: "PUT", headers, body: file, signal: options?.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout) });
  } catch {
    throw new Error(`“${file.name}”未完成上传，请检查网络后重试；若持续失败，请管理员检查对象存储的跨域设置。`);
  }
  if (!response.ok) throw new Error(`“${file.name}”上传失败（HTTP ${response.status}），可重试此文件。`);
}
