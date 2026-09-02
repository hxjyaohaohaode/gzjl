import { describe, expect, it } from "vitest";

import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  normalizeLoginIdentifier,
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
  });
});
