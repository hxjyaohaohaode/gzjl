import { and, desc, eq, gte, inArray, isNull, lt, or, type SQL } from "drizzle-orm";
import type { Database } from "@workbench/db";
import {
  organizations,
  orgMemberships,
  projectNodes,
  projects,
  users,
  workSessionProjectLinks,
  workSessions,
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
      })
      .from(workSessions)
      .innerJoin(orgMemberships, eq(orgMemberships.id, workSessions.membershipId))
      .innerJoin(users, eq(users.id, orgMemberships.userId))
      .leftJoin(projectNodes, eq(projectNodes.id, workSessions.primaryProjectNodeId))
      .leftJoin(projects, eq(projects.id, projectNodes.projectId))
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

    const byDay = new Map<string, number>();
    const byMember = new Map<string, { membershipId: string; displayName: string; seconds: number }>();
    const byProject = new Map<string, { projectId: string | null; projectName: string; seconds: number }>();
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
      const day = dateKey(row.session.startAt, timezone);
      byDay.set(day, (byDay.get(day) ?? 0) + row.session.netSeconds);
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
    }
    return {
      range: { from, to, timezone },
      totals: {
        sessionCount: rows.length,
        totalSeconds,
        approvedSeconds,
        pendingSeconds,
      },
      byDay: [...byDay].map(([date, seconds]) => ({ date, seconds })),
      byMember: [...byMember.values()].sort((a, b) => b.seconds - a.seconds),
      byProject: [...byProject.values()].sort((a, b) => b.seconds - a.seconds),
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
