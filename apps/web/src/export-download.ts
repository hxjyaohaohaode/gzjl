/** Direct exports must finish with a file, not an HTML gateway page or an endless spinner. */
export async function fetchExportFile(path: string, format: "csv" | "json", timeoutMs = 60_000): Promise<Blob> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, { credentials: "include", signal: controller.signal });
    if (!response.ok) {
      const failure: unknown = await response.json().catch(() => null);
      const message = failure && typeof failure === "object" && "message" in failure && typeof failure.message === "string" ? failure.message : null;
      throw new Error(message ?? (response.status === 401 ? "登录已失效，请重新登录后导出。" : `直接导出失败（HTTP ${response.status}），请稍后重试。`));
    }
    const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (mime !== (format === "csv" ? "text/csv" : "application/json")) {
      throw new Error("服务未返回有效的导出文件，请重新导出。");
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error("导出文件为空，请重新导出。");
    return blob;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("导出超时，请缩小时间范围后重试。", { cause: error });
    if (error instanceof TypeError) throw new Error("下载连接中断，请检查网络后重新导出。", { cause: error });
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
  }
}
