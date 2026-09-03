import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface RealtimeMessage {
  type?: unknown;
}

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
export function useRealtimeSync(enabled: boolean): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || typeof WebSocket === "undefined") return;

    let disposed = false;
    let reconnectTimer: number | undefined;
    let reconnectAttempt = 0;
    let socket: WebSocket | undefined;

    const invalidate = () => {
      void queryClient.invalidateQueries();
    };
    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== undefined) return;
      const delay = Math.min(30_000, 1_000 * 2 ** reconnectAttempt);
      reconnectAttempt = Math.min(reconnectAttempt + 1, 5);
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, delay);
    };
    const connect = () => {
      if (
        disposed ||
        socket?.readyState === WebSocket.OPEN ||
        socket?.readyState === WebSocket.CONNECTING
      ) {
        return;
      }
      try {
        socket = new WebSocket(websocketUrl());
      } catch {
        scheduleReconnect();
        return;
      }
      socket.addEventListener("open", () => {
        reconnectAttempt = 0;
      });
      socket.addEventListener("message", (event) => {
        const message = parseMessage(event.data);
        if (!message || typeof message.type !== "string") return;
        if (message.type === "heartbeat") return;
        // A fresh connection can have missed events while the device was
        // offline, so ready is deliberately treated as a full refetch signal.
        invalidate();
      });
      socket.addEventListener("close", (event) => {
        if (disposed) return;
        if (event.code === 4_401) {
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
    window.addEventListener("online", onOnline);
    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      window.removeEventListener("online", onOnline);
      socket?.close(1_000, "client cleanup");
    };
  }, [enabled, queryClient]);
}
