import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router-dom";

import { api, ApiError, type Me } from "./api.js";
import { AppShell } from "./shell.js";
import { AiPage, AnalyticsPage, ApprovalsPage, CalendarPage, HomePage, ImportPage, InvitationPage, LoginPage, NotFoundPage, NotificationPreferencesPage, OrganizationPage, PasswordResetPage, PasswordResetRequestPage, PayrollPage, ProjectDetailPage, ProjectsPage, SecurityPage, SetupPage, TeamPage, WorkPage } from "./pages.js";

async function getMe(): Promise<Me | null> {
  try { return await api<Me>("/api/me"); }
  catch (error) { if (error instanceof ApiError && error.status === 401) return null; throw error; }
}

export function App() {
  const meQuery = useQuery({ queryKey: ["me"], queryFn: getMe, retry: false });
  if (meQuery.isPending) return <div className="grid min-h-dvh place-items-center bg-[var(--canvas)] text-sm text-[var(--text-muted)]">正在验证登录状态…</div>;
  if (meQuery.isError) return <div className="grid min-h-dvh place-items-center bg-[var(--canvas)] p-6 text-center"><div><h1 className="text-lg font-bold">暂时无法连接服务</h1><p className="mt-2 text-sm text-[var(--text-muted)]">{meQuery.error.message}</p></div></div>;
  const me = meQuery.data;
  return (
    <Routes>
      <Route path="/login" element={me ? <Navigate replace to="/" /> : <LoginPage />} />
      <Route path="/forgot-password" element={me ? <Navigate replace to="/" /> : <PasswordResetRequestPage />} />
      <Route path="/reset-password" element={me ? <Navigate replace to="/" /> : <PasswordResetPage />} />
      <Route path="/setup" element={me ? <Navigate replace to="/" /> : <SetupPage />} />
      <Route path="/invite" element={me ? <Navigate replace to="/" /> : <InvitationPage />} />
      <Route element={me ? <AppShell me={me} /> : <Navigate replace to="/login" />}>
        <Route index element={<HomePage me={me!} />} />
        <Route path="work" element={<WorkPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="projects" element={<ProjectsPage me={me!} />} />
        <Route path="projects/:projectId" element={<ProjectDetailPage me={me!} />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="analytics" element={<AnalyticsPage me={me!} />} />
        <Route path="payroll" element={<PayrollPage />} />
        <Route path="ai" element={<AiPage />} />
        <Route path="approvals" element={<ApprovalsPage />} />
        <Route path="organization" element={<OrganizationPage />} />
        <Route path="security" element={<SecurityPage />} />
        <Route path="notification-preferences" element={<NotificationPreferencesPage />} />
        <Route path="imports" element={<ImportPage me={me!} />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
