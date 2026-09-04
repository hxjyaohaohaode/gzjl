import "dotenv/config";

import { and, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import pino from "pino";
import webPush from "web-push";
import { z } from "zod";
import {
  createDatabase,
  decryptScopedSecret,
  decryptSecret,
  SecretCipherError,
} from "@workbench/db";
import {
  aiJobs,
  aiReports,
  aiReportSources,
  notificationDeliveries,
  notifications,
  notificationPreferences,
  organizationOwners,
  organizationAiSettings,
  orgMemberships,
  outboxEvents,
  payPeriods,
  projects,
  projectNodeAssignees,
  projectNodes,
  pushSubscriptions,
  reminderRules,
  timerStates,
  workSessions,
} from "@workbench/db/schema";

import {
  isPermanentWebPushFailure,
  isWithinQuietHours,
  pushRetryDelayMs,
  webPushStatusCode,
} from "./push.js";

const config = z.object({
  DATABASE_URL: z.url(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(5),
  DATABASE_SSL: z.stringbool().default(false),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  ZHIPU_API_KEY: z.string().min(1).optional(),
  ZHIPU_API_BASE_URL: z.url().default("https://open.bigmodel.cn/api/paas/v4"),
  ZHIPU_MODEL: z.string().min(1).default("glm-4.7-flash"),
  AI_ENABLED: z.stringbool().default(false),
  AI_CONFIG_ENCRYPTION_KEY: z.string().min(32).optional(),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(180_000).default(60_000),
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_SUBJECT: z.string().min(1).optional(),
  PUSH_SUBSCRIPTION_ENCRYPTION_KEY: z.string().min(32).optional(),
}).superRefine((value, context) => {
  const configuredVapidValues = [
    value.VAPID_PUBLIC_KEY,
    value.VAPID_PRIVATE_KEY,
    value.VAPID_SUBJECT,
  ].filter(Boolean).length;
  if (
    configuredVapidValues !== 0 &&
    (configuredVapidValues !== 3 || !value.PUSH_SUBSCRIPTION_ENCRYPTION_KEY)
  ) {
    context.addIssue({
      code: "custom",
      path: ["VAPID_PUBLIC_KEY"],
      message: "浏览器推送需要完整 VAPID 配置与订阅加密密钥。",
    });
  }
  if (value.VAPID_SUBJECT && !/^(mailto:|https:\/\/)/.test(value.VAPID_SUBJECT)) {
    context.addIssue({
      code: "custom",
      path: ["VAPID_SUBJECT"],
      message: "VAPID_SUBJECT 必须是 mailto: 或 HTTPS 地址。",
    });
  }
}).parse(process.env);

const logger = pino({ level: config.LOG_LEVEL, redact: ["DATABASE_URL", "apiKey", "token", "password", "req.headers.authorization"] });
const database = createDatabase(process.env);
const boss = new PgBoss({ connectionString: config.DATABASE_URL, schema: "pgboss", application_name: "workbench-worker" });
boss.on("error", (error: Error) => logger.error({ error }, "background queue error"));

const pushReady = Boolean(
  config.VAPID_PUBLIC_KEY &&
    config.VAPID_PRIVATE_KEY &&
    config.VAPID_SUBJECT &&
    config.PUSH_SUBSCRIPTION_ENCRYPTION_KEY,
);
if (pushReady) {
  webPush.setVapidDetails(
    config.VAPID_SUBJECT!,
    config.VAPID_PUBLIC_KEY!,
    config.VAPID_PRIVATE_KEY!,
  );
}

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

async function resolveAiProvider(organizationId: string) {
  const [settings] = await database.db
    .select()
    .from(organizationAiSettings)
    .where(eq(organizationAiSettings.organizationId, organizationId))
    .limit(1);
  if (settings) {
    if (!settings.enabled || !settings.apiKeyCiphertext) {
      throw new Error("Organization AI is disabled or has no configured key");
    }
    if (!config.AI_CONFIG_ENCRYPTION_KEY) {
      throw new Error("AI_CONFIG_ENCRYPTION_KEY is not configured in the worker");
    }
    try {
      return {
        baseUrl: settings.baseUrl.replace(/\/$/, ""),
        apiKey: decryptSecret(
          settings.apiKeyCiphertext,
          config.AI_CONFIG_ENCRYPTION_KEY,
        ),
        model: settings.model,
      };
    } catch (error) {
      if (error instanceof SecretCipherError) {
        throw new Error("Organization AI key cannot be decrypted", {
          cause: error,
        });
      }
      throw error;
    }
  }
  if (!config.AI_ENABLED || !config.ZHIPU_API_KEY) {
    throw new Error("No organization or deployment-default AI key is configured");
  }
  return {
    baseUrl: config.ZHIPU_API_BASE_URL.replace(/\/$/, ""),
    apiKey: config.ZHIPU_API_KEY,
    model: config.ZHIPU_MODEL,
  };
}

async function notificationEventEnabled(membershipId: string, category: string): Promise<boolean> {
  const [preference] = await database.db.select().from(notificationPreferences).where(and(eq(notificationPreferences.membershipId, membershipId), eq(notificationPreferences.category, category))).limit(1);
  if (!preference) return true;
  if (preference.mutedUntil && preference.mutedUntil > new Date()) return false;
  return preference.inAppEnabled || preference.pushEnabled;
}

const defaultReminderRules = [
  { category: "timer_long_running", name: "系统默认", severity: "warning" as const, cooldownSeconds: 10_800, conditions: { thresholdSeconds: 36_000 } },
  { category: "work_overlap", name: "系统默认", severity: "warning" as const, cooldownSeconds: 86_400, conditions: { lookbackDays: 7 } },
  { category: "continuous_work_long", name: "系统默认", severity: "info" as const, cooldownSeconds: 86_400, conditions: { thresholdSeconds: 21_600 } },
  { category: "short_break", name: "系统默认", severity: "info" as const, cooldownSeconds: 86_400, conditions: { minimumGapSeconds: 600, precedingWorkSeconds: 10_800 } },
  { category: "project_due_soon", name: "系统默认", severity: "warning" as const, cooldownSeconds: 86_400, conditions: { daysBeforeDue: 3 } },
  { category: "blocked_node_aging", name: "系统默认", severity: "warning" as const, cooldownSeconds: 86_400, conditions: { agingDays: 7 } },
  { category: "approval_returned", name: "系统默认", severity: "warning" as const, cooldownSeconds: 86_400, conditions: { lookbackDays: 7 } },
  { category: "duration_baseline_change", name: "系统默认", severity: "info" as const, cooldownSeconds: 86_400, conditions: { lowerRatio: 0.5, upperRatio: 2, minimumBaselineSeconds: 7_200 } },
  { category: "forgotten_work", name: "系统默认（按需启用）", severity: "info" as const, cooldownSeconds: 86_400, conditions: { inactivityHours: 72 }, enabled: false },
  { category: "payroll_cutoff_pending", name: "系统默认", severity: "warning" as const, cooldownSeconds: 86_400, conditions: { daysBeforeCutoff: 3 } },
];

async function ensureDefaultReminderRules(): Promise<void> {
  const owners = await database.db.select().from(organizationOwners);
  for (const owner of owners) {
    await database.db.insert(reminderRules).values(defaultReminderRules.map((rule) => ({
      organizationId: owner.organizationId,
      createdBy: owner.membershipId,
      channels: ["in_app"],
      ...rule,
    }))).onConflictDoNothing();
  }
}

async function createRuleNotification(input: {
  rule: typeof reminderRules.$inferSelect;
  recipientMembershipId: string;
  title: string;
  body: string;
  actionUrl: string;
  dedupeKey: string;
  validUntil?: Date;
}): Promise<void> {
  if (!await notificationEventEnabled(input.recipientMembershipId, input.rule.category)) return;
  await database.db.insert(notifications).values({
    organizationId: input.rule.organizationId,
    recipientMembershipId: input.recipientMembershipId,
    reminderRuleId: input.rule.id,
    category: input.rule.category,
    severity: input.rule.severity,
    title: input.title,
    body: input.body,
    actionUrl: input.actionUrl,
    dedupeKey: input.dedupeKey,
    validUntil: input.validUntil ?? new Date(Date.now() + input.rule.cooldownSeconds * 1_000),
  }).onConflictDoNothing();
}

async function enqueueAiJob(jobId: string): Promise<void> {
  const [job] = await database.db
    .select({
      id: aiJobs.id,
      status: aiJobs.status,
      maxAttempts: aiJobs.maxAttempts,
    })
    .from(aiJobs)
    .where(eq(aiJobs.id, jobId))
    .limit(1);
  if (!job || job.status === "completed" || job.status === "cancelled") return;
  await boss.send(
    "ai-generate-report",
    { jobId: job.id },
    {
      singletonKey: job.id,
      retryLimit: Math.max(0, job.maxAttempts - 1),
      retryDelay: 30,
    },
  );
}

async function dispatchAiJobs(): Promise<void> {
  const queued = await database.db
    .select({ id: aiJobs.id })
    .from(aiJobs)
    .where(eq(aiJobs.status, "queued"))
    .limit(50);
  for (const job of queued) {
    await enqueueAiJob(job.id);
  }
}

async function processAiJob(jobId: string): Promise<void> {
  const [job] = await database.db.select().from(aiJobs).where(eq(aiJobs.id, jobId)).limit(1);
  if (!job || job.status === "completed" || job.status === "cancelled") return;
  const attempt = job.attempt + 1;
  await database.db.update(aiJobs).set({ status: "running", attempt, startedAt: new Date(), errorSummary: null }).where(eq(aiJobs.id, job.id));
  try {
    const provider = await resolveAiProvider(job.organizationId);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.AI_REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${provider.apiKey}`, "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: job.model || provider.model,
          temperature: 0.2,
          max_tokens: job.maxOutputTokens,
          // An Owner may choose any OpenAI-compatible provider. `response_format`
          // is not implemented consistently across that ecosystem, so use the
          // portable strict prompt below and validate the returned JSON locally
          // instead of turning a provider dialect difference into a paid 400.
          messages: [
            { role: "system", content: "你是工作事实分析助手。只能依据输入 JSON 的已授权聚合事实，不能编造数据、推测人格或把建议表述成事实。只输出一个可解析的 JSON 对象，不能输出 Markdown、代码围栏或对象外文字。对象必须且只能包含 title、summary、highlights、risks、suggestions；每一条风险和建议都应说明所依据的可见事实；内容简洁、可执行、避免重复。" },
            { role: "user", content: JSON.stringify(job.sourceSummary) },
          ],
        }),
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
    const payload = (await response.json()) as {
      id?: string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("AI provider returned no content");
    const output = parseAiJson(content);
    const sourceSummary = job.sourceSummary as { sources?: Array<{ entityType: string; entityId: string; entityVersion?: string; label: string }> };
    await database.db.transaction(async (tx) => {
      // Completion and cancellation race on the same conditional update. If
      // cancellation won while the provider request was in flight, discard
      // the paid response instead of resurrecting the cancelled job.
      const [completedJob] = await tx.update(aiJobs).set({ status: "completed", completedAt: new Date(), errorSummary: null, inputTokens: payload.usage?.prompt_tokens ?? null, outputTokens: payload.usage?.completion_tokens ?? null, providerRequestId: payload.id ?? null }).where(and(eq(aiJobs.id, job.id), eq(aiJobs.status, "running"))).returning({ id: aiJobs.id });
      if (!completedJob) return;
      const [report] = await tx.insert(aiReports).values({ aiJobId: job.id, title: output.title, summary: output.summary, structuredOutput: output, sourceCount: sourceSummary.sources?.length ?? 0 }).onConflictDoNothing().returning();
      if (report && sourceSummary.sources?.length) {
        await tx.insert(aiReportSources).values(sourceSummary.sources.map((source) => ({ aiReportId: report.id, entityType: source.entityType, entityId: source.entityId, entityVersion: source.entityVersion, label: source.label }))).onConflictDoNothing();
      }
      await tx.insert(outboxEvents).values({ organizationId: job.organizationId, eventType: "ai.report.completed", entityType: "ai_job", entityId: job.id, entityVersion: attempt, payload: { jobId: job.id, reportId: report?.id ?? null } });
      if (await notificationEventEnabled(job.requestedBy, "ai_report_ready")) await tx.insert(notifications).values({ organizationId: job.organizationId, recipientMembershipId: job.requestedBy, category: "ai_report_ready", severity: "info", title: "AI 工作洞察已生成", body: output.title, actionUrl: report ? `/ai?report=${report.id}` : "/ai", dedupeKey: `ai-report:${job.id}` }).onConflictDoNothing();
    });
  } catch (error) {
    const finalFailure = attempt >= job.maxAttempts;
    const errorSummary = error instanceof Error ? error.message.slice(0, 2_000) : "Unknown AI error";
    const failureRecorded = await database.db.transaction(async (tx) => {
      const [updatedJob] = await tx.update(aiJobs).set({ status: finalFailure ? "failed" : "queued", errorSummary, completedAt: finalFailure ? new Date() : null }).where(and(eq(aiJobs.id, job.id), eq(aiJobs.status, "running"))).returning({ id: aiJobs.id });
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
      if (await notificationEventEnabled(job.requestedBy, "ai_report_failed")) await database.db.insert(notifications).values({ organizationId: job.organizationId, recipientMembershipId: job.requestedBy, category: "ai_report_failed", severity: "warning", title: "AI 报告生成失败", body: "事实数据未受影响，可以稍后重试生成报告。", actionUrl: "/ai", dedupeKey: `ai-report-failed:${job.id}` }).onConflictDoNothing();
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
        if (await notificationEventEnabled(timer.membershipId, rule.category)) await database.db.insert(notifications).values({ organizationId: rule.organizationId, recipientMembershipId: timer.membershipId, reminderRuleId: rule.id, category: rule.category, severity: rule.severity, title: "计时器已运行较长时间", body: "请确认计时器仍在记录真实工作，或及时暂停、休息、结束。", actionUrl: "/work", dedupeKey: `long-timer:${timer.id}:${Math.floor(now.getTime() / (rule.cooldownSeconds * 1_000))}`, validUntil: new Date(now.getTime() + rule.cooldownSeconds * 1_000) }).onConflictDoNothing();
      }
    }
    if (rule.category === "payroll_cutoff_pending") {
      const days = typeof conditions.daysBeforeCutoff === "number" ? conditions.daysBeforeCutoff : 3;
      const periods = await database.db.select().from(payPeriods).where(and(eq(payPeriods.organizationId, rule.organizationId), eq(payPeriods.status, "open"), gt(payPeriods.cutoffAt, now), lt(payPeriods.cutoffAt, new Date(now.getTime() + days * 86_400_000))));
      for (const period of periods) {
        const pending = await database.db
          .select({ membershipId: workSessions.membershipId })
          .from(workSessions)
          .where(
            and(
              eq(workSessions.organizationId, rule.organizationId),
              eq(workSessions.recordKind, "fact"),
              eq(workSessions.approvalStatus, "pending_review"),
              lt(workSessions.startAt, period.endsAt),
              gt(workSessions.endAt, period.startsAt),
            ),
          );
        for (const item of pending) {
          if (await notificationEventEnabled(item.membershipId, rule.category)) await database.db.insert(notifications).values({ organizationId: rule.organizationId, recipientMembershipId: item.membershipId, reminderRuleId: rule.id, category: rule.category, severity: rule.severity, title: "结算截止前仍有待审工时", body: `${period.name} 即将截止，请联系审核人处理。`, actionUrl: "/work", dedupeKey: `payroll-cutoff:${period.id}:${item.membershipId}` }).onConflictDoNothing();
        }
      }
    }
    if (rule.category === "continuous_work_long") {
      const threshold = typeof conditions.thresholdSeconds === "number" ? conditions.thresholdSeconds : 21_600;
      const sessions = await database.db.select().from(workSessions).where(and(eq(workSessions.organizationId, rule.organizationId), eq(workSessions.recordKind, "fact"), isNull(workSessions.deletedAt), gte(workSessions.startAt, new Date(now.getTime() - 7 * 86_400_000))));
      for (const session of sessions.filter((item) => item.netSeconds >= threshold)) {
        await createRuleNotification({ rule, recipientMembershipId: session.membershipId, title: "连续工作时间较长", body: "这段记录持续时间较长，请确认记录准确，并按实际情况安排休息。", actionUrl: `/work?session=${session.id}`, dedupeKey: `continuous-work:${session.id}:${session.version}` });
      }
    }
    if (rule.category === "work_overlap" || rule.category === "short_break") {
      const lookbackDays = typeof conditions.lookbackDays === "number" ? conditions.lookbackDays : 7;
      const sessions = await database.db.select().from(workSessions).where(and(eq(workSessions.organizationId, rule.organizationId), eq(workSessions.recordKind, "fact"), isNull(workSessions.deletedAt), gte(workSessions.startAt, new Date(now.getTime() - lookbackDays * 86_400_000)))).orderBy(workSessions.membershipId, workSessions.startAt);
      const previousByMember = new Map<string, typeof workSessions.$inferSelect>();
      for (const session of sessions) {
        const previous = previousByMember.get(session.membershipId);
        if (previous && rule.category === "work_overlap" && session.startAt < previous.endAt && !session.parallelWork && !previous.parallelWork) {
          await createRuleNotification({ rule, recipientMembershipId: session.membershipId, title: "工作记录可能重叠", body: "发现两段非并行记录的时间范围相交，请确认并修正后再提交。", actionUrl: `/work?session=${session.id}`, dedupeKey: `work-overlap:${previous.id}:${session.id}` });
        }
        if (previous && rule.category === "short_break") {
          const minimumGap = typeof conditions.minimumGapSeconds === "number" ? conditions.minimumGapSeconds : 600;
          const precedingWork = typeof conditions.precedingWorkSeconds === "number" ? conditions.precedingWorkSeconds : 10_800;
          const gapSeconds = Math.floor((session.startAt.getTime() - previous.endAt.getTime()) / 1_000);
          if (previous.netSeconds >= precedingWork && gapSeconds >= 0 && gapSeconds < minimumGap) {
            await createRuleNotification({ rule, recipientMembershipId: session.membershipId, title: "两段较长工作间隔较短", body: "基于近期记录，两段工作之间的间隔较短；请确认时间是否准确。", actionUrl: `/work?session=${session.id}`, dedupeKey: `short-break:${previous.id}:${session.id}` });
          }
        }
        if (!previous || session.endAt > previous.endAt) previousByMember.set(session.membershipId, session);
      }
    }
    if (rule.category === "project_due_soon" || rule.category === "blocked_node_aging") {
      const days = rule.category === "project_due_soon"
        ? (typeof conditions.daysBeforeDue === "number" ? conditions.daysBeforeDue : 3)
        : (typeof conditions.agingDays === "number" ? conditions.agingDays : 7);
      const assigned = await database.db.select({ node: projectNodes, membershipId: projectNodeAssignees.membershipId }).from(projectNodes).innerJoin(projects, eq(projects.id, projectNodes.projectId)).innerJoin(projectNodeAssignees, eq(projectNodeAssignees.nodeId, projectNodes.id)).where(and(eq(projects.organizationId, rule.organizationId), isNull(projects.deletedAt), isNull(projectNodes.deletedAt)));
      for (const item of assigned) {
        if (rule.category === "project_due_soon" && item.node.dueAt && item.node.dueAt >= now && item.node.dueAt < new Date(now.getTime() + days * 86_400_000) && item.node.status !== "completed" && item.node.status !== "cancelled") {
          await createRuleNotification({ rule, recipientMembershipId: item.membershipId, title: "项目节点临近截止时间", body: `“${item.node.title}”即将到期，请确认真实进度或及时更新计划。`, actionUrl: `/projects/${item.node.projectId}`, dedupeKey: `project-due:${item.node.id}:${item.node.dueAt.toISOString()}` });
        }
        if (rule.category === "blocked_node_aging" && item.node.status === "blocked" && item.node.updatedAt < new Date(now.getTime() - days * 86_400_000)) {
          await createRuleNotification({ rule, recipientMembershipId: item.membershipId, title: "项目阻塞持续时间较长", body: `“${item.node.title}”仍处于阻塞状态，请确认责任人、依赖与下一步。`, actionUrl: `/projects/${item.node.projectId}`, dedupeKey: `blocked-aging:${item.node.id}:${item.node.version}` });
        }
      }
    }
    if (rule.category === "approval_returned") {
      const lookbackDays = typeof conditions.lookbackDays === "number" ? conditions.lookbackDays : 7;
      const returned = await database.db.select().from(workSessions).where(and(eq(workSessions.organizationId, rule.organizationId), eq(workSessions.recordKind, "fact"), eq(workSessions.approvalStatus, "returned"), isNull(workSessions.deletedAt), gte(workSessions.updatedAt, new Date(now.getTime() - lookbackDays * 86_400_000))));
      for (const session of returned) {
        await createRuleNotification({ rule, recipientMembershipId: session.membershipId, title: "工作记录已退回", body: "记录需要补充或修正，请查看审核意见后重新提交。", actionUrl: `/work?session=${session.id}`, dedupeKey: `approval-returned:${session.id}:${session.version}` });
      }
    }
    if (rule.category === "duration_baseline_change") {
      const lower = typeof conditions.lowerRatio === "number" ? conditions.lowerRatio : 0.5;
      const upper = typeof conditions.upperRatio === "number" ? conditions.upperRatio : 2;
      const minimumBaseline = typeof conditions.minimumBaselineSeconds === "number" ? conditions.minimumBaselineSeconds : 7_200;
      const boundary = new Date(now.getTime() - 7 * 86_400_000);
      const sessions = await database.db.select().from(workSessions).where(and(eq(workSessions.organizationId, rule.organizationId), eq(workSessions.recordKind, "fact"), isNull(workSessions.deletedAt), gte(workSessions.startAt, new Date(now.getTime() - 35 * 86_400_000))));
      const totals = new Map<string, { current: number; baseline: number }>();
      for (const session of sessions) {
        const total = totals.get(session.membershipId) ?? { current: 0, baseline: 0 };
        if (session.startAt >= boundary) total.current += session.netSeconds;
        else total.baseline += session.netSeconds / 4;
        totals.set(session.membershipId, total);
      }
      for (const [membershipId, total] of totals) {
        if (total.baseline < minimumBaseline) continue;
        const ratio = total.current / total.baseline;
        if (ratio >= lower && ratio <= upper) continue;
        await createRuleNotification({ rule, recipientMembershipId: membershipId, title: "近期记录时长变化较明显", body: "基于最近一周与此前四周的记录，时长出现明显变化；请确认是否存在漏记、补录或项目节奏变化。", actionUrl: "/analytics", dedupeKey: `duration-baseline:${membershipId}:${now.toISOString().slice(0, 10)}` });
      }
    }
    if (rule.category === "forgotten_work") {
      const inactivityHours = typeof conditions.inactivityHours === "number" ? conditions.inactivityHours : 72;
      const cutoff = new Date(now.getTime() - inactivityHours * 3_600_000);
      const members = await database.db.select({ id: orgMemberships.id, joinedAt: orgMemberships.joinedAt }).from(orgMemberships).where(and(eq(orgMemberships.organizationId, rule.organizationId), eq(orgMemberships.status, "active")));
      const recent = await database.db.select({ membershipId: workSessions.membershipId }).from(workSessions).where(and(eq(workSessions.organizationId, rule.organizationId), eq(workSessions.recordKind, "fact"), isNull(workSessions.deletedAt), gte(workSessions.endAt, cutoff)));
      const active = new Set(recent.map((item) => item.membershipId));
      for (const member of members.filter((item) => (!item.joinedAt || item.joinedAt < cutoff) && !active.has(item.id))) {
        await createRuleNotification({ rule, recipientMembershipId: member.id, title: "近期可能有工作尚未记录", body: "近期没有看到新的工作记录；如确有工作，请确认是否需要补录。", actionUrl: "/work", dedupeKey: `forgotten-work:${member.id}:${now.toISOString().slice(0, 10)}` });
      }
    }
  }
}

async function schedulePushDeliveries(): Promise<void> {
  if (!pushReady) return;
  const now = new Date();
  const preferences = await database.db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.pushEnabled, true));
  const eligiblePreferences = preferences.filter(
    (preference) =>
      (!preference.mutedUntil || preference.mutedUntil <= now) &&
      !isWithinQuietHours(preference.quietHours, now),
  );
  const membershipIds = [
    ...new Set(eligiblePreferences.map((preference) => preference.membershipId)),
  ];
  if (membershipIds.length === 0) return;

  const [subscriptions, notificationItems] = await Promise.all([
    database.db
      .select()
      .from(pushSubscriptions)
      .where(
        and(
          inArray(pushSubscriptions.membershipId, membershipIds),
          isNull(pushSubscriptions.disabledAt),
          or(
            isNull(pushSubscriptions.expiresAt),
            gt(pushSubscriptions.expiresAt, now),
          ),
        ),
      ),
    database.db
      .select()
      .from(notifications)
      .where(
        and(
          inArray(notifications.recipientMembershipId, membershipIds),
          gte(notifications.createdAt, new Date(now.getTime() - 7 * 86_400_000)),
          or(
            isNull(notifications.validUntil),
            gt(notifications.validUntil, now),
          ),
        ),
      ),
  ]);
  const preferenceKeys = new Set(
    eligiblePreferences.map(
      (preference) => `${preference.membershipId}:${preference.category}`,
    ),
  );
  const subscriptionsByMember = new Map<
    string,
    (typeof pushSubscriptions.$inferSelect)[]
  >();
  for (const subscription of subscriptions) {
    const current = subscriptionsByMember.get(subscription.membershipId) ?? [];
    current.push(subscription);
    subscriptionsByMember.set(subscription.membershipId, current);
  }
  const rows = notificationItems.flatMap((notification) => {
    if (
      !preferenceKeys.has(
        `${notification.recipientMembershipId}:${notification.category}`,
      )
    ) {
      return [];
    }
    return (subscriptionsByMember.get(notification.recipientMembershipId) ?? []).map(
      (subscription) => ({
        notificationId: notification.id,
        pushSubscriptionId: subscription.id,
        channel: "web_push" as const,
      }),
    );
  });
  for (let offset = 0; offset < rows.length; offset += 500) {
    await database.db
      .insert(notificationDeliveries)
      .values(rows.slice(offset, offset + 500))
      .onConflictDoNothing();
  }
}

async function dispatchPushDeliveries(): Promise<void> {
  if (!pushReady) return;
  const now = new Date();
  const candidates = await database.db
    .select({
      delivery: notificationDeliveries,
      notification: notifications,
      subscription: pushSubscriptions,
    })
    .from(notificationDeliveries)
    .innerJoin(
      notifications,
      eq(notifications.id, notificationDeliveries.notificationId),
    )
    .innerJoin(
      pushSubscriptions,
      eq(pushSubscriptions.id, notificationDeliveries.pushSubscriptionId),
    )
    .where(
      and(
        eq(notificationDeliveries.channel, "web_push"),
        or(
          eq(notificationDeliveries.status, "queued"),
          eq(notificationDeliveries.status, "failed"),
        ),
        lte(notificationDeliveries.nextAttemptAt, now),
        lt(notificationDeliveries.attempts, 5),
        isNull(pushSubscriptions.disabledAt),
        or(
          isNull(pushSubscriptions.expiresAt),
          gt(pushSubscriptions.expiresAt, now),
        ),
        or(
          isNull(notifications.validUntil),
          gt(notifications.validUntil, now),
        ),
      ),
    )
    .limit(50);

  for (const candidate of candidates) {
    const [claimed] = await database.db
      .update(notificationDeliveries)
      .set({
        status: "running",
        attempts: sql`${notificationDeliveries.attempts} + 1`,
        lastAttemptAt: now,
        updatedAt: now,
        errorSummary: null,
      })
      .where(
        and(
          eq(notificationDeliveries.id, candidate.delivery.id),
          eq(notificationDeliveries.status, candidate.delivery.status),
          lte(notificationDeliveries.nextAttemptAt, now),
        ),
      )
      .returning({ attempts: notificationDeliveries.attempts });
    if (!claimed) continue;

    try {
      const encryptionKey = config.PUSH_SUBSCRIPTION_ENCRYPTION_KEY!;
      await webPush.sendNotification(
        {
          endpoint: decryptScopedSecret(
            candidate.subscription.endpointCiphertext,
            encryptionKey,
            "push.endpoint",
          ),
          keys: {
            p256dh: decryptScopedSecret(
              candidate.subscription.p256dhCiphertext,
              encryptionKey,
              "push.p256dh",
            ),
            auth: decryptScopedSecret(
              candidate.subscription.authCiphertext,
              encryptionKey,
              "push.auth",
            ),
          },
        },
        JSON.stringify({
          notificationId: candidate.notification.id,
          title: candidate.notification.title,
          body: candidate.notification.body,
          actionUrl: candidate.notification.actionUrl ?? "/",
          tag: candidate.notification.dedupeKey,
        }),
        {
          TTL: Math.max(
            60,
            Math.min(
              86_400,
              candidate.notification.validUntil
                ? Math.floor(
                    (candidate.notification.validUntil.getTime() - now.getTime()) /
                      1_000,
                  )
                : 3_600,
            ),
          ),
          urgency:
            candidate.notification.severity === "critical" ||
            candidate.notification.severity === "high"
              ? "high"
              : "normal",
        },
      );
      await database.db.transaction(async (tx) => {
        await tx
          .update(notificationDeliveries)
          .set({
            status: "completed",
            deliveredAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(notificationDeliveries.id, candidate.delivery.id),
              eq(notificationDeliveries.status, "running"),
            ),
          );
        await tx
          .update(pushSubscriptions)
          .set({ lastSuccessAt: new Date() })
          .where(eq(pushSubscriptions.id, candidate.subscription.id));
      });
    } catch (error) {
      const status = webPushStatusCode(error);
      const errorSummary = status
        ? `push_provider_${status}`
        : "push_delivery_failed";
      if (isPermanentWebPushFailure(error)) {
        await database.db.transaction(async (tx) => {
          await tx
            .update(pushSubscriptions)
            .set({ disabledAt: new Date() })
            .where(eq(pushSubscriptions.id, candidate.subscription.id));
          await tx
            .update(notificationDeliveries)
            .set({
              status: "cancelled",
              errorSummary,
              updatedAt: new Date(),
            })
            .where(eq(notificationDeliveries.id, candidate.delivery.id));
        });
        continue;
      }
      await database.db
        .update(notificationDeliveries)
        .set({
          status: "failed",
          errorSummary,
          nextAttemptAt: new Date(
            Date.now() + pushRetryDelayMs(claimed.attempts),
          ),
          updatedAt: new Date(),
        })
        .where(eq(notificationDeliveries.id, candidate.delivery.id));
    }
  }
}

async function runPushCycle(): Promise<void> {
  if (!pushReady) return;
  const now = new Date();
  await database.db
    .update(notificationDeliveries)
    .set({
      status: "failed",
      nextAttemptAt: now,
      errorSummary: "push_delivery_lease_expired",
      updatedAt: now,
    })
    .where(
      and(
        eq(notificationDeliveries.status, "running"),
        lt(
          notificationDeliveries.lastAttemptAt,
          new Date(now.getTime() - 10 * 60_000),
        ),
      ),
    );
  await database.db
    .update(pushSubscriptions)
    .set({ disabledAt: now })
    .where(
      and(
        isNull(pushSubscriptions.disabledAt),
        lte(pushSubscriptions.expiresAt, now),
      ),
    );
  await schedulePushDeliveries();
  await dispatchPushDeliveries();
  await database.db
    .delete(pushSubscriptions)
    .where(
      lt(
        pushSubscriptions.disabledAt,
        new Date(now.getTime() - 30 * 86_400_000),
      ),
    );
}

async function publishOutbox(): Promise<void> {
  const events = await database.db.select().from(outboxEvents).where(isNull(outboxEvents.publishedAt)).limit(100);
  for (const event of events) {
    if (event.eventType === "ai.job.queued") {
      await enqueueAiJob(event.entityId);
    }
    await database.db.update(outboxEvents).set({ publishedAt: new Date(), attempt: sql`${outboxEvents.attempt} + 1` }).where(eq(outboxEvents.id, event.id));
  }
}

await boss.start();
await boss.createQueue("ai-generate-report");
await boss.work<{ jobId: string }>("ai-generate-report", { batchSize: 1 }, async (jobs) => {
  for (const job of jobs) await processAiJob(job.data.jobId);
});
await ensureDefaultReminderRules();
await Promise.all([
  dispatchAiJobs(),
  evaluateReminders(),
  publishOutbox(),
  runPushCycle(),
]);
const dispatchTimer = setInterval(() => void dispatchAiJobs().catch((error) => logger.error({ error }, "AI dispatch failed")), 15_000);
const reminderTimer = setInterval(() => void evaluateReminders().catch((error) => logger.error({ error }, "reminder evaluation failed")), 60_000);
const outboxTimer = setInterval(() => void publishOutbox().catch((error) => logger.error({ error }, "outbox publishing failed")), 5_000);
const pushTimer = setInterval(() => void runPushCycle().catch((error) => logger.error({ error }, "web push cycle failed")), 10_000);
logger.info("background worker started");
if (!pushReady) logger.info("browser push is disabled because VAPID is not configured");

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(dispatchTimer);
  clearInterval(reminderTimer);
  clearInterval(outboxTimer);
  clearInterval(pushTimer);
  logger.info({ signal }, "background worker shutdown started");
  await boss.stop({ graceful: true });
  await database.close();
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
