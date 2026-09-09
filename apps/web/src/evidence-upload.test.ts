/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeEvidenceUpload } from "./evidence-upload.js";
import { resetCsrfToken } from "./api.js";

afterEach(() => { resetCsrfToken(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("evidence completion", () => {
  it.each([500, 503])("recovers HTTP %s verification failure without uploading another file", async (status) => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ csrfToken: "test" }))
      .mockResolvedValueOnce(json({ message: "storage unavailable" }, status))
      .mockResolvedValueOnce(json({ attachment: { status: "available" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = completeEvidenceUpload("proof-1");
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBeUndefined();
    expect(fetchMock.mock.calls.slice(1).map(([url]) => url)).toEqual([
      "/api/attachments/proof-1/complete", "/api/attachments/proof-1/complete",
    ]);
  });
  it.each(["quarantined", "pending_upload", "upload_failed"])("does not report %s as success", async (status) => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ csrfToken: "test" }))
      .mockResolvedValueOnce(json({ attachment: { status } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(completeEvidenceUpload("proof-1")).rejects.toThrow("尚未通过核验");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
