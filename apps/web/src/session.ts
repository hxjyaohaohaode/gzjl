import type { QueryClient } from "@tanstack/react-query";
import { api, ApiError, notifySessionChanged, resetCsrfToken } from "./api.js";
import { detachCurrentBrowserPushBeforeLogout } from "./push-client.js";

/** Clear identity only after the server confirms logout or an expired session. */
export async function endCurrentSession(queryClient: QueryClient): Promise<void> {
  await detachCurrentBrowserPushBeforeLogout();
  try {
    await api<void>("/api/auth/logout", { method: "POST" });
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) {
      throw new Error("尚未确认退出成功，请检查网络后重试退出。当前会话可能仍然有效。", { cause: error });
    }
  }
  resetCsrfToken();
  // A me request started before logout must not restore the previous identity.
  await queryClient.cancelQueries();
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "me" });
  queryClient.setQueryData(["me"], null);
  notifySessionChanged();
}
