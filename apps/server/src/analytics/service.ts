import { and, desc, eq, gte, inArray, isNull, lt, or, type SQL } from "drizzle-orm";
import type { Database } from "@workbench/db";
import {
  organizations,
  orgMemberships,
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

interface TimeInterval {
  startAt: Date;
  endAt: Date;
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

  async summary(actor: AnalyticsActor, from: Date, to: Date) {
    const [organization] = await this.db
      .select({ timezone: organizations.timezone })
      .from(organizations)
      .where(eq(organizations.id, actor.organizationId))
      .limit(1);
    const timezone = organization?.timezone ?? "Asia/Shanghai";
    const access = await this.buildAccessCondition(actor);
    const rows = await this.db
      .select({
        session: workSessions,
        displayName: users.displayName,
        projectId: projects.id,
        projectName: projects.name,
        workTypeId: workTypes.id,
        workTypeName: workTypes.name,
      })
      .from(workSessions)
      .innerJoin(orgMemberships, eq(orgMemberships.id, workSessions.membershipId))
      .innerJoin(users, eq(users.id, orgMemberships.userId))
      .leftJoin(projectNodes, eq(projectNodes.id, workSessions.primaryProjectNodeId))
      .leftJoin(projects, eq(projects.id, projectNodes.projectId))
      .leftJoin(workTypes, eq(workTypes.id, workSessions.workTypeId))
      .where(
        and(
          access,
          gte(workSessions.startAt, from),
          lt(workSessions.startAt, to),
          eq(workSessions.recordKind, "fact"),
          isNull(workSessions.deletedAt),
        ),
      )
      .orderBy(workSessions.startAt);
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
    const byMember = new Map<string, { membershipId: string; displayName: string; seconds: number }>();
    const byProject = new Map<string, { projectId: string | null; projectName: string; seconds: number }>();
    const byWorkType = new Map<string, { workTypeId: string | null; workTypeName: string; seconds: number }>();
    const byApproval = new Map<string, { status: string; seconds: number; count: number }>();
    const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, seconds: 0, count: 0 }));
    let totalSeconds = 0;
    let approvedSeconds = 0;
    let pendingSeconds = 0;
    for (const row of rows) {
      totalSeconds += row.session.netSeconds;
      if (["approved", "locked"].includes(row.session.approvalStatus)) {
        approvedSeconds += row.session.netSeconds;
      }
      if (row.session.approvalStatus === "pending_review") {
        pendingSeconds += row.session.netSeconds;
      }
      const productiveIntervals = subtractBreaks(
        row.session.startAt,
        row.session.endAt,
        breaksBySession.get(row.session.id) ?? [],
      );
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
      member.seconds += row.session.netSeconds;
      byMember.set(row.session.membershipId, member);
      const projectKey = row.projectId ?? "unassigned";
      const project = byProject.get(projectKey) ?? {
        projectId: row.projectId,
        projectName: row.projectName ?? "未关联项目",
        seconds: 0,
      };
      project.seconds += row.session.netSeconds;
      byProject.set(projectKey, project);
      const typeKey = row.workTypeId ?? "unassigned";
      const workType = byWorkType.get(typeKey) ?? {
        workTypeId: row.workTypeId,
        workTypeName: row.workTypeName ?? "未分类",
        seconds: 0,
      };
      workType.seconds += row.session.netSeconds;
      byWorkType.set(typeKey, workType);
      const approval = byApproval.get(row.session.approvalStatus) ?? {
        status: row.session.approvalStatus,
        seconds: 0,
        count: 0,
      };
      approval.seconds += row.session.netSeconds;
      approval.count += 1;
      byApproval.set(row.session.approvalStatus, approval);
      byHour[hourKey(row.session.startAt, timezone)]!.count += 1;
    }
    return {
      range: { from, to, timezone },
      totals: {
        sessionCount: rows.length,
        totalSeconds,
        approvedSeconds,
        pendingSeconds,
      },
      byDay: [...byDay].map(([date, seconds]) => ({ date, seconds: Math.round(seconds) })),
      byMember: [...byMember.values()].sort((a, b) => b.seconds - a.seconds),
      byProject: [...byProject.values()].sort((a, b) => b.seconds - a.seconds),
      byWorkType: [...byWorkType.values()].sort((a, b) => b.seconds - a.seconds),
      byApproval: [...byApproval.values()].sort((a, b) => b.seconds - a.seconds),
      byHour: byHour.map((item) => ({ ...item, seconds: Math.round(item.seconds) })),
      funnel: [
        { stage: "已记录", count: rows.length },
        { stage: "已提交", count: rows.filter((row) => row.session.submissionStatus === "submitted").length },
        { stage: "已批准", count: rows.filter((row) => ["approved", "locked"].includes(row.session.approvalStatus)).length },
        { stage: "可计薪", count: rows.filter((row) => row.session.billableSeconds !== null && ["approved", "locked"].includes(row.session.approvalStatus)).length },
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
