import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { Database } from "@workbench/db";
import { notificationPreferences, notifications } from "@workbench/db/schema";

const notificationParams = z.object({ notificationId: z.uuid() });
const preferenceSchema = z.object({ category: z.string().min(1).max(100), inAppEnabled: z.boolean(), pushEnabled: z.boolean(), emailEnabled: z.boolean(), quietHours: z.record(z.string(), z.unknown()).default({}) });

export async function registerNotificationRoutes(app: FastifyInstance, db: Database, authenticate: preHandlerHookHandler): Promise<void> {
  app.get("/api/notifications", { preHandler: authenticate }, async (request) => ({ items: await db.select().from(notifications).where(and(eq(notifications.organizationId, request.auth!.organizationId), eq(notifications.recipientMembershipId, request.auth!.membershipId), or(isNull(notifications.validUntil), gt(notifications.validUntil, new Date())))).orderBy(desc(notifications.createdAt)).limit(100) }));
  app.post("/api/notifications/:notificationId/read", { preHandler: [app.csrfProtection, authenticate] }, async (request, reply) => { const { notificationId } = notificationParams.parse(request.params); const [item] = await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, notificationId), eq(notifications.recipientMembershipId, request.auth!.membershipId), isNull(notifications.readAt))).returning(); return item ? { notification: item } : reply.code(404).send({ error: "notification_not_found", message: "通知不存在。" }); });
  app.get("/api/notification-preferences", { preHandler: authenticate }, async (request) => ({ items: await db.select().from(notificationPreferences).where(eq(notificationPreferences.membershipId, request.auth!.membershipId)) }));
  app.put("/api/notification-preferences", { preHandler: [app.csrfProtection, authenticate] }, async (request) => { const input = preferenceSchema.parse(request.body); const [preference] = await db.insert(notificationPreferences).values({ membershipId: request.auth!.membershipId, ...input }).onConflictDoUpdate({ target: [notificationPreferences.membershipId, notificationPreferences.category], set: { inAppEnabled: input.inAppEnabled, pushEnabled: input.pushEnabled, emailEnabled: input.emailEnabled, quietHours: input.quietHours, updatedAt: new Date() } }).returning(); return { preference }; });
}
