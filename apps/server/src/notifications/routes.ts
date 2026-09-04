import { createHash } from "node:crypto";

import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { Database } from "@workbench/db";
import { encryptScopedSecret } from "@workbench/db";
import {
  auditLogs,
  notificationPreferences,
  notifications,
  outboxEvents,
  pushSubscriptions,
} from "@workbench/db/schema";

import type { ServerConfig } from "../config.js";

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

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const quietHoursSchema = z.union([
  z.object({}).strict(),
  z
    .object({
      start: timeOfDay,
      end: timeOfDay,
      timeZone: z.string().min(1).max(100),
    })
    .strict()
    .superRefine((value, context) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value.timeZone }).format();
      } catch {
        context.addIssue({
          code: "custom",
          path: ["timeZone"],
          message: "请选择有效的 IANA 时区。",
        });
      }
      if (value.start === value.end) {
        context.addIssue({
          code: "custom",
          path: ["end"],
          message: "免打扰开始和结束时间不能相同。",
        });
      }
    }),
]);

export const notificationPreferenceSchema = z
  .object({
    category: z.enum(notificationCategories),
    inAppEnabled: z.boolean(),
    pushEnabled: z.boolean(),
    emailEnabled: z.literal(false),
    quietHours: quietHoursSchema.default({}),
    mutedUntil: z.coerce.date().nullable().optional(),
  })
  .superRefine((value, context) => {
    if (
      value.mutedUntil &&
      (value.mutedUntil <= new Date() ||
        value.mutedUntil.getTime() > Date.now() + 7 * 24 * 60 * 60_000)
    ) {
      context.addIssue({
        code: "custom",
        message: "静音截止时间必须在未来 7 天内。",
        path: ["mutedUntil"],
      });
    }
  });

const pushKey = z
  .string()
  .min(20)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+={0,2}$/);
const p256dhKey = pushKey.refine(
  (value) => Buffer.from(value.replace(/=+$/, ""), "base64url").length === 65,
  { message: "p256dh 必须是 65 字节的浏览器公钥。" },
);
const authKey = pushKey.refine(
  (value) => Buffer.from(value.replace(/=+$/, ""), "base64url").length === 16,
  { message: "auth 必须是 16 字节的浏览器认证密钥。" },
);
const pushEndpoint = z
  .url()
  .max(2_048)
  .refine((value) => new URL(value).protocol === "https:", {
    message: "推送订阅地址必须使用 HTTPS。",
  });
export const pushSubscriptionSchema = z.object({
  endpoint: pushEndpoint,
  expirationTime: z.number().int().positive().nullable().optional(),
  previousEndpoint: pushEndpoint.optional(),
  keys: z.object({
    p256dh: p256dhKey,
    auth: authKey,
  }),
}).superRefine((value, context) => {
  if (value.expirationTime && value.expirationTime <= Date.now()) {
    context.addIssue({
      code: "custom",
      path: ["expirationTime"],
      message: "浏览器推送订阅已经过期。",
    });
  }
});
const unsubscribeSchema = z.object({ endpoint: pushEndpoint });

function endpointHash(endpoint: string): string {
  return createHash("sha256").update(endpoint, "utf8").digest("hex");
}

function pushConfigured(config: ServerConfig): boolean {
  return Boolean(
    config.VAPID_PUBLIC_KEY && config.PUSH_SUBSCRIPTION_ENCRYPTION_KEY,
  );
}

