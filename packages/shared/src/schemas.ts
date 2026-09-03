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
    ({ startAt, endAt, primaryProjectNodeId, projectNodeIds }, context) => {
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
    },
  );

export type CreateWorkSessionInput = z.infer<typeof createWorkSessionSchema>;
