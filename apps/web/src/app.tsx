import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Clock3 } from "lucide-react";
import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Button, Card, CardContent } from "@workbench/ui";

import {
  api,
  ApiError,
  resetCsrfToken,
  subscribeToSessionChanges,
  type Me,
} from "./api.js";
import { useRealtimeSync } from "./realtime.js";
import { AppShell } from "./shell.js";
import { setOrganizationTimezone } from "./timezone.js";
import { startOfflineReplay } from "./offline.js";
import {
  AiPage,
  AnalyticsPage,
  ApprovalsPage,
  CalendarPage,
  HomePage,
  ImportPage,
  InvitationPage,
  LoginPage,
  NotFoundPage,
  NotificationPreferencesPage,
  OrganizationPage,
  PasswordResetPage,
  PasswordResetRequestPage,
  PayrollPage,
  ProjectDetailPage,
  ProjectsPage,
  SecurityPage,
  SetupPage,
  TeamPage,
  VerifyContactPage,
  WorkPage,
} from "./pages.js";

async function getMe({ signal }: { signal: AbortSignal }): Promise<Me | null> {
  try {
    const me = await api<Me>("/api/me", { signal });
    setOrganizationTimezone(me.user.timezone);
    return me;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      setOrganizationTimezone(null);
      return null;
    }
    throw error;
  }
}

function AppConnectionState({
  error,
  retryAttempt = 0,
  onRetry,
}: {
  error?: Error;
  retryAttempt?: number;
  onRetry?: () => void;
}) {
  const isError = Boolean(error);
  return (
    <div className="app-connection-state grid min-h-dvh place-items-center p-5">
      <Card className="app-connection-card w-full max-w-md">
        <CardContent className="p-7 sm:p-9">
          <div
            className={
              isError
                ? "grid size-12 place-items-center rounded-2xl bg-[var(--danger-soft)] text-[var(--danger)]"
                : "grid size-12 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-strong)]"
            }
          >
            {isError ? (
              <AlertCircle size={23} />
            ) : (
              <Clock3 className="animate-pulse" size={23} />
            )}
          </div>
          <p className="app-page-kicker mt-6">安全连接</p>
          <h1 className="mt-2 text-xl font-extrabold tracking-[-0.035em]">
            {isError
              ? "暂时无法连接工作台"
              : retryAttempt
                ? "正在重新连接工作台"
                : "正在验证登录状态"}
          </h1>
          <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
            {isError
              ? error?.message || "服务暂时不可用，请确认网络与服务状态后重试。"
              : retryAttempt
                ? `网络或服务刚刚短暂不可用，正在进行第 ${retryAttempt} 次自动重试。`
                : "正在确认你的安全会话和当前授权范围。"}
          </p>
          {isError ? (
            <Button
              className="mt-6"
              onClick={onRetry}
              variant="secondary"
            >
              重新连接
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    // A 401 becomes null. api() handles bounded transient read retries;
    // retrying here again would multiply the login screen's waiting time.
    retry: false,
  });
  useEffect(
    () =>
      subscribeToSessionChanges(() => {
        resetCsrfToken();
        queryClient.removeQueries({
          predicate: (query) => query.queryKey[0] !== "me",
        });
        void queryClient.resetQueries({ queryKey: ["me"], exact: true });
      }),
    [queryClient],
  );
  const membershipId = meQuery.data?.user.membershipId;
  const syncStatus = useRealtimeSync(membershipId);
  useEffect(() => {
    if (membershipId) return startOfflineReplay(membershipId);
  }, [membershipId]);
  useEffect(() => {
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ["timer"] });
      void queryClient.invalidateQueries({ queryKey: ["work-sessions"] });
    };
    window.addEventListener("workbench:timer-synced", refresh);
    return () => window.removeEventListener("workbench:timer-synced", refresh);
  }, [queryClient]);
  if (meQuery.isPending)
    return <AppConnectionState retryAttempt={meQuery.failureCount} />;
  if (meQuery.isError)
    return (
      <AppConnectionState
        error={meQuery.error}
        onRetry={() => void meQuery.refetch()}
      />
    );
  const me = meQuery.data;
  return (
    <Routes>
      <Route
        path="/login"
        element={me ? <Navigate replace to="/" /> : <LoginPage />}
      />
      <Route
        path="/forgot-password"
        element={
          me ? <Navigate replace to="/" /> : <PasswordResetRequestPage />
        }
      />
      <Route
        path="/reset-password"
        element={<PasswordResetPage currentSession={me} />}
      />
      <Route path="/verify-contact" element={<VerifyContactPage />} />
      <Route
        path="/setup"
        element={me ? <Navigate replace to="/" /> : <SetupPage />}
      />
      <Route
        path="/invite"
        element={<InvitationPage currentSession={me} />}
      />
      <Route
        element={
          me ? (
            <AppShell key={me.user.membershipId} me={me} syncStatus={syncStatus} />
          ) : (
            <Navigate replace to="/login" />
          )
        }
      >
        <Route index element={<HomePage me={me!} />} />
        <Route path="work" element={<WorkPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="projects" element={<ProjectsPage me={me!} />} />
        <Route
          path="projects/:projectId"
          element={<ProjectDetailPage me={me!} />}
        />
        <Route path="team" element={<TeamPage />} />
        <Route path="analytics" element={<AnalyticsPage me={me!} />} />
        <Route path="payroll" element={<PayrollPage me={me!} />} />
        <Route path="ai" element={<AiPage me={me!} />} />
        <Route path="approvals" element={<ApprovalsPage />} />
        <Route path="organization" element={<OrganizationPage me={me!} />} />
        <Route path="security" element={<SecurityPage />} />
        <Route
          path="notification-preferences"
          element={<NotificationPreferencesPage />}
        />
        <Route path="imports" element={<ImportPage me={me!} />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
