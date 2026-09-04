import { describe, expect, it } from "vitest";

import {
  notificationPreferenceSchema,
  pushSubscriptionSchema,
} from "./routes.js";

describe("notification channel input boundaries", () => {
  it("accepts an HTTPS browser subscription with exact Web Push key sizes", () => {
    expect(
      pushSubscriptionSchema.parse({
        endpoint: "https://push.example.test/subscriptions/device",
        expirationTime: null,
        keys: {
          p256dh: Buffer.alloc(65, 1).toString("base64url"),
          auth: Buffer.alloc(16, 2).toString("base64url"),
        },
      }),
    ).toMatchObject({
      endpoint: "https://push.example.test/subscriptions/device",
    });
  });

  it("rejects non-HTTPS endpoints and malformed browser keys", () => {
    expect(() =>
      pushSubscriptionSchema.parse({
        endpoint: "http://push.example.test/device",
        keys: {
          p256dh: Buffer.alloc(64, 1).toString("base64url"),
          auth: Buffer.alloc(15, 2).toString("base64url"),
        },
      }),
    ).toThrow();
  });

  it("validates cross-midnight quiet hours and rejects invented time zones", () => {
    expect(
      notificationPreferenceSchema.parse({
        category: "timer_long_running",
        inAppEnabled: true,
        pushEnabled: true,
        emailEnabled: false,
        quietHours: {
          start: "22:00",
          end: "07:00",
          timeZone: "Asia/Shanghai",
        },
        mutedUntil: null,
      }).quietHours,
    ).toMatchObject({ start: "22:00", end: "07:00" });
    expect(() =>
      notificationPreferenceSchema.parse({
        category: "timer_long_running",
        inAppEnabled: true,
        pushEnabled: false,
        emailEnabled: false,
        quietHours: {
          start: "22:00",
          end: "07:00",
          timeZone: "Mars/Olympus",
        },
      }),
    ).toThrow();
  });
});
