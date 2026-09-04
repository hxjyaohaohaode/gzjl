import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface RealtimeMessage {
  type?: unknown;
}

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
    let socket: WebSocket | undefined;

    const invalidate = () => {
      if (invalidateTimer !== undefined) return;
      invalidateTimer = window.setTimeout(() => {
        invalidateTimer = undefined;
        // Refetch only data observed by the current screen. Inactive screens
        // will fetch on navigation, so one organization event cannot fan out
        // into dozens of requests in every open tab.
        void queryClient.invalidateQueries({
          type: "active",
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
        reconnectAttempt = 0;
        setStatus("connected");
        // A device can miss changes while suspended or offline. Reconcile the
        // data currently visible as soon as the realtime channel is restored.
        invalidate();
      });
      socket.addEventListener("message", (event) => {
        const message = parseMessage(event.data);
        if (!message || typeof message.type !== "string") return;
        if (message.type === "heartbeat") return;
        // A fresh connection can have missed events while the device was
        // offline, so ready is deliberately treated as a reconciled refetch.
        // Bursts are coalesced above so one saved work entry cannot make every
        // open chart replay several refreshes in succession.
        invalidate();
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
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      if (invalidateTimer !== undefined) window.clearTimeout(invalidateTimer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      socket?.close(1_000, "client cleanup");
    };
  }, [enabled, queryClient]);

  return status;
}
