import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import {
  EvidenceForbiddenError,
  EvidenceNotFoundError,
  EvidenceValidationError,
  type EvidenceService,
} from "./service.js";

const sessionParams = z.object({ sessionId: z.uuid() });
const attachmentParams = z.object({ attachmentId: z.uuid() });
const visibility = z.enum(["private", "management_only", "project_visible"]);
const fileInput = z.object({
  originalName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255),
  // The effective size limit comes from ATTACHMENT_MAX_BYTES in the service
  // so the browser can receive one configuration-consistent error. This is a
  // broad transport guard only; a direct signed S3 PUT cannot exceed 5 GiB.
  sizeBytes: z.number().int().positive().max(5 * 1024 * 1024 * 1024),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .transform((value) => value.toLowerCase()),
  visibility: visibility.default("management_only"),
  note: z.string().trim().max(2_000).optional(),
});
const replacementInput = fileInput.extend({
  reason: z.string().trim().min(1).max(1_000),
});
const deleteInput = z.object({
  reason: z.string().trim().min(1).max(1_000),
});
const referenceInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("url"),
    externalUrl: z.url().max(2_048),
    visibility: visibility.default("management_only"),
    note: z.string().trim().max(2_000).optional(),
  }),
  z.object({
    kind: z.literal("text"),
    textContent: z.string().trim().min(1).max(20_000),
    visibility: visibility.default("management_only"),
    note: z.string().trim().max(2_000).optional(),
  }),
]);

function mapEvidenceError(error: unknown, reply: FastifyReply) {
  if (error instanceof EvidenceNotFoundError) {
    return reply.code(404).send({ error: "evidence_not_found", message: error.message });
  }
  if (error instanceof EvidenceForbiddenError) {
    return reply.code(403).send({ error: "forbidden", message: error.message });
  }
  if (error instanceof EvidenceValidationError) {
    return reply.code(409).send({ error: "invalid_evidence", message: error.message });
  }
  throw error;
}

export async function registerEvidenceRoutes(
  app: FastifyInstance,
  service: EvidenceService,
  authenticate: preHandlerHookHandler,
) {
  app.get(
    "/api/evidence/capabilities",
    { preHandler: authenticate },
    async () => service.capabilities(),
  );
  app.post(
    "/api/work-sessions/:sessionId/attachments/upload-intent",
    { preHandler: [app.csrfProtection, authenticate] },
    async (request, reply) => {
      try {
        const { sessionId } = sessionParams.parse(request.params);
        return reply.code(201).send(
          await service.initiateFile(request.auth!, sessionId, fileInput.parse(request.body)),
        );
      } catch (error) {
        return mapEvidenceError(error, reply);
      }
    },
  );

  app.post(
    "/api/attachments/:attachmentId/complete",
    { preHandler: [app.csrfProtection, authenticate] },
    async (request, reply) => {
      try {
        const { attachmentId } = attachmentParams.parse(request.params);
        return await service.completeFile(request.auth!, attachmentId);
      } catch (error) {
        return mapEvidenceError(error, reply);
      }
    },
  );

  app.post(
    "/api/attachments/:attachmentId/upload-url",
    { preHandler: [app.csrfProtection, authenticate] },
    async (request, reply) => {
      try {
        const { attachmentId } = attachmentParams.parse(request.params);
        return reply.code(201).send(
          await service.renewFileUploadUrl(request.auth!, attachmentId),
        );
      } catch (error) {
        return mapEvidenceError(error, reply);
      }
    },
  );

  app.post(
    "/api/attachments/:attachmentId/replacement-intent",
    { preHandler: [app.csrfProtection, authenticate] },
    async (request, reply) => {
      try {
        const { attachmentId } = attachmentParams.parse(request.params);
        return reply.code(201).send(
          await service.initiateReplacement(request.auth!, attachmentId, replacementInput.parse(request.body)),
        );
      } catch (error) {
        return mapEvidenceError(error, reply);
      }
    },
  );

  app.post(
    "/api/work-sessions/:sessionId/attachments/reference",
    { preHandler: [app.csrfProtection, authenticate] },
    async (request, reply) => {
      try {
        const { sessionId } = sessionParams.parse(request.params);
        return reply.code(201).send(
          await service.createReference(request.auth!, sessionId, referenceInput.parse(request.body)),
        );
      } catch (error) {
        return mapEvidenceError(error, reply);
      }
    },
  );

  app.get(
    "/api/work-sessions/:sessionId/attachments",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { sessionId } = sessionParams.parse(request.params);
        return { items: await service.listForSession(request.auth!, sessionId) };
      } catch (error) {
        return mapEvidenceError(error, reply);
      }
    },
  );

  app.get(
    "/api/attachments/:attachmentId/download",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { attachmentId } = attachmentParams.parse(request.params);
        return await service.download(request.auth!, attachmentId);
      } catch (error) {
        return mapEvidenceError(error, reply);
      }
    },
  );

  app.get(
    "/api/attachments/:attachmentId/versions",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { attachmentId } = attachmentParams.parse(request.params);
        return { items: await service.listVersions(request.auth!, attachmentId) };
      } catch (error) {
        return mapEvidenceError(error, reply);
      }
    },
  );

  app.delete(
    "/api/attachments/:attachmentId",
    { preHandler: [app.csrfProtection, authenticate] },
    async (request, reply) => {
      try {
        const { attachmentId } = attachmentParams.parse(request.params);
        return await service.remove(request.auth!, attachmentId, deleteInput.parse(request.body).reason);
      } catch (error) {
        return mapEvidenceError(error, reply);
      }
    },
  );
}
