import { and, desc, eq, gt, inArray, isNull, lt, or, type SQL } from "drizzle-orm";
import type { Database } from "@workbench/db";
import {
  organizations,
  orgMemberships,
  orgUnits,
  projectNodes,
  projects,
  users,
  workBreaks,
  workSessionProjectLinks,
  workSessions,
  workTypes,
} from "@workbench/db/schema";
import type { PermissionGrant } from "@workbench/shared";

export interface AnalyticsActor {
  organizationId: string;
  membershipId: string;
  grants: PermissionGrant[];
}

export interface AnalyticsFilters {
  projectIds?: string[] | undefined;
  nodeIds?: string[] | undefined;
  workTypeIds?: string[] | undefined;
  memberIds?: string[] | undefined;
  orgUnitIds?: string[] | undefined;
  approvalStates?: Array<
    "not_requested" | "pending_review" | "approved" | "returned" | "locked"
  > | undefined;
  sourceTypes?: Array<"manual" | "timer" | "import"> | undefined;
}

function dateKey(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function hourKey(at: Date, timezone: string): number {
  return Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(at));
}

function addDateKey(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function fillDailySeries(
  from: Date,
  to: Date,
  timezone: string,
  values: ReadonlyMap<string, number>,
): Array<{ date: string; seconds: number }> {
  const result: Array<{ date: string; seconds: number }> = [];
  const lastInstant = new Date(Math.max(from.getTime(), to.getTime() - 1));
  const last = dateKey(lastInstant, timezone);
  let cursor = dateKey(from, timezone);
  while (cursor <= last && result.length <= 367) {
    result.push({ date: cursor, seconds: Math.round(values.get(cursor) ?? 0) });
    cursor = addDateKey(cursor, 1);
  }
  return result;
}

export function forecastDailySeries(
  observed: Array<{ date: string; seconds: number }>,
  horizonDays = 7,
): Array<{
  date: string;
  seconds: number;
  lowerSeconds: number;
  upperSeconds: number;
}> {
  if (observed.length < 3 || horizonDays <= 0) return [];
  const sample = observed.slice(-Math.min(28, observed.length));
  const mean = sample.reduce((total, item) => total + item.seconds, 0) / sample.length;
  const variance =
    sample.reduce((total, item) => total + (item.seconds - mean) ** 2, 0) /
    sample.length;
  const deviation = Math.sqrt(variance);
  const xMean = (sample.length - 1) / 2;
  const covariance = sample.reduce(
    (total, item, index) => total + (index - xMean) * (item.seconds - mean),
    0,
  );
  const xVariance = sample.reduce(
    (total, _item, index) => total + (index - xMean) ** 2,
    0,
  );
  const rawSlope = xVariance > 0 ? covariance / xVariance : 0;
  // A short noisy period must not create an explosive projection. Capping the
  // daily slope to 35% of the observed mean keeps this an explanatory planning
  // band rather than an invented performance claim.
  const slopeLimit = Math.max(mean * 0.35, 3_600);
  const slope = Math.max(-slopeLimit, Math.min(slopeLimit, rawSlope));
  const lastDate = observed.at(-1)!.date;
  return Array.from({ length: Math.min(14, horizonDays) }, (_, index) => {
    const seconds = Math.max(0, mean + slope * (xMean + index + 1));
    return {
      date: addDateKey(lastDate, index + 1),
      seconds: Math.round(seconds),
      lowerSeconds: Math.round(Math.max(0, seconds - deviation)),
      upperSeconds: Math.round(seconds + deviation),
    };
  });
}

export interface TimeInterval {
  startAt: Date;
  endAt: Date;
}

export function clipIntervalsToRange(
  intervals: TimeInterval[],
  from: Date,
  to: Date,
): TimeInterval[] {
  if (to <= from) return [];
  return intervals
    .map((interval) => ({
      startAt: interval.startAt < from ? from : interval.startAt,
      endAt: interval.endAt > to ? to : interval.endAt,
    }))
    .filter((interval) => interval.endAt > interval.startAt);
}

export function subtractBreaks(
  startAt: Date,
  endAt: Date,
  breaks: TimeInterval[],
): TimeInterval[] {
  const intervals: TimeInterval[] = [];
  let cursor = startAt.getTime();
  const end = endAt.getTime();
  for (const entry of [...breaks].sort(
    (left, right) => left.startAt.getTime() - right.startAt.getTime(),
  )) {
    const breakStart = Math.max(cursor, entry.startAt.getTime());
    const breakEnd = Math.min(end, entry.endAt.getTime());
    if (breakStart > cursor) {
      intervals.push({ startAt: new Date(cursor), endAt: new Date(breakStart) });
    }
    cursor = Math.max(cursor, breakEnd);
    if (cursor >= end) break;
  }
  if (cursor < end) intervals.push({ startAt: new Date(cursor), endAt });
  return intervals;
}

/**
 * Split an absolute interval whenever its organization-local calendar hour
 * changes. The binary search also handles non-whole-hour UTC offsets and DST
 * transitions without assuming that a local hour always lasts 3,600 seconds.
 */
export function splitByLocalHour(
  interval: TimeInterval,
  timezone: string,
): Array<TimeInterval & { date: string; hour: number }> {
  const segments: Array<TimeInterval & { date: string; hour: number }> = [];
  const end = interval.endAt.getTime();
  let cursor = interval.startAt.getTime();
  const token = (at: number) => {
    const date = new Date(at);
    return `${dateKey(date, timezone)}:${hourKey(date, timezone)}`;
  };
  while (cursor < end) {
    const currentToken = token(cursor);
    const probeEnd = Math.min(end, cursor + 3 * 3_600_000);
    let segmentEnd = end;
    if (probeEnd < end || token(Math.max(cursor, probeEnd - 1)) !== currentToken) {
      let low = cursor + 1;
      let high = probeEnd;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (token(middle) === currentToken) low = middle + 1;
        else high = middle;
      }
      segmentEnd = low;
    }
    const startAt = new Date(cursor);
    segments.push({
      startAt,
      endAt: new Date(segmentEnd),
      date: dateKey(startAt, timezone),
      hour: hourKey(startAt, timezone),
    });
    cursor = segmentEnd;
  }
  return segments;
}

