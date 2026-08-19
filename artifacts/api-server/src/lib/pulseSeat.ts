/**
 * Pulse seat — property-manager day-to-day workspace.
 *
 * Demo lock: only Thornbury at Chase Oaks is a Pulse property unless
 * HALO_PULSE_ALLOWLIST is set. Use "*" to serve every property (tests, later
 * multi-community Pulse). NODE_ENV=test with an empty allowlist disables the
 * lock so existing contract tests keep working.
 */
export const PULSE_PROPERTY_NAME = "Thornbury at Chase Oaks";

export type PulseEnv = {
  HALO_PULSE_ALLOWLIST?: string;
  NODE_ENV?: string;
};

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** null = every property is allowed. */
export function configuredPulseAllowlist(env: PulseEnv = process.env): string[] | null {
  const raw = env.HALO_PULSE_ALLOWLIST;
  if (raw === "*") return null;
  if (env.NODE_ENV === "test" && (raw == null || raw.trim() === "")) return null;
  const source = raw && raw.trim() ? raw : PULSE_PROPERTY_NAME;
  return source
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function namesMatchPulse(propertyName: string, allowed: string): boolean {
  const a = normalizeName(propertyName);
  const b = normalizeName(allowed);
  if (!a || !b) return false;
  if (a === b) return true;
  // Existing rows may be "Thornbury" while the lock is the full community name.
  if (a.includes("thornbury") && b.includes("thornbury")) return true;
  return false;
}

export function isPulsePropertyAllowed(
  propertyName: string,
  allowlist: string[] | null = configuredPulseAllowlist(),
): boolean {
  if (allowlist == null) return true;
  return allowlist.some((allowed) => namesMatchPulse(propertyName, allowed));
}

/**
 * The allowlist is the whole gate. HALO is passwordless by design — a valid
 * board link IS the credential — so there is no "sign in required" answer
 * here; `authenticated` is accepted only so callers read the same way.
 */
export function pulseSeatDenial(
  propertyName: string,
  _authenticated: boolean,
  allowlist: string[] | null = configuredPulseAllowlist(),
): { status: 404; body: Record<string, unknown> } | null {
  if (!isPulsePropertyAllowed(propertyName, allowlist)) {
    return {
      status: 404,
      body: { error: "This Pulse workspace is not available" },
    };
  }
  return null;
}
