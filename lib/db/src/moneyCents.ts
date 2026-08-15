/**
 * Integer-cents money helper for the client board.
 *
 * All money is bigint cents. Never a float, never a JS number for arithmetic
 * beyond display. Formatters may accept bigint only.
 */

export type Cents = bigint;

const CENTS_PER_DOLLAR = 100n;

export function toCents(value: bigint | number | string): Cents {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error("cents must be a finite integer (no floats)");
    }
    return BigInt(value);
  }
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(`invalid cents string: ${value}`);
  }
  return BigInt(trimmed);
}

export function addCents(...parts: Cents[]): Cents {
  let total = 0n;
  for (const part of parts) total += part;
  return total;
}

export function subCents(a: Cents, b: Cents): Cents {
  return a - b;
}

/** Integer quantity only — fractional qty belongs in milli-units, not floats. */
export function mulCents(unitPrice: Cents, qty: bigint | number): Cents {
  const q = typeof qty === "bigint" ? qty : toCents(qty);
  return unitPrice * q;
}

/**
 * Vacancy cost: over-target calendar days × monthly market rent / days-in-month.
 * Integer division (truncates toward zero) so the figure is defensible in a room.
 */
export function vacancyCostCents(args: {
  overTargetDays: bigint | number;
  marketRentCents: Cents;
  daysInMonth: bigint | number;
}): Cents {
  const days = toCents(args.overTargetDays);
  const monthDays = toCents(args.daysInMonth);
  if (monthDays <= 0n) throw new Error("daysInMonth must be > 0");
  if (days <= 0n) return 0n;
  return (days * args.marketRentCents) / monthDays;
}

/** Parse a dollar string from an Entrata CSV ("$1,450.00") into bigint cents. */
export function dollarsToCents(value: string): Cents {
  const cleaned = value.trim().replace(/[$,]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new Error(`invalid dollar string: ${value}`);
  }
  const negative = cleaned.startsWith("-");
  const unsigned = negative ? cleaned.slice(1) : cleaned;
  const [dollars, frac = ""] = unsigned.split(".");
  const cents = BigInt(dollars || "0") * CENTS_PER_DOLLAR + BigInt((frac + "00").slice(0, 2));
  return negative ? -cents : cents;
}

/** Display only. Never round-trip this string back into arithmetic. */
export function formatUsd(cents: Cents): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const dollars = abs / CENTS_PER_DOLLAR;
  const frac = abs % CENTS_PER_DOLLAR;
  const body = `${dollars.toString()}.${frac.toString().padStart(2, "0")}`;
  const withCommas = body.replace(/^(-?\d+)/, (whole) =>
    whole.replace(/\B(?=(\d{3})+(?!\d))/g, ","),
  );
  return `${negative ? "-" : ""}$${withCommas}`;
}
