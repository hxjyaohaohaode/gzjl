import type { AnalyticsActor } from "../analytics/service.js";
import { isAuthorized } from "../auth/authorization.js";

export function aiPermissionSnapshot(actor: AnalyticsActor, scope: "self" | "team") {
  return scope === "team" ? actor.grants.filter((grant) =>
    ["work.view_full_scope", "analytics.view_team"].includes(grant.permission),
  ) : [];
}

/** Old report snapshots and conversation context remain subject to current rights. */
export function canReadAiJob(actor: AnalyticsActor, job: { scope: unknown; sourceSummary: unknown }): boolean {
  const scope = (job.scope ?? {}) as { scope?: string; permissionSnapshot?: AnalyticsActor["grants"] };
  const source = (job.sourceSummary ?? {}) as { payroll?: unknown };
  if (scope.scope === "team" && !isAuthorized(actor.grants, "ai.team_analysis", { scopeKind: "organization" })) return false;
  // Legacy reports have no reconstructible field/scope snapshot. Only a
  // current organization-wide reader can safely cover their unknown range.
  if (scope.scope === "team" && !scope.permissionSnapshot && !actor.grants.some((grant) =>
    ["work.view_full_scope", "analytics.view_team"].includes(grant.permission) && grant.scopeKind === "organization",
  )) return false;
  if (source.payroll && !isAuthorized(actor.grants, "payroll.view_own", { scopeKind: "self", scopeId: actor.membershipId })) return false;
  return !scope.permissionSnapshot || scope.permissionSnapshot.every((grant) => isAuthorized(actor.grants, grant.permission, { scopeKind: grant.scopeKind, ...(grant.scopeId ? { scopeId: grant.scopeId } : {}) }));
}
