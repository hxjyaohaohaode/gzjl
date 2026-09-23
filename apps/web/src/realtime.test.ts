/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startRealtimeSync } from "./realtime.js";

class TestSocket extends EventTarget {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: TestSocket[] = [];
  readyState = 0;
  close = vi.fn(() => { this.readyState = 3; });
  constructor() { super(); TestSocket.instances.push(this); }
  open() { this.readyState = 1; this.dispatchEvent(new Event("open")); }
  message(type: string) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type }) })); }
  closed(code = 1006) { this.readyState = 3; this.dispatchEvent(new CloseEvent("close", { code })); }
}

let cleanup: (() => void) | undefined;
const client = { invalidateQueries: vi.fn(async () => undefined) };
const status = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.stubGlobal("WebSocket", TestSocket);
  vi.stubGlobal("BroadcastChannel", undefined);
  TestSocket.instances = [];
});
afterEach(() => {
  cleanup?.(); cleanup = undefined;
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks();
});
const first = () => TestSocket.instances[0]!;

describe("realtime recovery", () => {
  it("survives restricted cross-tab APIs and coalesces events", () => {
    vi.stubGlobal("BroadcastChannel", class { constructor() { throw new DOMException("Blocked", "SecurityError"); } });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Blocked"); });
    cleanup = startRealtimeSync(client, status);
    first().open();
    first().message("organization.data.changed");
    first().message("organization.data.changed");
    vi.advanceTimersByTime(1_500);
    expect(status).toHaveBeenLastCalledWith("connected");
    expect(client.invalidateQueries).toHaveBeenCalledExactlyOnceWith({ type: "all", refetchType: "active" });
  });

  it("bounds both a hanging handshake and an open connection without heartbeats", () => {
    cleanup = startRealtimeSync(client, status);
    vi.advanceTimersByTime(15_000);
    expect(first().close).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1_000);
    expect(TestSocket.instances).toHaveLength(2);
    const second = TestSocket.instances[1]!;
    second.open();
    vi.advanceTimersByTime(55_000);
    second.message("heartbeat");
    vi.advanceTimersByTime(59_999);
    expect(second.close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_001);
    expect(second.close).toHaveBeenCalledOnce();
    expect(TestSocket.instances).toHaveLength(3);
  });

  it("ignores every late event from a replaced connection", () => {
    cleanup = startRealtimeSync(client, status);
    first().open(); first().closed();
    vi.advanceTimersByTime(1_000);
    const second = TestSocket.instances[1]!;
    second.open();
    first().open(); first().message("organization.data.changed"); first().closed(4401);
    first().dispatchEvent(new Event("error"));
    vi.advanceTimersByTime(2_000);
    expect(TestSocket.instances).toHaveLength(2);
    expect(second.close).not.toHaveBeenCalled();
    expect(client.invalidateQueries).not.toHaveBeenCalled();
    expect(status).toHaveBeenLastCalledWith("connected");
  });

  it("rechecks identity and retries a rejected socket rather than remaining stuck", () => {
    cleanup = startRealtimeSync(client, status);
    first().closed(4401);
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["me"] });
    vi.advanceTimersByTime(1_000);
    expect(TestSocket.instances).toHaveLength(2);
  });

  it("reconciles the first authenticated ready message and cancels all effects on cleanup", () => {
    cleanup = startRealtimeSync(client, status);
    first().open(); first().message("realtime.ready");
    vi.advanceTimersByTime(1_500);
    expect(client.invalidateQueries).toHaveBeenCalledOnce();
    first().message("organization.data.changed");
    cleanup(); cleanup = undefined;
    first().message("organization.data.changed"); first().closed();
    vi.advanceTimersByTime(120_000);
    expect(client.invalidateQueries).toHaveBeenCalledOnce();
    expect(TestSocket.instances).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers on returning online without duplicating pending reconnect attempts", () => {
    cleanup = startRealtimeSync(client, status);
    first().open();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    window.dispatchEvent(new Event("offline"));
    expect(status).toHaveBeenLastCalledWith("offline");
    vi.advanceTimersByTime(60_000);
    expect(TestSocket.instances).toHaveLength(1);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("online"));
    expect(TestSocket.instances).toHaveLength(2);
    TestSocket.instances[1]!.open();
    vi.advanceTimersByTime(1_500);
    expect(client.invalidateQueries).toHaveBeenCalledOnce();
  });
});
