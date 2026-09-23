/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api.js";
import type * as ApiModule from "./api.js";
import { currentBrowserPushSubscription, detachCurrentBrowserPushBeforeLogout } from "./push-client.js";

vi.mock("./api.js", async (importOriginal) => ({ ...await importOriginal<typeof ApiModule>(), api: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
function browser(serviceWorker: Record<string, unknown>) {
  vi.stubGlobal("navigator", { serviceWorker });
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", class {});
}

describe("optional browser push recovery", () => {
  it("bounds a service worker that never becomes ready", async () => {
    vi.useFakeTimers();
    browser({ register: vi.fn(async () => ({})), ready: new Promise(() => undefined) });
    const rejected = expect(currentBrowserPushSubscription()).rejects.toThrow("启动超时");
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not install a service worker just to log out", async () => {
    const register = vi.fn();
    browser({ register, getRegistration: vi.fn(async () => undefined) });
    await detachCurrentBrowserPushBeforeLogout();
    expect(register).not.toHaveBeenCalled();
    expect(api).not.toHaveBeenCalled();
  });

  it("bounds cleanup and ignores a late browser lookup after logout continues", async () => {
    vi.useFakeTimers();
    let release!: (value: unknown) => void;
    const getSubscription = vi.fn();
    browser({ getRegistration: () => new Promise((resolve) => { release = resolve; }) });
    const cleanup = detachCurrentBrowserPushBeforeLogout();
    await vi.advanceTimersByTimeAsync(3_000);
    await cleanup;
    release({ pushManager: { getSubscription } });
    await vi.runAllTimersAsync();
    expect(getSubscription).not.toHaveBeenCalled();
    expect(api).not.toHaveBeenCalled();
  });

  it("unsubscribes locally even when the API cleanup stalls, and aborts that cleanup", async () => {
    vi.useFakeTimers();
    const unsubscribe = vi.fn(async () => true);
    browser({ getRegistration: async () => ({ pushManager: { getSubscription: async () => ({ endpoint: "https://push.example.test/old", unsubscribe }) } }) });
    vi.mocked(api).mockImplementationOnce((_path, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
    }));
    const cleanup = detachCurrentBrowserPushBeforeLogout();
    await vi.advanceTimersByTimeAsync(3_000);
    await cleanup;
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(vi.mocked(api).mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
