import { useEffect, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

const REALTIME_TAB_CHANNEL = "workbench-realtime-sync-v1";
const REALTIME_TAB_STORAGE_KEY = "workbench-realtime-sync-event";
const CONNECT_TIMEOUT = 15_000;
const HEARTBEAT_TIMEOUT = 60_000;

export type RealtimeSyncStatus = "offline" | "connecting" | "connected" | "reconnecting";

/** Events contain no business data. Every reconciliation still uses authenticated APIs. */
export function startRealtimeSync(
  queryClient: Pick<QueryClient, "invalidateQueries">,
  setStatus: (status: RealtimeSyncStatus) => void,
): () => void {
  if (typeof WebSocket === "undefined") {
    setStatus("offline");
    return () => undefined;
  }
  let disposed = false;
  let reconnectTimer: number | undefined;
  let invalidateTimer: number | undefined;
  let watchdog: number | undefined;
  let reconnectAttempt = 0;
  let hidden = false;
  let lastMessageAt = Date.now();
  let socket: WebSocket | undefined;
  let channel: BroadcastChannel | undefined;
  try {
    if (typeof BroadcastChannel !== "undefined") channel = new BroadcastChannel(REALTIME_TAB_CHANNEL);
  } catch {
    // A restricted optional browser capability must not disable the socket.
  }
  const publishToOtherTabs = () => {
    const value = `${Date.now()}:${crypto.randomUUID?.() ?? Math.random()}`;
    try { channel?.postMessage(value); } catch { /* Each tab also has its own socket. */ }
    try { localStorage.setItem(REALTIME_TAB_STORAGE_KEY, value); } catch { /* Storage can be unavailable. */ }
  };
  const invalidate = (broadcast = false) => {
    if (disposed) return;
    if (broadcast) publishToOtherTabs();
    if (invalidateTimer !== undefined) return;
    invalidateTimer = window.setTimeout(() => {
      invalidateTimer = undefined;
      if (!disposed) void queryClient.invalidateQueries({ type: "all", refetchType: "active" });
    }, 1_500);
  };
  const clearReconnect = () => {
    if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  };
  const closeSocket = () => {
    // Detach first: delayed events from an old connection cannot close or
    // invalidate a newer connection, including after an account switch.
    const previous = socket;
    socket = undefined;
    if (watchdog !== undefined) window.clearTimeout(watchdog);
    watchdog = undefined;
    try { previous?.close(1_000, "client reconnect or cleanup"); } catch { /* Already unavailable. */ }
  };
  const scheduleReconnect = () => {
    if (disposed || reconnectTimer !== undefined) return;
    if (!navigator.onLine) { setStatus("offline"); return; }
    setStatus("reconnecting");
    const delay = Math.min(30_000, 1_000 * 2 ** reconnectAttempt) + Math.floor(Math.random() * 500);
    reconnectAttempt = Math.min(reconnectAttempt + 1, 5);
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, delay);
  };
  const armWatchdog = (connection: WebSocket, timeout: number) => {
    if (watchdog !== undefined) window.clearTimeout(watchdog);
    watchdog = window.setTimeout(() => {
      if (disposed || socket !== connection) return;
      closeSocket();
      scheduleReconnect();
    }, timeout);
  };
  const connect = () => {
    if (disposed) return;
    if (!navigator.onLine) { setStatus("offline"); return; }
    if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
    clearReconnect();
    setStatus(reconnectAttempt ? "reconnecting" : "connecting");
    let connection: WebSocket;
    try {
      const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
      connection = new WebSocket(`${scheme}//${window.location.host}/api/realtime`);
      socket = connection;
    } catch { scheduleReconnect(); return; }
    const current = () => !disposed && socket === connection;
    armWatchdog(connection, CONNECT_TIMEOUT);
    connection.addEventListener("open", () => {
      if (!current()) return;
      reconnectAttempt = 0;
      lastMessageAt = Date.now();
      setStatus("connected");
      armWatchdog(connection, HEARTBEAT_TIMEOUT);
    });
    connection.addEventListener("message", (event) => {
      if (!current() || typeof event.data !== "string") return;
      let message: { type?: unknown };
      try { message = JSON.parse(event.data) as { type?: unknown }; } catch { return; }
      if (!message || typeof message.type !== "string") return;
      lastMessageAt = Date.now();
      armWatchdog(connection, HEARTBEAT_TIMEOUT);
      if (message.type === "heartbeat") return;
      // Ready reconciles even the first connection: facts can change between
      // the initial HTTP query and the server establishing its event cursor.
      invalidate(message.type !== "realtime.ready");
    });
    connection.addEventListener("close", (event) => {
      if (!current()) return;
      closeSocket();
      if (event.code === 4_401) void queryClient.invalidateQueries({ queryKey: ["me"] });
      scheduleReconnect();
    });
    connection.addEventListener("error", () => {
      if (!current()) return;
      closeSocket();
      scheduleReconnect();
    });
  };
  const onOnline = () => { invalidate(); connect(); };
  const onOffline = () => { clearReconnect(); closeSocket(); setStatus("offline"); };
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") { hidden = true; return; }
    if (hidden) { hidden = false; invalidate(); }
    // Suspended browsers can defer timeout callbacks and keep a dead socket OPEN.
    if (Date.now() - lastMessageAt >= HEARTBEAT_TIMEOUT) closeSocket();
    connect();
  };
  const onStorage = (event: StorageEvent) => { if (event.key === REALTIME_TAB_STORAGE_KEY) invalidate(); };
  const onChannelMessage = () => invalidate();
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  window.addEventListener("storage", onStorage);
  document.addEventListener("visibilitychange", onVisibilityChange);
  channel?.addEventListener("message", onChannelMessage);
  connect();
  return () => {
    disposed = true;
    clearReconnect();
    closeSocket();
    if (invalidateTimer !== undefined) window.clearTimeout(invalidateTimer);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("storage", onStorage);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    channel?.removeEventListener("message", onChannelMessage);
    try { channel?.close(); } catch { /* Optional channel may already be closed. */ }
  };
}

export function useRealtimeSync(membershipId: string | undefined): RealtimeSyncStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RealtimeSyncStatus>("connecting");
  useEffect(() => {
    if (!membershipId) return;
    return startRealtimeSync(queryClient, setStatus);
  }, [membershipId, queryClient]);
  return membershipId ? status : "offline";
}
