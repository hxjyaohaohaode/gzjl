const MICRO_SCALE = 1_000_000n;
const MICROS_PER_CENT = 10_000n;

function micros(value: string): bigint {
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(value)) throw new TypeError("Invalid decimal money");
  const negative = value.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const result = BigInt(whole) * MICRO_SCALE + BigInt(fraction.padEnd(6, "0"));
  return negative ? -result : result;
}

function centsText(value: bigint): string {
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

function roundedCents(value: bigint): bigint {
  const absolute = value < 0n ? -value : value;
  const rounded = (absolute + MICROS_PER_CENT / 2n) / MICROS_PER_CENT;
  return value < 0n ? -rounded : rounded;
}

/** Decimal half-up, including deductions; never passes money through a float. */
export function roundMoney(value: string): string {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) throw new TypeError("Invalid decimal money");
  const negative = value.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? value.slice(1) : value).split(".");
  let cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
  if ((fraction[2] ?? "0") >= "5") cents++;
  return centsText(negative ? -cents : cents);
}

/** Round the group once, then distribute its cents without changing its total.
 * Stable largest-remainder allocation prevents a sliced hour/day from adding
 * one rounding error per slice. The caller records each allocation in its trace.
 */
export function allocateRoundedMoney(values: string[]): string[] {
  const amounts = values.map(micros);
  const cents = amounts.map((amount) => amount / MICROS_PER_CENT);
  const target = roundedCents(amounts.reduce((total, amount) => total + amount, 0n));
  let difference = target - cents.reduce((total, amount) => total + amount, 0n);
  const direction = difference < 0n ? -1n : 1n;
  const order = amounts.map((amount, index) => ({ index, remainder: amount % MICROS_PER_CENT }))
    .sort((left, right) => left.remainder === right.remainder ? left.index - right.index
      : left.remainder > right.remainder ? Number(-direction) : Number(direction));
  for (const entry of order) {
    if (difference === 0n) break;
    cents[entry.index] = cents[entry.index]! + direction;
    difference -= direction;
  }
  if (difference !== 0n) throw new Error("Money allocation did not reconcile");
  return cents.map(centsText);
}

export function formatMoney(currency: string, value: string): string {
  const rounded = roundMoney(value);
  const [whole = "0", fraction = "00"] = rounded.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${currency} ${grouped}.${fraction}`;
}

/** Keep the locale's currency symbol without losing large integers or cents. */
export function formatCurrencyMoney(currency: string, value: string, locale = "zh-CN"): string {
  const rounded = roundMoney(value);
  const [whole = "0", fraction = "00"] = rounded.split(".");
  // BigInt has no negative zero. A negative template keeps the locale's sign
  // placement for deductions smaller than one currency unit.
  const negativeZero = whole === "-0";
  const integer = negativeZero ? -1n : BigInt(whole);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).formatToParts(integer).map((part) => {
      if (part.type === "fraction") return fraction;
      if (negativeZero && part.type === "integer") return "0";
      return part.value;
    }).join("");
  } catch {
    return formatMoney(currency, rounded);
  }
}
