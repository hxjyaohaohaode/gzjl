import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import { requirePermission } from "../auth/authorization.js";
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
  effectiveFrom: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  pendingReviewCountsInEstimate: z.boolean().default(true),
  rules: z.array(rateRuleSchema).max(32).default([]),
}).superRefine((input, context) => {
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
  timezone: z.string().trim().min(3).max(64),
  startsAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  endsAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  cutoffAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
});

export async function registerPayrollRoutes(
  app: FastifyInstance,
  service: PayrollService,
  authenticate: preHandlerHookHandler,
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
      const input = z.object({ payrollCutoffDay: z.number().int().min(1).max(28) }).parse(request.body);
      return { settings: await service.updateSettings(request.auth!, input.payrollCutoffDay) };
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

  app.get(
    "/api/payroll/me",
    { preHandler: [authenticate, ownPermission] },
    async (request) => service.listOwn(request.auth!),
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
}