export class AnalyticsService {
  constructor(private readonly db: Database) {}

  async buildAccessCondition(actor: AnalyticsActor): Promise<SQL> {
    const broadPermissions = new Set([
      "work.view_full_scope",
      "analytics.view_team",
    ]);
    const relevant = actor.grants.filter((grant) => broadPermissions.has(grant.permission));
    if (relevant.some((grant) => grant.scopeKind === "organization")) {
      return eq(workSessions.organizationId, actor.organizationId);
    }
    const conditions: SQL[] = [eq(workSessions.membershipId, actor.membershipId)];
    const unitIds = relevant
      .filter((grant) => grant.scopeKind === "org_unit" && grant.scopeId)
      .map((grant) => grant.scopeId!);
    if (unitIds.length > 0) {
      const memberships = await this.db
        .select({ id: orgMemberships.id })
        .from(orgMemberships)
        .where(
          and(
            eq(orgMemberships.organizationId, actor.organizationId),
            inArray(orgMemberships.orgUnitId, unitIds),
          ),
        );
      if (memberships.length > 0) {
        conditions.push(inArray(workSessions.membershipId, memberships.map((item) => item.id)));
      }
    }
    const projectIds = relevant
      .filter((grant) => grant.scopeKind === "project" && grant.scopeId)
      .map((grant) => grant.scopeId!);
    if (projectIds.length > 0) {
      const linked = await this.db
        .select({ id: workSessionProjectLinks.workSessionId })
        .from(workSessionProjectLinks)
        .where(inArray(workSessionProjectLinks.projectId, projectIds));
      if (linked.length > 0) {
        conditions.push(inArray(workSessions.id, linked.map((item) => item.id)));
      }
    }
    return and(
      eq(workSessions.organizationId, actor.organizationId),
      or(...conditions),
    )!;
  }

