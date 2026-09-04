import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Bell,
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  ChartNoAxesCombined,
  CircleDollarSign,
  Clock3,
  Crown,
  FileCheck2,
  FolderKanban,
  Home,
  LayoutGrid,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Users,
  X,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Button, cn } from "@workbench/ui";

import {
  api,
  hasGrant,
  notifySessionChanged,
  resetCsrfToken,
  type Me,
} from "./api.js";
import type { RealtimeSyncStatus } from "./realtime.js";
import { AccentPicker } from "./accent-picker.js";
import { readableForeground, sanitizeAccent } from "./color.js";
import { detachCurrentBrowserPushBeforeLogout } from "./push-client.js";

interface NavigationItem {
  label: string;
  shortLabel: string;
  to: string;
  icon: LucideIcon;
  section: "workspace" | "management" | "personal";
  permission?: string;
  organizationPermission?: string;
}
interface NotificationItem {
  id: string;
  title: string;
  body: string;
  severity: string;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

interface GlobalSearchResult {
  id: string;
  kind:
    | "work_session"
    | "project"
    | "project_node"
    | "member"
    | "attachment"
    | "ai_report";
  title: string;
  subtitle: string | null;
  href: string;
  occurredAt: string | null;
}

interface PendingOwnershipTransfer {
  id: string;
  requestedAt: string;
  fromDisplayName: string;
}

type AiPageArea =
  | "home"
  | "work"
  | "calendar"
  | "projects"
  | "project"
  | "team"
  | "analytics"
  | "payroll"
  | "approvals"
  | "organization"
  | "security"
  | "notifications"
  | "imports"
  | "ai";

interface PageCopilotContext {
  area: AiPageArea;
  label: string;
  conversationId: string;
  suggestions: [string, string];
  allowTeam: boolean;
  entityId?: string;
}

interface CopilotReportRecord {
  job: {
    id: string;
    taskType: string;
    status: string;
    errorSummary: string | null;
    scope: {
      scope: "self" | "team";
      question?: string;
      conversationId?: string;
    };
  };
  report: { id: string; summary: string } | null;
}

const pageCopilotDefaults: Record<
  Exclude<AiPageArea, "project">,
  Omit<PageCopilotContext, "conversationId" | "entityId">
> = {
  home: {
    area: "home",
    label: "今日工作台",
    suggestions: ["今天最需要我推进的是什么？", "哪些事项有阻塞或待处理？"],
    allowTeam: true,
  },
  work: {
    area: "work",
    label: "工作记录",
    suggestions: ["总结最近的工作事实", "哪些记录还需要补充或核对？"],
    allowTeam: true,
  },
  calendar: {
    area: "calendar",
    label: "日历",
    suggestions: ["本周时间主要投入在哪里？", "日程中有哪些冲突或空档？"],
    allowTeam: true,
  },
  projects: {
    area: "projects",
    label: "项目列表",
    suggestions: ["哪些项目当前最需要关注？", "梳理项目阻塞和下一步"],
    allowTeam: true,
  },
  team: {
    area: "team",
    label: "团队动态",
    suggestions: ["总结团队最近的进展", "哪些协作事项需要跟进？"],
    allowTeam: true,
  },
  analytics: {
    area: "analytics",
    label: "数据分析",
    suggestions: ["解释当前时间范围的关键变化", "有哪些异常值得进一步核对？"],
    allowTeam: true,
  },
  payroll: {
    area: "payroll",
    label: "我的薪资",
    suggestions: ["解释我最近一期工资及状态", "哪些薪资项仍待确认？"],
    allowTeam: false,
  },
  approvals: {
    area: "approvals",
    label: "审批",
    suggestions: ["哪些审批最需要优先处理？", "归纳待审记录中的异常"],
    allowTeam: true,
  },
  organization: {
    area: "organization",
    label: "组织与人员",
    suggestions: ["组织当前有哪些协作风险？", "哪些成员状态需要跟进？"],
    allowTeam: true,
  },
  security: {
    area: "security",
    label: "账户安全",
    suggestions: ["说明当前账号可见的安全事项", "我还需要完成哪些账号操作？"],
    allowTeam: false,
  },
  notifications: {
    area: "notifications",
    label: "通知设置",
    suggestions: ["哪些工作提醒值得保留？", "按我的工作情况建议提醒重点"],
    allowTeam: false,
  },
  imports: {
    area: "imports",
    label: "导入工时",
    suggestions: ["导入前最需要核对哪些事实？", "解释当前导入数据的风险"],
    allowTeam: true,
  },
  ai: {
    area: "ai",
    label: "AI 工作洞察",
    suggestions: ["总结当前可见的关键事实", "告诉我下一步最值得分析什么"],
    allowTeam: true,
  },
};

function resolvePageCopilotContext(pathname: string): PageCopilotContext {
  const projectMatch = pathname.match(/^\/projects\/([0-9a-f-]{36})(?:\/|$)/i);
  if (projectMatch?.[1]) {
    const entityId = projectMatch[1].toLowerCase();
    return {
      area: "project",
      label: "项目详情",
      conversationId: `page_project_${entityId.replaceAll("-", "")}`,
      suggestions: ["这个项目当前进展和阻塞是什么？", "下一步应优先处理哪些节点？"],
      allowTeam: true,
      entityId,
    };
  }
  const area: Exclude<AiPageArea, "project"> =
    pathname === "/"
      ? "home"
      : pathname.startsWith("/work")
        ? "work"
        : pathname.startsWith("/calendar")
          ? "calendar"
          : pathname.startsWith("/projects")
            ? "projects"
            : pathname.startsWith("/team")
              ? "team"
              : pathname.startsWith("/analytics")
                ? "analytics"
                : pathname.startsWith("/payroll")
                  ? "payroll"
                  : pathname.startsWith("/approvals")
                    ? "approvals"
                    : pathname.startsWith("/organization")
                      ? "organization"
                      : pathname.startsWith("/security")
                        ? "security"
                        : pathname.startsWith("/notification-preferences")
                          ? "notifications"
                          : pathname.startsWith("/imports")
                            ? "imports"
                            : "ai";
  return {
    ...pageCopilotDefaults[area],
    conversationId: `page_${area}`,
  };
}

const navigation: NavigationItem[] = [
  {
    label: "今日工作台",
    shortLabel: "今日",
    to: "/",
    icon: Home,
    section: "workspace",
  },
  {
    label: "工作记录",
    shortLabel: "记录",
    to: "/work",
    icon: Clock3,
    section: "workspace",
  },
  {
    label: "日历",
    shortLabel: "日历",
    to: "/calendar",
    icon: CalendarDays,
    section: "workspace",
  },
  {
    label: "项目",
    shortLabel: "项目",
    to: "/projects",
    icon: FolderKanban,
    section: "workspace",
  },
  {
    label: "团队动态",
    shortLabel: "团队",
    to: "/team",
    icon: Users,
    section: "workspace",
    permission: "work.view_project_public",
  },
  {
    label: "数据分析",
    shortLabel: "分析",
    to: "/analytics",
    icon: ChartNoAxesCombined,
    section: "workspace",
  },
  {
    label: "AI 工作洞察",
    shortLabel: "AI",
    to: "/ai",
    icon: Bot,
    section: "workspace",
  },
  {
    label: "审批",
    shortLabel: "审批",
    to: "/approvals",
    icon: FileCheck2,
    section: "management",
    permission: "work.review",
  },
  {
    label: "组织与人员",
    shortLabel: "组织",
    to: "/organization",
    icon: BriefcaseBusiness,
    section: "management",
    permission: "members.manage",
  },
  {
    label: "导入工时",
    shortLabel: "导入",
    to: "/imports",
    icon: FileCheck2,
    section: "management",
    organizationPermission: "import.scope",
  },
  {
    label: "我的薪资",
    shortLabel: "薪资",
    to: "/payroll",
    icon: CircleDollarSign,
    section: "personal",
    permission: "payroll.view_own",
  },
  {
    label: "账户安全",
    shortLabel: "安全",
    to: "/security",
    icon: ShieldCheck,
    section: "personal",
  },
  {
    label: "通知设置",
    shortLabel: "通知",
    to: "/notification-preferences",
    icon: Bell,
    section: "personal",
  },
];

const sectionNames: Record<NavigationItem["section"], string> = {
  workspace: "工作空间",
  management: "管理工作",
  personal: "个人设置",
};

function formatHeaderDate(): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date());
}

