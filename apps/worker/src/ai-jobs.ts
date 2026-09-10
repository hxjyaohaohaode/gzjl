import { and, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { resolveOrganizationAiProvider, type Database, type AiDeploymentConfig } from "@workbench/db";
import { aiJobs, aiReports, aiReportSources, notifications, outboxEvents } from "@workbench/db/schema";
import { AiProviderResponseError, maximumAiRequestTimeoutMs, requestAiChatCompletion } from "@workbench/shared";
import { buildAiSystemPrompt } from "./ai-prompt.js";

const aiOutputSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(10_000),
  highlights: z.array(z.string().max(1_000)).max(20).default([]),
  risks: z.array(z.string().max(1_000)).max(20).default([]),
  suggestions: z.array(z.string().max(1_000)).max(20).default([]),
});

function parseAiJson(content: string) {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return aiOutputSchema.parse(JSON.parse(cleaned));
}

/** A crashed process cannot leave a task running forever. Allow time for the
 * longest configurable request plus database finalization before recovering it. */
export async function recoverStaleAiJobs(db: Database, now = new Date()) {
  const cutoff = new Date(now.getTime() - maximumAiRequestTimeoutMs - 60_000);
  const stale = await db.select().from(aiJobs).where(and(eq(aiJobs.status, "running"), lt(aiJobs.startedAt, cutoff))).limit(50);
  for (const job of stale) {
    await db.transaction(async (tx) => {
      const failed = job.attempt >= job.maxAttempts;
      const [recovered] = await tx.update(aiJobs).set({ status: failed ? "failed" : "queued", startedAt: null, completedAt: failed ? now : null, errorSummary: failed ? "AI 工作进程中断且已达到尝试次数，可手动重试。" : "AI 工作进程中断，正在重新排队。" }).where(and(eq(aiJobs.id, job.id), eq(aiJobs.status, "running"), eq(aiJobs.attempt, job.attempt), lt(aiJobs.startedAt, cutoff))).returning({ id: aiJobs.id });
      if (recovered) await tx.insert(outboxEvents).values({ organizationId: job.organizationId, eventType: failed ? "ai.report.failed" : "ai.job.queued", entityType: "ai_job", entityId: job.id, entityVersion: job.attempt, payload: { jobId: job.id, recovered: true } });
    });
  }
}

