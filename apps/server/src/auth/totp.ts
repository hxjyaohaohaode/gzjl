import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;

function encodeBase32(value: Buffer): string {
  let bits = 0;
  let accumulator = 0;
  let output = "";
  for (const byte of value) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(accumulator >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(accumulator << (5 - bits)) & 31];
  return output;
}

function decodeBase32(value: string): Buffer | null {
  const normalized = value.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z2-7]+$/.test(normalized)) return null;
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) return null;
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((accumulator >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function createTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function createTotpUri(secret: string, accountName: string): string {
  const issuer = "工作智能工作台";
  const label = `${issuer}:${accountName}`;
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

export function currentTotpCounter(now = new Date()): number {
  return Math.floor(now.getTime() / 1_000 / TOTP_STEP_SECONDS);
}

function codeAt(secret: string, counter: number): string | null {
  const key = decodeBase32(secret);
  if (!key || counter < 0) return null;
  const bytes = Buffer.alloc(8);
  bytes.writeUInt32BE(Math.floor(counter / 0x1_0000_0000), 0);
  bytes.writeUInt32BE(counter >>> 0, 4);
  const digest = createHmac("sha1", key).update(bytes).digest();
  const lastByte = digest.at(-1);
  if (lastByte === undefined) return null;
  const offset = lastByte & 15;
  const [first, second, third, fourth] = [digest.at(offset), digest.at(offset + 1), digest.at(offset + 2), digest.at(offset + 3)];
  if (first === undefined || second === undefined || third === undefined || fourth === undefined) return null;
  const numeric = ((first & 127) << 24) | (second << 16) | (third << 8) | fourth;
  return String(numeric % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, "0");
}

export function verifyTotp(secret: string, code: string, now = new Date()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const candidate = Buffer.from(code, "utf8");
  const counter = currentTotpCounter(now);
  for (let drift = -1; drift <= 1; drift += 1) {
    const expected = codeAt(secret, counter + drift);
    if (expected && timingSafeEqual(candidate, Buffer.from(expected, "utf8"))) return counter + drift;
  }
  return null;
}

function encryptionKey(sessionSecret: string): Buffer {
  return createHash("sha256").update("workbench:totp:v1:\0", "utf8").update(sessionSecret, "utf8").digest();
}

export function encryptTotpSecret(secret: string, sessionSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(sessionSecret), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptTotpSecret(ciphertext: string, sessionSecret: string): string | null {
  const [ivPart, tagPart, encryptedPart, extra] = ciphertext.split(".");
  if (!ivPart || !tagPart || !encryptedPart || extra) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(sessionSecret), Buffer.from(ivPart, "base64url"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedPart, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
