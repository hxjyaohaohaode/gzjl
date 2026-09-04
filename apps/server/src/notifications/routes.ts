import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { Database } from "@workbench/db";
import { notificationPreferences, notifications } from "@workbench/db/schema";

const notificationParams = z.object({ notificationId: z.uuid() });
const notificationCategories = [
  "forgotten_work",
  "timer_long_running",
  "work_overlap",
  "continuous_work_long",
  "duration_baseline_change",
  "short_break",
  "project_due_soon",
  "blocked_node_aging",
  "approval_returned",
  "payroll_cutoff_pending",
  "identity_request_result",
  "export_ready",
  "export_failed",
  "ai_report_ready",
  "ai_report_failed",
] as const;
const preferenceSchema = z.object({
  category: z.enum(notificationCategories),
  inAppEnabled: z.boolean(),
  pushEnabled: z.boolean(),
  emailEnabled: z.boolean(),
  quietHours: z.record(z.string(), z.unknown()).default({}),
  mutedUntil: z.coerce.date().nullable().optional(),
}).superRefine((value, context) => {
  if (value.mutedUntil && (value.mutedUntil <= new Date() || value.mutedUntil.getTime() > Date.now() + 7 * 24 * 60 * 60_000)) context.addIssue({ code: "custom", message: "静音截止时间必须在未来 7 天内。", path: ["mutedUntil"] });
});

export async function registerNotificationRoutes(app: FastifyInstance, db: Database, authenticate: preHandlerHookHandler): Promise<void> {
  app.get("/api/notifications", { preHandler: authenticate }, async (request) => ({ items: await db.select().from(notifications).where(and(eq(notifications.organizationId, request.auth!.organizationId), eq(notifications.recipientMembershipId, request.auth!.membershipId), or(isNull(notifications.validUntil), gt(notifications.validUntil, new Date())))).orderBy(desc(notifications.createdAt)).limit(100) }));
  app.post("/api/notifications/:notificationId/read", { preHandler: [app.csrfProtection, authenticate] }, async (request, reply) => { const { notificationId } = notificationParams.parse(request.params); const [item] = await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, notificationId), eq(notifications.recipientMembershipId, request.auth!.membershipId), isNull(notifications.readAt))).returning(); return item ? { notification: item } : reply.code(404).send({ error: "notification_not_found", message: "通知不存在。" }); });
  app.post("/api/notifications/:notificationId/handled", { preHandler: [app.csrfProtection, authenticate] }, async (request, reply) => { const { notificationId } = notificationParams.parse(request.params); const [item] = await db.update(notifications).set({ handledAt: new Date(), readAt: new Date() }).where(and(eq(notifications.id, notificationId), eq(notifications.recipientMembershipId, request.auth!.membershipId), isNull(notifications.handledAt))).returning(); return item ? { notification: item } : reply.code(404).send({ error: "notification_not_found", message: "通知不存在或已处理。" }); });
  app.post("/api/notifications/:notificationId/ignore", { preHandler: [app.csrfProtection, authenticate] }, async (request, reply) => { const { notificationId } = notificationParams.parse(request.params); const [item] = await db.update(notifications).set({ ignoredAt: new Date(), readAt: new Date() }).where(and(eq(notifications.id, notificationId), eq(notifications.recipientMembershipId, request.auth!.membershipId), isNull(notifications.ignoredAt))).returning(); return item ? { notification: item } : reply.code(404).send({ error: "notification_not_found", message: "通知不存在或已忽略。" }); });
  app.get("/api/notification-preferences", { preHandler: authenticate }, async (request) => ({ items: await db.select().from(notificationPreferences).where(eq(notificationPreferences.membershipId, request.auth!.membershipId)) }));
  app.put("/api/notification-preferences", { preHandler: [app.csrfProtection, authenticate] }, async (request) => { const input = preferenceSchema.parse(request.body); const [preference] = await db.insert(notificationPreferences).values({ membershipId: request.auth!.membershipId, ...input }).onConflictDoUpdate({ target: [notificationPreferences.membershipId, notificationPreferences.category], set: { inAppEnabled: input.inAppEnabled, pushEnabled: input.pushEnabled, emailEnabled: input.emailEnabled, quietHours: input.quietHours, mutedUntil: input.mutedUntil ?? null, updatedAt: new Date() } }).returning(); return { preference }; });
}
