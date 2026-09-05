import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@workbench/db";
import {
  auditLogs,
  outboxEvents,
  projectNodes,
  projects,
  timerEvents,
  timerStates,
  workBreaks,
  workSessionProjectLinks,
  workSessions,
  workSessionVersions,
} from "@workbench/db/schema";
import {
  timerEventTypes,
  transitionTimerState,
  type TimerEventType,
  workDurationAnomalyFlags,
} from "@workbench/shared";

import type { WorkActor } from "../work/service.js";

const timerMetadataSchema = z
  .object({
    content: z.string().trim().min(1).max(10_000),
    result: z.string().max(10_000).default(""),
    blockers: z.string().max(5_000).default(""),
    nextStep: z.string().max(5_000).default(""),
    primaryProjectNodeId: z.uuid().nullable().default(null),
    projectNodeIds: z.array(z.uuid()).max(32).default([]),
    visibility: z
      .enum(["private", "management_only", "project_visible"])
      .default("management_only"),
    timezone: z.string().min(1).max(100).default("Asia/Shanghai"),
  })
  .superRefine(({ primaryProjectNodeId, projectNodeIds }, context) => {
    if (new Set(projectNodeIds).size !== projectNodeIds.length) {
      context.addIssue({
        code: "custom",
        path: ["projectNodeIds"],
        message: "关联项目节点不能重复。",
      });
    }
    if (projectNodeIds.length > 0 && !primaryProjectNodeId) {
      context.addIssue({
        code: "custom",
        path: ["primaryProjectNodeId"],
        message: "关联项目节点时必须指定主项目节点。",
      });
    }
    if (
      primaryProjectNodeId &&
      projectNodeIds.length > 0 &&
      !projectNodeIds.includes(primaryProjectNodeId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["primaryProjectNodeId"],
        message: "主项目节点必须包含在关联项目节点中。",
      });
    }
  });

export type TimerStartInput = z.input<typeof timerMetadataSchema> & {
  eventId: string;
  occurredAt: Date;
};

export class ActiveTimerConflictError extends Error {
  constructor() {
    super("已有一个主计时器正在运行、暂停或休息，请先处理现有计时器。");
    this.name = "ActiveTimerConflictError";
  }
}

export class TimerNotFoundError extends Error {
  constructor() {
    super("计时器不存在或不属于当前账号。请联系管理员以明确更多细节。");
    this.name = "TimerNotFoundError";
  }
}

export class TimerEventConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimerEventConflictError";
  }
}

function validateOccurredAt(occurredAt: Date): void {
  const now = Date.now();
  if (occurredAt.getTime() > now + 5 * 60_000) {
    throw new TimerEventConflictError(
      "事件时间不能晚于服务器时间 5 分钟以上。",
    );
  }
  if (occurredAt.getTime() < now - 7 * 86_400_000) {
    throw new TimerEventConflictError("离线计时事件最多可追溯 7 天。");
  }
}

export class TimerService {
  constructor(private readonly db: Database) {}

  async getCurrent(actor: WorkActor) {
    const [timer] = await this.db
      .select()
      .from(timerStates)
      .where(
        and(
          eq(timerStates.organizationId, actor.organizationId),
          eq(timerStates.membershipId, actor.membershipId),
          eq(timerStates.isPrimary, true),
          or(
            eq(timerStates.status, "running"),
            eq(timerStates.status, "paused"),
            eq(timerStates.status, "on_break"),
          ),
        ),
      )
      .orderBy(desc(timerStates.updatedAt))
      .limit(1);
    return timer ?? null;
  }

