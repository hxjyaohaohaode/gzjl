import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, hasGrant, hasOrganizationGrant, type Me } from "./api.js";
import { loadCalendarRecords } from "./calendar-model.js";
import { ErrorMessage, LoadingBlock } from "./workspace-primitives.js";
import { CompactDisclosure } from "./reference-primitives.js";
import { OrbitExplorer, PulseTrend, WorkHeatmap, type OrbitGroup } from "./reference-charts.js";
import { getOrganizationTimezone, zonedInputToDate } from "./timezone.js";
import { shiftVisualDay, visualDate, type VisualWorkRecord } from "./work-visualization-model.js";

interface PulseSummary { totals: { totalSeconds: number }; byDay: Array<{ date: string; seconds: number }> }
export function HomePulse({ me, at }: { me: Me; at: number }) {
  const [days, setDays] = useState(7);
  const navigate = useNavigate();
  const canInspect = hasGrant(me, "work.view_own") || hasGrant(me, "analytics.view_team");
  // The main timer ticks each second. Aggregate queries refresh by minute.
  const sampleAt = Math.floor(at / 60_000) * 60_000;
  const range = useMemo(() => {
    const day = visualDate(new Date(sampleAt), getOrganizationTimezone());
    const from = zonedInputToDate(`${shiftVisualDay(day, 1 - days)}T00:00`, getOrganizationTimezone());
    const previousFrom = zonedInputToDate(`${shiftVisualDay(day, 1 - days * 2)}T00:00`, getOrganizationTimezone());
    const until = Math.max(sampleAt, from.getTime() + 1);
    return { from: from.toISOString(), to: new Date(until).toISOString(), previousFrom: previousFrom.toISOString(), previousTo: new Date(previousFrom.getTime() + until - from.getTime()).toISOString() };
  }, [sampleAt, days]);
  const data = useQuery({ queryKey: ["analytics-summary", "home-pulse", range, me.user.membershipId], enabled: canInspect, queryFn: async () => {
    const load = (from: string, to: string) => api<PulseSummary>(`/api/analytics/summary?${new URLSearchParams({ from, to, memberIds: me.user.membershipId })}`);
    const [current, previous] = await Promise.all([load(range.from, range.to), load(range.previousFrom, range.previousTo)]);
    return { current, previous };
  } });
  return <section className="fx-chart-surface fx-pulse-card" aria-label="本人工作脉搏"><header className="fx-surface-heading"><div><h2>工作脉搏</h2><p>回看真实投入 · 本人范围 · 按分钟更新</p></div><div className="fx-segmented" aria-label="工作脉搏时间范围">{[1, 7, 30].map((value) => <button type="button" aria-pressed={days === value} key={value} onClick={() => setDays(value)}>{value === 1 ? "今日" : `${value} 天`}</button>)}</div></header>
    {!canInspect ? <p className="fx-chart-empty">当前角色未授权工时统计，可通过工作记录回看本人投入。</p> : data.isPending ? <LoadingBlock /> : data.data ? <PulseTrend points={data.data.current.byDay ?? []} previous={data.data.previous.totals?.totalSeconds} onSelect={(date) => {
      const from = zonedInputToDate(`${date}T00:00`, getOrganizationTimezone()).toISOString(), to = zonedInputToDate(`${shiftVisualDay(date, 1)}T00:00`, getOrganizationTimezone()).toISOString();
      navigate(`/work?${new URLSearchParams({ from, to })}`);
    }} /> : null}<ErrorMessage error={data.error} onRetry={() => void data.refetch()} retrying={data.isFetching} />
  </section>;
}
export function PersonalWorkHeatmap({ title = "本人工作时段", at }: { title?: string; at?: number }) {
  const navigate = useNavigate();
  const [openedAt] = useState(Date.now);
  const today = visualDate(new Date(at ?? openedAt), getOrganizationTimezone());
  const from = zonedInputToDate(`${shiftVisualDay(today, -6)}T00:00`, getOrganizationTimezone()).toISOString();
  const to = zonedInputToDate(`${shiftVisualDay(today, 1)}T00:00`, getOrganizationTimezone()).toISOString();
  const records = useQuery({ queryKey: ["work-sessions", "heatmap", from, to], queryFn: ({ signal }) => loadCalendarRecords<VisualWorkRecord>(from, to, signal) });
  return <div>{records.isPending ? <LoadingBlock /> : records.data ? <WorkHeatmap records={records.data.items} lastDay={today} title={title} onSelect={(item) => navigate(`/work?record=${encodeURIComponent(item.id)}`)} /> : null}<ErrorMessage error={records.error} onRetry={() => void records.refetch()} retrying={records.isFetching} /></div>;
}
export function WorkspacePaths({ me }: { me: Me }) {
  const navigate = useNavigate();
  const make = (id: string, label: string, items: Array<[string, string, boolean]>) => {
    const visible = items.filter(([, , allowed]) => allowed).map(([to, title]) => ({ id: to, label: title, sub: to, onSelect: () => navigate(to) }));
    return { id, label, count: visible.length, items: visible };
  };
  const groups: OrbitGroup[] = [
    make("facts", "记录与回看", [["/work", "工作记录", true], ["/calendar", "工作日历", true], ["/analytics", "数据分析", hasGrant(me, "work.view_own") || hasGrant(me, "analytics.view_team")]]),
    make("projects", "项目与协作", [["/projects", "项目工作区", true], ["/team", "团队动态", true], ["/ai", "AI 工作洞察", true]]),
    make("management", "审批与结算", [["/approvals", "工时审批", hasGrant(me, "work.review")], ["/payroll-management", "薪资管理", hasOrganizationGrant(me, "payroll.configure")], ["/payroll", "我的薪资", hasGrant(me, "payroll.view_own")], ["/reimbursements", "我的报销", hasGrant(me, "payroll.view_own")], ["/organization", "组织与人员", hasOrganizationGrant(me, "members.manage")]]),
  ].filter((group) => group.items.length > 0);
  return <CompactDisclosure title="工作路径图" summary="从事实记录到项目、审批和结算，点击逐层进入业务页面。"><OrbitExplorer title="工作路径" groups={groups} placeholder="查找工作记录、项目、审批或薪资入口" /></CompactDisclosure>;
}
