const lightForeground = "#ffffff";
const darkForeground = "#15332a";
const defaultAccent = "#1f765c";

function relativeLuminance(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

/** Pick the higher-contrast foreground for a validated six-digit hex color. */
export function readableForeground(hex: string): string {
  const value = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return lightForeground;
  const red = relativeLuminance(Number.parseInt(value.slice(0, 2), 16));
  const green = relativeLuminance(Number.parseInt(value.slice(2, 4), 16));
  const blue = relativeLuminance(Number.parseInt(value.slice(4, 6), 16));
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  const lightContrast = 1.05 / (luminance + 0.05);
  const darkContrast = (luminance + 0.05) / 0.078;
  return lightContrast >= darkContrast ? lightForeground : darkForeground;
}

/** Keep persisted accent values inside the color input's six-digit hex contract. */
export function sanitizeAccent(value: string | null | undefined): string {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : defaultAccent;
}
