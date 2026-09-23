import { and, eq } from "drizzle-orm";
import type { Database } from "@workbench/db";
import { notificationPreferences, notifications, orgMemberships, pushSubscriptions } from "@workbench/db/schema";

import { isWithinQuietHours } from "./push.js";

/** A queue row records intent, not a lasting permission to notify a browser. */
export async function currentPushEligibility(db: Database, notificationId: string, subscriptionId: string, now = new Date()) {
  const [current] = await db.select({ notification: notifications, subscription: pushSubscriptions, member: orgMemberships })
    .from(notifications)
    .innerJoin(orgMemberships, eq(orgMemberships.id, notifications.recipientMembershipId))
    .innerJoin(pushSubscriptions, eq(pushSubscriptions.id, subscriptionId))
    .where(eq(notifications.id, notificationId)).limit(1);
  if (!current || current.member.status !== "active" ||
      current.member.organizationId !== current.notification.organizationId ||
      current.subscription.membershipId !== current.notification.recipientMembershipId ||
      current.subscription.disabledAt ||
      (current.subscription.expiresAt && current.subscription.expiresAt <= now) ||
      (current.notification.validUntil && current.notification.validUntil <= now) ||
      current.notification.readAt || current.notification.handledAt || current.notification.ignoredAt) {
    return { decision: "cancel" as const };
  }
  const [preference] = await db.select().from(notificationPreferences).where(and(
    eq(notificationPreferences.membershipId, current.member.id),
    eq(notificationPreferences.category, current.notification.category),
  )).limit(1);
  if (!preference?.pushEnabled) return { decision: "cancel" as const };
  if ((preference.mutedUntil && preference.mutedUntil > now) || isWithinQuietHours(preference.quietHours, now)) {
    return { decision: "defer" as const };
  }
  return { decision: "send" as const, ...current };
}
