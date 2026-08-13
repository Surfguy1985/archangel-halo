/**
 * CORS origin policy (pure). Production without ALLOWED_ORIGINS is fail-closed.
 */

export function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isProductionEnv(env: { NODE_ENV?: string; HALO_ENV?: string }): boolean {
  return env.NODE_ENV === "production" || env.HALO_ENV === "production";
}

/**
 * Value for the `cors` package `origin` option.
 * Allowlist when set; reflect request origin in non-prod; deny cross-origin in prod.
 */
export function corsOriginSetting(env: {
  NODE_ENV?: string;
  HALO_ENV?: string;
  ALLOWED_ORIGINS?: string;
}): boolean | string[] {
  const origins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  if (origins.length > 0) return origins;
  if (isProductionEnv(env)) return false;
  return true;
}
