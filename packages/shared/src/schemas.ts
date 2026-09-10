import { z } from "zod";

export const uuidSchema = z.uuid();
export const timezoneSchema = z.string().min(1).max(100);
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const workSessionSources = ["manual", "timer", "import"] as const;
export const workSessionVisibilities = [
  "private",
  "management_only",
  "project_visible",
] as const;
export const submissionStatuses = ["draft", "submitted"] as const;
export const approvalStatuses = [
  "not_requested",
  "pending_review",
  "approved",
  "returned",
  "locked",
] as const;

export const createWorkSessionSchema = z
  .object({
    startAt: isoDateTimeSchema,
    endAt: isoDateTimeSchema,
    timezone: timezoneSchema.default("Asia/Shanghai"),
    source: z.enum(workSessionSources),
    content: z.string().trim().min(1).max(10_000),
    result: z.string().trim().max(10_000).default(""),
    blockers: z.string().trim().max(5_000).default(""),
    nextStep: z.string().trim().max(5_000).default(""),
    primaryProjectNodeId: uuidSchema.nullable().default(null),
    projectNodeIds: z.array(uuidSchema).max(32).default([]),
    reportedProgress: z.number().min(0).max(100).nullable().optional(),
    projectProgressUpdates: z.array(z.object({
      projectNodeId: uuidSchema,
      progress: z.number().min(0).max(100),
    })).max(32).optional(),
    visibility: z.enum(workSessionVisibilities).default("management_only"),
    parallelWork: z.boolean().default(false),
    breaks: z
      .array(
        z.object({
          startAt: isoDateTimeSchema,
          endAt: isoDateTimeSchema,
        }),
      )
      .max(100, "单条工作记录最多包含 100 段休息。")
      .default([]),
  })
  .superRefine(
    (
      { startAt, endAt, primaryProjectNodeId, projectNodeIds, reportedProgress, projectProgressUpdates },
      context,
    ) => {
      const progressNodeIds = new Set<string>();
      for (const [index, update] of (projectProgressUpdates ?? []).entries()) {
        if (progressNodeIds.has(update.projectNodeId) ||
          !(projectNodeIds.includes(update.projectNodeId) || primaryProjectNodeId === update.projectNodeId)) {
          context.addIssue({ code: "custom", path: ["projectProgressUpdates", index, "projectNodeId"], message: "只能更新已关联的节点，且每个节点只能填写一次完成度。" });
        }
        progressNodeIds.add(update.projectNodeId);
        if (update.projectNodeId === primaryProjectNodeId && reportedProgress != null && update.progress !== reportedProgress) {
          context.addIssue({ code: "custom", path: ["projectProgressUpdates", index, "progress"], message: "主节点的两份完成度不能冲突。" });
        }
      }
      if (new Date(endAt) <= new Date(startAt)) {
        context.addIssue({
          code: "custom",
          path: ["endAt"],
          message: "结束时间必须晚于开始时间",
        });
      }
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
      if (
        reportedProgress !== null &&
        reportedProgress !== undefined &&
        !primaryProjectNodeId
      ) {
        context.addIssue({
          code: "custom",
          path: ["reportedProgress"],
          message: "填写完成度时必须选择主项目节点。",
        });
      }
    },
  );

export type CreateWorkSessionInput = z.infer<typeof createWorkSessionSchema>;
