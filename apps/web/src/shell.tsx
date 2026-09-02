import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Bot, BriefcaseBusiness, CalendarDays, ChartNoAxesCombined, ChevronDown, CircleDollarSign, Clock3, FileCheck2, FolderKanban, Home, LogOut, Menu, Search, Settings, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Button, cn } from "@workbench/ui";

import { api, hasGrant, resetCsrfToken, type Me } from "./api.js";

interface NavigationItem { label: string; shortLabel: string; to: string; icon: LucideIcon; permission?: string; organizationPermission?: string }
interface NotificationItem { id: string; title: string; body: string; severity: string; actionUrl: string | null; readAt: string | null; createdAt: string }
const navigation: NavigationItem[] = [
  { label: "今日工作台", shortLabel: "今日", to: "/", icon: Home },
  { label: "工作记录", shortLabel: "记录", to: "/work", icon: Clock3 },
  { label: "日历", shortLabel: "日历", to: "/calendar", icon: CalendarDays },
  { label: "项目", shortLabel: "项目", to: "/projects", icon: FolderKanban },
  { label: "团队动态", shortLabel: "团队", to: "/team", icon: Users, permission: "work.view_project_public" },
  { label: "数据分析", shortLabel: "分析", to: "/analytics", icon: ChartNoAxesCombined },
  { label: "我的薪资", shortLabel: "薪资", to: "/payroll", icon: CircleDollarSign, permission: "payroll.view_own" },
  { label: "AI 工作洞察", shortLabel: "AI", to: "/ai", icon: Bot },
  { label: "审批", shortLabel: "审批", to: "/approvals", icon: FileCheck2, permission: "work.review" },
  { label: "组织与人员", shortLabel: "组织", to: "/organization", icon: BriefcaseBusiness, permission: "members.manage" },
  { label: "账户安全", shortLabel: "安全", to: "/security", icon: Settings },
  { label: "通知设置", shortLabel: "通知", to: "/notification-preferences", icon: Bell },
  { label: "导入工时", shortLabel: "导入", to: "/imports", icon: FileCheck2, organizationPermission: "import.scope" },
];

