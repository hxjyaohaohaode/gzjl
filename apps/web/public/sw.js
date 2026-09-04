const CACHE_NAME = "workbench-shell-v3";
const SHELL = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        SHELL.map(async (url) => {
          const response = await fetch(url, { cache: "reload" });
          if (!response.ok) throw new Error(`Unable to cache app shell: ${url}`);
          await cache.put(url, response);
        }),
      ),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  if (new URL(request.url).pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(request, { cache: request.mode === "navigate" ? "no-store" : "default" })
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
        }
        return response;
      })
      .catch(() => caches.match(request).then((response) => response || caches.match("/"))),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "工作智能工作台", {
      body: payload.body || "你有一条新通知",
      data: { url: payload.actionUrl || "/" },
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: payload.tag || payload.notificationId,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const requested = new URL(event.notification.data?.url || "/", self.location.origin);
      const target = requested.origin === self.location.origin ? requested.href : self.location.origin;
      const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (existing) {
        await existing.navigate(target);
        return existing.focus();
      }
      return clients.openWindow(target);
    })(),
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const applicationServerKey = event.oldSubscription?.options.applicationServerKey;
      if (!applicationServerKey) return;
      const subscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
      const csrfResponse = await fetch("/api/auth/csrf", { credentials: "include" });
      if (!csrfResponse.ok) return subscription.unsubscribe();
      const { csrfToken } = await csrfResponse.json();
      const response = await fetch("/api/push/subscriptions", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          ...subscription.toJSON(),
          previousEndpoint: event.oldSubscription?.endpoint,
        }),
      });
      if (!response.ok) await subscription.unsubscribe();
    })(),
  );
});
