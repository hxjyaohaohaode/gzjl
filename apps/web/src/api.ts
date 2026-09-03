let csrfToken: string | null = null;

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
  const response = await fetch(path, {
    ...requestOptions,
    method,
    headers,
    credentials: "include",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
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
