import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { timezoneSchema } from "@workbench/shared";

import { requirePermission } from "../auth/authorization.js";
import type { ReimbursementService } from "./reimbursements.js";
import type { PayrollHandoffService } from "./handoff.js";
import {
  PayrollConflictError,
  PayrollNotFoundError,
  type PayrollService,
} from "./service.js";

const periodParams = z.object({ payPeriodId: z.uuid() });
const runParams = z.object({ runId: z.uuid() });
const memberParams = z.object({ membershipId: z.uuid() });
const payslipParams = z.object({ payslipId: z.uuid() });
const money = z
  .string()
  .trim()
  .regex(/^\d{1,14}(?:\.\d{1,6})?$/, "金额须为非负数，最多 14 位整数和 6 位小数。");
const multiplier = z
  .string()
  .trim()
  .regex(/^\d{1,4}(?:\.\d{1,6})?$/, "倍率格式不正确。");
const rateRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("weekday"), priority: z.number().int().min(1).max(10_000).default(100), multiplier }),
  z.object({ type: z.literal("weekend"), priority: z.number().int().min(1).max(10_000).default(100), multiplier }),
  z.object({ type: z.literal("holiday"), priority: z.number().int().min(1).max(10_000).default(100), multiplier, holidayDates: z.array(z.iso.date()).max(366).default([]) }),
  z.object({ type: z.literal("night_window"), priority: z.number().int().min(1).max(10_000).default(100), multiplier, startHour: z.number().int().min(0).max(23), endHour: z.number().int().min(0).max(23) }),
  z.object({ type: z.literal("overtime"), priority: z.number().int().min(1).max(10_000).default(100), multiplier, thresholdSeconds: z.number().int().min(60).max(604_800) }),
  z.object({ type: z.literal("weekly_bonus"), priority: z.number().int().min(1).max(10_000).default(400), thresholdSeconds: z.number().int().min(60).max(604_800), rewardSeconds: z.number().int().min(60).max(604_800) }),
]);
const planSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.enum(["hourly", "daily", "monthly", "fixed_period", "project_based", "hybrid"]),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default("CNY"),
  baseAmount: money,
  fixedAmount: money.optional(),
  subsidies: z.array(z.object({
    name: z.string().trim().min(1, "补贴名称不能为空。").max(60),
    amount: money,
    // Legacy daily was an implicit default. Ordinary amounts are fixed;
    // only the separately named explicit option enables proration.
    distribution: z.enum(["daily", "period_end", "prorated"]).default("period_end"),
  })).max(20, "每份薪资方案最多配置 20 项补贴。").default([]),
  effectiveFrom: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  effectiveTo: z.iso.datetime({ offset: true }).transform((value) => new Date(value)).optional(),
  pendingReviewCountsInEstimate: z.boolean().default(true),
  rules: z.array(rateRuleSchema).max(32).default([]),
}).superRefine((input, context) => {
  if (input.effectiveTo && input.effectiveTo <= input.effectiveFrom) {
    context.addIssue({ code: "custom", path: ["effectiveTo"], message: "计薪范围结束时间必须晚于开始时间。" });
  }
  if (input.type === "hybrid" && input.fixedAmount === undefined) {
    context.addIssue({ code: "custom", path: ["fixedAmount"], message: "混合计薪必须填写固定部分金额。" });
  }
  const weeklyBonusRules = input.rules.filter((rule) => rule.type === "weekly_bonus");
  if (weeklyBonusRules.length > 1) {
    context.addIssue({ code: "custom", path: ["rules"], message: "每个薪资方案只能配置一条周超时奖励规则。" });
  }
  if (weeklyBonusRules.length > 0 && !["hourly", "hybrid"].includes(input.type)) {
    context.addIssue({ code: "custom", path: ["rules"], message: "周超时奖励仅适用于时薪或混合计薪方案。" });
  }
});
const createPeriodSchema = z.object({
  name: z.string().trim().min(2).max(120),
  timezone: timezoneSchema,
  startsAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  endsAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  cutoffAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
});

