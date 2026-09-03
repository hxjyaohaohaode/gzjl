import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import { requirePermission } from "../auth/authorization.js";
import {
  InvalidCredentialsError,
  TotpCodeError,
  type AuthService,
} from "../auth/service.js";
import { AuthDeliveryUnavailableError } from "../auth/mailer.js";
import {
  OrganizationConflictError,
  type OrganizationService,
} from "./service.js";

const nullableUuid = z.uuid().nullable();
const unitSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2_000).optional(),
  parentId: nullableUuid.default(null),
  leaderMembershipId: nullableUuid.optional(),
});
const unitParams = z.object({ unitId: z.uuid() });
const unitPatchSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
    parentId: nullableUuid.optional(),
    leaderMembershipId: nullableUuid.optional(),
  })
  .refine(
    (input) =>
      input.name !== undefined ||
      input.description !== undefined ||
      input.parentId !== undefined ||
      input.leaderMembershipId !== undefined,
    { message: "至少提供一个要更新的组织单元字段。" },
  );
const versionSchema = z.object({
  expectedVersion: z.number().int().positive(),
});
const inviteBaseSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  positionTitle: z.string().trim().max(120).optional(),
  orgUnitId: nullableUuid.default(null),
  roleId: z.uuid(),
});
const inviteSchema = z.discriminatedUnion("kind", [
  inviteBaseSchema.extend({
    kind: z.literal("email"),
    identifier: z.email().max(320),
  }),
  inviteBaseSchema.extend({
    kind: z.literal("phone"),
    identifier: z.string().regex(/^\+[1-9]\d{7,14}$/, "手机号须使用 E.164 格式，例如 +8613812345678。"),
  }),
]);
const membershipParams = z.object({ membershipId: z.uuid() });
const memberStatusSchema = z.object({ status: z.enum(["active", "inactive"]) });
const memberPatchSchema = z
  .object({
    positionTitle: z.string().trim().max(120).nullable().optional(),
    orgUnitId: nullableUuid.optional(),
  })
  .refine(
    (input) =>
      input.positionTitle !== undefined || input.orgUnitId !== undefined,
    { message: "至少提供一个要更新的成员字段。" },
  );
const roleGrantSchema = z.object({
  roleId: z.uuid(),
  scopeKind: z.enum(["organization", "org_unit", "project", "self"]),
  scopeId: nullableUuid.default(null),
});
const memberRolesSchema = z.object({
  grants: z.array(roleGrantSchema).max(30),
});
const identitySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2_000).optional(),
});
const memberIdentitiesSchema = z.object({
  identityIds: z.array(z.uuid()).max(30),
});
const identityChangeRequestSchema = z
  .object({
    action: z.enum(["add", "remove"]),
    identityId: z.uuid().optional(),
    requestedName: z.string().trim().min(1).max(120).optional(),
    reason: z.string().trim().max(2_000).optional(),
  })
  .superRefine((input, context) => {
    if (input.action === "add" && !input.identityId && !input.requestedName) {
      context.addIssue({
        code: "custom",
        message: "新增专业身份时请选择目录项或填写自定义名称。",
      });
    }
    if (input.action === "remove" && !input.identityId) {
      context.addIssue({
        code: "custom",
        message: "移除专业身份时必须选择当前已有身份。",
      });
    }
  });
const identityChangeRequestParams = z.object({ requestId: z.uuid() });
const reviewIdentityChangeSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reviewNote: z.string().trim().max(2_000).optional(),
});
const ownershipTransferParams = z.object({ transferId: z.uuid() });
const sensitiveActionVerificationSchema = z.object({
  password: z.string().min(8).max(1_024),
  totpCode: z.string().regex(/^\d{6}$/).optional(),
});
const ownershipTransferRequestSchema = sensitiveActionVerificationSchema.extend({
  toMembershipId: z.uuid(),
});
const acceptSchema = z.object({
  token: z.string().min(32).max(500),
  password: z
    .string()
    .min(12)
    .max(1_024)
    .regex(/[a-z]/)
    .regex(/[A-Z]/)
    .regex(/[0-9]/)
    .regex(/[^A-Za-z0-9]/),
});

function sendConflict(
  error: unknown,
  reply: {
    code: (statusCode: number) => { send: (payload: object) => unknown };
  },
) {
  if (error instanceof OrganizationConflictError)
    return reply
      .code(409)
      .send({ error: "organization_conflict", message: error.message });
  if (error instanceof AuthDeliveryUnavailableError)
    return reply
      .code(503)
      .send({ error: "delivery_unavailable", message: error.message });
  if (error instanceof InvalidCredentialsError || error instanceof TotpCodeError)
    return reply.code(401).send({
      error: "sensitive_action_verification_failed",
      message: "二次验证失败，请检查当前密码或动态验证码后重试。",
    });
  throw error;
}

