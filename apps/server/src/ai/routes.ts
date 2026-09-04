import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import { isAuthorized } from "../auth/authorization.js";
import {
  InvalidCredentialsError,
  TotpCodeError,
  type AuthService,
} from "../auth/service.js";
import {
  AiConfigurationError,
  AiConfigurationForbiddenError,
  AiQuotaExceededError,
} from "./configuration.js";
import type { AiConfigurationService } from "./configuration.js";
import {
  AiJobConflictError,
  AiPayrollAccessError,
  AiUnavailableError,
  aiTaskTypes,
  type AiService,
} from "./service.js";

const requestSchema = z
  .object({
    taskType: z.enum(aiTaskTypes).default("weekly_summary"),
    scope: z.enum(["self", "team"]).default("self"),
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    question: z.string().trim().min(2).max(2_000).optional(),
    conversationId: z.string().trim().regex(/^[a-zA-Z0-9_-]{1,64}$/).optional(),
  })
  .superRefine((value, context) => {
    const from = new Date(value.from);
    const to = new Date(value.to);
    if (to <= from) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "结束时间必须晚于开始时间。",
      });
    }
    if (to.getTime() - from.getTime() > 366 * 86_400_000) {
      context.addIssue({
        code: "custom",
        path: ["from"],
        message: "单次 AI 分析最多覆盖 366 天，避免无界成本与失真结论。",
      });
    }
    if (value.taskType === "assistant_chat" && !value.question) {
      context.addIssue({
        code: "custom",
        path: ["question"],
        message: "请输入要询问 AI 的内容。",
      });
    }
  });
const reportParams = z.object({ reportId: z.uuid() });
const jobParams = z.object({ jobId: z.uuid() });
const settingsSchema = z
  .object({
    enabled: z.boolean(),
    baseUrl: z.string().trim().min(8).max(512),
    model: z.string().trim().min(1).max(160),
    dailyRequestLimit: z.number().int().min(1).max(10_000),
    monthlyRequestLimit: z.number().int().min(1).max(300_000),
    maxOutputTokens: z.number().int().min(128).max(16_000),
    apiKey: z.string().trim().min(8).max(2_000).optional(),
    clearApiKey: z.boolean().default(false),
  })
  .superRefine((input, context) => {
    if (input.clearApiKey && input.apiKey) {
      context.addIssue({
        code: "custom",
        path: ["apiKey"],
        message: "清除密钥与填写新密钥不能同时进行。",
      });
    }
    if (input.monthlyRequestLimit < input.dailyRequestLimit) {
      context.addIssue({
        code: "custom",
        path: ["monthlyRequestLimit"],
        message: "月度请求上限不能低于每日请求上限。",
      });
    }
  });
const updateSettingsSchema = settingsSchema.extend({
  password: z.string().min(8).max(1_024),
  totpCode: z.string().regex(/^\d{6}$/).optional(),
});
const checkSettingsSchema = z.object({
  password: z.string().min(8).max(1_024),
  totpCode: z.string().regex(/^\d{6}$/).optional(),
});

function sendConfigurationError(error: unknown, reply: {
  code: (statusCode: number) => { send: (payload: object) => unknown };
}) {
  // Changing an organization-wide provider key is a sensitive action. Keep a
  // bad current password and a bad TOTP code indistinguishable to callers,
  // while returning a deliberate authentication failure instead of letting it
  // fall through to Fastify's generic 500 handler.
  if (error instanceof InvalidCredentialsError || error instanceof TotpCodeError) {
    return reply.code(401).send({
      error: "sensitive_action_denied",
      message: "当前密码或动态验证码不正确。",
    });
  }
  if (error instanceof AiConfigurationForbiddenError) {
    return reply.code(403).send({
      error: "ai_configuration_forbidden",
      message: error.message,
    });
  }
  if (error instanceof AiConfigurationError) {
    return reply.code(409).send({
      error: "ai_configuration_invalid",
      message: error.message,
    });
  }
  throw error;
}