export async function registerPayrollRoutes(
  app: FastifyInstance,
  service: PayrollService,
  authenticate: preHandlerHookHandler,
  reimbursements?: ReimbursementService,
  handoff?: PayrollHandoffService,
): Promise<void> {
  const ownPermission = requirePermission("payroll.view_own", (request) => ({
    scopeKind: "self",
    scopeId: request.auth?.membershipId ?? null,
  }));
  const settlePermission = requirePermission("payroll.settle", () => ({
    scopeKind: "organization",
  }));
  const configurePermission = requirePermission("payroll.configure", () => ({
    scopeKind: "organization",
  }));

  const handoffError = (error: unknown, reply: FastifyReply) => {
    if (error instanceof PayrollNotFoundError) return reply.code(404).send({ error: "payroll_not_found", message: error.message });
    if (error instanceof PayrollConflictError) return reply.code(409).send({ error: "payroll_conflict", message: error.message });
    throw error;
  };
  if (handoff) {
    app.get("/api/payroll-runs/:runId/report.xlsx", { preHandler: [authenticate, settlePermission, requirePermission("work.view_full_scope", () => ({ scopeKind: "organization" }))] }, async (request, reply) => {
      try {
        const file = await handoff.report(request.auth!, runParams.parse(request.params).runId);
        return reply.header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`).header("x-content-sha256", file.sha256).header("cache-control", "private, no-store").send(file.body);
      } catch (error) { return handoffError(error, reply); }
    });
    app.get("/api/payroll-runs/:runId/handoff.xlsx", { preHandler: [authenticate, settlePermission, requirePermission("work.view_full_scope", () => ({ scopeKind: "organization" }))] }, async (request, reply) => {
      try { const file = await handoff.workbook(request.auth!, runParams.parse(request.params).runId); return reply.header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`).header("x-content-sha256", file.sha256).header("cache-control", "private, no-store").send(file.body); } catch (error) { return handoffError(error, reply); }
    });
    app.get("/api/payroll-runs/:runId/handoff", { preHandler: [authenticate, settlePermission] }, async (request, reply) => {
      try { return await handoff.preview(request.auth!, runParams.parse(request.params).runId); } catch (error) { return handoffError(error, reply); }
    });
    app.post("/api/payroll-runs/:runId/handoff", { preHandler: [app.csrfProtection, authenticate, settlePermission] }, async (request, reply) => {
      const { previewHash } = z.object({ previewHash: z.string().regex(/^[a-f0-9]{64}$/), identityMatchingConfirmed: z.literal(true), exceptionsAcknowledged: z.literal(true) }).parse(request.body);
      try { return { batch: await handoff.confirm(request.auth!, runParams.parse(request.params).runId, previewHash) }; } catch (error) { return handoffError(error, reply); }
    });
    app.put("/api/payroll/members/:membershipId/external-identity", { preHandler: [app.csrfProtection, authenticate, configurePermission] }, async (request, reply) => {
      const { externalId } = z.object({ externalId: z.string().trim().min(1).max(120).refine((v) => [...v].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127), "编号不能包含控制字符。") }).parse(request.body);
      try { return await handoff.profile(request.auth!, z.object({ membershipId: z.uuid() }).parse(request.params).membershipId, externalId); } catch (error) { return handoffError(error, reply); }
    });
  }

  if (reimbursements) {
    app.get("/api/reimbursements", { preHandler: authenticate }, async (request) => {
      const query = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional(), pendingOnly: z.enum(["true", "false"]).transform((value) => value === "true").optional(), id: z.uuid().optional(),
        ownOnly: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
        reviewedOnly: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
        limit: z.coerce.number().int().min(1).max(100).default(100),
        before: z.string().refine((value) => { const [at, id, extra] = value.split("|"); return extra === undefined && z.iso.datetime({ offset: true }).safeParse(at).success && z.uuid().safeParse(id).success; }, "分页游标无效。").optional(),
      }).refine((value) => (!value.from && !value.to) || Boolean(value.from && value.to && value.to > value.from && Date.parse(value.to) - Date.parse(value.from) <= 366 * 86_400_000), "日期须成对指定，结束不含，范围为正且最多 366 天。").parse(request.query);
      return reimbursements.list(request.auth!, query);
    });
    app.post("/api/reimbursements", { preHandler: [app.csrfProtection, authenticate, ownPermission] }, async (request, reply) => {
      const input = z.object({ title: z.string().trim().min(2).max(120), description: z.string().trim().min(2).max(4000),
        expenseDate: z.iso.date(), amount: money.refine((value) => Number(value) > 0, "报销金额必须大于零。"),
        currency: z.string().regex(/^[A-Z]{3}$/).default("CNY") }).parse(request.body);
      return reply.code(201).send({ request: await reimbursements.create(request.auth!, input) });
    });
    app.post("/api/reimbursements/:id/actions", { preHandler: [app.csrfProtection, authenticate] }, async (request, reply) => {
      try {
        const { id } = z.object({ id: z.uuid() }).parse(request.params);
        const input = z.object({ action: z.enum(["submit", "cancel", "approve", "reject"]), expectedVersion: z.number().int().positive(),
          note: z.string().trim().max(2000).optional(), payPeriodId: z.uuid().optional() })
          .refine((value) => value.action !== "reject" || Boolean(value.note), "驳回时请填写原因。").parse(request.body);
        return { request: await reimbursements.act(request.auth!, id, input) };
      } catch (error) {
        if (error instanceof PayrollNotFoundError) return reply.code(404).send({ error: "not_found", message: "报销申请不存在。" });
        if (error instanceof PayrollConflictError) return reply.code(409).send({ error: "conflict", message: error.message });
        throw error;
      }
    });
  }

  app.get(
    "/api/payroll/management",
    { preHandler: [authenticate, configurePermission] },
    async (request) => service.managementOverview(request.auth!),
  );

  app.put(
    "/api/payroll/members/:membershipId/plan",
    { preHandler: [app.csrfProtection, authenticate, configurePermission] },
    async (request, reply) => {
      const { membershipId } = memberParams.parse(request.params);
      try {
        const input = planSchema.parse(request.body);
        return {
          result: await service.configurePlan(request.auth!, {
            membershipId,
            ...input,
          }),
        };
      } catch (error) {
        if (error instanceof PayrollNotFoundError) {
          return reply.code(404).send({ error: "payroll_member_not_found", message: "成员不存在或尚未接受邀请。" });
        }
        if (error instanceof PayrollConflictError) {
          return reply.code(409).send({ error: "payroll_conflict", message: error.message });
        }
        throw error;
      }
    },
  );

  app.patch(
    "/api/payroll/settings",
    { preHandler: [app.csrfProtection, authenticate, configurePermission] },
    async (request) => {
      const input = z.object({
        payrollCutoffDay: z.number().int().min(1).max(28),
        payrollCutoffMinute: z.number().int().min(0).max(1_439),
      }).parse(request.body);
      return {
        settings: await service.updateSettings(
          request.auth!,
          input.payrollCutoffDay,
          input.payrollCutoffMinute,
        ),
      };
    },
  );

  app.post(
    "/api/payroll/periods",
    { preHandler: [app.csrfProtection, authenticate, configurePermission] },
    async (request, reply) => {
      try {
        return { period: await service.createPeriod(request.auth!, createPeriodSchema.parse(request.body)) };
      } catch (error) {
        if (error instanceof PayrollConflictError) {
          return reply.code(409).send({ error: "payroll_conflict", message: error.message });
        }
        throw error;
      }
    },
  );

  app.delete(
    "/api/payroll/periods/:payPeriodId",
    { preHandler: [app.csrfProtection, authenticate, configurePermission] },
    async (request, reply) => {
      const { payPeriodId } = periodParams.parse(request.params);
      try {
        return { result: await service.deleteUncommittedPeriod(request.auth!, payPeriodId) };
      } catch (error) {
        if (error instanceof PayrollNotFoundError) {
          return reply.code(404).send({ error: "payroll_not_found", message: error.message });
        }
        if (error instanceof PayrollConflictError) {
          return reply.code(409).send({ error: "payroll_conflict", message: error.message });
        }
        throw error;
      }
    },
  );

  app.get(
    "/api/payroll/me",
    { preHandler: [authenticate, ownPermission] },
    async (request) => {
      const range = z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) }).refine((q) => Date.parse(q.to) > Date.parse(q.from) && Date.parse(q.to) - Date.parse(q.from) <= 366 * 86_400_000, "时间范围必须为正且最多 366 天。");
      const query = request.query as Record<string, unknown>;
      const selected = query.from !== undefined || query.to !== undefined ? range.parse(query) : null;
      return service.listOwn(request.auth!, selected ? { from: new Date(selected.from), to: new Date(selected.to) } : undefined);
    },
  );

  app.post(
    "/api/payroll/payslips/:payslipId/acknowledge",
    { preHandler: [app.csrfProtection, authenticate, ownPermission] },
    async (request, reply) => {
      const { payslipId } = payslipParams.parse(request.params);
      try {
        return { payslip: await service.acknowledgePayslip(request.auth!, payslipId) };
      } catch (error) {
        if (error instanceof PayrollNotFoundError) {
          return reply.code(404).send({ error: "payslip_not_found", message: error.message });
        }
        if (error instanceof PayrollConflictError) {
          return reply.code(409).send({ error: "payroll_conflict", message: error.message });
        }
        throw error;
      }
    },
  );

  app.post(
    "/api/pay-periods/:payPeriodId/calculate",
    { preHandler: [app.csrfProtection, authenticate, settlePermission] },
    async (request, reply) => {
      const { payPeriodId } = periodParams.parse(request.params);
      try {
        const run = await service.calculate(request.auth!, payPeriodId);
        return reply.code(202).send({ run });
      } catch (error) {
        if (error instanceof PayrollNotFoundError) {
          return reply.code(404).send({ error: "payroll_not_found", message: error.message });
        }
        if (error instanceof PayrollConflictError) {
          return reply.code(409).send({ error: "payroll_conflict", message: error.message });
        }
        throw error;
      }
    },
  );

  app.post(
    "/api/payroll-runs/:runId/settle",
    { preHandler: [app.csrfProtection, authenticate, settlePermission] },
    async (request, reply) => {
      const { runId } = runParams.parse(request.params);
      try {
        if (handoff) return reply.code(409).send({ error: "handoff_confirmation_required", message: "请先打开薪资交接预览，核对整批金额和外部人员编号后确认导出。", actionUrl: `/payroll-management/runs/${runId}` });
        return { run: await service.settle(request.auth!, runId) };
      } catch (error) {
        if (error instanceof PayrollNotFoundError) {
          return reply.code(404).send({ error: "payroll_not_found", message: error.message });
        }
        if (error instanceof PayrollConflictError) {
          return reply.code(409).send({ error: "payroll_conflict", message: error.message });
        }
        throw error;
      }
    },
  );

  app.post(
    "/api/payroll-runs/:runId/cancel-calculation",
    { preHandler: [app.csrfProtection, authenticate, settlePermission] },
    async (request, reply) => {
      const { runId } = runParams.parse(request.params);
      try {
        return { run: await service.cancelCalculation(request.auth!, runId) };
      } catch (error) {
        if (error instanceof PayrollNotFoundError) {
          return reply.code(404).send({ error: "payroll_not_found", message: error.message });
        }
        if (error instanceof PayrollConflictError) {
          return reply.code(409).send({ error: "payroll_conflict", message: error.message });
        }
        throw error;
      }
    },
  );

  app.get(
    "/api/payroll-runs/:runId/finance-export.csv",
    { preHandler: [authenticate, settlePermission] },
    async (request, reply) => {
      const { runId } = runParams.parse(request.params);
      try {
        if (handoff) {
          const preview = await handoff.preview(request.auth!, runId);
          if (!preview.batch && preview.run.status !== "settled") return reply.code(409).send({ error: "handoff_confirmation_required", message: "请先核对交接预览并确认保存原文件，再下载正式薪资依据。" });
        }
        const exported = await service.financeExport(request.auth!, runId);
        return reply
          .header("content-type", "text/csv; charset=utf-8")
          .header(
            "content-disposition",
            `attachment; filename*=UTF-8''${encodeURIComponent(exported.fileName)}`,
          )
          .header("cache-control", "private, no-store")
          .header("x-content-sha256", exported.sha256 ?? "")
          .send(exported.csv);
      } catch (error) {
        if (error instanceof PayrollNotFoundError) {
          return reply.code(404).send({ error: "payroll_not_found", message: error.message });
        }
        if (error instanceof PayrollConflictError) {
          return reply.code(409).send({ error: "payroll_conflict", message: error.message });
        }
        throw error;
      }
    },
  );

  app.post(
    "/api/payroll-runs/:runId/reopen",
    { preHandler: [app.csrfProtection, authenticate, settlePermission] },
    async (request, reply) => {
      const { runId } = runParams.parse(request.params);
      try {
        return { run: await service.reopenSettlement(request.auth!, runId) };
      } catch (error) {
        if (error instanceof PayrollNotFoundError) {
          return reply.code(404).send({ error: "payroll_not_found", message: error.message });
        }
        if (error instanceof PayrollConflictError) {
          return reply.code(409).send({ error: "payroll_conflict", message: error.message });
        }
        throw error;
      }
    },
  );
}
