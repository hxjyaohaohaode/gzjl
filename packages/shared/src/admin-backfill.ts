import { z } from "zod";
import { isoDateTimeSchema, timezoneSchema } from "./schemas.js";

// Unlinked work can only be confirmed by an organization or department reviewer.
// Project-only review grants must not become permission to create unrelated work.
export function canAdminBackfill(grants: readonly { permission: string; scopeKind: string; scopeId: string | null }[]): boolean {
  return grants.some((grant) => grant.permission === "work.review" &&
    (grant.scopeKind === "organization" || (grant.scopeKind === "org_unit" && Boolean(grant.scopeId))));
}

export const adminWorkBackfillSchema = z.object({
  membershipIds: z.array(z.uuid()).min(1, "请选择至少一位员工。").max(100, "一次最多补录 100 位员工。")
    .refine((ids) => new Set(ids).size === ids.length, "员工不能重复。"),
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema,
  timezone: timezoneSchema,
  content: z.string().trim().min(1, "请填写工作内容。").max(10_000),
}).strict().refine((input) => new Date(input.endAt) > new Date(input.startAt), {
  path: ["endAt"], message: "结束时间必须晚于开始时间。",
});

export type AdminWorkBackfillInput = z.infer<typeof adminWorkBackfillSchema>;
