export function ser<T extends Record<string, unknown>>(
  row: T,
): { [K in keyof T]: T[K] extends Date ? string : T[K] } {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = value instanceof Date ? value.toISOString() : value;
  }
  return out as { [K in keyof T]: T[K] extends Date ? string : T[K] };
}

export function serList<T extends Record<string, unknown>>(rows: T[]) {
  return rows.map((r) => ser(r));
}
