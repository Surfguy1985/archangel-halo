/** Display only. Parse the cents string as bigint; never use JS number arithmetic. */
export function formatUsdCents(cents: string): string {
  let value: bigint;
  try {
    value = BigInt(cents);
  } catch {
    return "$—";
  }
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const dollars = abs / 100n;
  const frac = abs % 100n;
  const body = `${dollars.toString()}.${frac.toString().padStart(2, "0")}`;
  const withCommas = body.replace(/^(-?\d+)/, (whole) =>
    whole.replace(/\B(?=(\d{3})+(?!\d))/g, ","),
  );
  return `${negative ? "-" : ""}$${withCommas}`;
}

export function signedUsdCents(cents: string): string {
  const formatted = formatUsdCents(cents);
  if (cents.startsWith("-") || cents === "0") return formatted;
  return `+${formatted}`;
}
