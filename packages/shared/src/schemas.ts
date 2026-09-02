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
    visibility: z.enum(workSessionVisibilities).default("management_only"),
    parallelWork: z.boolean().default(false),
    breaks: z
      .array(
        z.object({
          startAt: isoDateTimeSchema,
          endAt: isoDateTimeSchema,
        }),
      )
      .default([]),
  })
  .superRefine(({ startAt, endAt }, context) => {
    if (new Date(endAt) <= new Date(startAt)) {
      context.addIssue({
        code: "custom",
        path: ["endAt"],
        message: "结束时间必须晚于开始时间",
      });
    }
  });

export type CreateWorkSessionInput = z.infer<typeof createWorkSessionSchema>;