export async function registerOrganizationRoutes(
  app: FastifyInstance,
  service: OrganizationService,
  authService: AuthService,
  authenticate: preHandlerHookHandler,
): Promise<void> {
  const manageMembers = requirePermission("members.manage", () => ({
    scopeKind: "organization",
  }));
  const manageOrg = requirePermission("org.manage", () => ({
    scopeKind: "organization",
  }));
  app.get(
    "/api/organization",
    { preHandler: [authenticate, manageMembers] },
    async (request) => service.overview(request.auth!),
  );
  app.post(
    "/api/organization/units",
    { preHandler: [app.csrfProtection, authenticate, manageOrg] },
    async (request, reply) => {
      try {
        return reply.code(201).send({
          unit: await service.createUnit(
            request.auth!,
            unitSchema.parse(request.body),
          ),
        });
      } catch (error) {
        return sendConflict(error, reply);
      }
    },
  );
  app.patch(
    "/api/organization/units/:unitId",
    { preHandler: [app.csrfProtection, authenticate, manageOrg] },
    async (request, reply) => {
      const { unitId } = unitParams.parse(request.params);
      const { expectedVersion, ...input } = unitPatchSchema.parse(request.body);
      try {
        return {
          unit: await service.updateUnit(
            request.auth!,
            unitId,
            expectedVersion,
            input,
          ),
        };
      } catch (error) {
        return sendConflict(error, reply);
      }
    },
  );
  app.post(
    "/api/organization/units/:unitId/archive",
    { preHandler: [app.csrfProtection, authenticate, manageOrg] },
    async (request, reply) => {
      const { unitId } = unitParams.parse(request.params);
      try {
        return {
          unit: await service.archiveUnit(
            request.auth!,
            unitId,
            versionSchema.parse(request.body).expectedVersion,
          ),
        };
      } catch (error) {
        return sendConflict(error, reply);
      }
    },
  );
  app.post(
    "/api/organization/professional-identities",
    { preHandler: [app.csrfProtection, authenticate, manageOrg] },
    async (request, reply) => {
      try {
        return reply.code(201).send({
          identity: await service.createProfessionalIdentity(
            request.auth!,
            identitySchema.parse(request.body),
          ),
        });
      } catch (error) {
        return sendConflict(error, reply);
      }
    },
  );
  app.get(
    "/api/organization/ownership-transfers/pending-for-me",
    { preHandler: authenticate },
    async (request) => ({
      transfer: await service.pendingOwnershipTransferForRecipient(
        request.auth!,
      ),
    }),
  );
  app.get(
    "/api/organization/my-identities",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        return await service.myIdentityProfile(request.auth!);
      } catch (error) {
        return sendConflict(error, reply);
      }
    },
  );
  app.post(
    "/api/organization/my-identities/requests",
    { preHandler: [app.csrfProtection, authenticate] },
    async (request, reply) => {
      try {
        return reply.code(201).send({
          request: await service.requestIdentityChange(
            request.auth!,
            identityChangeRequestSchema.parse(request.body),
          ),
        });
      } catch (error) {
        return sendConflict(error, reply);
      }
    },
  );
  app.get(
    "/api/organization/identity-change-requests",
    { preHandler: [authenticate, manageMembers] },
    async (request) => ({
      items: await service.identityChangeRequests(request.auth!),
    }),
  );
  app.post(
    "/api/organization/identity-change-requests/:requestId/review",
    { preHandler: [app.csrfProtection, authenticate, manageMembers] },
    async (request, reply) => {
      const { requestId } = identityChangeRequestParams.parse(request.params);
      try {
        return {
          request: await service.reviewIdentityChange(
            request.auth!,
            requestId,
            reviewIdentityChangeSchema.parse(request.body),
          ),
        };
      } catch (error) {
        return sendConflict(error, reply);
      }
    },
  );
  app.post(
    "/api/organization/ownership-transfers",
    {
      preHandler: [app.csrfProtection, authenticate, manageOrg],
      config: { rateLimit: { max: 5, timeWindow: "15 minutes", ban: 2 } },
    },
    async (request, reply) => {
      try {
        const input = ownershipTransferRequestSchema.parse(request.body);
        await authService.verifySensitiveAction(
          request.auth!,
          input.password,
          input.totpCode,
        );
        return reply.code(201).send({
          transfer: await service.requestOwnershipTransfer(
            request.auth!,
            input.toMembershipId,
          ),
        });
      } catch (error) {
        return sendConflict(error, reply);
      }
    },
  );
  app.post(
    "/api/organization/ownership-transfers/:transferId/confirm",
    {
      preHandler: [app.csrfProtection, authenticate],
      config: { rateLimit: { max: 5, timeWindow: "15 minutes", ban: 2 } },
    },
    async (request, reply) => {
      const { transferId } = ownershipTransferParams.parse(request.params);
      try {
        const input = sensitiveActionVerificationSchema.parse(request.body);
        await authService.verifySensitiveAction(
          request.auth!,
          input.password,
          input.totpCode,
        );
        return {
          transfer: await service.confirmOwnershipTransfer(
            request.auth!,
            transferId,
          ),
        };
      } catch (error) {
        return sendConflict(error, reply);
      }
    },
  );
  app.post(
    "/api/organization/ownership-transfers/:transferId/cancel",
    { preHandler: [app.csrfProtection, authenticate] },
    async (request, reply) => {
      const { transferId } = ownershipTransferParams.parse(request.params);
      try {
        return {
          transfer: await service.cancelOwnershipTransfer(
            request.auth!,
            transferId,
          ),
        };
      } catch (error) {
        return sendConflict(error, reply);
      }
    },
  );
  app.post(
    "/api/organization/invitations",
    { preHandler: [app.csrfProtection, authenticate, manageMembers] },
    async (request, reply) => {
      try {
        const input = inviteSchema.parse(request.body);
        const invitation = await service.invite(request.auth!, input);
        return reply
          .code(201)
          .send(
            await service.deliverInvitation(
              invitation,
              input.displayName,
              input.identifier,
              input.kind,
            ),
          );
      } catch (error) {
        return sendConflict(error, reply);
      }
    },
  );
  app.post(
    "/api/organization/invitations/:membershipId/resend",
    { preHandler: [app.csrfProtection, authenticate, manageMembers] },
    async (request, reply) => {
      const { membershipId } = membershipParams.parse(request.params);
      try {
        return {
          invitation: await service.resendInvitation(request.auth!, membershipId),
        };
      } catch (error) {
        return sendConflict(error, reply);
      }
    },
  );
  app.patch(
    "/api/organization/members/:membershipId",
    { preHandler: [app.csrfProtection, authenticate, manageMembers] },
    async (request, reply) => {
      const { membershipId } = membershipParams.parse(request.params);
      try {
        return {
          membership: await service.updateMember(
            request.auth!,
            membershipId,
            memberPatchSchema.parse(request.body),
          ),
        };
      } catch (error) {
        return sendConflict(error, reply);
      }
    },
  );
  app.put(
    "/api/organization/members/:membershipId/roles",
    { preHandler: [app.csrfProtection, authenticate, manageMembers] },
    async (request, reply) => {
      const { membershipId } = membershipParams.parse(request.params);
      try {
        await service.replaceMemberRoles(
          request.auth!,
          membershipId,
          memberRolesSchema.parse(request.body).grants,
        );
        return reply.code(204).send();
      } catch (error) {
        return sendConflict(error, reply);
      }
    },
  );
  app.put(
    "/api/organization/members/:membershipId/identities",
    { preHandler: [app.csrfProtection, authenticate, manageMembers] },
    async (request, reply) => {
      const { membershipId } = membershipParams.parse(request.params);
      try {
        await service.replaceMemberIdentities(
          request.auth!,
          membershipId,
          memberIdentitiesSchema.parse(request.body).identityIds,
        );
        return reply.code(204).send();
      } catch (error) {
        return sendConflict(error, reply);
      }
    },
  );
  app.patch(
    "/api/organization/members/:membershipId/status",
    { preHandler: [app.csrfProtection, authenticate, manageMembers] },
    async (request, reply) => {
      const { membershipId } = membershipParams.parse(request.params);
      const { status } = memberStatusSchema.parse(request.body);
      try {
        return {
          membership: await service.setMemberStatus(
            request.auth!,
            membershipId,
            status,
          ),
        };
      } catch (error) {
        return sendConflict(error, reply);
      }
    },
  );
  app.post(
    "/api/auth/invitations/accept",
    { preHandler: app.csrfProtection },
    async (request, reply) => {
      const input = acceptSchema.parse(request.body);
      try {
        return {
          membership: await service.acceptInvitation(
            input.token,
            input.password,
          ),
        };
      } catch (error) {
        return sendConflict(error, reply);
      }
    },
  );
}
