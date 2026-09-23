/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import { api, ApiError, resetCsrfToken } from "./api.js";

afterEach(() => {
  resetCsrfToken();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("API transport recovery", () => {
  it("does not mistake a failed HEAD request for a successful empty response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 403 })));
    await expect(api("/api/example", { method: "HEAD" })).rejects.toMatchObject({ status: 403 });
  });
  it("rejects a successful HTML gateway response instead of returning an empty object", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Gateway</html>")));
    await expect(api("/api/example")).rejects.toMatchObject({ code: "invalid_response", status: 502 });
  });

  it("does not retry permanent permission failures", async () => {
    const fetchMock = vi.fn(async () => new Response("denied", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(api("/api/example")).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shares the CSRF handshake across concurrent writes", async () => {
    let release!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((path) => path === "/api/auth/csrf"
      ? new Promise((resolve) => { release = resolve; })
      : Promise.resolve(new Response(JSON.stringify({ ok: true }))));
    vi.stubGlobal("fetch", fetchMock);
    const first = api("/api/one", { method: "POST" });
    const second = api("/api/two", { method: "POST" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(new Response(JSON.stringify({ csrfToken: "shared" })));
    await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchMock.mock.calls.slice(1)) expect(new Headers(init?.headers).get("x-csrf-token")).toBe("shared");
  });

  it("rejects a late handshake after the account changed without sending the write", async () => {
    let release!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = api("/api/example", { method: "POST" });
    const rejected = expect(pending).rejects.toMatchObject({ code: "session_changed" });
    resetCsrfToken();
    release(new Response(JSON.stringify({ csrfToken: "old-session" })));
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("can retry a write explicitly after a rejected CSRF token", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: "old" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "FST_CSRF_INVALID_TOKEN" }), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: "fresh" })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(api("/api/example", { method: "POST" })).rejects.toMatchObject({ status: 403 });
    await expect(api("/api/example", { method: "POST" })).resolves.toBeUndefined();
    expect(new Headers(fetchMock.mock.calls[3]?.[1]?.headers).get("x-csrf-token")).toBe("fresh");
  });

  it("bounds stalled requests and does not duplicate a timed-out write", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: "csrf" })))
      .mockImplementation((_path, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }));
    vi.stubGlobal("fetch", fetchMock);
    const result = api("/api/example", { method: "POST", timeoutMs: 1_000 });
    const rejected = expect(result).rejects.toMatchObject({ code: "request_timeout", message: expect.stringContaining("核对") });
    await vi.runAllTimersAsync();
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops safe-read recovery when a caller cancels the request", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => new Response("busy", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = api("/api/example", { signal: controller.signal });
    const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await vi.runAllTimersAsync();
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("retries a safe read after a server Retry-After response", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "rate_limited" }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "0" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = api<{ ok: boolean }>("/api/example");
    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never repeats a mutation whose response may have been lost", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ csrfToken: "csrf-test" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "temporarily_unavailable" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      api("/api/example", { method: "POST", body: { value: 1 } }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("POST");
  });
});
