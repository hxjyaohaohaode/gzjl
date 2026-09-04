export interface QuietHours {
  start: string;
  end: string;
  timeZone: string;
}

function parseClock(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function parseQuietHours(value: unknown): QuietHours | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.start !== "string" ||
    typeof candidate.end !== "string" ||
    typeof candidate.timeZone !== "string" ||
    parseClock(candidate.start) === null ||
    parseClock(candidate.end) === null ||
    candidate.start === candidate.end
  ) {
    return null;
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: candidate.timeZone }).format();
  } catch {
    return null;
  }
  return {
    start: candidate.start,
    end: candidate.end,
    timeZone: candidate.timeZone,
  };
}

export function isWithinQuietHours(value: unknown, now = new Date()): boolean {
  const quiet = parseQuietHours(value);
  if (!quiet) return false;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: quiet.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const current = hour * 60 + minute;
  const start = parseClock(quiet.start)!;
  const end = parseClock(quiet.end)!;
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
}

export function webPushStatusCode(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === "number" ? statusCode : null;
}

export function isPermanentWebPushFailure(error: unknown): boolean {
  const status = webPushStatusCode(error);
  return status === 404 || status === 410;
}

export function pushRetryDelayMs(attempt: number): number {
  const exponent = Math.max(0, Math.min(6, attempt - 1));
  return Math.min(6 * 60 * 60_000, 30_000 * 2 ** exponent);
}
