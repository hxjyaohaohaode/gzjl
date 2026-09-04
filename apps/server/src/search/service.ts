import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
} from "drizzle-orm";
import type { Database } from "@workbench/db";
import {
  aiJobs,
  aiReports,
  attachmentLinks,
  attachments,
  orgMemberships,
  projectMembers,
  projectNodes,
  projects,
  users,
  workSessions,
} from "@workbench/db/schema";

import type { AnalyticsActor, AnalyticsService } from "../analytics/service.js";

export type SearchResultKind =
  | "work_session"
  | "project"
  | "project_node"
  | "member"
  | "attachment"
  | "ai_report";

export interface SearchResult {
  id: string;
  kind: SearchResultKind;
  title: string;
  subtitle: string | null;
  href: string;
  occurredAt: Date | null;
}

function literalPattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, "\\$&")}%`;
}

function compact(value: string | null | undefined, maximum = 96): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length > maximum
    ? `${normalized.slice(0, maximum - 1)}…`
    : normalized;
}

function hasOrganizationGrant(actor: AnalyticsActor, permissions: string[]): boolean {
  return actor.grants.some(
    (grant) =>
      permissions.includes(grant.permission) &&
      grant.scopeKind === "organization",
  );
}

/**
 * Permission-aware search intentionally queries each business aggregate with
 * its own access rule. It never builds a cross-tenant materialized index that
 * could accidentally retain content after a role or project membership change.
 */
export class SearchService {
  constructor(
    private readonly db: Database,
    private readonly analytics: AnalyticsService,
  ) {}

  async search(
    actor: AnalyticsActor,
    rawQuery: string,
    perKindLimit: number,
  ): Promise<SearchResult[]> {
    const query = rawQuery.normalize("NFKC").trim();
    if (query.length < 2) return [];
    const pattern = literalPattern(query);
    const workAccess = await this.analytics.buildAccessCondition(actor);
    const canViewAllProjects = hasOrganizationGrant(actor, [
      "project.view_all",
      "project.manage",
    ]);
    const accessibleProjectIds = canViewAllProjects
      ? null
      : (
          await this.db
            .select({ projectId: projectMembers.projectId })
            .from(projectMembers)
            .innerJoin(projects, eq(projects.id, projectMembers.projectId))
            .where(
              and(
                eq(projects.organizationId, actor.organizationId),
                eq(projectMembers.membershipId, actor.membershipId),
                isNull(projectMembers.leftAt),
                isNull(projects.deletedAt),
              ),
            )
        ).map((item) => item.projectId);
    const projectVisibility = canViewAllProjects
      ? eq(projects.organizationId, actor.organizationId)
      : accessibleProjectIds?.length
        ? inArray(projects.id, accessibleProjectIds)
        : undefined;

    const workPromise = this.db
      .select({
        id: workSessions.id,
        content: workSessions.content,
        result: workSessions.result,
        startAt: workSessions.startAt,
      })
      .from(workSessions)
      .where(
        and(
          workAccess,
          eq(workSessions.recordKind, "fact"),
          isNull(workSessions.deletedAt),
          or(
            ilike(workSessions.content, pattern),
            ilike(workSessions.result, pattern),
            ilike(workSessions.blockers, pattern),
            ilike(workSessions.nextStep, pattern),
          ),
        ),
      )
      .orderBy(desc(workSessions.startAt))
      .limit(perKindLimit);

    const projectPromise = projectVisibility
      ? this.db
          .select({
            id: projects.id,
            key: projects.key,
            name: projects.name,
            description: projects.description,
            updatedAt: projects.updatedAt,
          })
          .from(projects)
          .where(
            and(
              projectVisibility,
              isNull(projects.deletedAt),
              or(
                ilike(projects.key, pattern),
                ilike(projects.name, pattern),
                ilike(projects.description, pattern),
              ),
            ),
          )
          .orderBy(desc(projects.updatedAt))
          .limit(perKindLimit)
      : Promise.resolve([]);

    const nodePromise = projectVisibility
      ? this.db
          .select({
            id: projectNodes.id,
            projectId: projects.id,
            projectName: projects.name,
            title: projectNodes.title,
            description: projectNodes.description,
            updatedAt: projectNodes.updatedAt,
          })
          .from(projectNodes)
          .innerJoin(projects, eq(projects.id, projectNodes.projectId))
          .where(
            and(
              projectVisibility,
              isNull(projects.deletedAt),
              isNull(projectNodes.deletedAt),
              or(
                ilike(projectNodes.title, pattern),
                ilike(projectNodes.description, pattern),
              ),
            ),
          )
          .orderBy(desc(projectNodes.updatedAt))
          .limit(perKindLimit)
      : Promise.resolve([]);

    const unitIds = actor.grants
      .filter(
        (grant) =>
          ["members.manage", "analytics.view_team", "work.view_full_scope"].includes(
            grant.permission,
          ) &&
          grant.scopeKind === "org_unit" &&
          grant.scopeId,
      )
      .map((grant) => grant.scopeId!);
    const canSearchAllMembers = hasOrganizationGrant(actor, [
      "members.manage",
      "analytics.view_team",
      "work.view_full_scope",
    ]);
    const memberScope = canSearchAllMembers
      ? eq(orgMemberships.organizationId, actor.organizationId)
      : unitIds.length
        ? and(
            eq(orgMemberships.organizationId, actor.organizationId),
            inArray(orgMemberships.orgUnitId, unitIds),
          )
        : eq(orgMemberships.id, actor.membershipId);
    const memberPromise = this.db
      .select({
        id: orgMemberships.id,
        displayName: users.displayName,
        positionTitle: orgMemberships.positionTitle,
        updatedAt: orgMemberships.updatedAt,
      })
      .from(orgMemberships)
      .innerJoin(users, eq(users.id, orgMemberships.userId))
      .where(
        and(
          memberScope,
          eq(orgMemberships.status, "active"),
          eq(users.status, "active"),
          or(
            ilike(users.displayName, pattern),
            ilike(orgMemberships.positionTitle, pattern),
          ),
        ),
      )
      .orderBy(desc(orgMemberships.updatedAt))
      .limit(perKindLimit);

    const canManageEvidence = hasOrganizationGrant(actor, [
      "evidence.view_management",
    ]);
    const evidenceVisibility = canManageEvidence
      ? or(
          eq(attachments.uploadedBy, actor.membershipId),
          eq(attachments.visibility, "management_only"),
          eq(attachments.visibility, "project_visible"),
        )
      : or(
          eq(attachments.uploadedBy, actor.membershipId),
          eq(attachments.visibility, "project_visible"),
        );
    const attachmentPromise = this.db
      .select({
        id: attachments.id,
        sessionId: workSessions.id,
        originalName: attachments.originalName,
        note: attachments.note,
        kind: attachments.kind,
        uploadedAt: attachments.uploadedAt,
      })
      .from(attachments)
      .innerJoin(
        attachmentLinks,
        and(
          eq(attachmentLinks.attachmentId, attachments.id),
          eq(attachmentLinks.entityType, "work_session"),
        ),
      )
      .innerJoin(workSessions, eq(workSessions.id, attachmentLinks.entityId))
      .where(
        and(
          workAccess,
          eq(attachments.organizationId, actor.organizationId),
          eq(attachments.status, "available"),
          isNull(attachments.deletedAt),
          evidenceVisibility,
          or(
            ilike(attachments.originalName, pattern),
            ilike(attachments.note, pattern),
            ilike(attachments.externalUrl, pattern),
            ilike(attachments.textContent, pattern),
          ),
        ),
      )
      .orderBy(desc(attachments.uploadedAt))
      .limit(perKindLimit);

    const aiPromise = this.db
      .select({
        id: aiReports.id,
        title: aiReports.title,
        summary: aiReports.summary,
        generatedAt: aiReports.generatedAt,
      })
      .from(aiReports)
      .innerJoin(aiJobs, eq(aiJobs.id, aiReports.aiJobId))
      .where(
        and(
          eq(aiJobs.organizationId, actor.organizationId),
          eq(aiJobs.requestedBy, actor.membershipId),
          or(ilike(aiReports.title, pattern), ilike(aiReports.summary, pattern)),
        ),
      )
      .orderBy(desc(aiReports.generatedAt))
      .limit(perKindLimit);

    const [work, projectRows, nodes, members, evidence, reports] =
      await Promise.all([
        workPromise,
        projectPromise,
        nodePromise,
        memberPromise,
        attachmentPromise,
        aiPromise,
      ]);

    return [
      ...work.map((item) => ({
        id: item.id,
        kind: "work_session" as const,
        title: compact(item.content, 72) ?? "工作记录",
        subtitle: compact(item.result),
        href: `/work#work-session-${item.id}`,
        occurredAt: item.startAt,
      })),
      ...projectRows.map((item) => ({
        id: item.id,
        kind: "project" as const,
        title: `${item.key} · ${item.name}`,
        subtitle: compact(item.description),
        href: `/projects/${item.id}`,
        occurredAt: item.updatedAt,
      })),
      ...nodes.map((item) => ({
        id: item.id,
        kind: "project_node" as const,
        title: item.title,
        subtitle: compact(`${item.projectName} ${item.description ?? ""}`),
        href: `/projects/${item.projectId}?node=${item.id}`,
        occurredAt: item.updatedAt,
      })),
      ...members.map((item) => ({
        id: item.id,
        kind: "member" as const,
        title: item.displayName,
        subtitle: compact(item.positionTitle),
        href: `/organization?member=${item.id}`,
        occurredAt: item.updatedAt,
      })),
      ...evidence.map((item) => ({
        id: item.id,
        kind: "attachment" as const,
        title:
          compact(item.originalName, 72) ??
          (item.kind === "url" ? "链接证据" : "文字证据"),
        subtitle: compact(item.note),
        href: `/work#work-session-${item.sessionId}`,
        occurredAt: item.uploadedAt,
      })),
      ...reports.map((item) => ({
        id: item.id,
        kind: "ai_report" as const,
        title: item.title,
        subtitle: compact(item.summary),
        href: `/ai?report=${item.id}`,
        occurredAt: item.generatedAt,
      })),
    ].sort(
      (left, right) =>
        (right.occurredAt?.getTime() ?? 0) -
        (left.occurredAt?.getTime() ?? 0),
    );
  }
}
