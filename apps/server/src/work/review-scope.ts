import { eq, inArray, or, sql, type SQLWrapper } from "drizzle-orm";
import { orgMemberships, workSessionProjectLinks, workSessions } from "@workbench/db/schema";
import type { PermissionGrant } from "@workbench/shared";

/** Apply authorization before ORDER BY/LIMIT so unrelated busy teams cannot
 * hide an authorized reviewer's own waiting work. The caller still filters
 * the authenticated organization and excludes self review. */
export function workReviewScope(grants: readonly PermissionGrant[]) {
  const review = grants.filter((grant) => grant.permission === "work.review");
  if (review.some((grant) => grant.scopeKind === "organization")) return undefined;
  const units = review.filter((grant) => grant.scopeKind === "org_unit" && grant.scopeId).map((grant) => grant.scopeId!);
  const projects = review.filter((grant) => grant.scopeKind === "project" && grant.scopeId).map((grant) => grant.scopeId!);
  return or(
    units.length ? inArray(orgMemberships.orgUnitId, units) : undefined,
    projects.length ? sql`exists (select 1 from ${workSessionProjectLinks}
      where ${workSessionProjectLinks.workSessionId} = ${workSessions.id}
      and ${inArray(workSessionProjectLinks.projectId, projects)})` : undefined,
  ) ?? sql`false`;
}

/** Counts permission does not grant access to another member's narrative. */
export function workContentScope(membershipId: string, grants: readonly PermissionGrant[]) {
  const content = grants.filter((g) => g.permission === "work.view_full_scope").map((g) => ({ ...g, permission: "work.review" as const }));
  return or(eq(workSessions.membershipId, membershipId), content.length ? workReviewScope(content) ?? sql`true` : sql`false`)!;
}
export function visibleWorkText(field: SQLWrapper, membershipId: string, grants: readonly PermissionGrant[]) {
  return sql<string>`case when ${workContentScope(membershipId, grants)} then ${field} else '[按字段权限隐藏]' end`;
}
