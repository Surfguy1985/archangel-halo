export function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function average(values: number[], fallback: number): number {
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return fallback;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

export function ratio(numerator: number, denominator: number, fallback: number): number {
  if (!Number.isFinite(denominator) || denominator <= 0) return fallback;
  return clamp(numerator / denominator, 0, 1);
}

export function bayesianAverage(
  observedAverage: number,
  observedCount: number,
  priorAverage: number,
  priorWeight: number
): number {
  const count = Math.max(0, observedCount);
  return (observedAverage * count + priorAverage * priorWeight) / (count + priorWeight);
}

export function decimalToCents(value: string | number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) throw new Error(`Invalid money value: ${value}`);
  return Math.round(numeric * 100);
}

export function centsToDecimal(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error(`Money cents must be a safe integer: ${cents}`);
  return (cents / 100).toFixed(2);
}

export function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

export function monthsBetween(start: Date, end: Date): number {
  const years = end.getUTCFullYear() - start.getUTCFullYear();
  const months = end.getUTCMonth() - start.getUTCMonth();
  const dayAdjustment = end.getUTCDate() < start.getUTCDate() ? -1 : 0;
  return Math.max(0, years * 12 + months + dayAdjustment);
}
