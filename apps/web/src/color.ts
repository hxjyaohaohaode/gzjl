const lightForeground = "#ffffff";
const darkForeground = "#172036";
const defaultAccent = "#5b5ce2";
const darkSurface = "#171c30";
const minimumSurfaceContrast = 3;

function relativeLuminance(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function rgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function luminance(hex: string): number {
  const [red, green, blue] = rgb(hex);
  return (
    0.2126 * relativeLuminance(red) +
    0.7152 * relativeLuminance(green) +
    0.0722 * relativeLuminance(blue)
  );
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function mixHex(first: string, second: string, weight: number): string {
  const [firstRed, firstGreen, firstBlue] = rgb(first);
  const [secondRed, secondGreen, secondBlue] = rgb(second);
  const mix = (start: number, end: number) =>
    Math.round(start * (1 - weight) + end * weight)
      .toString(16)
      .padStart(2, "0");
  return (
    "#" +
    mix(firstRed, secondRed) +
    mix(firstGreen, secondGreen) +
    mix(firstBlue, secondBlue)
  );
}

/** Pick the higher-contrast foreground for a validated six-digit hex color. */
export function readableForeground(hex: string): string {
  const value = sanitizeAccent(hex);
  const lightContrast = contrastRatio(value, lightForeground);
  const darkContrast = contrastRatio(value, darkForeground);
  return lightContrast >= darkContrast ? lightForeground : darkForeground;
}

/** Keep persisted accent values inside the color input's six-digit hex contract. */
export function sanitizeAccent(value: string | null | undefined): string {
  return value && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : defaultAccent;
}

/**
 * Keep custom accents distinguishable from both the default light work area and
 * the supported dark surface. The input stays in local storage unchanged; only
 * its effective visual token is gently moved toward the product indigo when
 * contrast would otherwise disappear.
 */
export function accessibleAccent(value: string | null | undefined): string {
  let candidate = sanitizeAccent(value);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const lightContrast = contrastRatio(candidate, lightForeground);
    const darkContrast = contrastRatio(candidate, darkSurface);
    if (
      lightContrast >= minimumSurfaceContrast &&
      darkContrast >= minimumSurfaceContrast
    )
      return candidate;
    candidate =
      lightContrast < minimumSurfaceContrast
        ? mixHex(candidate, "#4646bd", 0.22)
        : mixHex(candidate, "#8d91ff", 0.22);
  }
  return defaultAccent;
}
