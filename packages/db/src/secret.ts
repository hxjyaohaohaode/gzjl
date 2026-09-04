import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const algorithm = "aes-256-gcm";
const legacyVersion = "v1";
const scopedVersion = "v2";
const legacyAad = Buffer.from("workbench.organization-ai-key", "utf8");

export class SecretCipherError extends Error {
  constructor() {
    super("加密配置无法读取，请由 Owner 重新配置密钥。");
    this.name = "SecretCipherError";
  }
}

function deriveKey(secret: string): Buffer {
  if (secret.length < 32) throw new SecretCipherError();
  return createHash("sha256").update(secret, "utf8").digest();
}

/**
 * `Buffer.from(value, "base64url")` deliberately accepts some malformed
 * values.  Credentials are security boundaries, so accept only the canonical
 * unpadded base64url form that encryptSecret emits.
 */
function decodeEnvelopeSegment(value: string): Buffer {
  if (
    !/^[A-Za-z0-9_-]+$/.test(value) ||
    value.length % 4 === 1
  ) {
    throw new Error("invalid envelope segment");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length === 0 || decoded.toString("base64url") !== value) {
    throw new Error("non-canonical envelope segment");
  }
  return decoded;
}

/** Encrypts a short provider credential with authenticated encryption. */
function encryptEnvelope(
  plaintext: string,
  secret: string,
  version: string,
  aad: Buffer,
): string {
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv(algorithm, deriveKey(secret), iv);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      version,
      iv.toString("base64url"),
      tag.toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  } catch {
    throw new SecretCipherError();
  }
}

function decryptEnvelope(
  ciphertext: string,
  secret: string,
  expectedVersion: string,
  aad: Buffer,
): string {
  try {
    const [cipherVersion, ivValue, tagValue, encryptedValue, ...extra] =
      ciphertext.split(".");
    if (
      cipherVersion !== expectedVersion ||
      !ivValue ||
      !tagValue ||
      !encryptedValue ||
      extra.length > 0
    ) {
      throw new Error("invalid ciphertext");
    }
    const iv = decodeEnvelopeSegment(ivValue);
    const tag = decodeEnvelopeSegment(tagValue);
    const encrypted = decodeEnvelopeSegment(encryptedValue);
    if (iv.length !== 12 || tag.length !== 16) {
      throw new Error("invalid envelope dimensions");
    }
    const decipher = createDecipheriv(
      algorithm,
      deriveKey(secret),
      iv,
    );
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new SecretCipherError();
  }
}

/** Encrypts an existing organization AI key with the stable legacy envelope. */
export function encryptSecret(plaintext: string, secret: string): string {
  return encryptEnvelope(plaintext, secret, legacyVersion, legacyAad);
}

/** Decrypts an existing organization AI key without changing stored values. */
export function decryptSecret(ciphertext: string, secret: string): string {
  return decryptEnvelope(ciphertext, secret, legacyVersion, legacyAad);
}

function scopedAad(scope: string): Buffer {
  if (!/^[a-z0-9][a-z0-9._:-]{0,79}$/.test(scope)) {
    throw new SecretCipherError();
  }
  return Buffer.from(`workbench.secret.${scope}`, "utf8");
}

/**
 * Encrypts non-AI application secrets with authenticated, domain-separated
 * envelopes. The scope is deliberately not stored next to the ciphertext: a
 * caller must know the field's purpose in order to decrypt it.
 */
export function encryptScopedSecret(
  plaintext: string,
  secret: string,
  scope: string,
): string {
  return encryptEnvelope(plaintext, secret, scopedVersion, scopedAad(scope));
}

export function decryptScopedSecret(
  ciphertext: string,
  secret: string,
  scope: string,
): string {
  return decryptEnvelope(ciphertext, secret, scopedVersion, scopedAad(scope));
}
