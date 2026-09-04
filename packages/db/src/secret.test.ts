import { describe, expect, it } from "vitest";

import {
  decryptScopedSecret,
  decryptSecret,
  encryptScopedSecret,
  encryptSecret,
  SecretCipherError,
} from "./secret.js";

const key = "test-only-organization-ai-envelope-key-at-least-32-bytes";

describe("organization AI secret envelope", () => {
  it("round-trips an API key without retaining plaintext in ciphertext", () => {
    const plaintext = "provider-key-that-must-never-reach-a-browser";
    const ciphertext = encryptSecret(plaintext, key);

    expect(ciphertext).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(ciphertext).not.toContain(plaintext);
    expect(decryptSecret(ciphertext, key)).toBe(plaintext);
  });

  it("fails closed for a wrong key or a tampered envelope", () => {
    const ciphertext = encryptSecret("provider-key", key);

    expect(() => decryptSecret(ciphertext, `${key}-other`)).toThrow(
      SecretCipherError,
    );
    expect(() => decryptSecret(`${ciphertext}x`, key)).toThrow(
      SecretCipherError,
    );
  });

  it("domain-separates scoped application secrets", () => {
    const ciphertext = encryptScopedSecret(
      "https://push.example.test/subscription",
      key,
      "push.endpoint",
    );

    expect(ciphertext).toMatch(/^v2\./);
    expect(
      decryptScopedSecret(ciphertext, key, "push.endpoint"),
    ).toBe("https://push.example.test/subscription");
    expect(() =>
      decryptScopedSecret(ciphertext, key, "push.auth"),
    ).toThrow(SecretCipherError);
    expect(() => decryptSecret(ciphertext, key)).toThrow(SecretCipherError);
  });
});
