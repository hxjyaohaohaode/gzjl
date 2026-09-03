const lightForeground = "#ffffff";
const darkForeground = "#172036";
const defaultAccent = "#5b5ce2";
const darkSurface = "#171c30";
const minimumSurfaceContrast = 3;

export interface HsvColor {
  hue: number;
  saturation: number;
  value: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

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

/** Convert a persisted sRGB hex value into the coordinates used by the picker. */
export function hexToHsv(value: string | null | undefined): HsvColor {
  const [red, green, blue] = rgb(sanitizeAccent(value)).map(
    (channel) => channel / 255,
  ) as [number, number, number];
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta) {
    if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  return {
    hue: (hue + 360) % 360,
    saturation: maximum === 0 ? 0 : (delta / maximum) * 100,
    value: maximum * 100,
  };
}

/** Convert picker coordinates to an exact six-digit sRGB value. */
export function hsvToHex({ hue, saturation, value }: HsvColor): string {
  const normalizedHue = ((hue % 360) + 360) % 360;
  const normalizedSaturation = clamp(saturation, 0, 100) / 100;
  const normalizedValue = clamp(value, 0, 100) / 100;
  const chroma = normalizedValue * normalizedSaturation;
  const offset = (normalizedHue / 60) % 2;
  const secondary = chroma * (1 - Math.abs(offset - 1));
  const match = normalizedValue - chroma;
  const channels =
    normalizedHue < 60
      ? [chroma, secondary, 0]
      : normalizedHue < 120
        ? [secondary, chroma, 0]
        : normalizedHue < 180
          ? [0, chroma, secondary]
          : normalizedHue < 240
            ? [0, secondary, chroma]
            : normalizedHue < 300
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary];
  return `#${channels
    .map((channel) =>
      Math.round((channel + match) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
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
