import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface RealtimeMessage {
  type?: unknown;
}

const REALTIME_TAB_CHANNEL = "workbench-realtime-sync-v1";
const REALTIME_TAB_STORAGE_KEY = "workbench-realtime-sync-event";

export type RealtimeSyncStatus =
  | "offline"
  | "connecting"
  | "connected"
  | "reconnecting";

function websocketUrl(): string {
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return [scheme, "//", window.location.host, "/api/realtime"].join("");
}

function parseMessage(value: unknown): RealtimeMessage | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as RealtimeMessage) : null;
  } catch {
    return null;
  }
}

/**
 * Keeps every active screen aligned with the organization fact source. Events
 * intentionally contain no work, payroll, evidence, or AI content: receiving
 * a signal merely invalidates React Query and each endpoint re-applies its
 * server-side permission scope on refetch.
 */
export function useRealtimeSync(enabled: boolean): RealtimeSyncStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RealtimeSyncStatus>(() =>
    navigator.onLine && typeof WebSocket !== "undefined"
      ? "connecting"
      : "offline",
  );

  useEffect(() => {
    if (!enabled || typeof WebSocket === "undefined") return;

    let disposed = false;
    let reconnectTimer: number | undefined;
    let invalidateTimer: number | undefined;
    let reconnectAttempt = 0;
    let hasConnected = false;
    let hiddenAt: number | undefined;
    let socket: WebSocket | undefined;
    const channel = typeof BroadcastChannel === "undefined"
      ? undefined
      : new BroadcastChannel(REALTIME_TAB_CHANNEL);

    const publishToOtherTabs = () => {
      const value = `${Date.now()}:${crypto.randomUUID?.() ?? Math.random()}`;
      channel?.postMessage(value);
      try {
        localStorage.setItem(REALTIME_TAB_STORAGE_KEY, value);
      } catch {
        // Storage may be disabled; BroadcastChannel or each tab's socket still works.
      }
    };
    const invalidate = (broadcast = false) => {
      if (broadcast) publishToOtherTabs();
      if (invalidateTimer !== undefined) return;
      invalidateTimer = window.setTimeout(() => {
        invalidateTimer = undefined;
        // Mark every cached screen stale but refetch only the screen currently
        // observed. A later navigation can never reuse a pre-event cache, while
        // one organization event still cannot fan out into dozens of requests.
        void queryClient.invalidateQueries({
          type: "all",
          refetchType: "active",
        });
      }, 1_500);
    };
    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== undefined) return;
      if (!navigator.onLine) {
        setStatus("offline");
        return;
      }
      setStatus("reconnecting");
      const delay =
        Math.min(30_000, 1_000 * 2 ** reconnectAttempt) +
        Math.floor(Math.random() * 500);
      reconnectAttempt = Math.min(reconnectAttempt + 1, 5);
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, delay);
    };
    const connect = () => {
      if (!navigator.onLine) {
        setStatus("offline");
        return;
      }
      if (
        disposed ||
        socket?.readyState === WebSocket.OPEN ||
        socket?.readyState === WebSocket.CONNECTING
      ) {
        return;
      }
      setStatus(reconnectAttempt ? "reconnecting" : "connecting");
      try {
        socket = new WebSocket(websocketUrl());
      } catch {
        scheduleReconnect();
        return;
      }
      socket.addEventListener("open", () => {
        const isReconnect = hasConnected;
        hasConnected = true;
        reconnectAttempt = 0;
        setStatus("connected");
        // A device can miss changes while suspended or offline. Reconcile the
        // visible data when a lost channel is restored. The first connection
        // follows the screen's normal initial queries and needs no duplicate
        // refetch.
        if (isReconnect) invalidate(true);
      });
      socket.addEventListener("message", (event) => {
        const message = parseMessage(event.data);
        if (!message || typeof message.type !== "string") return;
        if (message.type === "heartbeat" || message.type === "realtime.ready") return;
        // Business event bursts are coalesced above so one saved work entry
        // cannot make every open chart replay several refreshes in succession.
        invalidate(true);
      });
      socket.addEventListener("close", (event) => {
        if (disposed) return;
        if (event.code === 4_401) {
          setStatus("reconnecting");
          void queryClient.invalidateQueries({ queryKey: ["me"] });
          return;
        }
        scheduleReconnect();
      });
      socket.addEventListener("error", () => {
        if (socket?.readyState === WebSocket.OPEN) socket.close();
      });
    };

    const onOnline = () => {
      invalidate();
      if (socket?.readyState !== WebSocket.OPEN) connect();
    };
    const onOffline = () => {
      setStatus("offline");
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      socket?.close(1_000, "device offline");
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt !== undefined) {
        hiddenAt = undefined;
        invalidate();
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === REALTIME_TAB_STORAGE_KEY) invalidate();
    };
    const onChannelMessage = () => invalidate();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibilityChange);
    channel?.addEventListener("message", onChannelMessage);
    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      if (invalidateTimer !== undefined) window.clearTimeout(invalidateTimer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      channel?.removeEventListener("message", onChannelMessage);
      channel?.close();
      socket?.close(1_000, "client cleanup");
    };
  }, [enabled, queryClient]);

  return status;
}
