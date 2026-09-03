import { createHash } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "@workbench/db";
import { aiJobs, aiReports, aiReportSources, outboxEvents } from "@workbench/db/schema";

import type { AnalyticsActor, AnalyticsService } from "../analytics/service.js";
import type { AiConfigurationService } from "./configuration.js";

export class AiUnavailableError extends Error {
  constructor() { super("AI 服务未启用或尚未配置 API Key；核心业务不受影响。") ; this.name = "AiUnavailableError"; }
}

export class AiService {
  constructor(
    private readonly db: Database,
    private readonly analytics: AnalyticsService,
    private readonly configuration: AiConfigurationService,
  ) {}

  async requestReport(actor: AnalyticsActor, scope: "self" | "team", from: Date, to: Date) {
    const provider = await this.configuration.resolveEffective(actor.organizationId);
    if (!provider) throw new AiUnavailableError();
    const facts = await this.analytics.summary(
      scope === "self"
        ? { ...actor, grants: actor.grants.filter((grant) => grant.scopeKind === "self") }
        : actor,
      from,
      to,
    );
    const sourceSummary = this.limitSourceSummary({
      scope,
      range: facts.range,
      totals: facts.totals,
      byDay: facts.byDay,
      byProject: facts.byProject,
      byMember: scope === "team" ? facts.byMember : [],
      sources: facts.byProject
        .filter((item) => item.projectId)
        .map((item) => ({ entityType: "project", entityId: item.projectId, label: item.projectName })),
    });
    const inputHash = createHash("sha256")
      // Provider/model/output-cap changes can materially affect a report even
      // when the business facts are unchanged.  Keep those non-secret inputs
      // in the de-duplication key so an Owner's configuration change cannot
      // accidentally return an old report from a different provider.
      .update(
        JSON.stringify({
          sourceSummary,
          // Reports are returned only to the requesting member.  Including
          // that member in the key prevents two employees with coincidentally
          // identical (for example, empty) self summaries from reusing an
          // inaccessible job that the list/detail authorization would hide.
          requesterMembershipId: actor.membershipId,
          provider: {
            source: provider.source,
            baseUrl: provider.baseUrl,
            model: provider.model,
            maxOutputTokens: provider.maxOutputTokens,
          },
          template: "weekly-v2",
        }),
      )
      .digest("hex");
    return this.db.transaction(async (tx) => {
      // A transaction-scoped PostgreSQL lock makes de-duplication and quota
      // accounting atomic for one organization. Without it, simultaneous
      // clicks from multiple devices could all observe the same final slot.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${actor.organizationId}))`,
      );
      const [existing] = await tx
        .select()
        .from(aiJobs)
        .where(
          and(
            eq(aiJobs.organizationId, actor.organizationId),
            eq(aiJobs.taskType, "weekly_report"),
            eq(aiJobs.inputHash, inputHash),
          ),
        )
        .limit(1);
      if (existing) return existing;
      await this.configuration.assertQuota(actor.organizationId, tx);
      const [job] = await tx.insert(aiJobs).values({ organizationId: actor.organizationId, requestedBy: actor.membershipId, scope: { scope, from, to }, taskType: "weekly_report", provider: "openai_compatible", model: provider.model, promptTemplateVersion: "weekly-v2", inputHash, sourceSummary, maxAttempts: provider.maxAttempts, maxOutputTokens: provider.maxOutputTokens }).returning();
      if (!job) throw new Error("Failed to create AI job");
      await tx.insert(outboxEvents).values({ organizationId: actor.organizationId, eventType: "ai.job.queued", entityType: "ai_job", entityId: job.id, entityVersion: 1, payload: { jobId: job.id } });
      return job;
    });
  }

  async list(actor: { organizationId: string; membershipId: string }) {
    return this.db.select({ job: aiJobs, report: aiReports }).from(aiJobs).leftJoin(aiReports, eq(aiReports.aiJobId, aiJobs.id)).where(and(eq(aiJobs.organizationId, actor.organizationId), eq(aiJobs.requestedBy, actor.membershipId))).orderBy(desc(aiJobs.queuedAt)).limit(50);
  }

  async detail(actor: { organizationId: string; membershipId: string }, reportId: string) {
    const [record] = await this.db.select({ job: aiJobs, report: aiReports }).from(aiReports).innerJoin(aiJobs, eq(aiJobs.id, aiReports.aiJobId)).where(and(eq(aiReports.id, reportId), eq(aiJobs.organizationId, actor.organizationId), eq(aiJobs.requestedBy, actor.membershipId))).limit(1);
    if (!record) return null;
    const sources = await this.db.select().from(aiReportSources).where(eq(aiReportSources.aiReportId, reportId));
    return { ...record, sources };
  }

  /**
   * The AI receives already-authorized aggregates only. Hard limits protect
   * both provider cost and report latency without altering the fact store.
   */
  private limitSourceSummary<T extends Record<string, unknown>>(summary: T): T {
    const cap = <V>(value: V, maximum: number): V =>
      Array.isArray(value) && value.length > maximum
        ? (value.slice(0, maximum) as V)
        : value;
    let bounded = {
      ...summary,
      byDay: cap(summary.byDay, 366),
      byProject: cap(summary.byProject, 200),
      byMember: cap(summary.byMember, 200),
      sources: cap(summary.sources, 200),
    } as T;
    if (JSON.stringify(bounded).length <= 48_000) return bounded;
    bounded = {
      ...summary,
      byDay: cap(summary.byDay, 90),
      byProject: cap(summary.byProject, 80),
      byMember: cap(summary.byMember, 80),
      sources: cap(summary.sources, 80),
      inputTruncated: true,
    } as T;
    return bounded;
  }
}
