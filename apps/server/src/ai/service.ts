import { createHash } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";
import type { Database } from "@workbench/db";
import { aiJobs, aiReports, aiReportSources, outboxEvents } from "@workbench/db/schema";

import type { ServerConfig } from "../config.js";
import type { AnalyticsActor, AnalyticsService } from "../analytics/service.js";

export class AiUnavailableError extends Error {
  constructor() { super("AI 服务未启用或尚未配置 API Key；核心业务不受影响。") ; this.name = "AiUnavailableError"; }
}

export class AiService {
  constructor(private readonly db: Database, private readonly analytics: AnalyticsService, private readonly config: ServerConfig) {}

  async requestReport(actor: AnalyticsActor, scope: "self" | "team", from: Date, to: Date) {
    if (!this.config.AI_ENABLED || !this.config.ZHIPU_API_KEY) throw new AiUnavailableError();
    const facts = await this.analytics.summary(
      scope === "self"
        ? { ...actor, grants: actor.grants.filter((grant) => grant.scopeKind === "self") }
        : actor,
      from,
      to,
    );
    const sourceSummary = {
      scope,
      range: facts.range,
      totals: facts.totals,
      byDay: facts.byDay,
      byProject: facts.byProject,
      byMember: scope === "team" ? facts.byMember : [],
      sources: facts.byProject
        .filter((item) => item.projectId)
        .map((item) => ({ entityType: "project", entityId: item.projectId, label: item.projectName })),
    };
    const inputHash = createHash("sha256")
      .update(JSON.stringify({ sourceSummary, model: this.config.ZHIPU_MODEL, template: "weekly-v1" }))
      .digest("hex");
    const [existing] = await this.db.select().from(aiJobs).where(and(eq(aiJobs.organizationId, actor.organizationId), eq(aiJobs.taskType, "weekly_report"), eq(aiJobs.inputHash, inputHash))).limit(1);
    if (existing) return existing;
    return this.db.transaction(async (tx) => {
      const [job] = await tx.insert(aiJobs).values({ organizationId: actor.organizationId, requestedBy: actor.membershipId, scope: { scope, from, to }, taskType: "weekly_report", provider: "zhipu", model: this.config.ZHIPU_MODEL, promptTemplateVersion: "weekly-v1", inputHash, sourceSummary, maxAttempts: this.config.AI_MAX_RETRIES }).returning();
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
}
