/**
 * Postgres unique-index violation (SQLSTATE 23505).
 *
 * Drizzle wraps the underlying pg error inside a DrizzleQueryError, so the
 * SQLSTATE code may live on `error.code` OR on `error.cause.code`.  Both
 * must be checked — reading only `error.code` silently misses the wrapped
 * case and returns 500 instead of the expected 409.
 */
export function isUniqueViolation(e: unknown): boolean {
  const code =
    (e as { code?: string })?.code ??
    (e as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}
