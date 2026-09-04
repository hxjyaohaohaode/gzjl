import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Flag,
  GripVertical,
  List,
  Rows3,
  Table2,
} from "lucide-react";
import { useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  cn,
} from "@workbench/ui";

import { api } from "./api.js";
import { getCalendarAlmanac } from "./calendar-almanac.js";
import { EmptyState, ErrorMessage, LoadingBlock, PageHeader } from "./pages.js";
import {
  getOrganizationTimezone,
  toZonedInputValue,
  zonedInputToDate,
} from "./timezone.js";

type CalendarView = "day" | "week" | "month" | "list";
type StatusFilter = "all" | "draft" | "submitted" | "approved" | "plan";

interface CalendarSession {
  id: string;
  startAt: string;
  endAt: string;
  netSeconds: number;
  content: string;
  result: string;
  source: string;
  recordKind?: "fact" | "plan";
  submissionStatus: string;
  approvalStatus: string;
  version: number;
}

interface CalendarSessionSegment {
  key: string;
  session: CalendarSession;
  displayStartAt: Date;
  displayEndAt: Date;
}

interface CalendarMilestone {
  nodeId: string;
  projectId: string;
  projectKey: string;
  projectName: string;
  projectColor: string;
  title: string;
  dueAt: string;
  status: string;
  progress: string;
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}
function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}
function dateKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
function organizationWallDate(value: string | Date = new Date()): Date {
  const local = toZonedInputValue(new Date(value));
  const [datePart = "1970-01-01", timePart = "00:00:00"] = local.split("T");
  const [year = 1970, month = 1, day = 1] = datePart.split("-").map(Number);
  const [hour = 0, minute = 0, second = 0] = timePart.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute, second);
}
function wallInputValue(value: Date): string {
  return `${dateKey(value)}T${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}:${String(value.getSeconds()).padStart(2, "0")}`;
}
function wallDateToInstant(value: Date): Date {
  return zonedInputToDate(wallInputValue(value));
}
function shiftInstantByOrganizationDays(value: string, days: number): Date {
  const wall = organizationWallDate(value);
  wall.setDate(wall.getDate() + days);
  return wallDateToInstant(wall);
}
function dayDelta(from: Date, to: Date): number {
  return Math.round(
    (startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000,
  );
}
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours} 小时 ${minutes} 分` : `${minutes} 分钟`;
}
function formatTime(value: string | Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: getOrganizationTimezone(),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
function formatWallTime(value: Date): string {
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}
function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: getOrganizationTimezone(),
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(new Date(value));
}
function splitCalendarSession(
  session: CalendarSession,
  periodStart: Date,
  periodEnd: Date,
): CalendarSessionSegment[] {
  const originalStart = organizationWallDate(session.startAt);
  const originalEnd = organizationWallDate(session.endAt);
  if (
    Number.isNaN(originalStart.getTime()) ||
    Number.isNaN(originalEnd.getTime()) ||
    originalEnd <= periodStart ||
    originalStart >= periodEnd
  ) {
    return [];
  }
  const visibleStart = new Date(
    Math.max(originalStart.getTime(), periodStart.getTime()),
  );
  const visibleEnd = new Date(
    Math.min(originalEnd.getTime(), periodEnd.getTime()),
  );
  const segments: CalendarSessionSegment[] = [];
  for (
    let date = startOfDay(visibleStart);
    date < visibleEnd;
    date = addDays(date, 1)
  ) {
    const nextDay = addDays(date, 1);
    const displayStartAt = new Date(
      Math.max(visibleStart.getTime(), date.getTime()),
    );
    const displayEndAt = new Date(
      Math.min(visibleEnd.getTime(), nextDay.getTime()),
    );
    if (displayEndAt <= displayStartAt) continue;
    segments.push({
      key: `${session.id}:${dateKey(date)}`,
      session,
      displayStartAt,
      displayEndAt,
    });
  }
  return segments;
}
function statusLabel(session: CalendarSession): string {
  return session.recordKind === "plan"
    ? "计划草稿"
    : session.approvalStatus === "approved" ||
    session.approvalStatus === "locked"
    ? "已批准"
    : session.approvalStatus === "pending_review"
      ? "待审核"
      : session.approvalStatus === "returned"
        ? "已退回"
        : session.submissionStatus === "draft"
          ? "草稿"
          : "已提交";
}
function statusTone(
  session: CalendarSession,
): "positive" | "warning" | "danger" | "neutral" {
  return session.recordKind === "plan"
    ? "neutral"
    : session.approvalStatus === "approved" ||
    session.approvalStatus === "locked"
    ? "positive"
    : session.approvalStatus === "pending_review"
      ? "warning"
      : session.approvalStatus === "returned"
        ? "danger"
        : "neutral";
}

function MiniCalendar({
  anchorDate,
  onPick,
}: {
  anchorDate: Date;
  onPick: (date: Date) => void;
}) {
  const today = startOfDay(organizationWallDate());
  const monthStart = new Date(
    anchorDate.getFullYear(),
    anchorDate.getMonth(),
    1,
  );
  const gridStart = addDays(monthStart, -((monthStart.getDay() + 6) % 7));
  const dates = Array.from({ length: 42 }, (_, index) =>
    addDays(gridStart, index),
  );
  return (
    <section className="calendar-mini">
      <div className="calendar-mini-head">
        <strong>
          {new Intl.DateTimeFormat("zh-CN", {
            year: "numeric",
            month: "long",
          }).format(anchorDate)}
        </strong>
      </div>
      <div className="calendar-mini-weekdays">
        {["一", "二", "三", "四", "五", "六", "日"].map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="calendar-mini-days">
        {dates.map((date) => {
          const almanac = getCalendarAlmanac(date);
          return (
          <button
            aria-label={new Intl.DateTimeFormat("zh-CN", {
              month: "long",
              day: "numeric",
            }).format(date)}
            className={cn(
              date.getMonth() !== monthStart.getMonth() && "is-outside",
              dateKey(date) === dateKey(today) && "is-today",
              dateKey(date) === dateKey(anchorDate) && "is-selected",
            )}
            key={dateKey(date)}
            onClick={() => onPick(date)}
            title={almanac.detail}
            type="button"
          >
            {date.getDate()}
          </button>
          );
        })}
      </div>
    </section>
  );
}

function CalendarEvent({
  item,
  onDragStart,
  onDragEnd,
}: {
  item: CalendarSessionSegment;
  onDragStart: (item: CalendarSessionSegment) => void;
  onDragEnd: () => void;
}) {
  const session = item.session;
  const isPlan = session.recordKind === "plan";
  const movable = session.submissionStatus === "draft";
  const isCrossDayFragment =
    item.displayStartAt.getTime() !== organizationWallDate(session.startAt).getTime() ||
    item.displayEndAt.getTime() !== organizationWallDate(session.endAt).getTime();
  return (
    <div
      aria-label={`${session.content}，${formatWallTime(item.displayStartAt)} 至 ${formatWallTime(item.displayEndAt)}${isCrossDayFragment ? "，跨日片段" : ""}${isPlan ? "，云端计划，不计入工时事实" : ""}${movable ? "，可拖拽改期" : ""}`}
      className={cn(
        "calendar-event",
        isPlan && "is-plan",
        movable && "is-draggable",
      )}
      draggable={movable}
      onDragEnd={onDragEnd}
      onDragStart={() => onDragStart(item)}
    >
      <span className="calendar-event-handle">
        {movable ? <GripVertical size={12} /> : null}
      </span>
      <time>
        {formatWallTime(item.displayStartAt)} – {formatWallTime(item.displayEndAt)}
      </time>
      <strong className="block truncate">
        {isPlan ? <span className="calendar-event-kind">计划</span> : null}
        {session.content}
      </strong>
    </div>
  );
}

function CalendarMilestone({
  item,
  compact = false,
}: {
  item: CalendarMilestone;
  compact?: boolean;
}) {
  return (
    <Link
      aria-label={`${item.projectName}：里程碑 ${item.title}，截止 ${formatDate(item.dueAt)}`}
      className={cn(
        "calendar-milestone",
        compact && "is-compact",
        item.status === "completed" && "is-completed",
      )}
      onClick={(event) => event.stopPropagation()}
      style={
        { "--milestone-color": item.projectColor } as CSSProperties
      }
      to={`/projects/${item.projectId}`}
    >
      <Flag aria-hidden="true" size={compact ? 12 : 14} />
      <span className="min-w-0">
        <strong>{item.title}</strong>
        <small>
          {item.projectKey} · {item.projectName} · 截止 {formatTime(item.dueAt)}
        </small>
      </span>
    </Link>
  );
}

export function CalendarPage() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<CalendarView>(() =>
    window.matchMedia("(max-width: 640px)").matches ? "day" : "week",
  );
  const [anchorDate, setAnchorDate] = useState(() => organizationWallDate());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showMilestones, setShowMilestones] = useState(false);
  const [dragging, setDragging] = useState<CalendarSessionSegment | null>(null);
  const reschedule = useMutation({
    mutationFn: ({
      item,
      days,
    }: {
      item: CalendarSession;
      days: number;
    }) => {
      return api(`/api/work-sessions/${item.id}/schedule`, {
        method: "PATCH",
        body: {
          expectedVersion: item.version,
          startAt: shiftInstantByOrganizationDays(item.startAt, days).toISOString(),
          endAt: shiftInstantByOrganizationDays(item.endAt, days).toISOString(),
        },
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["work-sessions"] });
    },
  });

  const [today] = useState(() => startOfDay(organizationWallDate()));
  const dayStart = startOfDay(anchorDate);
  const weekStart = addDays(dayStart, -((dayStart.getDay() + 6) % 7));
  const monthStart = new Date(dayStart.getFullYear(), dayStart.getMonth(), 1);
  const periodStart =
    view === "month" ? monthStart : view === "day" ? dayStart : weekStart;
  const periodEnd =
    view === "month"
      ? new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1)
      : addDays(periodStart, view === "day" ? 1 : 7);
  const periodStartInstant = wallDateToInstant(periodStart);
  const periodEndInstant = wallDateToInstant(periodEnd);
  const work = useQuery({
    queryKey: [
      "work-sessions",
      "calendar",
      periodStartInstant.toISOString(),
      periodEndInstant.toISOString(),
    ],
    queryFn: () => {
      const query = new URLSearchParams({
        limit: "100",
        from: periodStartInstant.toISOString(),
        to: periodEndInstant.toISOString(),
      });
      return api<{ items: CalendarSession[] }>(
        `/api/work-sessions?${query.toString()}`,
      );
    },
  });
  const milestones = useQuery({
    queryKey: [
      "calendar-milestones",
      periodStartInstant.toISOString(),
      periodEndInstant.toISOString(),
    ],
    queryFn: () => {
      const query = new URLSearchParams({
        startAt: periodStartInstant.toISOString(),
        endAt: periodEndInstant.toISOString(),
      });
      return api<{ items: CalendarMilestone[] }>(
        `/api/projects/calendar-milestones?${query.toString()}`,
      );
    },
    enabled: showMilestones,
  });
  const sessions = (work.data?.items ?? []).filter(
    (item) =>
      statusFilter === "all" ||
      (statusFilter === "plan" && item.recordKind === "plan") ||
      (statusFilter === "draft" && item.submissionStatus === "draft") ||
      (statusFilter === "submitted" &&
        item.submissionStatus === "submitted" &&
        item.approvalStatus !== "approved") ||
      (statusFilter === "approved" &&
        ["approved", "locked"].includes(item.approvalStatus)),
  );
  const periodSessions = sessions.filter((item) => {
    const startsAt = new Date(item.startAt).getTime();
    const endsAt = new Date(item.endAt).getTime();
    return startsAt < periodEndInstant.getTime() && endsAt > periodStartInstant.getTime();
  });
  const factualPeriodSessions = periodSessions.filter(
    (item) => item.recordKind !== "plan",
  );
  const plannedPeriodSessions = periodSessions.filter(
    (item) => item.recordKind === "plan",
  );
  const sessionsByDate = new Map<string, CalendarSessionSegment[]>();
  periodSessions.forEach((item) => {
    splitCalendarSession(item, periodStart, periodEnd).forEach((segment) => {
      const key = dateKey(segment.displayStartAt);
      sessionsByDate.set(key, [...(sessionsByDate.get(key) ?? []), segment]);
    });
  });
  const periodMilestones = showMilestones ? (milestones.data?.items ?? []) : [];
  const milestonesByDate = new Map<string, CalendarMilestone[]>();
  periodMilestones.forEach((item) => {
    const key = dateKey(organizationWallDate(item.dueAt));
    milestonesByDate.set(key, [...(milestonesByDate.get(key) ?? []), item]);
  });
  const weekDays = Array.from({ length: 7 }, (_, index) =>
    addDays(weekStart, index),
  );
  const monthGridStart = addDays(monthStart, -((monthStart.getDay() + 6) % 7));
  const monthDays = Array.from({ length: 42 }, (_, index) =>
    addDays(monthGridStart, index),
  );
  const isToday = (date: Date) => dateKey(date) === dateKey(today);
  const movePeriod = (direction: number) =>
    setAnchorDate((date) => {
      const next = new Date(date);
      if (view === "month") next.setMonth(next.getMonth() + direction);
      else next.setDate(next.getDate() + direction * (view === "day" ? 1 : 7));
      return next;
    });
  const rangeLabel =
    view === "month"
      ? new Intl.DateTimeFormat("zh-CN", {
          year: "numeric",
          month: "long",
        }).format(anchorDate)
      : view === "day"
        ? new Intl.DateTimeFormat("zh-CN", {
            year: "numeric",
            month: "long",
            day: "numeric",
            weekday: "long",
          }).format(anchorDate)
        : `${new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(weekStart)} – ${new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(addDays(weekStart, 6))}`;
  const eventProps = {
    onDragStart: setDragging,
    onDragEnd: () => setDragging(null),
  };
  const handleDrop = (targetDate: Date) => {
    if (!dragging || dragging.session.submissionStatus !== "draft") return;
    const days = dayDelta(dragging.displayStartAt, targetDate);
    if (days !== 0) reschedule.mutate({ item: dragging.session, days });
    setDragging(null);
  };
  const dayHours = [
    "00:00",
    "03:00",
    "06:00",
    "09:00",
    "12:00",
    "15:00",
    "18:00",
    "21:00",
  ];
  const daySessions = sessionsByDate.get(dateKey(anchorDate)) ?? [];
  const dayMilestones = milestonesByDate.get(dateKey(anchorDate)) ?? [];
  const listGroups = new Map<string, CalendarSession[]>();
  periodSessions.forEach((item) => {
    const label = formatDate(item.startAt);
    listGroups.set(label, [...(listGroups.get(label) ?? []), item]);
  });
  const groupedListSessions = [...listGroups.entries()];

  return (
    <>
      <PageHeader
        title="工作日历"
        description="阳历、农历、节气、节日与真实工作记录统一查看。"
        actions={
          <div className="calendar-top-actions">
            <Button
              aria-label="上一周期"
              onClick={() => movePeriod(-1)}
              size="icon"
              variant="secondary"
            >
              <ChevronLeft size={17} />
            </Button>
            <Button
              onClick={() => setAnchorDate(organizationWallDate())}
              size="compact"
              variant="secondary"
            >
              今天
            </Button>
            <Button
              aria-label="下一周期"
              onClick={() => movePeriod(1)}
              size="icon"
              variant="secondary"
            >
              <ChevronRight size={17} />
            </Button>
            <span className="calendar-view-divider" />
            {(
              [
                ["day", "日", Rows3],
                ["week", "周", Table2],
                ["month", "月", CalendarDays],
                ["list", "列表", List],
              ] as const
            ).map(([value, label, Icon]) => (
              <Button
                aria-pressed={view === value}
                key={value}
                onClick={() => setView(value)}
                size="compact"
                variant={view === value ? "primary" : "secondary"}
              >
                <Icon size={14} />
                {label}
              </Button>
            ))}
          </div>
        }
      />
      {work.isPending ? (
        <Card>
          <LoadingBlock />
        </Card>
      ) : (
        <div className="calendar-workbench">
          <aside className="calendar-side-index">
            <MiniCalendar
              anchorDate={anchorDate}
              onPick={(date) => {
                setAnchorDate(date);
                setView("day");
              }}
            />
            <div className="calendar-side-section">
              <p className="app-section-label">显示范围</p>
              <div className="calendar-filter-list">
                {(
                  [
                  ["all", "全部记录"],
                  ["draft", "草稿可改期"],
                  ["plan", "云端计划"],
                  ["submitted", "已提交待审"],
                    ["approved", "已批准"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    aria-pressed={statusFilter === value}
                    className={statusFilter === value ? "is-active" : ""}
                    key={value}
                    onClick={() => setStatusFilter(value)}
                    type="button"
                  >
                    <span>{label}</span>
                    <small>
                      {value === "all"
                        ? (work.data?.items.length ?? 0)
                        : value === "plan"
                          ? (work.data?.items.filter(
                              (item) => item.recordKind === "plan",
                            ).length ?? 0)
                        : value === "draft"
                          ? (work.data?.items.filter(
                              (item) => item.submissionStatus === "draft",
                            ).length ?? 0)
                          : value === "approved"
                            ? (work.data?.items.filter((item) =>
                                ["approved", "locked"].includes(
                                  item.approvalStatus,
                                ),
                              ).length ?? 0)
                            : (work.data?.items.filter(
                                (item) =>
                                  item.submissionStatus === "submitted" &&
                                  item.approvalStatus !== "approved",
                              ).length ?? 0)}
                    </small>
                  </button>
                ))}
              </div>
            </div>
            <div className="calendar-side-section">
              <p className="app-section-label">叠加层</p>
              <div className="calendar-filter-list">
                <button
                  aria-pressed={showMilestones}
                  className={showMilestones ? "is-active" : ""}
                  onClick={() => setShowMilestones((current) => !current)}
                  type="button"
                >
                  <span className="inline-flex items-center gap-2">
                    <Flag size={14} />
                    显示项目里程碑
                  </span>
                  <small>
                    {milestones.isFetching ? "…" : periodMilestones.length}
                  </small>
                </button>
              </div>
            </div>
            <div className="calendar-side-section calendar-drag-hint">
              <GripVertical size={16} />
              <p>
                <strong>拖拽改期</strong>
                <span>
                  仅草稿可拖到日、周或月视图中的另一天；提交后保留审核轨迹。
                </span>
              </p>
            </div>
            <div className="calendar-side-section calendar-almanac-note">
              <CalendarDays size={16} />
              <p>
                <strong>历法说明</strong>
                <span>已载入 2026 年国务院放假与调休安排；农历、传统节日和二十四节气可持续计算，未公布年份不预造调休。</span>
              </p>
            </div>
          </aside>
          <section className="min-w-0">
            <div className="calendar-period-bar">
              <div>
                <p className="app-section-label">时间视图</p>
                <h2>{rangeLabel}</h2>
                {view === "day" ? (
                  <p className="calendar-period-lunar">{getCalendarAlmanac(anchorDate).detail}</p>
                ) : null}
              </div>
              <div>
                <Badge tone="info">
                  {formatDuration(
                    factualPeriodSessions.reduce(
                      (sum, item) => sum + item.netSeconds,
                      0,
                    ),
                  )}
                </Badge>
                <span>{factualPeriodSessions.length} 条事实</span>
                <span>{plannedPeriodSessions.length} 个计划</span>
                {showMilestones ? (
                  <span>{periodMilestones.length} 个里程碑</span>
                ) : null}
              </div>
            </div>
            <section aria-label="工作日历视图" className="calendar-shell">
              {view === "week" ? (
                <div className="calendar-week-scroll">
                  <div className="calendar-week-grid">
                    {weekDays.map((date) => {
                      const almanac = getCalendarAlmanac(date);
                      return (
                        <div
                        className={`calendar-week-heading ${isToday(date) ? "is-today" : ""}`}
                        key={dateKey(date)}
                        title={almanac.detail}
                      >
                        <span>
                          {new Intl.DateTimeFormat("zh-CN", {
                            weekday: "short",
                          }).format(date)}
                        </span>
                        <strong>{date.getDate()}</strong>
                        <small className={cn((almanac.solarTerm || almanac.festivals.length) && "is-festival")}>{almanac.lunarLabel}</small>
                        {almanac.officialSchedule ? (
                          <small className={cn("calendar-official-label", almanac.officialSchedule.status === "workday" && "is-workday")}>
                            {almanac.officialSchedule.status === "off" ? "休" : "班"}
                          </small>
                        ) : null}
                        </div>
                      );
                    })}
                    {weekDays.map((date) => (
                      <div
                        className={cn(
                          "calendar-week-column",
                          dragging && "is-drop-target",
                        )}
                        key={`column-${dateKey(date)}`}
                        onDragOver={(event) => {
                          if (dragging?.session.submissionStatus === "draft")
                            event.preventDefault();
                        }}
                        onDrop={() => handleDrop(date)}
                      >
                        {milestonesByDate.get(dateKey(date))?.map((item) => (
                          <CalendarMilestone item={item} key={item.nodeId} />
                        ))}
                        {sessionsByDate.get(dateKey(date))?.map((item) => (
                          <CalendarEvent
                            item={item}
                            key={item.key}
                            {...eventProps}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {view === "month" ? (
                <div className="calendar-month-grid">
                  {["一", "二", "三", "四", "五", "六", "日"].map((label) => (
                    <div className="calendar-month-weekday" key={label}>
                      周{label}
                    </div>
                  ))}
                  {monthDays.map((date) => {
                    const almanac = getCalendarAlmanac(date);
                    return (
                      <div
                      className={cn(
                        "calendar-month-day",
                        date.getMonth() !== monthStart.getMonth() &&
                          "is-outside",
                        isToday(date) && "is-today",
                        dragging && "is-drop-target",
                      )}
                      key={dateKey(date)}
                      title={almanac.detail}
                      onClick={() => {
                        setAnchorDate(date);
                        setView("day");
                      }}
                      onDragOver={(event) => {
                        if (dragging?.session.submissionStatus === "draft")
                          event.preventDefault();
                      }}
                      onDrop={(event) => {
                        event.stopPropagation();
                        handleDrop(date);
                      }}
                    >
                      <div className="calendar-day-meta">
                        <span className="calendar-day-number">{date.getDate()}</span>
                        <span className="calendar-day-almanac">
                          <small className={cn((almanac.solarTerm || almanac.festivals.length) && "is-festival")}>{almanac.lunarLabel}</small>
                          {almanac.officialSchedule ? (
                            <small className={cn("calendar-official-label", almanac.officialSchedule.status === "workday" && "is-workday")}>
                              {almanac.officialSchedule.status === "off" ? "休" : "班"}
                            </small>
                          ) : null}
                        </span>
                      </div>
                      {milestonesByDate
                        .get(dateKey(date))
                        ?.slice(0, 1)
                        .map((item) => (
                          <CalendarMilestone
                            compact
                            item={item}
                            key={item.nodeId}
                          />
                        ))}
                      {sessionsByDate
                        .get(dateKey(date))
                        ?.slice(0, 3)
                        .map((item) => (
                          <CalendarEvent
                            item={item}
                            key={item.key}
                            {...eventProps}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {view === "day" ? (
                <>
                  {dayMilestones.length ? (
                    <div className="calendar-day-milestone-rail">
                      <span>当日里程碑</span>
                      {dayMilestones.map((item) => (
                        <CalendarMilestone item={item} key={item.nodeId} />
                      ))}
                    </div>
                  ) : null}
                  <div className="calendar-day-view">
                    <div className="calendar-day-hours">
                      {dayHours.map((hour) => (
                        <span key={hour}>{hour}</span>
                      ))}
                    </div>
                    <div
                      className={cn(
                        "calendar-day-track",
                        dragging && "is-drop-target",
                      )}
                      onDragOver={(event) => {
                        if (dragging?.session.submissionStatus === "draft")
                          event.preventDefault();
                      }}
                      onDrop={() => handleDrop(anchorDate)}
                    >
                      {daySessions.map((item) => {
                        const start = item.displayStartAt;
                        const end = item.displayEndAt;
                        const startHour =
                          start.getHours() + start.getMinutes() / 60;
                        const endHour =
                          startOfDay(start).getTime() ===
                          startOfDay(end).getTime()
                            ? end.getHours() + end.getMinutes() / 60
                            : 24;
                        const top = Math.max(0, Math.min(100, (startHour / 24) * 100));
                        const height = Math.max(
                          6,
                          Math.min(100, ((endHour - startHour) / 24) * 100),
                        );
                        return (
                          <div
                            className="calendar-day-event-wrap"
                            key={item.key}
                            style={{ top: `${top}%`, height: `${height}%` }}
                          >
                            <CalendarEvent item={item} {...eventProps} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : null}
              {view === "list" ? (
                <div className="calendar-list-view">
                  {periodMilestones.length ? (
                    <section className="calendar-milestone-agenda">
                      <div className="calendar-list-day-head">
                        <h3>本周期项目里程碑</h3>
                        <Badge tone="info">{periodMilestones.length} 个</Badge>
                      </div>
                      <div className="calendar-list-items">
                        {periodMilestones.map((item) => (
                          <CalendarMilestone item={item} key={item.nodeId} />
                        ))}
                      </div>
                    </section>
                  ) : null}
                  {groupedListSessions.length ? (
                    groupedListSessions.map(([date, items]) => (
                      <section key={date}>
                        <div className="calendar-list-day-head">
                          <h3>{date}</h3>
                          <Badge tone="info">
                            {formatDuration(
                              items
                                .filter((item) => item.recordKind !== "plan")
                                .reduce(
                                  (sum, item) => sum + item.netSeconds,
                                  0,
                                ),
                            )}
                          </Badge>
                        </div>
                        <div className="calendar-list-items">
                          {items.map((item) => (
                            <div
                              className={cn(
                                "calendar-list-item",
                                item.recordKind === "plan" && "is-plan",
                              )}
                              key={item.id}
                            >
                              <div>
                                <strong>{item.content}</strong>
                                <p>
                                  {formatTime(item.startAt)} –{" "}
                                  {formatTime(item.endAt)} ·{" "}
                                  {item.recordKind === "plan"
                                    ? "云端计划，不计入工时"
                                    : formatDuration(item.netSeconds)}
                                </p>
                                {item.result ? (
                                  <small>结果：{item.result}</small>
                                ) : null}
                              </div>
                              <Badge tone={statusTone(item)}>
                                {statusLabel(item)}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </section>
                    ))
                  ) : !periodMilestones.length ? (
                    <EmptyState
                      description="当前筛选条件下没有工作记录。"
                      icon={<CalendarDays />}
                  title="没有可显示的日历记录"
                    />
                  ) : null}
                </div>
              ) : null}
            </section>
            <Card className="calendar-audit-card">
              <CardHeader>
                <div>
                  <p className="app-section-label">记录对账</p>
                  <h2 className="mt-2 font-extrabold tracking-[-0.025em]">
                    当前周期事实与计划
                  </h2>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">
                    计划只保留在本人跨端草稿中；真实工时提交后必须通过审核、更正流程操作。
                  </p>
                </div>
                <Badge tone="info">
                  {factualPeriodSessions.length} 条事实 · {plannedPeriodSessions.length} 个计划
                </Badge>
              </CardHeader>
              <CardContent>
                {periodSessions.length ? (
                  <div className="calendar-audit-list">
                    {periodSessions.map((item) => (
                      <div className="calendar-audit-row" key={item.id}>
                        <div className="min-w-0 flex-1">
                          <strong>{item.content}</strong>
                          <p>
                            {formatDate(item.startAt)} ·{" "}
                            {formatTime(item.startAt)} –{" "}
                            {formatTime(item.endAt)} ·{" "}
                            {formatDuration(item.netSeconds)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge tone={statusTone(item)}>
                            {statusLabel(item)}
                          </Badge>
                          {item.submissionStatus === "draft" ? (
                            <Button
                              disabled={reschedule.isPending}
                              onClick={() =>
                                reschedule.mutate({
                                  item,
                                  days: -1,
                                })
                              }
                              size="compact"
                              variant="secondary"
                            >
                              前一天
                            </Button>
                          ) : null}
                          {item.submissionStatus === "draft" ? (
                            <Button
                              disabled={reschedule.isPending}
                              onClick={() =>
                                reschedule.mutate({
                                  item,
                                  days: 1,
                                })
                              }
                              size="compact"
                              variant="secondary"
                            >
                              后一天
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    description="当前时间范围和筛选条件下没有工作记录或云端计划。"
                    icon={<Clock3 />}
                    title="没有可对账的记录"
                  />
                )}
                <ErrorMessage error={reschedule.error} />
              </CardContent>
            </Card>
          </section>
        </div>
      )}
      <div className="mt-4">
        <ErrorMessage error={work.error ?? milestones.error} />
      </div>
    </>
  );
}
