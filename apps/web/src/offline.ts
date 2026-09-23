import { api, ApiError, subscribeToSessionChanges } from "./api.js";

interface QueuedRequest {
  id: string;
  membershipId: string;
  path: string;
  body: Record<string, unknown>;
  queuedAt: string;
}
export interface OfflineTimerStatus { count: number; syncing: boolean; error: string | null }
const DATABASE_NAME = "workbench-offline-v1";
const STORE_NAME = "timer-events";
const MAX_QUEUED_EVENTS = 500;
let databasePromise: Promise<IDBDatabase> | undefined;
let activeMembershipId: string | null = null;
let replayController: AbortController | null = null;
let replaying = false;
let discarding = false;
let status: OfflineTimerStatus = { count: 0, syncing: false, error: null };

function database(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onerror = () => reject(new Error("无法打开离线队列，请检查浏览器存储权限。"));
    request.onblocked = () => reject(new Error("离线队列被其他页面占用，请关闭旧页面后重试。"));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "id" }).createIndex("queuedAt", "queuedAt");
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); databasePromise = undefined; };
      resolve(db);
    };
  });
  databasePromise = pending.catch((error: unknown) => { databasePromise = undefined; throw error; });
  return databasePromise;
}

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const request = action(tx.objectStore(STORE_NAME));
    // A successful request can still be rolled back by quota/commit failure.
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error ?? new Error("离线操作未保存，请检查浏览器存储空间。"));
    tx.onerror = () => reject(tx.error ?? new Error("离线队列操作失败。"));
  });
}

async function readQueue(membershipId: string): Promise<QueuedRequest[]> {
  const items = await transaction("readonly", (store) => store.getAll()) as QueuedRequest[];
  // Legacy entries without a known owner are never assigned to the next user.
  return items.filter((item) => item.membershipId === membershipId).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

function announce(update: Partial<OfflineTimerStatus>): void {
  status = { ...status, ...update };
  window.dispatchEvent(new CustomEvent("workbench:offline-queue", { detail: status }));
}
export function getOfflineTimerStatus(): OfflineTimerStatus { return status; }
export function subscribeOfflineTimerStatus(listener: () => void): () => void {
  window.addEventListener("workbench:offline-queue", listener);
  return () => window.removeEventListener("workbench:offline-queue", listener);
}
export async function queuedTimerEventCount(): Promise<number> {
  return activeMembershipId ? (await readQueue(activeMembershipId)).length : 0;
}
export async function queuedTimerEventsForReview(): Promise<QueuedRequest[]> {
  return activeMembershipId ? readQueue(activeMembershipId) : [];
}
export async function discardQueuedTimerEvents(ids: string[]): Promise<void> {
  const membershipId = activeMembershipId;
  if (!membershipId) throw new Error("请先确认当前登录账号。");
  if (replaying || discarding) throw new Error("同步仍在进行，请等待完成后再处理。");
  discarding = true;
  try {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => {
        if (membershipId !== activeMembershipId) { tx.abort(); return; }
        for (const item of request.result as QueuedRequest[]) {
          if (item.membershipId === membershipId && ids.includes(item.id)) store.delete(item.id);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(new Error("未能放弃本机操作，请确认登录状态与浏览器存储。"));
      tx.onerror = () => reject(tx.error ?? new Error("本机操作仍被保留，请重试。"));
    });
    if (membershipId === activeMembershipId) announce({ count: (await readQueue(membershipId)).length, error: null });
  } finally { discarding = false; }
}

async function enqueue(item: QueuedRequest): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    let full = false;
    request.onsuccess = () => {
      const items = request.result as QueuedRequest[];
      if (items.some((entry) => entry.id === item.id)) return;
      if (items.length >= MAX_QUEUED_EVENTS) { full = true; tx.abort(); return; }
      store.put(item);
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(new Error(full ? "离线队列已满，请先同步已有操作；本次操作未保存。" : "离线操作未保存，请检查浏览器存储权限或空间。"));
    tx.onerror = () => reject(tx.error ?? new Error("离线操作未保存。"));
  });
  if (activeMembershipId === item.membershipId) announce({ count: (await readQueue(item.membershipId)).length, error: null });
}

export async function sendQueueableTimerEvent<T>(path: string, body: Record<string, unknown>): Promise<T | { queuedOffline: true }> {
  const membershipId = activeMembershipId;
  if (!membershipId) throw new Error("请先确认登录状态，再操作计时器。");
  const eventId = String(body.eventId ?? crypto.randomUUID());
  const item = { id: eventId, membershipId, path, body: { ...body, eventId }, queuedAt: new Date().toISOString() };
  const existing = await readQueue(membershipId).catch((error: unknown) => {
    if (!navigator.onLine) throw error;
    return [];
  });
  if (!navigator.onLine || existing.length) {
    await enqueue(item);
    return { queuedOffline: true };
  }
  try {
    return await api<T>(path, { method: "POST", headers: { "x-workbench-membership": membershipId }, body: item.body });
  } catch (error) {
    if (error instanceof TypeError || (error instanceof ApiError && error.code === "request_timeout")) {
      // Timer events have durable server idempotency keys, unlike general writes.
      await enqueue(item);
      return { queuedOffline: true };
    }
    throw error;
  }
}

export async function replayOfflineTimerEvents(): Promise<void> {
  const membershipId = activeMembershipId;
  if (replaying || discarding || !navigator.onLine || !membershipId) return;
  replaying = true;
  const controller = new AbortController();
  replayController = controller;
  try {
    const queue = await readQueue(membershipId);
    if (membershipId !== activeMembershipId) return;
    announce({ count: queue.length, syncing: queue.length > 0, error: null });
    for (const item of queue) {
      if (controller.signal.aborted || membershipId !== activeMembershipId) break;
      await api(item.path, { method: "POST", headers: { "x-workbench-membership": membershipId }, body: item.body, signal: controller.signal });
      await transaction("readwrite", (store) => store.delete(item.id));
      if (membershipId === activeMembershipId) announce({ count: (await readQueue(membershipId)).length });
      window.dispatchEvent(new Event("workbench:timer-synced"));
    }
  } catch (error) {
    if (!controller.signal.aborted && membershipId === activeMembershipId) announce({ error: error instanceof Error ? error.message : "同步失败，操作仍保留在此浏览器中。" });
  } finally {
    replaying = false;
    if (replayController === controller) replayController = null;
    if (membershipId === activeMembershipId) announce({ syncing: false });
    // A newly authenticated account may have started while the old replay
    // was still being cancelled. Resume its own queue after that cancellation.
    if (activeMembershipId && (membershipId !== activeMembershipId || controller.signal.aborted)) void replayOfflineTimerEvents();
  }
}

export function startOfflineReplay(membershipId: string): () => void {
  activeMembershipId = membershipId;
  announce({ count: 0, syncing: false, error: null });
  const replay = () => void replayOfflineTimerEvents();
  const refresh = () => { if (document.visibilityState === "visible") replay(); };
  const stop = () => {
    activeMembershipId = null;
    replayController?.abort();
    announce({ count: 0, syncing: false, error: null });
  };
  const unsubscribe = subscribeToSessionChanges(stop);
  window.addEventListener("online", replay);
  document.addEventListener("visibilitychange", refresh);
  void readQueue(membershipId).then((queue) => {
    if (activeMembershipId !== membershipId) return;
    announce({ count: queue.length });
    replay();
  }).catch(() => {
    // Storage is optional for connected work; errors are surfaced on a user action.
  });
  return () => {
    unsubscribe();
    window.removeEventListener("online", replay);
    document.removeEventListener("visibilitychange", refresh);
    stop();
  };
}