  async start(actor: WorkActor, input: TimerStartInput) {
    validateOccurredAt(input.occurredAt);
    const metadata = timerMetadataSchema.parse(input);

    const linkedNodeIds = Array.from(
      new Set([
        ...metadata.projectNodeIds,
        ...(metadata.primaryProjectNodeId
          ? [metadata.primaryProjectNodeId]
          : []),
      ]),
    );
    if (linkedNodeIds.length > 0) {
      const nodes = await this.db
        .select({ id: projectNodes.id })
        .from(projectNodes)
        .innerJoin(projects, eq(projects.id, projectNodes.projectId))
        .where(
          and(
            inArray(projectNodes.id, linkedNodeIds),
            eq(projects.organizationId, actor.organizationId),
            isNull(projectNodes.deletedAt),
            isNull(projects.deletedAt),
          ),
        );
      if (nodes.length !== linkedNodeIds.length) {
        throw new TimerEventConflictError("所选项目任务不存在或不可用。");
      }
    }

    const [retry] = await this.db
      .select({ timer: timerStates })
      .from(timerEvents)
      .innerJoin(timerStates, eq(timerStates.id, timerEvents.timerStateId))
      .where(
        and(
          eq(timerStates.organizationId, actor.organizationId),
          eq(timerStates.membershipId, actor.membershipId),
          eq(timerEvents.eventId, input.eventId),
          eq(timerEvents.eventType, "start"),
        ),
      )
      .limit(1);
    if (retry) return retry.timer;

    try {
      return await this.db.transaction(async (tx) => {
        const [timer] = await tx
          .insert(timerStates)
          .values({
            organizationId: actor.organizationId,
            membershipId: actor.membershipId,
            status: "running",
            isPrimary: true,
            startedAt: input.occurredAt,
            stateChangedAt: input.occurredAt,
            metadata,
            clientEventCursor: input.eventId,
          })
          .returning();
        if (!timer) throw new Error("Failed to create timer");
        await tx.insert(timerEvents).values({
          timerStateId: timer.id,
          eventId: input.eventId,
          eventType: "start",
          occurredAt: input.occurredAt,
          payload: metadata,
        });
        await tx.insert(auditLogs).values({
          organizationId: actor.organizationId,
          actorMembershipId: actor.membershipId,
          action: "timer.started",
          entityType: "timer_state",
          entityId: timer.id,
          after: timer,
        });
        return timer;
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ActiveTimerConflictError();
      }
      throw error;
    }
  }

  async transition(
    actor: WorkActor,
    timerId: string,
    event: { eventId: string; eventType: TimerEventType; occurredAt: Date },
  ) {
    validateOccurredAt(event.occurredAt);
    if (!timerEventTypes.includes(event.eventType)) {
      throw new TimerEventConflictError("未知的计时器事件。");
    }

    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(timerStates)
        .where(
          and(
            eq(timerStates.id, timerId),
            eq(timerStates.organizationId, actor.organizationId),
            eq(timerStates.membershipId, actor.membershipId),
          ),
        )
        .for("update")
        .limit(1);
      if (!current) throw new TimerNotFoundError();

      const [duplicate] = await tx
        .select({ id: timerEvents.id })
        .from(timerEvents)
        .where(
          and(
            eq(timerEvents.timerStateId, current.id),
            eq(timerEvents.eventId, event.eventId),
          ),
        )
        .limit(1);
      if (duplicate) return current;

      let transition;
      try {
        transition = transitionTimerState(
          {
            status: current.status,
            stateChangedAt: current.stateChangedAt,
            accumulatedSeconds: current.accumulatedSeconds,
          },
          event.eventType,
          event.occurredAt,
        );
      } catch (error) {
        throw new TimerEventConflictError(
          error instanceof Error ? error.message : "计时器状态转换失败。",
        );
      }

      const [updated] = await tx
        .update(timerStates)
        .set({
          status: transition.status,
          stateChangedAt: transition.stateChangedAt,
          accumulatedSeconds: transition.accumulatedSeconds,
          stoppedAt: transition.stoppedAt,
          clientEventCursor: event.eventId,
          version: current.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(timerStates.id, current.id),
            eq(timerStates.version, current.version),
          ),
        )
        .returning();
      if (!updated)
        throw new TimerEventConflictError(
          "计时器已被其他设备更新，请同步后重试。",
        );

      await tx.insert(timerEvents).values({
        timerStateId: current.id,
        eventId: event.eventId,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
      });

      if (transition.status !== "stopped") return updated;
      if (transition.accumulatedSeconds <= 0) {
        throw new TimerEventConflictError("有效计时时长必须大于 0 秒。");
      }
      const grossSeconds = Math.floor(
        (event.occurredAt.getTime() - current.startedAt.getTime()) / 1_000,
      );
      if (grossSeconds < transition.accumulatedSeconds || grossSeconds <= 0) {
        throw new TimerEventConflictError("计时事件时间序列不合法。");
      }
      const anomalyFlags = workDurationAnomalyFlags({
        grossSeconds,
        breakSeconds: grossSeconds - transition.accumulatedSeconds,
        netSeconds: transition.accumulatedSeconds,
      });
      const metadata = timerMetadataSchema.parse(current.metadata);
      const [session] = await tx
        .insert(workSessions)
        .values({
          organizationId: actor.organizationId,
          membershipId: actor.membershipId,
          startAt: current.startedAt,
          endAt: event.occurredAt,
          timezone: metadata.timezone,
          grossSeconds,
          breakSeconds: grossSeconds - transition.accumulatedSeconds,
          netSeconds: transition.accumulatedSeconds,
          billableSeconds: transition.accumulatedSeconds,
          source: "timer",
          content: metadata.content,
          result: metadata.result,
          blockers: metadata.blockers,
          nextStep: metadata.nextStep,
          primaryProjectNodeId: metadata.primaryProjectNodeId,
          visibility: metadata.visibility,
          anomalyFlags,
        })
        .returning();
      if (!session) throw new Error("Failed to create timer work session");

      const linkedNodeIds = Array.from(
        new Set([
          ...metadata.projectNodeIds,
          ...(metadata.primaryProjectNodeId
            ? [metadata.primaryProjectNodeId]
            : []),
        ]),
      );
      const projectLinks: Array<{
        workSessionId: string;
        projectId: string;
        projectNodeId: string;
        projectBranchId: string;
        isPrimary: boolean;
        allocationBasisPoints: number;
      }> = [];
      if (linkedNodeIds.length > 0) {
        const nodes = await tx
          .select({
            id: projectNodes.id,
            projectId: projectNodes.projectId,
            branchId: projectNodes.branchId,
          })
          .from(projectNodes)
          .innerJoin(projects, eq(projects.id, projectNodes.projectId))
          .where(
            and(
              inArray(projectNodes.id, linkedNodeIds),
              eq(projects.organizationId, actor.organizationId),
            ),
          );
        if (nodes.length !== linkedNodeIds.length) {
          throw new TimerEventConflictError(
            "关联项目任务已不存在，无法结束计时。",
          );
        }
        projectLinks.push(
          ...linkedNodeIds.map((nodeId) => {
            const node = nodes.find((candidate) => candidate.id === nodeId);
            if (!node)
              throw new TimerEventConflictError(
                "关联项目任务已不存在，无法结束计时。",
              );
            return {
              workSessionId: session.id,
              projectId: node.projectId,
              projectNodeId: node.id,
              projectBranchId: node.branchId,
              isPrimary: node.id === metadata.primaryProjectNodeId,
              allocationBasisPoints:
                node.id === metadata.primaryProjectNodeId ? 10_000 : 0,
            };
          }),
        );
      }
      if (projectLinks.length > 0) {
        await tx.insert(workSessionProjectLinks).values(projectLinks);
      }

      await tx
        .update(timerStates)
        .set({ workSessionId: session.id })
        .where(eq(timerStates.id, current.id));

      const allEvents = await tx
        .select({
          eventType: timerEvents.eventType,
          occurredAt: timerEvents.occurredAt,
        })
        .from(timerEvents)
        .where(eq(timerEvents.timerStateId, current.id))
        .orderBy(timerEvents.occurredAt);
      let nonWorkStart: Date | null = null;
      const breakIntervals: Array<{ startAt: Date; endAt: Date }> = [];
      for (const timerEvent of allEvents) {
        if (
          (timerEvent.eventType === "pause" ||
            timerEvent.eventType === "break_start") &&
          nonWorkStart === null
        ) {
          nonWorkStart = timerEvent.occurredAt;
        }
        if (
          (timerEvent.eventType === "resume" ||
            timerEvent.eventType === "break_end") &&
          nonWorkStart
        ) {
          breakIntervals.push({
            startAt: nonWorkStart,
            endAt: timerEvent.occurredAt,
          });
          nonWorkStart = null;
        }
      }
      if (nonWorkStart) {
        breakIntervals.push({ startAt: nonWorkStart, endAt: event.occurredAt });
      }
      const validBreakIntervals = breakIntervals.filter(
        (interval) => interval.endAt > interval.startAt,
      );
      if (validBreakIntervals.length > 0) {
        await tx.insert(workBreaks).values(
          validBreakIntervals.map((interval) => ({
            ...interval,
            workSessionId: session.id,
            reason: "timer_non_work",
          })),
        );
      }
      const snapshot = {
        ...session,
        breaks: validBreakIntervals,
        projectLinks,
      };
      await tx.insert(workSessionVersions).values({
        workSessionId: session.id,
        version: 1,
        snapshot,
        changeReason: "timer_stopped",
        changedBy: actor.membershipId,
      });
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "timer.stopped",
        entityType: "timer_state",
        entityId: current.id,
        after: { ...updated, workSessionId: session.id, workSession: snapshot },
      });
      await tx.insert(outboxEvents).values({
        organizationId: actor.organizationId,
        eventType: "work_session.changed",
        entityType: "work_session",
        entityId: session.id,
        entityVersion: session.version,
        payload: { change: "timer_stopped" },
      });
      return { ...updated, workSessionId: session.id, workSession: snapshot };
    });
  }
}
