import "dotenv/config";

import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import pino from "pino";
import { z } from "zod";
import { createDatabase } from "@workbench/db";
import {
  aiJobs,
  aiReports,
  aiReportSources,
  notifications,
  outboxEvents,
  payPeriods,
  reminderRules,
  timerStates,
  workSessions,
} from "@workbench/db/schema";

const config = z.object({
  DATABASE_URL: z.url(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(5),
  DATABASE_SSL: z.stringbool().default(false),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  ZHIPU_API_KEY: z.string().min(1).optional(),
  ZHIPU_API_BASE_URL: z.url().default("https://open.bigmodel.cn/api/paas/v4"),
  ZHIPU_MODEL: z.string().min(1).default("glm-5.3-flash"),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
}).parse(process.env);

const logger = pino({ level: config.LOG_LEVEL, redact: ["DATABASE_URL", "apiKey", "token", "password", "req.headers.authorization"] });
const database = createDatabase(process.env);
const boss = new PgBoss({ connectionString: config.DATABASE_URL, schema: "pgboss", application_name: "workbench-worker" });
boss.on("error", (error: Error) => logger.error({ error }, "background queue error"));

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

async function dispatchAiJobs(): Promise<void> {
  const queued = await database.db.select({ id: aiJobs.id }).from(aiJobs).where(eq(aiJobs.status, "queued")).limit(50);
  for (const job of queued) {
    await boss.send("ai-generate-report", { jobId: job.id }, { singletonKey: job.id, retryLimit: 3, retryDelay: 30 });
  }
}

async function processAiJob(jobId: string): Promise<void> {
  const [job] = await database.db.select().from(aiJobs).where(eq(aiJobs.id, jobId)).limit(1);
  if (!job || job.status === "completed" || job.status === "cancelled") return;
  const attempt = job.attempt + 1;
  await database.db.update(aiJobs).set({ status: "running", attempt, startedAt: new Date(), errorSummary: null }).where(eq(aiJobs.id, job.id));
  try {
    if (!config.ZHIPU_API_KEY) throw new Error("ZHIPU_API_KEY is not configured");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.AI_REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${config.ZHIPU_API_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${config.ZHIPU_API_KEY}`, "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: job.model || config.ZHIPU_MODEL,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "你是一个自小便受相关专业教育且极其严谨极其认真极其注重细节与变化的资深工作分析助理。你只能依据输入的聚合事实生成报告，不能推测个人品格，不编造数据。强制要求输出严格 JSON：title、summary、highlights、risks、suggestions。风险与建议必须严苛准确清楚区分事实和解释。你必须以极其严苛乃至完全变态的高严苛程度查看用户的所有全部完整数据，深度分析所有相关数据之间的显性联系以及各类可能出现的隐性联系，深度整理分析对比预测用户完整的数据并提供非常专业且个性化的智能服务与建议，需要深度考虑用户可能出现的各类显性需求以及各类在未来的工作之中可能出现的隐性需求。严禁你凭空捏造任何不能通过已有数据分析到的人格性格工作等各方面的信息，你所有的输出内容都必须有完整的证据链且证据链的每一个证据节点都必须是真实的不能是你的幻觉，必须指出其完整的出处。强制要求你在输出之前对自己的内容进行不低于两轮的核对与检查，确保无误之后才能够输出。" },
            { role: "user", content: JSON.stringify(job.sourceSummary) },
          ],
        }),
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("AI provider returned no content");
    const output = parseAiJson(content);
    const sourceSummary = job.sourceSummary as { sources?: Array<{ entityType: string; entityId: string; entityVersion?: string; label: string }> };
    await database.db.transaction(async (tx) => {
      const [report] = await tx.insert(aiReports).values({ aiJobId: job.id, title: output.title, summary: output.summary, structuredOutput: output, sourceCount: sourceSummary.sources?.length ?? 0 }).onConflictDoNothing().returning();
      if (report && sourceSummary.sources?.length) {
        await tx.insert(aiReportSources).values(sourceSummary.sources.map((source) => ({ aiReportId: report.id, entityType: source.entityType, entityId: source.entityId, entityVersion: source.entityVersion, label: source.label }))).onConflictDoNothing();
      }
      await tx.update(aiJobs).set({ status: "completed", completedAt: new Date(), errorSummary: null }).where(eq(aiJobs.id, job.id));
      await tx.insert(notifications).values({ organizationId: job.organizationId, recipientMembershipId: job.requestedBy, category: "ai_report_ready", severity: "info", title: "AI 工作洞察已生成", body: output.title, actionUrl: report ? `/ai?report=${report.id}` : "/ai", dedupeKey: `ai-report:${job.id}` }).onConflictDoNothing();
    });
  } catch (error) {
    const finalFailure = attempt >= job.maxAttempts;
    const errorSummary = error instanceof Error ? error.message.slice(0, 2_000) : "Unknown AI error";
    await database.db.update(aiJobs).set({ status: finalFailure ? "failed" : "queued", errorSummary, completedAt: finalFailure ? new Date() : null }).where(eq(aiJobs.id, job.id));
    if (finalFailure) {
      await database.db.insert(notifications).values({ organizationId: job.organizationId, recipientMembershipId: job.requestedBy, category: "ai_report_failed", severity: "warning", title: "AI 报告生成失败", body: "事实数据未受影响，可以稍后重试生成报告。", actionUrl: "/ai", dedupeKey: `ai-report-failed:${job.id}` }).onConflictDoNothing();
    }
    throw error;
  }
}

async function evaluateReminders(): Promise<void> {
  const rules = await database.db.select().from(reminderRules).where(eq(reminderRules.enabled, true));
  const now = new Date();
  for (const rule of rules) {
    const conditions = rule.conditions as Record<string, unknown>;
    if (rule.category === "timer_long_running") {
      const threshold = typeof conditions.thresholdSeconds === "number" ? conditions.thresholdSeconds : 36_000;
      const timers = await database.db.select().from(timerStates).where(and(eq(timerStates.organizationId, rule.organizationId), eq(timerStates.status, "running"), lt(timerStates.startedAt, new Date(now.getTime() - threshold * 1_000))));
      for (const timer of timers) {
        await database.db.insert(notifications).values({ organizationId: rule.organizationId, recipientMembershipId: timer.membershipId, reminderRuleId: rule.id, category: rule.category, severity: rule.severity, title: "计时器已运行较长时间", body: "请确认计时器仍在记录真实工作，或及时暂停、休息、结束。", actionUrl: "/work", dedupeKey: `long-timer:${timer.id}:${Math.floor(now.getTime() / (rule.cooldownSeconds * 1_000))}`, validUntil: new Date(now.getTime() + rule.cooldownSeconds * 1_000) }).onConflictDoNothing();
      }
    }
    if (rule.category === "payroll_cutoff_pending") {
      const days = typeof conditions.daysBeforeCutoff === "number" ? conditions.daysBeforeCutoff : 3;
      const periods = await database.db.select().from(payPeriods).where(and(eq(payPeriods.organizationId, rule.organizationId), eq(payPeriods.status, "open"), gt(payPeriods.cutoffAt, now), lt(payPeriods.cutoffAt, new Date(now.getTime() + days * 86_400_000))));
      for (const period of periods) {
        const pending = await database.db.select({ membershipId: workSessions.membershipId }).from(workSessions).where(and(eq(workSessions.organizationId, rule.organizationId), eq(workSessions.approvalStatus, "pending_review"), lt(workSessions.startAt, period.endsAt), gt(workSessions.endAt, period.startsAt)));
        for (const item of pending) {
          await database.db.insert(notifications).values({ organizationId: rule.organizationId, recipientMembershipId: item.membershipId, reminderRuleId: rule.id, category: rule.category, severity: rule.severity, title: "结算截止前仍有待审工时", body: `${period.name} 即将截止，请联系审核人处理。`, actionUrl: "/work", dedupeKey: `payroll-cutoff:${period.id}:${item.membershipId}` }).onConflictDoNothing();
        }
      }
    }
  }
}

async function publishOutbox(): Promise<void> {
  const events = await database.db.select().from(outboxEvents).where(isNull(outboxEvents.publishedAt)).limit(100);
  for (const event of events) {
    if (event.eventType === "ai.job.queued") {
      await boss.send("ai-generate-report", { jobId: event.entityId }, { singletonKey: event.entityId, retryLimit: 3, retryDelay: 30 });
    }
    await database.db.update(outboxEvents).set({ publishedAt: new Date(), attempt: sql`${outboxEvents.attempt} + 1` }).where(eq(outboxEvents.id, event.id));
  }
}

await boss.start();
await boss.createQueue("ai-generate-report");
await boss.work<{ jobId: string }>("ai-generate-report", { batchSize: 1 }, async (jobs) => {
  for (const job of jobs) await processAiJob(job.data.jobId);
});
await Promise.all([dispatchAiJobs(), evaluateReminders(), publishOutbox()]);
const dispatchTimer = setInterval(() => void dispatchAiJobs().catch((error) => logger.error({ error }, "AI dispatch failed")), 15_000);
const reminderTimer = setInterval(() => void evaluateReminders().catch((error) => logger.error({ error }, "reminder evaluation failed")), 60_000);
const outboxTimer = setInterval(() => void publishOutbox().catch((error) => logger.error({ error }, "outbox publishing failed")), 5_000);
logger.info("background worker started");

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(dispatchTimer);
  clearInterval(reminderTimer);
  clearInterval(outboxTimer);
  logger.info({ signal }, "background worker shutdown started");
  await boss.stop({ graceful: true });
  await database.close();
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
