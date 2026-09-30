import { z } from "zod";
export const workRecordFiltersSchema = z.object({
  projectId: z.uuid().optional(), nodeId: z.uuid().optional(), memberId: z.uuid().optional(), orgUnitId: z.uuid().optional(), workTypeId: z.uuid().optional(),
  approvalState: z.enum(["not_requested", "pending_review", "approved", "returned", "locked"]).optional(),
  sourceType: z.enum(["manual", "timer", "import"]).optional(),
});
export type WorkRecordFilters = z.infer<typeof workRecordFiltersSchema>;
