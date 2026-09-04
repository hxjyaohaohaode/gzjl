import { createHash } from "node:crypto";

import { and, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Database } from "@workbench/db";
import {
  aiJobs,
  aiReports,
  aiReportSources,
  orgMemberships,
  orgUnits,
  outboxEvents,
  projectMembers,
  projectNodes,
  projects,
  users,
  workSessions,
  workTypes,
} from "@workbench/db/schema";

import type { AnalyticsActor, AnalyticsService } from "../analytics/service.js";
import type { AiConfigurationService } from "./configuration.js";

export const aiTaskTypes = [
  "daily_summary",
  "weekly_summary",
  "monthly_summary",
  "work_rhythm",
  "project_progress",
  "project_blockers",
  "organization_summary",
  "assistant_chat",
] as const;
export type AiTaskType = (typeof aiTaskTypes)[number];

const taskGoals: Record<AiTaskType, string> = {
  daily_summary: "总结当日已经记录的工作事实、产出、阻塞与下一步，不补写未发生的工作。",
  weekly_summary: "生成本周可直接校对的工作周报，区分事实、风险和建议。",
  monthly_summary: "生成月度工作回顾，说明投入结构、变化与仍需确认的事项。",
  work_rhythm: "分析有记录支持的工作节奏与时段分布，不评价人格、勤奋程度或健康状况。",
  project_progress: "按项目汇总投入和进展证据；工时不能被直接解释为完成度。",
  project_blockers: "仅根据工作记录中的阻塞与项目事实定位风险，并给出可验证的处理建议。",
  organization_summary: "汇总授权范围内的组织工作事实，不做员工排名、处罚或绩效结论。",
  assistant_chat: "回答用户关于工作、成员状态和项目状态的问题；结论必须能回溯到当前授权范围内的事实。",
};

export interface AiReportRequest {
  taskType: AiTaskType;
  scope: "self" | "team";
  from: Date;
  to: Date;
  question?: string | undefined;
  conversationId?: string | undefined;
}

export class AiUnavailableError extends Error {
  constructor() { super("AI 服务未启用或尚未配置 API Key；核心业务不受影响。") ; this.name = "AiUnavailableError"; }
}

export class AiJobConflictError extends Error {
  constructor(message: string) { super(message); this.name = "AiJobConflictError"; }
}

export class AiService {
  constructor(
    private readonly db: Database,
    private readonly analytics: AnalyticsService,
    private readonly configuration: AiConfigurationService,
  ) {}