export function createAiJobProcessor(db: Database, config: AiDeploymentConfig, notificationEventEnabled: (membershipId: string, category: string) => Promise<boolean>, providerFetch: typeof fetch = fetch) {
  return async function processAiJob(jobId: string): Promise<void> {
    const [job] = await db.select().from(aiJobs).where(eq(aiJobs.id, jobId)).limit(1);
    if (!job || job.status !== "queued") return;
    const attempt = job.attempt + 1;
    const [claimed] = await db.update(aiJobs).set({ status: "running", attempt, startedAt: new Date(), errorSummary: null }).where(and(eq(aiJobs.id, job.id), eq(aiJobs.status, "queued"))).returning({ id: aiJobs.id });
    if (!claimed) return;
    let maxAttempts = job.maxAttempts;
    try {
      const provider = await resolveOrganizationAiProvider(db, job.organizationId, config);
      if (!provider) throw new AiProviderResponseError("组织 AI 已停用或密钥不可用，请检查组织配置与 Worker 的加密密钥。");
      maxAttempts = provider.maxAttempts;
      // Take URL, key, model and options from the same current configuration.
      const [active] = await db.update(aiJobs).set({ model: provider.model, maxOutputTokens: provider.maxOutputTokens, maxAttempts }).where(and(eq(aiJobs.id, job.id), eq(aiJobs.status, "running"), eq(aiJobs.attempt, attempt))).returning({ id: aiJobs.id });
      if (!active) return;
      const payload = await requestAiChatCompletion(provider, [
        { role: "system", content: buildAiSystemPrompt(job.taskType) },
        { role: "user", content: JSON.stringify(job.sourceSummary) },
      ], providerFetch);
      const output = parseAiJson(payload.content);
      const sourceSummary = job.sourceSummary as { sources?: Array<{ entityType: string; entityId: string; entityVersion?: string; label: string }> };
      await db.transaction(async (tx) => {
        // Completion and cancellation race on the same conditional update. If
        // cancellation won while the provider request was in flight, discard
        // the paid response instead of resurrecting the cancelled job.
        const [completedJob] = await tx.update(aiJobs).set({ status: "completed", completedAt: new Date(), errorSummary: null, inputTokens: payload.usage?.prompt_tokens ?? null, outputTokens: payload.usage?.completion_tokens ?? null, providerRequestId: payload.id ?? null }).where(and(eq(aiJobs.id, job.id), eq(aiJobs.status, "running"), eq(aiJobs.attempt, attempt))).returning({ id: aiJobs.id });
        if (!completedJob) return;
        const [report] = await tx.insert(aiReports).values({ aiJobId: job.id, title: output.title, summary: output.summary, structuredOutput: output, sourceCount: sourceSummary.sources?.length ?? 0 }).onConflictDoNothing().returning();
        if (report && sourceSummary.sources?.length) {
          await tx.insert(aiReportSources).values(sourceSummary.sources.map((source) => ({ aiReportId: report.id, entityType: source.entityType, entityId: source.entityId, entityVersion: source.entityVersion, label: source.label }))).onConflictDoNothing();
        }
        await tx.insert(outboxEvents).values({ organizationId: job.organizationId, eventType: "ai.report.completed", entityType: "ai_job", entityId: job.id, entityVersion: attempt, payload: { jobId: job.id, reportId: report?.id ?? null } });
        if (await notificationEventEnabled(job.requestedBy, "ai_report_ready")) await tx.insert(notifications).values({ organizationId: job.organizationId, recipientMembershipId: job.requestedBy, category: "ai_report_ready", severity: "info", title: "AI 工作洞察已生成", body: output.title, actionUrl: report ? `/ai?report=${report.id}` : "/ai", dedupeKey: `ai-report:${job.id}` }).onConflictDoNothing();
      });
    } catch (error) {
      const finalFailure = attempt >= maxAttempts || (error instanceof AiProviderResponseError && !error.retryable);
      const errorSummary = (() => {
        if (error instanceof AiProviderResponseError) return error.message;
        if (error instanceof DOMException && error.name === "AbortError") {
          return "AI 供应商响应超时，请稍后重试。";
        }
        if (error instanceof Error && /^AI provider returned \d{3}$/.test(error.message)) {
          return error.message.replace("AI provider returned", "AI 供应商返回 HTTP");
        }
        if (error instanceof SyntaxError || error instanceof z.ZodError) {
          return "AI 供应商返回了不兼容的结构化内容。";
        }
        if (error instanceof Error && error.message === "AI provider returned no content") {
          return "AI 供应商未返回可用内容。";
        }
        return "AI 供应商暂时不可用，请检查组织配置或稍后重试。";
      })();
      const failureRecorded = await db.transaction(async (tx) => {
        const [updatedJob] = await tx.update(aiJobs).set({ status: finalFailure ? "failed" : "queued", errorSummary, completedAt: finalFailure ? new Date() : null }).where(and(eq(aiJobs.id, job.id), eq(aiJobs.status, "running"), eq(aiJobs.attempt, attempt))).returning({ id: aiJobs.id });
        if (!updatedJob) return false;
        if (finalFailure) {
          await tx.insert(outboxEvents).values({ organizationId: job.organizationId, eventType: "ai.report.failed", entityType: "ai_job", entityId: job.id, entityVersion: attempt, payload: { jobId: job.id } });
        }
        return true;
      });
      // A user cancellation is a successful terminal state, not a provider
      // failure that pg-boss should retry or notify about.
      if (!failureRecorded) return;
      if (finalFailure) {
        if (await notificationEventEnabled(job.requestedBy, "ai_report_failed")) await db.insert(notifications).values({ organizationId: job.organizationId, recipientMembershipId: job.requestedBy, category: "ai_report_failed", severity: "warning", title: "AI 报告生成失败", body: "事实数据未受影响，可以稍后重试生成报告。", actionUrl: "/ai", dedupeKey: `ai-report-failed:${job.id}` }).onConflictDoNothing();
      }
      // Queue logs must never serialize an upstream error's credential-bearing cause.
      // eslint-disable-next-line preserve-caught-error
      if (!finalFailure) throw new Error(errorSummary);
    }
  };
}