export function AppShell({ me }: { me: Me }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [theme, setTheme] = useState<"system" | "light" | "dark">(() => (localStorage.getItem("workbench-theme") as "system" | "light" | "dark" | null) ?? "system");
  const [accent, setAccent] = useState(() => localStorage.getItem("workbench-accent") ?? "#3468f5");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const visibleNavigation = navigation.filter((item) => (!item.permission || hasGrant(me, item.permission)) && (!item.organizationPermission || me.permissions.some((grant) => grant.permission === item.organizationPermission && grant.scopeKind === "organization")));
  const mobileNavigation = ["/", "/work", "/projects", "/analytics", "/payroll"].map((path) => visibleNavigation.find((item) => item.to === path)).filter((item): item is NavigationItem => Boolean(item));
  const logout = useMutation({ mutationFn: () => api<void>("/api/auth/logout", { method: "POST" }), onSettled: async () => { resetCsrfToken(); await queryClient.invalidateQueries({ queryKey: ["me"] }); navigate("/login", { replace: true }); } });
  const notifications = useQuery({ queryKey: ["notifications"], queryFn: () => api<{ items: NotificationItem[] }>("/api/notifications"), refetchInterval: 30_000 });
  const markRead = useMutation({ mutationFn: (id: string) => api(`/api/notifications/${id}/read`, { method: "POST" }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["notifications"] }); } });
  const unreadCount = notifications.data?.items.filter((item) => !item.readAt).length ?? 0;
  useEffect(() => { const root = document.documentElement; if (theme === "system") root.removeAttribute("data-theme"); else root.dataset.theme = theme; localStorage.setItem("workbench-theme", theme); }, [theme]);
  useEffect(() => { const root = document.documentElement; root.style.setProperty("--accent", accent); root.style.setProperty("--accent-strong", accent); root.style.setProperty("--accent-soft", `color-mix(in srgb, ${accent} 14%, transparent)`); localStorage.setItem("workbench-accent", accent); }, [accent]);
  return (
    <div className="min-h-dvh bg-[var(--canvas)] text-[var(--text)]">
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <aside aria-label="主导航" className={cn("fixed inset-y-0 left-0 z-40 flex w-[276px] flex-col border-r border-[var(--border)] bg-[var(--surface)] transition-transform lg:translate-x-0", sidebarOpen ? "translate-x-0" : "-translate-x-full") }>
        <div className="flex h-18 items-center gap-3 px-5"><div className="grid size-10 place-items-center rounded-2xl bg-[var(--accent)] text-white shadow-sm"><Clock3 size={20} /></div><div className="min-w-0"><p className="truncate text-sm font-bold">工作智能工作台</p><p className="truncate text-xs text-[var(--text-muted)]">统一事实 · 清晰协作</p></div></div>
        <nav className="flex-1 overflow-y-auto px-3 py-3"><p className="px-3 pb-2 text-[11px] font-semibold tracking-[0.12em] text-[var(--text-subtle)] uppercase">工作空间</p><div className="space-y-1">{visibleNavigation.map((item) => { const Icon = item.icon; return <NavLink className={({ isActive }) => cn("flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors hover:bg-[var(--surface-subtle)]", isActive && "bg-[var(--accent-soft)] text-[var(--accent-strong)]")} end={item.to === "/"} key={item.to} onClick={() => setSidebarOpen(false)} to={item.to}><Icon size={18} /><span>{item.label}</span></NavLink>; })}</div></nav>
        <div className="border-t border-[var(--border)] p-3"><div className="flex items-center gap-3 rounded-xl px-3 py-2"><div className="grid size-9 place-items-center rounded-full bg-[var(--accent-soft)] text-sm font-bold text-[var(--accent-strong)]">{me.user.displayName.slice(0, 1)}</div><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{me.user.displayName}</span><span className="block truncate text-xs text-[var(--text-muted)]">已安全登录</span></span><ChevronDown size={16} /></div><Button className="mt-2 w-full justify-start" disabled={logout.isPending} onClick={() => logout.mutate()} variant="ghost"><LogOut size={17} />退出登录</Button></div>
      </aside>
      {sidebarOpen ? <button aria-label="关闭导航" className="fixed inset-0 z-30 bg-black/20 backdrop-blur-[1px] lg:hidden" onClick={() => setSidebarOpen(false)} type="button" /> : null}
      <div className="lg:pl-[276px]"><header className="sticky top-0 z-20 flex h-18 items-center gap-3 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--canvas)_88%,transparent)] px-4 backdrop-blur-xl md:px-6"><Button aria-label="打开导航" className="lg:hidden" onClick={() => setSidebarOpen(true)} size="icon" variant="ghost"><Menu size={20} /></Button><button className="hidden min-h-10 max-w-lg flex-1 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text-muted)] md:flex" type="button"><Search size={17} /><span>搜索记录、项目、成员或文件</span><kbd className="ml-auto rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[10px]">Ctrl K</kbd></button><div className="relative ml-auto flex items-center gap-1.5"><span className="relative"><Button aria-expanded={notificationsOpen} aria-label={`通知${unreadCount ? `，${unreadCount} 条未读` : ""}`} onClick={() => setNotificationsOpen((value) => !value)} size="icon" variant="ghost"><Bell size={19} /></Button>{unreadCount ? <span className="absolute right-0 top-0 grid min-w-4 place-items-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-bold text-white">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}</span><Button aria-expanded={settingsOpen} aria-label="设置" onClick={() => setSettingsOpen((value) => !value)} size="icon" variant="ghost"><Settings size={19} /></Button>{notificationsOpen ? <div className="absolute right-0 top-12 z-50 max-h-[min(70vh,560px)] w-[min(92vw,380px)] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-card)]"><div className="flex items-center justify-between px-1 pb-2"><p className="font-bold">通知</p><span className="text-xs text-[var(--text-muted)]">{unreadCount} 条未读</span></div>{notifications.isPending ? <p className="p-3 text-sm text-[var(--text-muted)]">正在读取通知…</p> : notifications.error ? <p className="p-3 text-sm text-[var(--danger)]">通知暂时不可用。</p> : notifications.data?.items.length ? <div className="space-y-1">{notifications.data.items.map((item) => <button className={cn("w-full rounded-xl p-3 text-left transition hover:bg-[var(--surface-subtle)]", !item.readAt && "bg-[var(--accent-soft)]")} key={item.id} onClick={() => { if (!item.readAt) markRead.mutate(item.id); if (item.actionUrl) { setNotificationsOpen(false); navigate(item.actionUrl); } }} type="button"><div className="flex gap-2"><span className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.severity === "critical" ? "bg-[var(--danger)]" : item.severity === "warning" ? "bg-[var(--warning)]" : "bg-[var(--accent)]")} /><span className="min-w-0"><span className="block text-sm font-semibold">{item.title}</span><span className="mt-1 block text-xs leading-5 text-[var(--text-muted)]">{item.body}</span><span className="mt-1 block text-[11px] text-[var(--text-subtle)]">{new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(item.createdAt))}</span></span></div></button>)}</div> : <p className="p-3 text-sm text-[var(--text-muted)]">暂无通知。</p>}</div> : null}{settingsOpen ? <div className="absolute right-0 top-12 z-50 w-72 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-card)]"><p className="text-sm font-bold">外观设置</p><label className="mt-3 block text-xs font-semibold text-[var(--text-muted)]">主题</label><div className="mt-2 grid grid-cols-3 gap-2">{(["system", "light", "dark"] as const).map((value) => <Button key={value} onClick={() => setTheme(value)} size="compact" variant={theme === value ? "primary" : "secondary"}>{value === "system" ? "跟随系统" : value === "light" ? "浅色" : "深色"}</Button>)}</div><label className="mt-4 flex items-center justify-between text-xs font-semibold text-[var(--text-muted)]">强调色<input aria-label="自定义强调色" className="h-9 w-12 cursor-pointer rounded border border-[var(--border)] bg-transparent p-1" onChange={(event) => setAccent(event.target.value)} type="color" value={accent} /></label></div> : null}</div></header><main className="mx-auto max-w-[1600px] px-4 py-6 md:px-6 md:py-8" id="main-content"><Outlet /></main></div>
      <nav aria-label="移动端主导航" className="fixed inset-x-0 bottom-0 z-20 grid border-t border-[var(--border)] bg-[var(--surface)] px-2 pb-[env(safe-area-inset-bottom)] lg:hidden" style={{ gridTemplateColumns: `repeat(${mobileNavigation.length}, minmax(0, 1fr))` }}>{mobileNavigation.map((item) => { const Icon = item.icon; return <NavLink className={({ isActive }) => cn("flex min-h-16 flex-col items-center justify-center gap-1 text-[10px]", isActive ? "text-[var(--accent-strong)]" : "text-[var(--text-muted)]")} end={item.to === "/"} key={item.to} to={item.to}><Icon size={20} /><span>{item.shortLabel}</span></NavLink>; })}</nav>
    </div>
  );
}
