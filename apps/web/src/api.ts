let csrfToken: string | null = null;
const SESSION_CHANGE_STORAGE_KEY = "workbench-session-change";

const RETRYABLE_READ_STATUSES = new Set([429, 502, 503, 504]);

function retryDelay(response: Response | null, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(10_000, Math.max(0, seconds * 1_000));
    const at = Date.parse(retryAfter);
    if (Number.isFinite(at)) return Math.min(10_000, Math.max(0, at - Date.now()));
  }
  const base = [500, 1_500, 3_500][attempt] ?? 5_000;
  return base + Math.floor(Math.random() * 350);
}

async function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) throw signal.reason;
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

async function fetchReadWithRecovery(
  path: string,
  init: RequestInit,
): Promise<Response> {
  let lastNetworkError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(path, init);
      if (!RETRYABLE_READ_STATUSES.has(response.status) || attempt === 2) {
        return response;
      }
      await response.body?.cancel().catch(() => undefined);
      await sleep(retryDelay(response, attempt), init.signal);
    } catch (error) {
      if (init.signal?.aborted) throw error;
      lastNetworkError = error;
      if (attempt === 2) throw error;
      await sleep(retryDelay(null, attempt), init.signal);
    }
  }
  throw lastNetworkError;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function getCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  const response = await fetch("/api/auth/csrf", { credentials: "include" });
  if (!response.ok) throw new ApiError(response.status, "csrf_unavailable", "无法建立安全请求上下文。")
  const payload = (await response.json()) as { csrfToken: string };
  csrfToken = payload.csrfToken;
  return csrfToken;
}

export async function api<T>(
  path: string,
  options: Omit<RequestInit, "body"> & { body?: unknown } = {},
): Promise<T> {
  const { body, ...requestOptions } = options;
  const method = (options.method ?? "GET").toUpperCase();
  const writes = !["GET", "HEAD", "OPTIONS"].includes(method);
  const headers = new Headers(options.headers);
  if (writes) headers.set("x-csrf-token", await getCsrfToken());
  if (body !== undefined) headers.set("content-type", "application/json");
  const init: RequestInit = {
    ...requestOptions,
    method,
    headers,
    credentials: "include",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
  // Mutations are never retried automatically because the client cannot know
  // whether a disconnected response was committed. Safe reads absorb short
  // Render wake-ups, gateway resets and Retry-After rate-limit windows.
  const response = writes
    ? await fetch(path, init)
    : await fetchReadWithRecovery(path, init);
  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    if (response.status === 403 && payload.error === "FST_CSRF_INVALID_TOKEN") csrfToken = null;
    throw new ApiError(
      response.status,
      typeof payload.error === "string" ? payload.error : "request_failed",
      typeof payload.message === "string" ? payload.message : "请求失败，请稍后重试。",
      payload.issues,
    );
  }
  return payload as T;
}

export function resetCsrfToken(): void {
  csrfToken = null;
}

/**
 * Tells other tabs on this device that the cookie-backed identity changed.
 * The event contains no account data or credentials; its value only exists to
 * make consecutive changes observable by the browser's storage event.
 */
export function notifySessionChanged(): void {
  try {
    localStorage.setItem(
      SESSION_CHANGE_STORAGE_KEY,
      `${Date.now()}:${globalThis.crypto?.randomUUID?.() ?? Math.random()}`,
    );
  } catch {
    // Private browsing/storage restrictions must never block login or logout.
  }
}

export function subscribeToSessionChanges(listener: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === SESSION_CHANGE_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", handleStorage);
  return () => window.removeEventListener("storage", handleStorage);
}

export interface PermissionGrant {
  permission: string;
  scopeKind: "organization" | "org_unit" | "project" | "self";
  scopeId: string | null;
}

export interface Me {
  user: {
    id: string;
    membershipId: string;
    organizationId: string;
    displayName: string;
    isOwner: boolean;
  };
  permissions: PermissionGrant[];
}

export function hasGrant(me: Me, permission: string): boolean {
  return me.permissions.some((grant) => grant.permission === permission);
}
