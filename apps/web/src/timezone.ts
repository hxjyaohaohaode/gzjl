const browserTimezone =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";

let activeTimezone = browserTimezone;

export function setOrganizationTimezone(timezone: string | null | undefined): void {
  if (!timezone) {
    activeTimezone = browserTimezone;
    return;
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date(0));
    activeTimezone = timezone;
  } catch {
    activeTimezone = browserTimezone;
  }
}

export function getOrganizationTimezone(): string {
  return activeTimezone;
}

function partsAt(date: Date, timezone: string) {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(values.find((part) => part.type === type)?.value ?? 0);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

export function toZonedInputValue(
  date: Date,
  timezone = activeTimezone,
): string {
  const parts = partsAt(date, timezone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

export function zonedInputToDate(
  value: string,
  timezone = activeTimezone,
): Date {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!match) throw new RangeError("日期时间格式不正确。");
  const desired = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
  };
  const desiredAsUtc = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
    desired.second,
  );
  let candidate = new Date(desiredAsUtc);
  // Two passes normally converge; a third protects unusual historical
  // timezone transitions. This makes organization wall time authoritative,
  // independent of the device's local timezone.
  for (let pass = 0; pass < 3; pass += 1) {
    const represented = partsAt(candidate, timezone);
    const representedAsUtc = Date.UTC(
      represented.year,
      represented.month - 1,
      represented.day,
      represented.hour,
      represented.minute,
      represented.second,
    );
    candidate = new Date(candidate.getTime() + desiredAsUtc - representedAsUtc);
  }
  const final = partsAt(candidate, timezone);
  if (Object.keys(desired).some((key) => final[key as keyof typeof final] !== desired[key as keyof typeof desired])) {
    throw new RangeError("该本地时间在组织时区中不存在，请避开夏令时切换时刻。");
  }
  return candidate;
}