function CommandPalette({
  items,
  onClose,
}: {
  items: NavigationItem[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [settledQuery, setSettledQuery] = useState("");
  const navigate = useNavigate();
  const normalizedQuery = query.trim();
  const matches = items.filter((item) => item.label.includes(normalizedQuery));
  useEffect(() => {
    const timer = window.setTimeout(() => setSettledQuery(normalizedQuery), 220);
    return () => window.clearTimeout(timer);
  }, [normalizedQuery]);
  const search = useQuery({
    queryKey: ["global-search", settledQuery],
    queryFn: () =>
      api<{ items: GlobalSearchResult[] }>(
        `/api/search?q=${encodeURIComponent(settledQuery)}&limit=5`,
      ),
    enabled: settledQuery.length >= 2,
    staleTime: 15_000,
  });
  const resultKindLabel: Record<GlobalSearchResult["kind"], string> = {
    work_session: "工作",
    project: "项目",
    project_node: "节点",
    member: "成员",
    attachment: "附件",
    ai_report: "AI",
  };
  const open = (href: string) => {
    navigate(href);
    onClose();
  };
  return (
    <div
      aria-label="全局导航"
      aria-modal="true"
      className="fixed inset-0 z-[70] grid place-items-start bg-[#151735]/35 p-4 pt-[10vh] backdrop-blur-sm"
      role="dialog"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="app-command-palette w-full max-w-xl overflow-hidden rounded-[22px] border border-[var(--border)] bg-[var(--surface-raised)] shadow-[var(--shadow-float)]">
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-4">
          <Search className="text-[var(--text-subtle)]" size={19} />
          <input
            aria-label="搜索工作台"
            autoFocus
            className="h-14 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--text-subtle)]"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索工作、项目、成员、附件或报告…"
            value={query}
          />
          <Button
            aria-label="关闭搜索"
            onClick={onClose}
            size="compact"
            variant="ghost"
          >
            <X size={16} />
          </Button>
        </div>
        <div className="max-h-[min(64vh,520px)] overflow-y-auto p-2">
          <p className="px-3 py-2 text-[11px] font-bold tracking-[0.12em] text-[var(--text-subtle)] uppercase">
            快速前往
          </p>
          {matches.length ? (
            matches.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition hover:bg-[var(--surface-subtle)]"
                  key={item.to}
                  onClick={() => {
                    open(item.to);
                  }}
                  type="button"
                >
                  <span className="grid size-8 place-items-center rounded-lg bg-[var(--surface-subtle)] text-[var(--accent-strong)]">
                    <Icon size={16} />
                  </span>
                  <span className="flex-1">{item.label}</span>
                  <span className="text-xs font-normal text-[var(--text-subtle)]">
                    {sectionNames[item.section]}
                  </span>
                </button>
              );
            })
          ) : normalizedQuery.length < 2 ? (
            <p className="px-3 py-8 text-center text-sm text-[var(--text-muted)]">
              没有匹配的页面。
            </p>
          ) : null}
          {normalizedQuery.length >= 2 ? (
            <div className="mt-1 border-t border-[color-mix(in_srgb,var(--text)_5%,transparent)] pt-2">
              <p className="px-3 py-2 text-[11px] font-bold tracking-[0.12em] text-[var(--text-subtle)] uppercase">
                业务结果
              </p>
              {search.isPending || settledQuery !== normalizedQuery ? (
                <p className="px-3 py-6 text-center text-sm text-[var(--text-muted)]">
                  搜索中…
                </p>
              ) : search.isError ? (
                <p className="px-3 py-6 text-center text-sm text-[var(--danger)]">
                  搜索暂时不可用，请重试。
                </p>
              ) : search.data?.items.length ? (
                search.data.items.map((item) => (
                  <button
                    className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-[var(--surface-subtle)]"
                    key={`${item.kind}:${item.id}`}
                    onClick={() => open(item.href)}
                    type="button"
                  >
                    <span className="mt-0.5 min-w-10 rounded-full bg-[var(--surface-subtle)] px-2 py-1 text-center text-[10px] font-bold text-[var(--text-muted)]">
                      {resultKindLabel[item.kind]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">
                        {item.title}
                      </span>
                      {item.subtitle ? (
                        <span className="mt-0.5 block truncate text-xs text-[var(--text-muted)]">
                          {item.subtitle}
                        </span>
                      ) : null}
                    </span>
                  </button>
                ))
              ) : (
                <p className="px-3 py-6 text-center text-sm text-[var(--text-muted)]">
                  没有可见的匹配结果。
                </p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const syncStatusPresentation: Record<
  RealtimeSyncStatus,
  { compact: string; detailed: string; tone: "positive" | "warning" }
> = {
  offline: {
    compact: "离线",
    detailed: "离线，恢复后自动同步",
    tone: "warning",
  },
  connecting: {
    compact: "连接中",
    detailed: "正在连接同步服务",
    tone: "warning",
  },
  connected: {
    compact: "已同步",
    detailed: "数据实时同步中",
    tone: "positive",
  },
  reconnecting: {
    compact: "重连中",
    detailed: "同步中断，正在自动恢复",
    tone: "warning",
  },
};

export function AppShell({
  me,
  syncStatus,
}: {
  me: Me;
  syncStatus: RealtimeSyncStatus;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("workbench-sidebar-collapsed") === "true",
  );
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem("workbench-sidebar-width"));
    return Number.isFinite(stored) && stored >= 224 && stored <= 420
      ? stored
      : 272;
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [contextDrafts, setContextDrafts] = useState<Record<string, string>>({});
  const [contextScope, setContextScope] = useState<"self" | "team">("self");
  const [online, setOnline] = useState(() => navigator.onLine);
  const [theme, setTheme] = useState<"system" | "light" | "dark">(() => {
    const storedTheme = localStorage.getItem("workbench-theme");
    return storedTheme === "light" ||
      storedTheme === "dark" ||
      storedTheme === "system"
      ? storedTheme
      : "light";
  });
  const [accent, setAccent] = useState(() => {
    const storedAccent = localStorage.getItem("workbench-accent");
    // The first workbench release persisted its built-in green as if it were a
    // custom user choice. Migrate only that legacy default; real custom colors stay intact.
    return storedAccent?.toLowerCase() === "#1f765c"
      ? "#5b5ce2"
      : sanitizeAccent(storedAccent);
  });
  const selectedAccent = sanitizeAccent(accent);
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const utilityMenuRef = useRef<HTMLDivElement>(null);
  const sidebarTouchStartX = useRef<number | null>(null);
  const contextPanelRef = useRef<HTMLElement>(null);
  const contextScrollRef = useRef<HTMLDivElement>(null);
  const pageCopilot = useMemo(
    () => resolvePageCopilotContext(location.pathname),
    [location.pathname],
  );
  const contextQuestion = contextDrafts[pageCopilot.conversationId] ?? "";
  const setContextQuestion = (value: string) =>
    setContextDrafts((current) => ({
      ...current,
      [pageCopilot.conversationId]: value,
    }));
  const canAnalyzeTeam = me.permissions.some(
    (grant) =>
      grant.permission === "ai.team_analysis" &&
      grant.scopeKind === "organization",
  );
  const canUseTeamCopilot = pageCopilot.allowTeam && canAnalyzeTeam;
  const visibleNavigation = useMemo(
    () =>
      navigation.filter(
        (item) =>
          (!item.permission || hasGrant(me, item.permission)) &&
          (!item.organizationPermission ||
            me.permissions.some(
              (grant) =>
                grant.permission === item.organizationPermission &&
                grant.scopeKind === "organization",
            )),
      ),
    [me],
  );
  const mobileNavigation = ["/", "/work", "/projects", "/analytics", "/payroll"]
    .map((path) => visibleNavigation.find((item) => item.to === path))
    .filter((item): item is NavigationItem => Boolean(item));
  const logout = useMutation({
    mutationFn: async () => {
      await detachCurrentBrowserPushBeforeLogout();
      return api<void>("/api/auth/logout", { method: "POST" });
    },
    onSettled: async () => {
      resetCsrfToken();
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== "me",
      });
      queryClient.setQueryData(["me"], null);
      notifySessionChanged();
      navigate("/login", { replace: true });
    },
  });
  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<{ items: NotificationItem[] }>("/api/notifications"),
    refetchInterval: 30_000,
  });
  const pendingOwnershipTransfer = useQuery({
    queryKey: ["pending-ownership-transfer"],
    queryFn: () =>
      api<{ transfer: PendingOwnershipTransfer | null }>(
        "/api/organization/ownership-transfers/pending-for-me",
      ),
    refetchInterval: 30_000,
  });
  const copilotReports = useQuery({
    queryKey: ["ai-reports"],
    queryFn: () =>
      api<{ items: CopilotReportRecord[] }>("/api/ai/reports"),
    enabled: contextOpen,
    refetchInterval: (query) =>
      query.state.data?.items.some((item) =>
        ["queued", "running"].includes(item.job.status),
      )
        ? 5_000
        : false,
  });
  const copilotItems = (copilotReports.data?.items ?? [])
    .filter(
      (item) =>
        item.job.taskType === "assistant_chat" &&
        item.job.scope.conversationId === pageCopilot.conversationId,
    )
    .reverse()
    .slice(-6);
  const copilotUpdateKey = copilotItems
    .map((item) => `${item.job.id}:${item.job.status}:${Boolean(item.report)}`)
    .join("|");
  const sendCopilot = useMutation({
    mutationFn: () => {
      const to = new Date();
      to.setSeconds(0, 0);
      to.setMinutes(Math.floor(to.getMinutes() / 5) * 5);
      return api("/api/ai/reports", {
        method: "POST",
        body: {
          taskType: "assistant_chat",
          scope: canUseTeamCopilot ? contextScope : "self",
          question: contextQuestion.trim(),
          conversationId: pageCopilot.conversationId,
          pageContext: {
            area: pageCopilot.area,
            ...(pageCopilot.entityId ? { entityId: pageCopilot.entityId } : {}),
          },
          from: new Date(to.getTime() - 31 * 86_400_000).toISOString(),
          to: to.toISOString(),
        },
      });
    },
    onSuccess: async () => {
      setContextDrafts((current) => ({
        ...current,
        [pageCopilot.conversationId]: "",
      }));
      await queryClient.invalidateQueries({ queryKey: ["ai-reports"] });
    },
  });
  const retryCopilot = useMutation({
    mutationFn: (jobId: string) =>
      api(`/api/ai/jobs/${jobId}/retry`, { method: "POST" }),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["ai-reports"] }),
  });
  const copilotError =
    copilotReports.error ?? sendCopilot.error ?? retryCopilot.error;
  const markRead = useMutation({
    mutationFn: (id: string) =>
      api(`/api/notifications/${id}/read`, { method: "POST" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
  const unreadCount =
    notifications.data?.items.filter((item) => !item.readAt).length ?? 0;
  const displayedSyncStatus = online ? syncStatus : "offline";
  const syncPresentation = syncStatusPresentation[displayedSyncStatus];
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    localStorage.setItem("workbench-theme", theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem(
      "workbench-sidebar-collapsed",
      String(sidebarCollapsed),
    );
  }, [sidebarCollapsed]);
  useEffect(() => {
    localStorage.setItem("workbench-sidebar-width", String(sidebarWidth));
  }, [sidebarWidth]);
  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [sidebarOpen]);
  useEffect(() => {
    const root = document.documentElement;
    // The exact stored value is the exact visible accent. Contrast-sensitive
    // foreground and derivative tokens are calculated separately, so a picker
    // handle cannot drift away from the color used by the product.
    root.style.setProperty("--accent", selectedAccent);
    root.style.setProperty(
      "--accent-strong",
      "color-mix(in srgb, " + selectedAccent + " 72%, var(--text))",
    );
    root.style.setProperty(
      "--accent-foreground",
      readableForeground(selectedAccent),
    );
    root.style.setProperty(
      "--accent-soft",
      "color-mix(in srgb, " + selectedAccent + " 13%, transparent)",
    );
    localStorage.setItem("workbench-accent", selectedAccent);
  }, [selectedAccent]);
  useEffect(() => {
    const setStatus = () => setOnline(navigator.onLine);
    window.addEventListener("online", setStatus);
    window.addEventListener("offline", setStatus);
    return () => {
      window.removeEventListener("online", setStatus);
      window.removeEventListener("offline", setStatus);
    };
  }, []);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setSettingsOpen(false);
        setNotificationsOpen(false);
        setContextOpen(false);
        setSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  useEffect(() => {
    if (!settingsOpen && !notificationsOpen) return;
    const closeUtilityMenus = (event: PointerEvent) => {
      if (
        utilityMenuRef.current?.contains(event.target as Node)
      )
        return;
      setSettingsOpen(false);
      setNotificationsOpen(false);
    };
    window.addEventListener("pointerdown", closeUtilityMenus);
    return () => window.removeEventListener("pointerdown", closeUtilityMenus);
  }, [notificationsOpen, settingsOpen]);
  useEffect(() => {
    if (!contextOpen) return;
    const closeContext = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        contextPanelRef.current?.contains(target) ||
        utilityMenuRef.current?.contains(target)
      )
        return;
      setContextOpen(false);
    };
    window.addEventListener("pointerdown", closeContext);
    return () => window.removeEventListener("pointerdown", closeContext);
  }, [contextOpen]);
  useEffect(() => {
    if (!contextOpen) return;
    const container = contextScrollRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [contextOpen, copilotUpdateKey]);
  return (
    <div
      className={cn(
        "app-shell min-h-dvh bg-[var(--canvas)] text-[var(--text)]",
        sidebarCollapsed && "app-shell--sidebar-collapsed",
      )}
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      {commandOpen ? (
        <CommandPalette
          items={visibleNavigation}
          onClose={() => setCommandOpen(false)}
        />
      ) : null}
      <aside
        aria-label="主导航"
        className={cn(
          "app-sidebar fixed inset-y-0 left-0 z-40 flex w-[var(--sidebar-width)] max-w-[88vw] flex-col border-r border-[var(--border)] backdrop-blur-xl transition-[transform,width] duration-300 lg:max-w-none lg:translate-x-0",
          sidebarCollapsed && "lg:w-[76px]",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
        onTouchEnd={(event) => {
          const start = sidebarTouchStartX.current;
          const end = event.changedTouches[0]?.clientX;
          sidebarTouchStartX.current = null;
          if (start !== null && end !== undefined && start - end > 72) {
            setSidebarOpen(false);
          }
        }}
        onTouchStart={(event) => {
          sidebarTouchStartX.current = event.touches[0]?.clientX ?? null;
        }}
      >
        <div className="app-sidebar-brand flex h-[76px] items-center gap-3 px-5">
          <div className="app-brand-mark grid size-10 place-items-center rounded-[14px] bg-[var(--accent)] text-[var(--accent-foreground)]">
            <Clock3 size={20} />
          </div>
          <div className="app-sidebar-copy min-w-0">
            <p className="truncate text-[15px] font-extrabold tracking-[-0.035em]">
              时序 · 工作智能
            </p>
            <p className="app-brand-subtitle mt-0.5 truncate text-[11px] font-medium">
              以事实，推进工作
            </p>
          </div>
          <Button
            aria-label="关闭导航"
            className="ml-auto lg:hidden"
            onClick={() => setSidebarOpen(false)}
            size="icon"
            variant="ghost"
          >
            <X size={20} />
          </Button>
        </div>
        <div className="px-4 pb-4">
          <button
            className="app-sidebar-search flex h-10 w-full items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 text-left text-xs text-[var(--text-muted)] transition"
            onClick={() => setCommandOpen(true)}
            type="button"
          >
            <Search size={16} />
            <span className="flex-1">搜索工作台</span>
            <kbd className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px]">
              ⌘ K
            </kbd>
          </button>
        </div>
        <nav className="relative z-[1] flex-1 overflow-y-auto px-3 pb-4">
          {(["workspace", "management", "personal"] as const).map((section) => {
            const items = visibleNavigation.filter(
              (item) => item.section === section,
            );
            if (!items.length) return null;
            return (
              <div className="mb-5" key={section}>
                <p className="app-nav-section-label px-3 pb-2 text-[10px] font-extrabold tracking-[0.13em] uppercase">
                  {sectionNames[section]}
                </p>
                <div className="space-y-0.5">
                  {items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <NavLink
                        aria-label={item.label}
                        className={({ isActive }) =>
                          cn(
                            "app-nav-link group flex min-h-10 items-center gap-3 rounded-xl px-3 text-[13px] font-semibold transition-all duration-200",
                            isActive && "app-nav-link--active",
                          )
                        }
                        end={item.to === "/"}
                        key={item.to}
                        onClick={() => setSidebarOpen(false)}
                        title={item.label}
                        to={item.to}
                      >
                        {({ isActive }) => (
                          <>
                            <Icon
                              className="transition-transform group-hover:scale-105"
                              size={17}
                              strokeWidth={isActive ? 2.4 : 1.9}
                            />
                            <span className="app-nav-link-label">
                              {item.label}
                            </span>
                          </>
                        )}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
        <div className="relative z-[1] border-t border-white/10 p-3">
          <div className="app-user-card flex items-center gap-3 rounded-xl px-3 py-3">
            <div className="app-user-avatar grid size-8 place-items-center rounded-full text-xs font-bold">
              {me.user.displayName.slice(0, 1)}
            </div>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-bold">
                {me.user.displayName}
              </span>
              <span className="mt-0.5 flex items-center gap-1 text-[10px] text-[#96a0be]">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    syncPresentation.tone === "positive"
                      ? "bg-[var(--positive)]"
                      : "bg-[var(--warning)]",
                  )}
                />
                {syncPresentation.detailed}
              </span>
            </span>
          </div>
          <Button
            className="mt-1.5 w-full justify-start text-[#aab3cc] hover:bg-white/8 hover:text-white"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
            size="compact"
            variant="ghost"
          >
            <LogOut size={15} />
            退出登录
          </Button>
        </div>
        {!sidebarCollapsed ? (
          <div
            aria-label="调整侧边栏宽度"
            aria-orientation="vertical"
            aria-valuemax={420}
            aria-valuemin={224}
            aria-valuenow={sidebarWidth}
            className="app-sidebar-resize-handle"
            onKeyDown={(event) => {
              const increment = event.shiftKey ? 24 : 8;
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                setSidebarWidth((current) => Math.max(224, current - increment));
              }
              if (event.key === "ArrowRight") {
                event.preventDefault();
                setSidebarWidth((current) => Math.min(420, current + increment));
              }
              if (event.key === "Home") {
                event.preventDefault();
                setSidebarWidth(224);
              }
              if (event.key === "End") {
                event.preventDefault();
                setSidebarWidth(420);
              }
            }}
            onPointerDown={(event) => {
              const initialX = event.clientX;
              const initialWidth = sidebarWidth;
              event.currentTarget.setPointerCapture(event.pointerId);
              const resize = (moveEvent: PointerEvent) => {
                setSidebarWidth(
                  Math.min(
                    420,
                    Math.max(224, initialWidth + moveEvent.clientX - initialX),
                  ),
                );
              };
              const stopResize = () => {
                window.removeEventListener("pointermove", resize);
                window.removeEventListener("pointerup", stopResize);
                window.removeEventListener("pointercancel", stopResize);
              };
              window.addEventListener("pointermove", resize);
              window.addEventListener("pointerup", stopResize);
              window.addEventListener("pointercancel", stopResize);
            }}
            role="separator"
            tabIndex={0}
          />
        ) : null}
      </aside>
      {sidebarOpen ? (
        <button
          aria-label="关闭导航"
          className="fixed inset-0 z-30 bg-[#111629]/35 backdrop-blur-[2px] lg:hidden"
          onClick={() => setSidebarOpen(false)}
          type="button"
        />
      ) : null}
      <div
        className={cn(
          "min-h-dvh min-w-0 w-full lg:pl-[var(--sidebar-width)]",
          sidebarCollapsed && "lg:pl-[76px]",
        )}
      >
        <header className="app-topbar sticky top-0 z-20 flex h-[76px] items-center gap-3 border-b border-[var(--border)] px-4 backdrop-blur-xl md:px-7">
          <Button
            aria-label="打开导航"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
            size="icon"
            variant="ghost"
          >
            <Menu size={20} />
          </Button>
          <Button
            aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
            className="hidden lg:inline-flex"
            onClick={() => setSidebarCollapsed((value) => !value)}
            size="icon"
            variant="ghost"
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={18} />
            ) : (
              <PanelLeftClose size={18} />
            )}
          </Button>
          <div className="hidden items-center gap-2 text-xs font-medium text-[var(--text-muted)] md:flex">
            <span className="grid size-7 place-items-center rounded-lg bg-[var(--surface-subtle)] text-[var(--accent-strong)]">
              <LayoutGrid size={15} />
            </span>
            <span>{formatHeaderDate()}</span>
          </div>
          <button
            className="app-topbar-search hidden h-10 max-w-md flex-1 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 text-left text-xs text-[var(--text-muted)] transition md:flex"
            onClick={() => setCommandOpen(true)}
            type="button"
          >
            <Search size={16} />
            <span className="flex-1">快速打开页面</span>
            <kbd className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px]">
              Ctrl K
            </kbd>
          </button>
          <div
            className="relative ml-auto flex items-center gap-1.5"
            ref={utilityMenuRef}
          >
            {pendingOwnershipTransfer.data?.transfer ? (
              <>
                <Button
                  aria-label="待确认组织所有权转移"
                  className="hidden sm:inline-flex"
                  onClick={() => navigate("/security")}
                  size="compact"
                  variant="secondary"
                >
                  <Crown size={15} />
                  确认 Owner
                </Button>
                <Button
                  aria-label="待确认组织所有权转移"
                  className="sm:hidden"
                  onClick={() => navigate("/security")}
                  size="icon"
                  variant="ghost"
                >
                  <Crown className="text-[var(--warning)]" size={18} />
                </Button>
              </>
            ) : null}
            <span className="hidden items-center gap-1.5 rounded-full bg-[var(--surface-subtle)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] sm:flex">
              <Zap
                size={13}
                className={
                  syncPresentation.tone === "positive"
                    ? "text-[var(--positive)]"
                    : "text-[var(--warning)]"
                }
              />
              {syncPresentation.compact}
            </span>
            <Button
              aria-label="快速记录工作"
              onClick={() => navigate("/work")}
              size="compact"
            >
              <Plus size={15} />
              记录工作
            </Button>
            <Button
              aria-expanded={contextOpen}
              aria-label="打开 AI 上下文"
              onClick={() => {
                if (!contextOpen && !canUseTeamCopilot) {
                  setContextScope("self");
                }
                setContextOpen((value) => !value);
                setNotificationsOpen(false);
                setSettingsOpen(false);
              }}
              size="icon"
              variant="ghost"
            >
              <Bot size={18} />
            </Button>
            <span className="relative">
              <Button
                aria-expanded={notificationsOpen}
                aria-label={`通知${unreadCount ? `，${unreadCount} 条未读` : ""}`}
                onClick={() => {
                  setNotificationsOpen((value) => !value);
                  setSettingsOpen(false);
                  setContextOpen(false);
                }}
                size="icon"
                variant="ghost"
              >
                <Bell size={18} />
              </Button>
              {unreadCount ? (
                <span className="absolute right-0 top-0 grid min-w-4 place-items-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-bold text-[var(--danger-foreground)]">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              ) : null}
            </span>
            <Button
              aria-expanded={settingsOpen}
              aria-label="外观设置"
              onClick={() => {
                setSettingsOpen((value) => !value);
                setNotificationsOpen(false);
                setContextOpen(false);
              }}
              size="icon"
              variant="ghost"
            >
              <Settings size={18} />
            </Button>
            {notificationsOpen ? (
              <div className="app-utility-popover absolute right-0 top-12 z-50 max-h-[min(70vh,560px)] w-[min(92vw,380px)] overflow-y-auto rounded-[18px] border border-[var(--border)] bg-[var(--surface-raised)] p-3 shadow-[var(--shadow-float)]">
                <div className="flex items-center justify-between px-1 pb-2">
                  <p className="font-bold">通知中心</p>
                  <span className="text-xs text-[var(--text-muted)]">
                    {unreadCount} 条未读
                  </span>
                </div>
                {notifications.isPending ? (
                  <p className="p-3 text-sm text-[var(--text-muted)]">
                    正在读取通知…
                  </p>
                ) : notifications.error ? (
                  <p className="p-3 text-sm text-[var(--danger)]">
                    通知暂时不可用。
                  </p>
                ) : notifications.data?.items.length ? (
                  <div className="space-y-1">
                    {notifications.data.items.map((item) => (
                      <button
                        className={cn(
                          "w-full rounded-xl p-3 text-left transition hover:bg-[var(--surface-subtle)]",
                          !item.readAt && "bg-[var(--accent-soft)]",
                        )}
                        key={item.id}
                        onClick={() => {
                          if (!item.readAt) markRead.mutate(item.id);
                          if (item.actionUrl) {
                            setNotificationsOpen(false);
                            navigate(item.actionUrl);
                          }
                        }}
                        type="button"
                      >
                        <div className="flex gap-2">
                          <span
                            className={cn(
                              "mt-1.5 size-2 shrink-0 rounded-full",
                              item.severity === "critical"
                                ? "bg-[var(--danger)]"
                                : item.severity === "warning"
                                  ? "bg-[var(--warning)]"
                                  : "bg-[var(--accent)]",
                            )}
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold">
                              {item.title}
                            </span>
                            <span className="mt-1 block text-xs leading-5 text-[var(--text-muted)]">
                              {item.body}
                            </span>
                            <span className="mt-1 block text-[11px] text-[var(--text-subtle)]">
                              {new Intl.DateTimeFormat("zh-CN", {
                                month: "2-digit",
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              }).format(new Date(item.createdAt))}
                            </span>
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="p-3 text-sm text-[var(--text-muted)]">
                    暂无通知。
                  </p>
                )}
              </div>
            ) : null}
            {settingsOpen ? (
              <div className="app-utility-popover absolute right-0 top-12 z-50 w-[min(92vw,20rem)] rounded-[18px] border border-[var(--border)] bg-[var(--surface-raised)] p-4 shadow-[var(--shadow-float)]">
                <p className="text-sm font-bold">外观设置</p>
                <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                  强调色仅作用于导航与操作层，业务状态色保持清晰。
                </p>
                <label className="mt-4 block text-xs font-semibold text-[var(--text-muted)]">
                  主题
                </label>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {(["system", "light", "dark"] as const).map((value) => (
                    <Button
                      key={value}
                      onClick={() => setTheme(value)}
                      size="compact"
                      variant={theme === value ? "primary" : "secondary"}
                    >
                      {value === "system"
                        ? "跟随系统"
                        : value === "light"
                          ? "浅色"
                          : "深色"}
                    </Button>
                  ))}
                </div>
                <div className="mt-4">
                  <p className="text-xs font-semibold text-[var(--text-muted)]">
                    强调色
                  </p>
                  <p className="mt-1 text-[11px] leading-4 text-[var(--text-subtle)]">
                    取色器、HEX 值和实际主色始终完全一致。
                  </p>
                  <div className="mt-3">
                    <AccentPicker
                      onChange={setAccent}
                      value={selectedAccent}
                    />
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </header>
        <main
          className="app-main w-full px-4 py-6 md:px-7 md:py-8 xl:px-9"
          id="main-content"
        >
          <Outlet />
        </main>
      </div>
      {contextOpen ? (
        <button
          aria-label="关闭 AI 上下文"
          className="app-context-backdrop fixed inset-0 z-40"
          onClick={() => setContextOpen(false)}
          type="button"
        />
      ) : null}
      {contextOpen ? (
        <aside
          aria-label="AI 上下文面板"
          className="app-context-panel fixed inset-x-0 bottom-0 top-[4.75rem] z-50 overflow-y-auto p-5 lg:inset-y-0 lg:left-auto lg:top-[76px] lg:w-[340px]"
          ref={contextPanelRef}
          role="dialog"
          aria-modal="true"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="app-section-label text-[var(--accent-strong)]">
                页面 Copilot
              </p>
              <h2 className="mt-2 text-lg font-extrabold tracking-[-0.035em]">
                {pageCopilot.label}
              </h2>
            </div>
            <Button
              aria-label="关闭 AI 上下文"
              onClick={() => setContextOpen(false)}
              size="compact"
              variant="ghost"
            >
              <X size={16} />
            </Button>
          </div>
          <div className="mt-5 flex min-h-[calc(100%-4.5rem)] flex-col">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-[var(--text-muted)]">
                仅使用当前授权事实
              </span>
              {canUseTeamCopilot ? (
                <select
                  aria-label="页面 AI 分析范围"
                  className="rounded-lg bg-[var(--surface-subtle)] px-2 py-1.5 text-xs font-semibold outline-none"
                  onChange={(event) =>
                    setContextScope(event.target.value as "self" | "team")
                  }
                  value={contextScope}
                >
                  <option value="self">本人</option>
                  <option value="team">团队</option>
                </select>
              ) : (
                <span className="rounded-full bg-[var(--surface-subtle)] px-2.5 py-1 text-xs font-semibold">
                  本人
                </span>
              )}
            </div>
            <div
              aria-live="polite"
              className="mt-4 max-h-[44vh] flex-1 space-y-3 overflow-y-auto pr-1"
              ref={contextScrollRef}
            >
              {copilotReports.isPending ? (
                <p className="py-8 text-center text-sm text-[var(--text-muted)]">
                  正在读取对话…
                </p>
              ) : copilotItems.length ? (
                copilotItems.map((item) => (
                  <div className="space-y-2" key={item.job.id}>
                    <div className="ml-auto max-w-[92%] rounded-2xl rounded-br-md bg-[var(--accent)] px-3 py-2.5 text-sm leading-6 text-[var(--accent-foreground)]">
                      {item.job.scope.question || "页面分析"}
                    </div>
                    <div className="max-w-[94%] rounded-2xl rounded-bl-md bg-[var(--surface-subtle)] px-3 py-2.5 text-sm leading-6">
                      {item.report?.summary ??
                        (item.job.status === "failed"
                          ? item.job.errorSummary || "本次回答生成失败。"
                          : item.job.status === "cancelled"
                            ? "本次对话已取消。"
                            : "正在根据最新授权事实生成回答…")}
                      {!item.report &&
                      ["failed", "cancelled"].includes(item.job.status) ? (
                        <button
                          className="mt-2 flex items-center gap-1 text-xs font-bold text-[var(--accent-strong)]"
                          disabled={retryCopilot.isPending}
                          onClick={() => retryCopilot.mutate(item.job.id)}
                          type="button"
                        >
                          <RotateCcw size={13} />
                          重试
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-5 text-center">
                  <div className="mx-auto grid size-10 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                    <Bot size={19} />
                  </div>
                  <p className="mt-3 text-sm text-[var(--text-muted)]">
                    直接询问当前页面中的工作事实。
                  </p>
                </div>
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {pageCopilot.suggestions.map((suggestion) => (
                <button
                  className="rounded-lg bg-[var(--surface-subtle)] px-2.5 py-2 text-left text-xs font-semibold transition hover:bg-[var(--accent-soft)]"
                  key={suggestion}
                  onClick={() => setContextQuestion(suggestion)}
                  type="button"
                >
                  {suggestion}
                </button>
              ))}
            </div>
            <form
              className="mt-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (contextQuestion.trim().length >= 2) sendCopilot.mutate();
              }}
            >
              <textarea
                aria-label="向页面 AI 提问"
                className="min-h-24 w-full resize-y rounded-xl bg-[var(--surface-subtle)] px-3 py-3 text-sm leading-6 outline-none transition focus:ring-2 focus:ring-[var(--accent)]"
                maxLength={2_000}
                onChange={(event) => setContextQuestion(event.target.value)}
                placeholder="询问当前页面的进展、异常或下一步"
                value={contextQuestion}
              />
              <Button
                className="mt-2 w-full"
                disabled={
                  contextQuestion.trim().length < 2 || sendCopilot.isPending
                }
                type="submit"
              >
                <ArrowUpRight size={15} />
                {sendCopilot.isPending ? "正在提交…" : "发送"}
              </Button>
            </form>
            {copilotError ? (
              <p className="mt-3 text-sm leading-6 text-[var(--danger)]">
                {copilotError instanceof Error
                  ? copilotError.message
                  : "页面 AI 暂时不可用。"}
              </p>
            ) : null}
            <button
              className="mt-4 flex items-center justify-center gap-1 text-xs font-bold text-[var(--accent-strong)]"
              onClick={() => {
                const params = new URLSearchParams({
                  conversation: pageCopilot.conversationId,
                  area: pageCopilot.area,
                  ...(pageCopilot.entityId
                    ? { entity: pageCopilot.entityId }
                    : {}),
                });
                navigate(`/ai?${params.toString()}`);
                setContextOpen(false);
              }}
              type="button"
            >
              在 AI 工作洞察中继续
              <ArrowUpRight size={13} />
            </button>
          </div>
        </aside>
      ) : null}
      <nav
        aria-label="移动端主导航"
        className="app-mobile-nav fixed inset-x-0 bottom-0 z-20 grid border-t border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_94%,transparent)] px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
        style={{
          gridTemplateColumns: `repeat(${mobileNavigation.length}, minmax(0, 1fr))`,
        }}
      >
        {mobileNavigation.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              className={({ isActive }) =>
                cn(
                  "relative flex min-h-[64px] flex-col items-center justify-center gap-1 text-[10px] font-semibold",
                  isActive
                    ? "text-[var(--accent-strong)]"
                    : "text-[var(--text-muted)]",
                )
              }
              end={item.to === "/"}
              key={item.to}
              to={item.to}
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      "grid size-7 place-items-center rounded-lg",
                      isActive && "bg-[var(--accent-soft)]",
                    )}
                  >
                    <Icon size={18} strokeWidth={isActive ? 2.4 : 1.9} />
                  </span>
                  <span>{item.shortLabel}</span>
                </>
              )}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