  async summary(
    actor: AnalyticsActor,
    from: Date,
    to: Date,
    filters: AnalyticsFilters = {},
  ) {
    const [organization] = await this.db
      .select({ timezone: organizations.timezone })
      .from(organizations)
      .where(eq(organizations.id, actor.organizationId))
      .limit(1);
    const timezone = organization?.timezone ?? "Asia/Shanghai";
    const access = await this.buildAccessCondition(actor);
    const baseRows = await this.db
      .select({
        session: workSessions,
        displayName: users.displayName,
        orgUnitId: orgMemberships.orgUnitId,
        orgUnitName: orgUnits.name,
        projectId: projects.id,
        projectName: projects.name,
        projectStatus: projects.status,
        projectDueAt: projects.dueAt,
        workTypeId: workTypes.id,
        workTypeName: workTypes.name,
      })
      .from(workSessions)
      .innerJoin(orgMemberships, eq(orgMemberships.id, workSessions.membershipId))
      .innerJoin(users, eq(users.id, orgMemberships.userId))
      .leftJoin(orgUnits, eq(orgUnits.id, orgMemberships.orgUnitId))
      .leftJoin(projectNodes, eq(projectNodes.id, workSessions.primaryProjectNodeId))
      .leftJoin(projects, eq(projects.id, projectNodes.projectId))
      .leftJoin(workTypes, eq(workTypes.id, workSessions.workTypeId))
      .where(
        and(
          access,
          gt(workSessions.endAt, from),
          lt(workSessions.startAt, to),
          eq(workSessions.recordKind, "fact"),
          isNull(workSessions.deletedAt),
        ),
      )
      .orderBy(workSessions.startAt);
    const selectedProjects = new Set(filters.projectIds ?? []);
    const selectedNodes = new Set(filters.nodeIds ?? []);
    const selectedWorkTypes = new Set(filters.workTypeIds ?? []);
    const selectedMembers = new Set(filters.memberIds ?? []);
    const selectedOrgUnits = new Set(filters.orgUnitIds ?? []);
    const selectedApprovals = new Set(filters.approvalStates ?? []);
    const selectedSources = new Set(filters.sourceTypes ?? []);
    const rows = baseRows.filter((row) => {
      if (selectedProjects.size && (!row.projectId || !selectedProjects.has(row.projectId))) return false;
      if (selectedNodes.size && (!row.session.primaryProjectNodeId || !selectedNodes.has(row.session.primaryProjectNodeId))) return false;
      if (selectedWorkTypes.size && (!row.workTypeId || !selectedWorkTypes.has(row.workTypeId))) return false;
      if (selectedMembers.size && !selectedMembers.has(row.session.membershipId)) return false;
      if (selectedOrgUnits.size && (!row.orgUnitId || !selectedOrgUnits.has(row.orgUnitId))) return false;
      if (selectedApprovals.size && !selectedApprovals.has(row.session.approvalStatus)) return false;
      if (selectedSources.size && !selectedSources.has(row.session.source)) return false;
      return true;
    });
    const breaks = rows.length
      ? await this.db
          .select({
            workSessionId: workBreaks.workSessionId,
            startAt: workBreaks.startAt,
            endAt: workBreaks.endAt,
          })
          .from(workBreaks)
          .where(inArray(workBreaks.workSessionId, rows.map((row) => row.session.id)))
      : [];
    const breaksBySession = new Map<string, TimeInterval[]>();
    for (const entry of breaks) {
      breaksBySession.set(entry.workSessionId, [
        ...(breaksBySession.get(entry.workSessionId) ?? []),
        entry,
      ]);
    }

    const byDay = new Map<string, number>();
    const byMember = new Map<
      string,
      { membershipId: string; displayName: string; seconds: number }
    >();
    const byProject = new Map<
      string,
      {
        projectId: string | null;
        projectName: string;
        projectStatus: string | null;
        dueAt: Date | null;
        seconds: number;
      }
    >();
    const byWorkType = new Map<
      string,
      { workTypeId: string | null; workTypeName: string; seconds: number }
    >();
    const byOrgUnit = new Map<
      string,
      { orgUnitId: string | null; orgUnitName: string; seconds: number }
    >();
    const bySource = new Map<string, { source: string; seconds: number; count: number }>();
    const byApproval = new Map<string, { status: string; seconds: number; count: number }>();
    const projectWorkTypes = new Map<
      string,
      {
        projectId: string | null;
        projectName: string;
        workTypeId: string | null;
        workTypeName: string;
        seconds: number;
      }
    >();
    const flowNodes = new Map<string, { id: string; label: string; kind: "project" | "work_type" | "approval" }>();
    const flowLinks = new Map<string, { source: string; target: string; seconds: number }>();
    const anomalies = new Map<string, { category: string; count: number; seconds: number }>();
    const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, seconds: 0, count: 0 }));
    const includedSessionIds = new Set<string>();
    const addFlow = (source: string, target: string, seconds: number) => {
      const key = `${source}\u0000${target}`;
      const current = flowLinks.get(key) ?? { source, target, seconds: 0 };
      current.seconds += seconds;
      flowLinks.set(key, current);
    };
    let totalSeconds = 0;
    let approvedSeconds = 0;
    let pendingSeconds = 0;
    for (const row of rows) {
      const productiveIntervals = clipIntervalsToRange(
        subtractBreaks(
          row.session.startAt,
          row.session.endAt,
          breaksBySession.get(row.session.id) ?? [],
        ),
        from,
        to,
      );
      const sessionSeconds = productiveIntervals.reduce(
        (total, interval) =>
          total + (interval.endAt.getTime() - interval.startAt.getTime()) / 1_000,
        0,
      );
      if (sessionSeconds <= 0) continue;
      includedSessionIds.add(row.session.id);
      totalSeconds += sessionSeconds;
      if (["approved", "locked"].includes(row.session.approvalStatus)) {
        approvedSeconds += sessionSeconds;
      }
      if (row.session.approvalStatus === "pending_review") {
        pendingSeconds += sessionSeconds;
      }
      for (const interval of productiveIntervals) {
        for (const segment of splitByLocalHour(interval, timezone)) {
          const seconds =
            (segment.endAt.getTime() - segment.startAt.getTime()) / 1_000;
          byDay.set(segment.date, (byDay.get(segment.date) ?? 0) + seconds);
          const hour = byHour[segment.hour]!;
          hour.seconds += seconds;
        }
      }
      const member = byMember.get(row.session.membershipId) ?? {
        membershipId: row.session.membershipId,
        displayName: row.displayName,
        seconds: 0,
      };
      member.seconds += sessionSeconds;
      byMember.set(row.session.membershipId, member);
      const projectKey = row.projectId ?? "unassigned";
      const project = byProject.get(projectKey) ?? {
        projectId: row.projectId,
        projectName: row.projectName ?? "未关联项目",
        projectStatus: row.projectStatus,
        dueAt: row.projectDueAt,
        seconds: 0,
      };
      project.seconds += sessionSeconds;
      byProject.set(projectKey, project);
      const typeKey = row.workTypeId ?? "unassigned";
      const workType = byWorkType.get(typeKey) ?? {
        workTypeId: row.workTypeId,
        workTypeName: row.workTypeName ?? "未分类",
        seconds: 0,
      };
      workType.seconds += sessionSeconds;
      byWorkType.set(typeKey, workType);
      const unitKey = row.orgUnitId ?? "unassigned";
      const unit = byOrgUnit.get(unitKey) ?? {
        orgUnitId: row.orgUnitId,
        orgUnitName: row.orgUnitName ?? "未分配组织单元",
        seconds: 0,
      };
      unit.seconds += sessionSeconds;
      byOrgUnit.set(unitKey, unit);
      const source = bySource.get(row.session.source) ?? {
        source: row.session.source,
        seconds: 0,
        count: 0,
      };
      source.seconds += sessionSeconds;
      source.count += 1;
      bySource.set(row.session.source, source);
      const approval = byApproval.get(row.session.approvalStatus) ?? {
        status: row.session.approvalStatus,
        seconds: 0,
        count: 0,
      };
      approval.seconds += sessionSeconds;
      approval.count += 1;
      byApproval.set(row.session.approvalStatus, approval);
      byHour[hourKey(productiveIntervals[0]!.startAt, timezone)]!.count += 1;

      const jointKey = `${projectKey}\u0000${typeKey}`;
      const joint = projectWorkTypes.get(jointKey) ?? {
        projectId: row.projectId,
        projectName: row.projectName ?? "未关联项目",
        workTypeId: row.workTypeId,
        workTypeName: row.workTypeName ?? "未分类",
        seconds: 0,
      };
      joint.seconds += sessionSeconds;
      projectWorkTypes.set(jointKey, joint);

      const projectNodeId = `project:${projectKey}`;
      const typeNodeId = `work_type:${typeKey}`;
      const approvalNodeId = `approval:${row.session.approvalStatus}`;
      flowNodes.set(projectNodeId, {
        id: projectNodeId,
        label: row.projectName ?? "未关联项目",
        kind: "project",
      });
      flowNodes.set(typeNodeId, {
        id: typeNodeId,
        label: row.workTypeName ?? "未分类",
        kind: "work_type",
      });
      flowNodes.set(approvalNodeId, {
        id: approvalNodeId,
        label: row.session.approvalStatus,
        kind: "approval",
      });
      addFlow(projectNodeId, typeNodeId, sessionSeconds);
      addFlow(typeNodeId, approvalNodeId, sessionSeconds);

      const anomalyFlags = Array.isArray(row.session.anomalyFlags)
        ? row.session.anomalyFlags.filter((value): value is string => typeof value === "string")
        : [];
      for (const category of anomalyFlags) {
        const anomaly = anomalies.get(category) ?? { category, count: 0, seconds: 0 };
        anomaly.count += 1;
        anomaly.seconds += sessionSeconds;
        anomalies.set(category, anomaly);
      }
    }

    const activeProjectIds = [...byProject.values()]
      .flatMap((item) => (item.projectId ? [item.projectId] : []));
    const projectNodeRows = activeProjectIds.length
      ? await this.db
          .select({
            projectId: projectNodes.projectId,
            status: projectNodes.status,
            progress: projectNodes.progress,
            weight: projectNodes.weight,
          })
          .from(projectNodes)
          .where(
            and(
              inArray(projectNodes.projectId, activeProjectIds),
              isNull(projectNodes.deletedAt),
            ),
          )
      : [];
    const projectHealth = [...byProject.values()]
      .filter((item): item is typeof item & { projectId: string } => item.projectId !== null)
      .map((item) => {
        const nodes = projectNodeRows.filter((node) => node.projectId === item.projectId);
        const activeNodes = nodes.filter((node) => node.status !== "cancelled");
        const totalWeight = activeNodes.reduce((total, node) => total + Number(node.weight), 0);
        const progress = totalWeight > 0
          ? activeNodes.reduce(
              (total, node) => total + Number(node.progress) * Number(node.weight),
              0,
            ) / totalWeight
          : 0;
        return {
          projectId: item.projectId,
          projectName: item.projectName,
          status: item.projectStatus,
          dueAt: item.dueAt,
          seconds: Math.round(item.seconds),
          progress: Math.round(progress * 100) / 100,
          blockedNodes: nodes.filter((node) => node.status === "blocked").length,
          totalNodes: nodes.length,
        };
      })
      .sort((left, right) => right.blockedNodes - left.blockedNodes || right.seconds - left.seconds);
    const dailyObserved = fillDailySeries(from, to, timezone, byDay);
    const forecast = forecastDailySeries(dailyObserved);
    const availableMembers = new Map<string, string>();
    const availableProjects = new Map<string, string>();
    const availableWorkTypes = new Map<string, string>();
    const availableOrgUnits = new Map<string, string>();
    for (const row of baseRows) {
      availableMembers.set(row.session.membershipId, row.displayName);
      if (row.projectId) availableProjects.set(row.projectId, row.projectName ?? "未命名项目");
      if (row.workTypeId) availableWorkTypes.set(row.workTypeId, row.workTypeName ?? "未分类");
      if (row.orgUnitId) availableOrgUnits.set(row.orgUnitId, row.orgUnitName ?? "未命名组织单元");
    }
    return {
      range: { from, to, timezone },
      totals: {
        sessionCount: includedSessionIds.size,
        totalSeconds: Math.round(totalSeconds),
        approvedSeconds: Math.round(approvedSeconds),
        pendingSeconds: Math.round(pendingSeconds),
      },
      appliedFilters: filters,
      availableFilters: {
        members: [...availableMembers].map(([id, label]) => ({ id, label })),
        projects: [...availableProjects].map(([id, label]) => ({ id, label })),
        workTypes: [...availableWorkTypes].map(([id, label]) => ({ id, label })),
        orgUnits: [...availableOrgUnits].map(([id, label]) => ({ id, label })),
        approvalStates: [...new Set(baseRows.map((row) => row.session.approvalStatus))],
        sourceTypes: [...new Set(baseRows.map((row) => row.session.source))],
      },
      byDay: [...byDay]
        .map(([date, seconds]) => ({ date, seconds: Math.round(seconds) }))
        .sort((left, right) => left.date.localeCompare(right.date)),
      byMember: [...byMember.values()]
        .map((item) => ({ ...item, seconds: Math.round(item.seconds) }))
        .sort((a, b) => b.seconds - a.seconds),
      byProject: [...byProject.values()]
        .map((item) => ({ ...item, seconds: Math.round(item.seconds) }))
        .sort((a, b) => b.seconds - a.seconds),
      byWorkType: [...byWorkType.values()]
        .map((item) => ({ ...item, seconds: Math.round(item.seconds) }))
        .sort((a, b) => b.seconds - a.seconds),
      byOrgUnit: [...byOrgUnit.values()]
        .map((item) => ({ ...item, seconds: Math.round(item.seconds) }))
        .sort((a, b) => b.seconds - a.seconds),
      bySource: [...bySource.values()]
        .map((item) => ({ ...item, seconds: Math.round(item.seconds) }))
        .sort((a, b) => b.seconds - a.seconds),
      byApproval: [...byApproval.values()]
        .map((item) => ({ ...item, seconds: Math.round(item.seconds) }))
        .sort((a, b) => b.seconds - a.seconds),
      byHour: byHour.map((item) => ({ ...item, seconds: Math.round(item.seconds) })),
      projectWorkTypes: [...projectWorkTypes.values()]
        .map((item) => ({ ...item, seconds: Math.round(item.seconds) }))
        .sort((a, b) => b.seconds - a.seconds),
      flow: {
        nodes: [...flowNodes.values()],
        links: [...flowLinks.values()].map((item) => ({ ...item, seconds: Math.round(item.seconds) })),
      },
      anomalies: [...anomalies.values()]
        .map((item) => ({ ...item, seconds: Math.round(item.seconds) }))
        .sort((a, b) => b.count - a.count),
      projectHealth,
      forecast: { observed: dailyObserved, predicted: forecast },
      funnel: [
        { stage: "已记录", count: includedSessionIds.size },
        { stage: "已提交", count: rows.filter((row) => includedSessionIds.has(row.session.id) && row.session.submissionStatus === "submitted").length },
        { stage: "已批准", count: rows.filter((row) => includedSessionIds.has(row.session.id) && ["approved", "locked"].includes(row.session.approvalStatus)).length },
        { stage: "可计薪", count: rows.filter((row) => includedSessionIds.has(row.session.id) && row.session.billableSeconds !== null && ["approved", "locked"].includes(row.session.approvalStatus)).length },
      ],
    };
  }

  async teamActivity(actor: AnalyticsActor, limit: number) {
    const access = await this.buildAccessCondition(actor);
    return this.db
      .select({
        id: workSessions.id,
        displayName: users.displayName,
        content: workSessions.content,
        result: workSessions.result,
        startAt: workSessions.startAt,
        endAt: workSessions.endAt,
        netSeconds: workSessions.netSeconds,
        visibility: workSessions.visibility,
        projectName: projects.name,
      })
      .from(workSessions)
      .innerJoin(orgMemberships, eq(orgMemberships.id, workSessions.membershipId))
      .innerJoin(users, eq(users.id, orgMemberships.userId))
      .leftJoin(projectNodes, eq(projectNodes.id, workSessions.primaryProjectNodeId))
      .leftJoin(projects, eq(projects.id, projectNodes.projectId))
      .where(
        and(
          access,
          eq(workSessions.visibility, "project_visible"),
          eq(workSessions.recordKind, "fact"),
          isNull(workSessions.deletedAt),
        ),
      )
      .orderBy(desc(workSessions.startAt))
      .limit(limit);
  }
}
