let csrfToken: string | null = null;
let csrfRequest: Promise<string> | null = null;
let csrfGeneration = 0;
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
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
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
  // Concurrent writes must share one cookie/token handshake. A late response
  // from the previous session must never restore that session's token.
  if (csrfRequest) return csrfRequest;
  const generation = csrfGeneration;
  const pending = api<{ csrfToken: string }>("/api/auth/csrf", { timeoutMs: 15_000 }).then((payload) => {
    if (typeof payload.csrfToken !== "string" || !payload.csrfToken) {
      throw new ApiError(502, "csrf_unavailable", "无法建立安全请求上下文，请重试。");
    }
    if (generation !== csrfGeneration) {
      throw new ApiError(409, "session_changed", "登录状态已变化，请确认当前账号后重新操作。");
    }
    csrfToken = payload.csrfToken;
    return csrfToken;
  }).finally(() => { if (csrfRequest === pending) csrfRequest = null; });
  csrfRequest = pending;
  return pending;
}

export async function api<T>(
  path: string,
  options: Omit<RequestInit, "body"> & { body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const { body, timeoutMs = 45_000, signal, ...requestOptions } = options;
  signal?.throwIfAborted();
  const method = (options.method ?? "GET").toUpperCase();
  const writes = !["GET", "HEAD", "OPTIONS"].includes(method);
  const headers = new Headers(options.headers);
  if (writes) headers.set("x-csrf-token", await getCsrfToken());
  signal?.throwIfAborted();
  if (body !== undefined) headers.set("content-type", "application/json");
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const init: RequestInit = {
    ...requestOptions,
    method,
    headers,
    credentials: "include",
    signal: controller.signal,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
  // Mutations are never retried automatically because the client cannot know
  // whether a disconnected response was committed. Safe reads absorb short
  // Render wake-ups, gateway resets and Retry-After rate-limit windows.
  try {
    const response = writes ? await fetch(path, init) : await fetchReadWithRecovery(path, init);
    if (response.ok && (response.status === 204 || method === "HEAD")) return undefined as T;
    const payload: unknown = await response.json().catch(() => null);
    // Gateways may return HTML with status 200. Treating it as {} turns a
    // recoverable connection problem into an unrelated render exception.
    if (response.ok && (payload === null || typeof payload !== "object")) {
      throw new ApiError(502, "invalid_response", "服务返回的数据不完整，请重新加载。");
    }
    if (!response.ok) {
      const problem = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
      if (response.status === 403 && ["FST_CSRF_INVALID_TOKEN", "FST_CSRF_MISSING_SECRET"].includes(String(problem.error))) resetCsrfToken();
      const fallback = response.status === 401 ? "登录已失效，请重新登录后继续。"
        : response.status === 403 ? "当前操作未获授权，请确认权限后重试。"
          : response.status === 409 ? "数据已发生变化，请刷新后核对再操作。"
            : response.status === 429 ? "请求较多，请稍候再试。"
              : "服务暂时不可用，请稍后重试。";
      throw new ApiError(response.status, typeof problem.error === "string" ? problem.error : "request_failed",
        typeof problem.message === "string" ? problem.message : fallback, problem.issues);
    }
    return payload as T;
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (controller.signal.aborted) {
      throw new ApiError(408, "request_timeout", writes
        ? "请求超时，尚未确认是否保存成功。请先刷新核对结果，再决定是否重新提交。"
        : "连接超时，请检查网络后重新加载。");
    }
    if (error instanceof TypeError) {
      // Preserve the TypeError contract used by the idempotent timer queue.
      throw new TypeError(writes
        ? "网络连接中断，尚未确认是否保存成功。请先核对结果，再决定是否重新提交。"
        : "网络连接中断，请检查网络后重新加载。", { cause: error });
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export function resetCsrfToken(): void {
  csrfToken = null;
  csrfRequest = null;
  csrfGeneration += 1;
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
    timezone: string;
  };
  permissions: PermissionGrant[];
}

export function hasGrant(me: Me, permission: string): boolean {
  return me.permissions.some((grant) => grant.permission === permission);
}
