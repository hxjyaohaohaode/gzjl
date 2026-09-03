import { createHash, randomBytes } from "node:crypto";

import { argon2id, hash, verify } from "argon2";

export const SESSION_COOKIE_DEV = "workbench_session";
export const SESSION_COOKIE_PROD = "__Host-workbench_session";

export async function hashPassword(password: string): Promise<string> {
  return hash(password, {
    type: argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1,
  });
}

export async function verifyPassword(
  passwordHash: string,
  candidate: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, candidate);
  } catch {
    return false;
  }
}

export function createOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function normalizeLoginIdentifier(value: string): string {
  const normalized = value.trim();
  if (normalized.includes("@")) return normalized.toLocaleLowerCase("en-US");
  return normalizePhoneIdentifier(normalized);
}

/**
 * Chinese mobile numbers are commonly typed locally without a country code.
 * The UI accepts that familiar form while the database keeps one canonical
 * E.164 value, so `138...`, `86 138...`, and `+86 138...` cannot become three
 * different accounts. Other countries continue to use an explicit `+` code.
 */
export function normalizePhoneIdentifier(value: string): string {
  let compact = value.trim().replace(/[\s().-]/g, "");
  if (compact.startsWith("00")) compact = `+${compact.slice(2)}`;
  if (/^1[3-9]\d{9}$/.test(compact)) return `+86${compact}`;
  if (/^861[3-9]\d{9}$/.test(compact)) return `+${compact}`;
  return compact;
}

export function isE164PhoneIdentifier(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

/**
 * The browser never needs a full recovery identifier after it has been bound.
 * Return a stable, human-recognisable hint without leaking the address or
 * telephone number into client state, analytics, or screenshots.
 */
export function maskCredentialIdentifier(
  kind: "email" | "phone",
  normalizedIdentifier: string,
): string {
  if (kind === "phone") {
    const suffix = normalizedIdentifier.slice(-4);
    return `+********${suffix}`;
  }

  const at = normalizedIdentifier.lastIndexOf("@");
  if (at <= 0 || at === normalizedIdentifier.length - 1) return "***";
  const local = normalizedIdentifier.slice(0, at);
  const domain = normalizedIdentifier.slice(at + 1);
  const visibleSuffix = local.length > 2 ? local.slice(-1) : "";
  return `${local.slice(0, 1)}***${visibleSuffix}@${domain}`;
}
