import { describe, expect, it } from "vitest";

import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  isE164PhoneIdentifier,
  maskCredentialIdentifier,
  normalizeLoginIdentifier,
  normalizePhoneIdentifier,
  verifyPassword,
} from "./security.js";

describe("authentication security", () => {
  it("hashes passwords with Argon2id and verifies only the original value", async () => {
    const passwordHash = await hashPassword("Strong-Test-Password-123!");

    expect(passwordHash).toContain("$argon2id$");
    await expect(verifyPassword(passwordHash, "Strong-Test-Password-123!")).resolves.toBe(true);
    await expect(verifyPassword(passwordHash, "wrong-password")).resolves.toBe(false);
  });

  it("creates non-reversible session token hashes", () => {
    const token = createOpaqueToken();
    const tokenHash = hashOpaqueToken(token);

    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenHash).not.toContain(token);
  });

  it("normalizes email and phone identifiers without conflating credentials", () => {
    expect(normalizeLoginIdentifier(" Owner@Example.TEST ")).toBe("owner@example.test");
    expect(normalizeLoginIdentifier("+86 (138) 0000-0000")).toBe("+8613800000000");
    expect(normalizeLoginIdentifier("138 0000 0000")).toBe("+8613800000000");
    expect(normalizeLoginIdentifier("86-138-0000-0000")).toBe("+8613800000000");
    expect(normalizePhoneIdentifier("0044 7700 900123")).toBe("+447700900123");
    expect(isE164PhoneIdentifier(normalizePhoneIdentifier("13800000000"))).toBe(true);
    expect(isE164PhoneIdentifier(normalizePhoneIdentifier("12345"))).toBe(false);
  });

  it("only exposes masked recovery identifiers to a signed-in browser", () => {
    expect(maskCredentialIdentifier("email", "owner@example.test")).toBe(
      "o***r@example.test",
    );
    expect(maskCredentialIdentifier("phone", "+8613800000000")).toBe(
      "+********0000",
    );
  });
});