  async requestReport(actor: AnalyticsActor, input: AiReportRequest) {
    const { taskType, scope, from, to } = input;
    const question = input.question?.trim();
    const conversationId = input.conversationId?.trim() || "primary";
    const provider = await this.configuration.resolveEffective(actor.organizationId);
    if (!provider) throw new AiUnavailableError();
    const analysisActor =
      scope === "self"
        ? { ...actor, grants: actor.grants.filter((grant) => grant.scopeKind === "self") }
        : actor;
    const facts = await this.analytics.summary(analysisActor, from, to);
    const memberRows = await this.db
      .select({
        membershipId: orgMemberships.id,
        displayName: users.displayName,
        status: orgMemberships.status,
        orgUnitId: orgMemberships.orgUnitId,
        orgUnitName: orgUnits.name,
        positionTitle: orgMemberships.positionTitle,
        joinedAt: orgMemberships.joinedAt,
      })
      .from(orgMemberships)
      .innerJoin(users, eq(users.id, orgMemberships.userId))
      .leftJoin(orgUnits, eq(orgUnits.id, orgMemberships.orgUnitId))
      .where(
        and(
          eq(orgMemberships.organizationId, actor.organizationId),
          scope === "self" ? eq(orgMemberships.id, actor.membershipId) : undefined,
        ),
      )
      .limit(200);
    const [memberProjects, access] = await Promise.all([
      scope === "self"
        ? this.db
            .select({ projectId: projectMembers.projectId })
            .from(projectMembers)
            .where(
              and(
                eq(projectMembers.membershipId, actor.membershipId),
                isNull(projectMembers.leftAt),
              ),
            )
        : Promise.resolve([]),
      this.analytics.buildAccessCondition(analysisActor),
    ]);
    const accessibleProjectIds = [
      ...new Set([
        ...facts.byProject
          .map((item) => item.projectId)
          .filter((id): id is string => Boolean(id)),
        ...memberProjects.map((item) => item.projectId),
      ]),
    ];
    const recentRecords = await this.db
      .select({
        id: workSessions.id,
        version: workSessions.version,
        memberId: workSessions.membershipId,
        displayName: users.displayName,
        startAt: workSessions.startAt,
        endAt: workSessions.endAt,
        netSeconds: workSessions.netSeconds,
        content: workSessions.content,
        result: workSessions.result,
        blockers: workSessions.blockers,
        nextStep: workSessions.nextStep,
        submissionStatus: workSessions.submissionStatus,
        approvalStatus: workSessions.approvalStatus,
        workType: workTypes.name,
        projectId: projects.id,
        projectName: projects.name,
        nodeId: projectNodes.id,
        nodeTitle: projectNodes.title,
      })
      .from(workSessions)
      .innerJoin(orgMemberships, eq(orgMemberships.id, workSessions.membershipId))
      .innerJoin(users, eq(users.id, orgMemberships.userId))
      .leftJoin(workTypes, eq(workTypes.id, workSessions.workTypeId))
      .leftJoin(projectNodes, eq(projectNodes.id, workSessions.primaryProjectNodeId))
      .leftJoin(projects, eq(projects.id, projectNodes.projectId))
      .where(
        and(
          access,
          gt(workSessions.endAt, from),
          lt(workSessions.startAt, to),
          eq(workSessions.recordKind, "fact"),
          isNull(workSessions.deletedAt),
        ),
      )
      .orderBy(desc(workSessions.startAt))
      .limit(60);
    const projectRows =
      scope === "self" && accessibleProjectIds.length === 0
        ? []
        : await this.db
            .select({
              projectId: projects.id,
              projectName: projects.name,
              projectStatus: projects.status,
              projectDueAt: projects.dueAt,
              projectVersion: projects.version,
              nodeId: projectNodes.id,
              nodeTitle: projectNodes.title,
              nodeStatus: projectNodes.status,
              nodeProgress: projectNodes.progress,
              nodeWeight: projectNodes.weight,
              nodeDueAt: projectNodes.dueAt,
              nodeVersion: projectNodes.version,
            })
            .from(projects)
            .leftJoin(
              projectNodes,
              and(eq(projectNodes.projectId, projects.id), isNull(projectNodes.deletedAt)),
            )
            .where(
              and(
                eq(projects.organizationId, actor.organizationId),
                isNull(projects.deletedAt),
                scope === "self" ? inArray(projects.id, accessibleProjectIds) : undefined,
              ),
            )
            .limit(240);
    const projectContext = new Map<
      string,
      {
        id: string;
        name: string;
        status: string;
        dueAt: Date | null;
        version: number;
        recordedSeconds: number;
        nodes: Array<{
          id: string;
          title: string;
          status: string;
          progress: string;
          weight: string;
          dueAt: Date | null;
          version: number;
        }>;
      }
    >();
    for (const row of projectRows) {
      const project = projectContext.get(row.projectId) ?? {
        id: row.projectId,
        name: row.projectName,
        status: row.projectStatus,
        dueAt: row.projectDueAt,
        version: row.projectVersion,
        recordedSeconds:
          facts.byProject.find((item) => item.projectId === row.projectId)?.seconds ?? 0,
        nodes: [],
      };
      if (row.nodeId && row.nodeTitle && row.nodeStatus && row.nodeProgress && row.nodeWeight) {
        project.nodes.push({
          id: row.nodeId,
          title: row.nodeTitle,
          status: row.nodeStatus,
          progress: row.nodeProgress,
          weight: row.nodeWeight,
          dueAt: row.nodeDueAt,
          version: row.nodeVersion ?? 1,
        });
      }
      projectContext.set(row.projectId, project);
    }
    const conversationRows =
      taskType === "assistant_chat"
        ? await this.db
            .select({ job: aiJobs, report: aiReports })
            .from(aiJobs)
            .leftJoin(aiReports, eq(aiReports.aiJobId, aiJobs.id))
            .where(
              and(
                eq(aiJobs.organizationId, actor.organizationId),
                eq(aiJobs.requestedBy, actor.membershipId),
                eq(aiJobs.taskType, "assistant_chat"),
              ),
            )
            .orderBy(desc(aiJobs.queuedAt))
            .limit(30)
        : [];
    const conversationHistory = conversationRows
      .filter((entry) => {
        const jobScope = entry.job.scope as { conversationId?: unknown };
        return (jobScope.conversationId || "primary") === conversationId;
      })
      .slice(0, 10)
      .reverse()
      .map((entry) => ({
        question: String((entry.job.scope as { question?: unknown }).question ?? ""),
        answer: entry.report?.summary ?? null,
      }));
    const sourceSummary = this.limitSourceSummary({
      taskType,
      taskGoal: taskGoals[taskType],
      ...(question ? { question, conversationId, conversationHistory } : {}),
      scope,
      range: facts.range,
      totals: facts.totals,
      byDay: facts.byDay,
      byProject: facts.byProject,
      byMember: scope === "team" ? facts.byMember : [],
      byWorkType: facts.byWorkType,
      byApproval: facts.byApproval,
      byHour: facts.byHour,
      funnel: facts.funnel,
      members: memberRows.map((member) => ({
        ...member,
        recordedSeconds:
          facts.byMember.find((item) => item.membershipId === member.membershipId)?.seconds ??
          (member.membershipId === actor.membershipId ? facts.totals.totalSeconds : 0),
      })),
      projects: [...projectContext.values()].map((project) => ({
        ...project,
        nodes: project.nodes.slice(0, 40),
        nodesTruncated: project.nodes.length > 40,
      })),
      recentRecords: recentRecords.map((record) => ({
        ...record,
        // The model needs the work narrative, not unlimited editor text. The
        // durable record remains untouched and is referenced by id/version.
        content: record.content.slice(0, 2_000),
        result: record.result.slice(0, 2_000),
        blockers: record.blockers.slice(0, 1_000),
        nextStep: record.nextStep.slice(0, 1_000),
      })),
      sources: [
        // Keep record-level provenance first so a large organization cannot
        // crowd it out of the bounded source list with roster entries.
        ...recentRecords.map((record) => ({
          entityType: "work_session",
          entityId: record.id,
          entityVersion: String(record.version),
          label: `工作记录 · ${record.displayName} · ${record.startAt.toISOString().slice(0, 10)}`,
        })),
        ...facts.byProject
          .filter((item) => item.projectId)
          .map((item) => ({ entityType: "project", entityId: item.projectId!, label: item.projectName })),
        ...(scope === "team"
          ? memberRows.map((member) => ({
              entityType: "organization_membership",
              entityId: member.membershipId,
              label: member.displayName,
            }))
          : []),
      ],
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
          template: "structured-work-intelligence-v4-chat",
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
            eq(aiJobs.taskType, taskType),
            eq(aiJobs.inputHash, inputHash),
          ),
        )
        .limit(1);
      if (existing) return existing;
      await this.configuration.assertQuota(actor.organizationId, tx);
      const [job] = await tx.insert(aiJobs).values({ organizationId: actor.organizationId, requestedBy: actor.membershipId, scope: { scope, from, to, ...(question ? { question, conversationId } : {}) }, taskType, provider: "openai_compatible", model: provider.model, promptTemplateVersion: "structured-work-intelligence-v4-chat", inputHash, sourceSummary, maxAttempts: provider.maxAttempts, maxOutputTokens: provider.maxOutputTokens }).returning();
      if (!job) throw new Error("Failed to create AI job");
      await tx.insert(outboxEvents).values({ organizationId: actor.organizationId, eventType: "ai.job.queued", entityType: "ai_job", entityId: job.id, entityVersion: 1, payload: { jobId: job.id } });
      return job;
    });
  }

  async list(actor: { organizationId: string; membershipId: string }) {
    return this.db.select({ job: aiJobs, report: aiReports }).from(aiJobs).leftJoin(aiReports, eq(aiReports.aiJobId, aiJobs.id)).where(and(eq(aiJobs.organizationId, actor.organizationId), eq(aiJobs.requestedBy, actor.membershipId))).orderBy(desc(aiJobs.queuedAt)).limit(100);
  }

  async detail(actor: { organizationId: string; membershipId: string }, reportId: string) {
    const [record] = await this.db.select({ job: aiJobs, report: aiReports }).from(aiReports).innerJoin(aiJobs, eq(aiJobs.id, aiReports.aiJobId)).where(and(eq(aiReports.id, reportId), eq(aiJobs.organizationId, actor.organizationId), eq(aiJobs.requestedBy, actor.membershipId))).limit(1);
    if (!record) return null;
    const sources = await this.db.select().from(aiReportSources).where(eq(aiReportSources.aiReportId, reportId));
    return { ...record, sources };
  }

  async cancel(actor: { organizationId: string; membershipId: string }, jobId: string) {
    const [job] = await this.db.select().from(aiJobs).where(and(eq(aiJobs.id, jobId), eq(aiJobs.organizationId, actor.organizationId), eq(aiJobs.requestedBy, actor.membershipId))).limit(1);
    if (!job) return null;
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      throw new AiJobConflictError("只有排队中或生成中的任务可以取消。");
    }
    const [updated] = await this.db.update(aiJobs).set({ status: "cancelled", cancelledAt: new Date(), completedAt: new Date(), errorSummary: null }).where(and(eq(aiJobs.id, job.id), eq(aiJobs.status, job.status))).returning();
    if (!updated) throw new AiJobConflictError("任务状态已经变化，请刷新后重试。");
    await this.db.insert(outboxEvents).values({ organizationId: actor.organizationId, eventType: "ai.job.cancelled", entityType: "ai_job", entityId: job.id, entityVersion: job.attempt + 1, payload: { jobId: job.id } });
    return updated;
  }

  async retry(actor: { organizationId: string; membershipId: string }, jobId: string) {
    const [job] = await this.db.select().from(aiJobs).where(and(eq(aiJobs.id, jobId), eq(aiJobs.organizationId, actor.organizationId), eq(aiJobs.requestedBy, actor.membershipId))).limit(1);
    if (!job) return null;
    if (job.status !== "failed" && job.status !== "cancelled") {
      throw new AiJobConflictError("只有失败或已取消的任务可以重试。");
    }
    const [updated] = await this.db.update(aiJobs).set({ status: "queued", attempt: 0, queuedAt: new Date(), startedAt: null, completedAt: null, cancelledAt: null, errorSummary: null }).where(and(eq(aiJobs.id, job.id), eq(aiJobs.status, job.status))).returning();
    if (!updated) throw new AiJobConflictError("任务状态已经变化，请刷新后重试。");
    await this.db.insert(outboxEvents).values({ organizationId: actor.organizationId, eventType: "ai.job.queued", entityType: "ai_job", entityId: job.id, entityVersion: job.attempt + 1, payload: { jobId: job.id, retry: true } });
    return updated;
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
      members: cap(summary.members, 200),
      projects: cap(summary.projects, 200),
      recentRecords: cap(summary.recentRecords, 60),
      conversationHistory: cap(summary.conversationHistory, 10),
      sources: cap(summary.sources, 200),
    } as T;
    if (JSON.stringify(bounded).length <= 48_000) return bounded;
    bounded = {
      ...summary,
      byDay: cap(summary.byDay, 90),
      byProject: cap(summary.byProject, 80),
      byMember: cap(summary.byMember, 80),
      members: cap(summary.members, 80),
      projects: cap(summary.projects, 80),
      recentRecords: cap(summary.recentRecords, 24),
      conversationHistory: cap(summary.conversationHistory, 6),
      sources: cap(summary.sources, 80),
      inputTruncated: true,
    } as T;
    if (JSON.stringify(bounded).length <= 48_000) return bounded;
    const compactProjects = Array.isArray(summary.projects)
      ? summary.projects.slice(0, 24).map((project) => {
          if (!project || typeof project !== "object") return project;
          const value = project as Record<string, unknown>;
          return {
            ...value,
            nodes: Array.isArray(value.nodes) ? value.nodes.slice(0, 12) : [],
            nodesTruncated: true,
          };
        })
      : summary.projects;
    return {
      ...summary,
      byDay: cap(summary.byDay, 31),
      byProject: cap(summary.byProject, 24),
      byMember: cap(summary.byMember, 50),
      members: cap(summary.members, 50),
      projects: compactProjects,
      recentRecords: cap(summary.recentRecords, 10),
      conversationHistory: cap(summary.conversationHistory, 4),
      sources: cap(summary.sources, 48),
      inputTruncated: true,
    } as T;
  }
}
