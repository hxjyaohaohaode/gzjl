import { api, ApiError } from "./api.js";

export interface PushConfiguration {
  available: boolean;
  publicKey: string | null;
  activeSubscriptions: Array<{
    id: string;
    createdAt: string;
    lastSuccessAt: string | null;
    userAgent: string | null;
  }>;
}

export function pushBrowserSupported(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(base64), (character) =>
    character.charCodeAt(0),
  );
  return new Uint8Array(bytes.buffer.slice(0));
}

async function serviceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        await navigator.serviceWorker.register("/sw.js");
        return navigator.serviceWorker.ready;
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("浏览器推送服务启动超时，请检查网络或刷新后重试。")), 10_000);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

export async function currentBrowserPushSubscription(): Promise<PushSubscription | null> {
  if (!pushBrowserSupported()) return null;
  const registration = await serviceWorkerRegistration();
  return registration.pushManager.getSubscription();
}

export async function enableCurrentBrowserPush(
  configuration: PushConfiguration,
): Promise<void> {
  if (!pushBrowserSupported()) {
    throw new Error("当前浏览器不支持标准 Web Push。");
  }
  if (!configuration.available || !configuration.publicKey) {
    throw new Error("组织尚未配置浏览器推送服务。");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "浏览器已拒绝通知权限，请在站点权限中重新允许。"
        : "尚未获得浏览器通知权限。",
    );
  }
  const registration = await serviceWorkerRegistration();
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(configuration.publicKey),
    }));
  const serialized = subscription.toJSON();
  if (!serialized.endpoint || !serialized.keys?.p256dh || !serialized.keys.auth) {
    await subscription.unsubscribe();
    throw new Error("浏览器返回的推送订阅不完整，请刷新后重试。");
  }
  await api("/api/push/subscriptions", {
    method: "POST",
    body: {
      endpoint: serialized.endpoint,
      expirationTime: serialized.expirationTime ?? null,
      keys: serialized.keys,
    },
  });
}

export async function disableCurrentBrowserPush(): Promise<void> {
  const subscription = await currentBrowserPushSubscription();
  if (!subscription) return;
  try {
    await api("/api/push/subscriptions", {
      method: "DELETE",
      body: { endpoint: subscription.endpoint },
    });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
  }
  await subscription.unsubscribe();
}

/** Best effort: a failed API call must never trap a user in the current account. */
export async function detachCurrentBrowserPushBeforeLogout(): Promise<void> {
  if (!pushBrowserSupported()) return;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Logout must not install a worker or wait indefinitely for optional Push.
  // Abort prevents a delayed lookup from deleting a later account's subscription.
  const cleanup = (async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration || controller.signal.aborted) return;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription || controller.signal.aborted) return;
    // Stop delivery locally even if the server-side cleanup stalls.
    await Promise.all([
      subscription.unsubscribe().catch(() => false),
      api("/api/push/subscriptions", {
        method: "DELETE",
        body: { endpoint: subscription.endpoint },
        signal: controller.signal,
        timeoutMs: 3_000,
      }).catch(() => undefined),
    ]);
  })().catch(() => undefined);
  try {
    await Promise.race([
      cleanup,
      new Promise<void>((resolve) => {
        timer = setTimeout(() => { controller.abort(); resolve(); }, 3_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
