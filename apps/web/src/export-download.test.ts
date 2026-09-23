import { afterEach, expect, it, vi } from "vitest";
import { fetchExportFile } from "./export-download.js";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("downloads the complete file with the authenticated session", async () => {
  const fetchMock = vi.fn(async () => new Response("日期,工时\n2026-09-21,1", { headers: { "content-type": "text/csv; charset=utf-8" } }));
  vi.stubGlobal("fetch", fetchMock);
  expect(await (await fetchExportFile("/api/exports/work-sessions.csv", "csv")).text()).toContain("2026-09-21");
  expect(fetchMock).toHaveBeenCalledWith("/api/exports/work-sessions.csv", expect.objectContaining({ credentials: "include" }));
});
it("rejects a successful HTML gateway response and an empty export", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("<html>Gateway</html>", { headers: { "content-type": "text/html" } }))
    .mockResolvedValueOnce(new Response("", { headers: { "content-type": "application/json" } })));
  await expect(fetchExportFile("/export", "csv")).rejects.toThrow("有效的导出文件");
  await expect(fetchExportFile("/export", "json")).rejects.toThrow("文件为空");
});
it("preserves server permission errors without attempting a download", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "导出权限已被撤销" }), { status: 403 })));
  await expect(fetchExportFile("/export", "csv")).rejects.toThrow("导出权限已被撤销");
});
it("bounds a stalled response without automatically creating another export", async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn<typeof fetch>((_path, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  }));
  vi.stubGlobal("fetch", fetchMock);
  const pending = expect(fetchExportFile("/export", "csv", 1_000)).rejects.toThrow("导出超时");
  await vi.runAllTimersAsync();
  await pending;
  expect(fetchMock).toHaveBeenCalledOnce();
});
