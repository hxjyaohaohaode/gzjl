export async function hashEvidenceFile(file: File, onProgress?: ((percentage: number) => void) | undefined, signal?: AbortSignal | undefined): Promise<string> {
  signal?.throwIfAborted();
  if (typeof Worker === "undefined") {
    const { hashFileSlices } = await import("./evidence-hash-core.js");
    return hashFileSlices(file, onProgress, signal);
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./evidence-hash.worker.ts", import.meta.url), { type: "module" });
    const timer = setTimeout(() => finish(new Error("文件校验超时，请重新选择文件后重试。")), 180_000);
    const cancel = () => finish(new Error("已取消文件校验，可以重新尝试。"));
    const finish = (error?: Error, digest?: string) => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); worker.terminate(); if (error) reject(error); else resolve(digest!); };
    signal?.addEventListener("abort", cancel, { once: true });
    worker.onerror = () => finish(new Error("文件校验进程不可用，请刷新后重新选择文件。"));
    worker.onmessage = (event: MessageEvent<{ progress?: number; sha256?: string; error?: string }>) => {
      if (event.data.progress !== undefined) onProgress?.(event.data.progress);
      if (event.data.error) finish(new Error(event.data.error));
      else if (event.data.sha256) finish(undefined, event.data.sha256);
    };
    worker.postMessage({ file });
  });
}
