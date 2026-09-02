import { api } from "./api.js";

interface QueuedRequest {
  id: string;
  path: string;
  body: Record<string, unknown>;
  queuedAt: string;
}

const DATABASE_NAME = "workbench-offline-v1";
const STORE_NAME = "timer-events";
const MAX_QUEUED_EVENTS = 500;
let databasePromise: Promise<IDBDatabase> | undefined;

function database(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onerror = () => reject(request.error ?? new Error("无法打开离线队列。"));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" }).createIndex("queuedAt", "queuedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
  return databasePromise;
}

function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return database().then((db) => new Promise<T>((resolve, reject) => {
    const request = action(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
    request.onerror = () => reject(request.error ?? new Error("离线队列操作失败。"));
    request.onsuccess = () => resolve(request.result);
  }));
}

async function readQueue(): Promise<QueuedRequest[]> {
  const items = await transaction("readonly", (store) => store.getAll());
  return (items as QueuedRequest[]).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

function announceQueue(count: number): void {
  window.dispatchEvent(new CustomEvent("workbench:offline-queue", { detail: count }));
}

async function enqueue(item: QueuedRequest): Promise<void> {
  const queue = await readQueue();
  const duplicate = queue.some((existing) => existing.id === item.id);
  if (!duplicate) await transaction("readwrite", (store) => store.put(item));
  const overflow = duplicate ? [] : queue.slice(0, Math.max(0, queue.length + 1 - MAX_QUEUED_EVENTS));
  await Promise.all(overflow.map((entry) => transaction("readwrite", (store) => store.delete(entry.id))));
  announceQueue(Math.min(MAX_QUEUED_EVENTS, duplicate ? queue.length : queue.length + 1));
}

async function remove(id: string): Promise<void> {
  await transaction("readwrite", (store) => store.delete(id));
  announceQueue((await readQueue()).length);
}

export async function queuedTimerEventCount(): Promise<number> {
  return (await readQueue()).length;
}

async function queueTimerEvent(path: string, body: Record<string, unknown>): Promise<void> {
  await enqueue({ id: String(body.eventId ?? crypto.randomUUID()), path, body, queuedAt: new Date().toISOString() });
}

export async function sendQueueableTimerEvent<T>(path: string, body: Record<string, unknown>): Promise<T | { queuedOffline: true }> {
  if (!navigator.onLine) {
    await queueTimerEvent(path, body);
    return { queuedOffline: true };
  }
  try {
    return await api<T>(path, { method: "POST", body });
  } catch (error) {
    if (error instanceof TypeError) {
      await queueTimerEvent(path, body);
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
    for (const item of await readQueue()) {
      try {
        await api(item.path, { method: "POST", body: item.body });
        // Delete only the acknowledged item. A new event enqueued while this
        // replay is running remains durable and ordered for the next pass.
        await remove(item.id);
      } catch (error) {
        if (error instanceof TypeError) break;
        // A 4xx/5xx must remain reviewable rather than being silently dropped.
        break;
      }
    }
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