export async function registerAiRoutes(
  app: FastifyInstance,
  service: AiService,
  configuration: AiConfigurationService,
  authService: AuthService,
  authenticate: preHandlerHookHandler,
): Promise<void> {
  app.get(
    "/api/ai/reports",
    { preHandler: authenticate },
    async (request) => ({ items: await service.list(request.auth!) }),
  );
  app.get(
    "/api/ai/reports/:reportId",
    { preHandler: authenticate },
    async (request, reply) => {
      const { reportId } = reportParams.parse(request.params);
      const result = await service.detail(request.auth!, reportId);
      return result ?? reply.code(404).send({
        error: "report_not_found",
        message: "报告不存在。",
      });
    },
  );
  app.post(
    "/api/ai/reports",
    { preHandler: [app.csrfProtection, authenticate] },
    async (request, reply) => {
      const input = requestSchema.parse(request.body);
      if (
        input.scope === "team" &&
        (!request.auth ||
          !isAuthorized(request.auth.grants, "ai.team_analysis", {
            scopeKind: "organization",
          }))
      ) {
        return reply.code(403).send({
          error: "forbidden",
          message: "当前账号没有组织级团队 AI 分析权限。",
        });
      }
      if (
        input.taskType === "salary_explanation" &&
        (input.scope !== "self" ||
          !request.auth ||
          !isAuthorized(request.auth.grants, "payroll.view_own", {
            scopeKind: "self",
            scopeId: request.auth.membershipId,
          }))
      ) {
        return reply.code(403).send({
          error: "payroll_ai_forbidden",
          message: "薪资解释只支持本人范围，并要求查看本人薪资权限。",
        });
      }
      try {
        const job = await service.requestReport(request.auth!, {
          taskType: input.taskType,
          scope: input.scope,
          from: new Date(input.from),
          to: new Date(input.to),
          question: input.question,
          conversationId: input.conversationId,
        });
        return reply.code(202).send({ job });
      } catch (error) {
        if (error instanceof AiUnavailableError) {
          return reply.code(503).send({
            error: "ai_unavailable",
            message: error.message,
          });
        }
        if (error instanceof AiQuotaExceededError) {
          return reply.code(429).send({
            error: "ai_quota_exceeded",
            message: error.message,
          });
        }
        if (error instanceof AiPayrollAccessError) {
          return reply.code(403).send({
            error: "payroll_ai_forbidden",
            message: error.message,
          });
        }
        throw error;
      }
    },
  );
  app.post(
    "/api/ai/jobs/:jobId/cancel",
    { preHandler: [app.csrfProtection, authenticate] },
    async (request, reply) => {
      const { jobId } = jobParams.parse(request.params);
      try {
        const job = await service.cancel(request.auth!, jobId);
        return job
          ? { job }
          : reply.code(404).send({ error: "ai_job_not_found", message: "任务不存在。" });
      } catch (error) {
        if (error instanceof AiJobConflictError) {
          return reply.code(409).send({ error: "ai_job_conflict", message: error.message });
        }
        throw error;
      }
    },
  );
  app.post(
    "/api/ai/jobs/:jobId/retry",
    { preHandler: [app.csrfProtection, authenticate] },
    async (request, reply) => {
      const { jobId } = jobParams.parse(request.params);
      try {
        const job = await service.retry(request.auth!, jobId);
        return job
          ? reply.code(202).send({ job })
          : reply.code(404).send({ error: "ai_job_not_found", message: "任务不存在。" });
      } catch (error) {
        if (error instanceof AiJobConflictError) {
          return reply.code(409).send({ error: "ai_job_conflict", message: error.message });
        }
        throw error;
      }
    },
  );
  app.get(
    "/api/ai/settings",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        return await configuration.getSettings(request.auth!);
      } catch (error) {
        return sendConfigurationError(error, reply);
      }
    },
  );
  app.put(
    "/api/ai/settings",
    { preHandler: [app.csrfProtection, authenticate] },
    async (request, reply) => {
      const input = updateSettingsSchema.parse(request.body);
      try {
        await configuration.assertOwner(request.auth!);
        await authService.verifySensitiveAction(
          request.auth!,
          input.password,
          input.totpCode,
        );
        return await configuration.updateSettings(request.auth!, input);
      } catch (error) {
        return sendConfigurationError(error, reply);
      }
    },
  );
  app.get(
    "/api/ai/settings/checks",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        return { items: await configuration.listProviderChecks(request.auth!) };
      } catch (error) {
        return sendConfigurationError(error, reply);
      }
    },
  );
  app.post(
    "/api/ai/settings/check",
    { preHandler: [app.csrfProtection, authenticate] },
    async (request, reply) => {
      const input = checkSettingsSchema.parse(request.body);
      try {
        await configuration.assertOwner(request.auth!);
        await authService.verifySensitiveAction(
          request.auth!,
          input.password,
          input.totpCode,
        );
        return { check: await configuration.checkProvider(request.auth!) };
      } catch (error) {
        return sendConfigurationError(error, reply);
      }
    },
  );
}
