import { api } from "./api.js";

interface QueuedRequest {
  id: string;
  path: string;
  body: Record<string, unknown>;
  queuedAt: string;
}

const STORAGE_KEY = "workbench.offline.timer-events.v1";

function readQueue(): QueuedRequest[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? (value as QueuedRequest[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedRequest[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue.slice(-500)));
  window.dispatchEvent(new CustomEvent("workbench:offline-queue", { detail: queue.length }));
}

export function queuedTimerEventCount(): number {
  return readQueue().length;
}

export async function sendQueueableTimerEvent<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T | { queuedOffline: true }> {
  if (!navigator.onLine) {
    const queue = readQueue();
    queue.push({ id: String(body.eventId ?? crypto.randomUUID()), path, body, queuedAt: new Date().toISOString() });
    writeQueue(queue);
    return { queuedOffline: true };
  }
  try {
    return await api<T>(path, { method: "POST", body });
  } catch (error) {
    if (error instanceof TypeError) {
      const queue = readQueue();
      queue.push({ id: String(body.eventId ?? crypto.randomUUID()), path, body, queuedAt: new Date().toISOString() });
      writeQueue(queue);
      return { queuedOffline: true };
    }
    throw error;
  }
}

let replaying = false;
export async function replayOfflineTimerEvents(): Promise<void> {
  if (replaying || !navigator.onLine) return;
  replaying = true;
  try {
    const queue = readQueue();
    const remaining: QueuedRequest[] = [];
    for (let index = 0; index < queue.length; index += 1) {
      const item = queue[index]!;
      try {
        await api(item.path, { method: "POST", body: item.body });
      } catch (error) {
        remaining.push(item, ...queue.slice(index + 1));
        if (error instanceof TypeError) break;
      }
    }
    writeQueue(remaining);
  } finally {
    replaying = false;
  }
}

export function startOfflineReplay(): () => void {
  const replay = () => void replayOfflineTimerEvents();
  window.addEventListener("online", replay);
  replay();
  return () => window.removeEventListener("online", replay);
}
