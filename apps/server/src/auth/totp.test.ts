import { describe, expect, it } from "vitest";

import { createTotpSecret, decryptTotpSecret, encryptTotpSecret, verifyTotp } from "./totp.js";

describe("TOTP security primitives", () => {
  it("encrypts a generated shared secret without retaining plaintext", () => {
    const secret = createTotpSecret();
    const ciphertext = encryptTotpSecret(secret, "this-is-a-test-session-secret-with-at-least-32-bytes");
    expect(ciphertext).not.toContain(secret);
    expect(decryptTotpSecret(ciphertext, "this-is-a-test-session-secret-with-at-least-32-bytes")).toBe(secret);
    expect(decryptTotpSecret(ciphertext, "a-different-test-session-secret-with-at-least-32-bytes")).toBeNull();
  });

  it("validates the RFC 6238 SHA-1 test vector in the permitted time step", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    // RFC 6238's eight-digit 94287082 becomes 287082 for this product's six-digit policy.
    expect(verifyTotp(secret, "287082", new Date(59_000))).toBe(1);
    expect(verifyTotp(secret, "287082", new Date(180_000))).toBeNull();
  });
});
