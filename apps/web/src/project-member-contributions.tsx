import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, hasGrant, type Me } from "./api.js";
import { PulseTrend } from "./reference-charts.js";
import { ErrorMessage, LoadingBlock } from "./workspace-primitives.js";
import { getOrganizationTimezone, zonedInputToDate } from "./timezone.js";
import { shiftVisualDay, visualDate, visualDuration } from "./work-visualization-model.js";

interface ContributionSummary { totals: { totalSeconds: number; sessionCount: number }; byMember: Array<{ membershipId: string; seconds: number }>; byProject: Array<{ projectId: string | null; projectName: string; seconds: number }>; byDay: Array<{ date: string; seconds: number }> }
export function ProjectMemberContributions({ member, projectId, me, onClose }: { member: { membershipId: string; displayName: string }; projectId: string; me: Me; onClose: () => void }) {
  const today = visualDate(new Date(), getOrganizationTimezone());
  const from = zonedInputToDate(`${shiftVisualDay(today, -89)}T00:00`, getOrganizationTimezone()).toISOString();
  const to = zonedInputToDate(`${shiftVisualDay(today, 1)}T00:00`, getOrganizationTimezone()).toISOString();
  const canInspect = hasGrant(me, "analytics.view_team") || (member.membershipId === me.user.membershipId && hasGrant(me, "work.view_own"));
  const data = useQuery({ queryKey: ["analytics-summary", "member-contribution", projectId, member.membershipId, from, to, me.user.membershipId], enabled: canInspect, queryFn: async () => {
    const [person, project] = await Promise.all([
      api<ContributionSummary>(`/api/analytics/summary?${new URLSearchParams({ from, to, memberIds: member.membershipId })}`),
      api<ContributionSummary>(`/api/analytics/summary?${new URLSearchParams({ from, to, projectIds: projectId })}`),
    ]);
    return { person, project };
  } });
  const currentSeconds = data.data?.project.byMember.find((item) => item.membershipId === member.membershipId)?.seconds ?? 0;
  const currentTotal = data.data?.project.totals.totalSeconds ?? 0;
  return <section aria-label="项目成员贡献详情"><p className="fx-detail-meta">近 90 天 · 仅当前授权可见的真实工作；工时占比表示投入，不作为绩效评分。</p>
    {!canInspect ? <p className="fx-chart-empty">当前访问角色未授权查看这位成员的工时统计。可返回成员列表，查看其项目协作角色和已认领节点。</p> : data.isPending ? <LoadingBlock /> : data.data && <><div className="project-team-summary"><span><strong>{visualDuration(data.data.person.totals.totalSeconds)}</strong><small>可见工作投入</small></span><span><strong>{data.data.person.byProject.filter((item) => item.projectId).length}</strong><small>有可见工时的项目</small></span><span><strong>{currentTotal > 0 ? `${(currentSeconds / currentTotal * 100).toFixed(1)}%` : "暂无"}</strong><small>本项目可见工时投入占比</small></span></div>
      <div className="fx-chart-surface"><PulseTrend points={data.data.person.byDay.slice(-30)} label="近 30 天授权工作投入" /></div>
      <h3 className="fx-detail-title mt-5">参与项目与投入</h3>{data.data.person.byProject.map((item) => <div className="fx-day-record" key={item.projectId ?? "unlinked"}>{item.projectId ? <Link className="fx-back-link" to={`/projects/${item.projectId}`} onClick={onClose}>{item.projectName} →</Link> : <strong>未关联项目的工作</strong>}<span>{visualDuration(item.seconds)}</span></div>)}</>}
    <ErrorMessage error={data.error} onRetry={() => void data.refetch()} retrying={data.isFetching} />
  </section>;
}