export async function registerNotificationRoutes(
  app: FastifyInstance,
  db: Database,
  authenticate: preHandlerHookHandler,
  config: ServerConfig,
): Promise<void> {
  app.get(
    "/api/notifications",
    { preHandler: authenticate },
    async (request) => {
      const [candidates, preferences] = await Promise.all([
        db
          .select()
          .from(notifications)
          .where(
            and(
              eq(notifications.organizationId, request.auth!.organizationId),
              eq(
                notifications.recipientMembershipId,
                request.auth!.membershipId,
              ),
              or(
                isNull(notifications.validUntil),
                gt(notifications.validUntil, new Date()),
              ),
            ),
          )
          .orderBy(desc(notifications.createdAt))
          .limit(300),
        db
          .select()
          .from(notificationPreferences)
          .where(
            eq(
              notificationPreferences.membershipId,
              request.auth!.membershipId,
            ),
          ),
      ]);
      const byCategory = new Map(
        preferences.map((preference) => [preference.category, preference]),
      );
      const now = new Date();
      return {
        items: candidates
          .filter((item) => {
            const preference = byCategory.get(item.category);
            return (
              (!preference || preference.inAppEnabled) &&
              (!preference?.mutedUntil || preference.mutedUntil <= now)
            );
          })
          .slice(0, 100),
      };
    },
  );

  app.post(
    "/api/notifications/:notificationId/read",
    { preHandler: [app.csrfProtection, authenticate] },
    async (request, reply) => {
      const { notificationId } = notificationParams.parse(request.params);
      const [item] = await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.id, notificationId),
            eq(
              notifications.recipientMembershipId,
              request.auth!.membershipId,
            ),
            isNull(notifications.readAt),
          ),
        )
        .returning();
      return item
        ? { notification: item }
        : reply.code(404).send({
            error: "notification_not_found",
            message: "通知不存在。",
          });
    },
  );

  app.post(
    "/api/notifications/:notificationId/handled",
    { preHandler: [app.csrfProtection, authenticate] },
    async (request, reply) => {
      const { notificationId } = notificationParams.parse(request.params);
      const [item] = await db
        .update(notifications)
        .set({ handledAt: new Date(), readAt: new Date() })
        .where(
          and(
            eq(notifications.id, notificationId),
            eq(
              notifications.recipientMembershipId,
              request.auth!.membershipId,
            ),
            isNull(notifications.handledAt),
          ),
        )
        .returning();
      return item
        ? { notification: item }
        : reply.code(404).send({
            error: "notification_not_found",
            message: "通知不存在或已处理。",
          });
    },
  );

  app.post(
    "/api/notifications/:notificationId/ignore",
    { preHandler: [app.csrfProtection, authenticate] },
    async (request, reply) => {
      const { notificationId } = notificationParams.parse(request.params);
      const [item] = await db
        .update(notifications)
        .set({ ignoredAt: new Date(), readAt: new Date() })
        .where(
          and(
            eq(notifications.id, notificationId),
            eq(
              notifications.recipientMembershipId,
              request.auth!.membershipId,
            ),
            isNull(notifications.ignoredAt),
          ),
        )
        .returning();
      return item
        ? { notification: item }
        : reply.code(404).send({
            error: "notification_not_found",
            message: "通知不存在或已忽略。",
          });
    },
  );

  app.get(
    "/api/notification-preferences",
    { preHandler: authenticate },
    async (request) => ({
      items: await db
        .select()
        .from(notificationPreferences)
        .where(
          eq(
            notificationPreferences.membershipId,
            request.auth!.membershipId,
          ),
        ),
    }),
  );

  app.put(
    "/api/notification-preferences/quiet-hours",
    { preHandler: [app.csrfProtection, authenticate] },
    async (request) => {
      const { quietHours } = z
        .object({ quietHours: quietHoursSchema })
        .parse(request.body);
      const updatedAt = new Date();
      await db
        .insert(notificationPreferences)
        .values(
          notificationCategories.map((category) => ({
            membershipId: request.auth!.membershipId,
            category,
            quietHours,
            updatedAt,
          })),
        )
        .onConflictDoUpdate({
          target: [
            notificationPreferences.membershipId,
            notificationPreferences.category,
          ],
          set: { quietHours, updatedAt },
        });
      return { quietHours, categoryCount: notificationCategories.length };
    },
  );

  app.put(
    "/api/notification-preferences",
    { preHandler: [app.csrfProtection, authenticate] },
    async (request, reply) => {
      const input = notificationPreferenceSchema.parse(request.body);
      if (input.pushEnabled) {
        if (!pushConfigured(config)) {
          return reply.code(409).send({
            error: "push_not_configured",
            message: "组织尚未配置浏览器推送服务。",
          });
        }
        const [subscription] = await db
          .select({ id: pushSubscriptions.id })
          .from(pushSubscriptions)
          .where(
            and(
              eq(
                pushSubscriptions.membershipId,
                request.auth!.membershipId,
              ),
              isNull(pushSubscriptions.disabledAt),
              or(
                isNull(pushSubscriptions.expiresAt),
                gt(pushSubscriptions.expiresAt, new Date()),
              ),
            ),
          )
          .limit(1);
        if (!subscription) {
          return reply.code(409).send({
            error: "push_subscription_required",
            message: "请先在当前浏览器启用推送，再开启分类推送。",
          });
        }
      }
      const [preference] = await db
        .insert(notificationPreferences)
        .values({ membershipId: request.auth!.membershipId, ...input })
        .onConflictDoUpdate({
          target: [
            notificationPreferences.membershipId,
            notificationPreferences.category,
          ],
          set: {
            inAppEnabled: input.inAppEnabled,
            pushEnabled: input.pushEnabled,
            emailEnabled: false,
            quietHours: input.quietHours,
            mutedUntil: input.mutedUntil ?? null,
            updatedAt: new Date(),
          },
        })
        .returning();
      return { preference };
    },
  );

  app.get(
    "/api/push/configuration",
    { preHandler: authenticate },
    async (request) => {
      const active = await db
        .select({
          id: pushSubscriptions.id,
          createdAt: pushSubscriptions.createdAt,
          lastSuccessAt: pushSubscriptions.lastSuccessAt,
          userAgent: pushSubscriptions.userAgent,
          expiresAt: pushSubscriptions.expiresAt,
        })
        .from(pushSubscriptions)
        .where(
          and(
            eq(
              pushSubscriptions.membershipId,
              request.auth!.membershipId,
            ),
            isNull(pushSubscriptions.disabledAt),
            or(
              isNull(pushSubscriptions.expiresAt),
              gt(pushSubscriptions.expiresAt, new Date()),
            ),
          ),
        );
      const available = pushConfigured(config);
      return {
        available,
        publicKey: available ? config.VAPID_PUBLIC_KEY : null,
        activeSubscriptions: active,
      };
    },
  );

  app.post(
    "/api/push/subscriptions",
    { preHandler: [app.csrfProtection, authenticate] },
    async (request, reply) => {
      if (!pushConfigured(config)) {
        return reply.code(503).send({
          error: "push_not_configured",
          message: "浏览器推送服务尚未配置。",
        });
      }
      const input = pushSubscriptionSchema.parse(request.body);
      const hash = endpointHash(input.endpoint);
      const encryptionKey = config.PUSH_SUBSCRIPTION_ENCRYPTION_KEY!;
      const encrypted = {
        endpointCiphertext: encryptScopedSecret(
          input.endpoint,
          encryptionKey,
          "push.endpoint",
        ),
        p256dhCiphertext: encryptScopedSecret(
          input.keys.p256dh,
          encryptionKey,
          "push.p256dh",
        ),
        authCiphertext: encryptScopedSecret(
          input.keys.auth,
          encryptionKey,
          "push.auth",
        ),
      };
      const [subscription] = await db.transaction(async (tx) => {
        const [saved] = await tx
          .insert(pushSubscriptions)
          .values({
            membershipId: request.auth!.membershipId,
            endpointHash: hash,
            ...encrypted,
            userAgent: request.headers["user-agent"]?.slice(0, 500) ?? null,
            expiresAt: input.expirationTime
              ? new Date(input.expirationTime)
              : null,
          })
          .onConflictDoUpdate({
            target: pushSubscriptions.endpointHash,
            set: {
              membershipId: request.auth!.membershipId,
              ...encrypted,
              userAgent: request.headers["user-agent"]?.slice(0, 500) ?? null,
              expiresAt: input.expirationTime
                ? new Date(input.expirationTime)
                : null,
              disabledAt: null,
            },
          })
          .returning();
        if (
          input.previousEndpoint &&
          input.previousEndpoint !== input.endpoint
        ) {
          await tx
            .update(pushSubscriptions)
            .set({ disabledAt: new Date() })
            .where(
              and(
                eq(
                  pushSubscriptions.endpointHash,
                  endpointHash(input.previousEndpoint),
                ),
                eq(
                  pushSubscriptions.membershipId,
                  request.auth!.membershipId,
                ),
                isNull(pushSubscriptions.disabledAt),
              ),
            );
        }
        await tx.insert(auditLogs).values({
          organizationId: request.auth!.organizationId,
          actorMembershipId: request.auth!.membershipId,
          action: "push.subscription.upserted",
          entityType: "push_subscription",
          entityId: saved!.id,
          after: {
            endpointHash: hash,
            expirationTime: input.expirationTime ?? null,
            rotatedPreviousEndpoint: Boolean(input.previousEndpoint),
          },
          requestId: request.id,
        });
        await tx.insert(outboxEvents).values({
          organizationId: request.auth!.organizationId,
          eventType: "push.subscription.updated",
          entityType: "push_subscription",
          entityId: saved!.id,
          entityVersion: 1,
          payload: { membershipId: request.auth!.membershipId },
        });
        return [saved!];
      });
      return reply.code(201).send({
        subscription: {
          id: subscription.id,
          createdAt: subscription.createdAt,
          userAgent: subscription.userAgent,
        },
      });
    },
  );

  app.delete(
    "/api/push/subscriptions",
    { preHandler: [app.csrfProtection, authenticate] },
    async (request, reply) => {
      const input = unsubscribeSchema.parse(request.body);
      const [disabled] = await db.transaction(async (tx) => {
        const [saved] = await tx
          .update(pushSubscriptions)
          .set({ disabledAt: new Date() })
          .where(
            and(
              eq(pushSubscriptions.endpointHash, endpointHash(input.endpoint)),
              eq(
                pushSubscriptions.membershipId,
                request.auth!.membershipId,
              ),
              isNull(pushSubscriptions.disabledAt),
            ),
          )
          .returning({ id: pushSubscriptions.id });
        if (!saved) return [];
        await tx.insert(auditLogs).values({
          organizationId: request.auth!.organizationId,
          actorMembershipId: request.auth!.membershipId,
          action: "push.subscription.disabled",
          entityType: "push_subscription",
          entityId: saved.id,
          requestId: request.id,
        });
        return [saved];
      });
      if (!disabled) {
        return reply.code(404).send({
          error: "push_subscription_not_found",
          message: "当前浏览器没有可停用的推送订阅。",
        });
      }
      return reply.code(204).send();
    },
  );
}
