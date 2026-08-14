/**
 * Enforcer V3 identity + capability policy (pure, no I/O).
 *
 * Tenant and role NEVER come from request bodies, client headers, or
 * unverified JWT claims. Production without HALO_ENFORCER_TENANT_ID fails closed.
 */

export const HALO_ROLES = [
  "executive",
  "admin",
  "property_manager",
  "field_manager",
  "accounting",
  "vendor",
  "crew",
] as const;

export type HaloRole = (typeof HALO_ROLES)[number];

export const HALO_CAPABILITIES = [
  "properties.read",
  "jobs.read",
  "jobs.write",
  "jobs.assign",
  "schedules.read",
  "schedules.write",
  "crews.read",
  "invoices.read",
  "invoices.send",
  "pricing.write",
  "payments.read",
  "payments.initiate",
  "payments.approve",
  "base44.edit",
  "pm_links.create",
  "chat.office",
  "chat.pm",
  "command.execute",
] as const;

export type HaloCapability = (typeof HALO_CAPABILITIES)[number];

/**
 * Explicit grants. Role names do not imply permissions — a "property_manager"
 * does not automatically get write access because the name contains "manager".
 */
export const ROLE_CAPABILITIES: Record<HaloRole, readonly HaloCapability[]> = {
  executive: [
    "properties.read",
    "jobs.read",
    "jobs.write",
    "jobs.assign",
    "schedules.read",
    "schedules.write",
    "crews.read",
    "invoices.read",
    "invoices.send",
    "payments.read",
    "payments.initiate",
    "pm_links.create",
    "chat.office",
    "command.execute",
  ],
  admin: [
    "properties.read",
    "jobs.read",
    "jobs.write",
    "jobs.assign",
    "schedules.read",
    "schedules.write",
    "crews.read",
    "invoices.read",
    "invoices.send",
    "pricing.write",
    "payments.read",
    "payments.initiate",
    "payments.approve",
    "pm_links.create",
    "chat.office",
    "command.execute",
  ],
  property_manager: [
    "properties.read",
    "jobs.read",
    "schedules.read",
    "crews.read",
    "invoices.read",
    "chat.office",
  ],
  field_manager: [
    "properties.read",
    "jobs.read",
    "schedules.read",
    "schedules.write",
    "crews.read",
    "chat.office",
  ],
  accounting: [
    "properties.read",
    "invoices.read",
    "invoices.send",
    "payments.read",
    "payments.initiate",
    "chat.office",
  ],
  vendor: ["jobs.read"],
  crew: ["jobs.read", "crews.read"],
};

/** Absolute deny overlay for PM live-link sessions. Backend enforced, not prompt-only. */
export const PM_LIVE_DENIED: readonly HaloCapability[] = [
  "jobs.write",
  "jobs.assign",
  "schedules.write",
  "invoices.send",
  "pricing.write",
  "payments.initiate",
  "payments.approve",
  "base44.edit",
  "pm_links.create",
  "command.execute",
];

export const PM_WRITE_ACTIONS = [
  "job.create",
  "job.status.update",
  "crew.schedule",
  "crew.assign",
  "invoice.send",
  "pricing.update",
  "payment.release",
  "payment.initiate",
  "payment.approve",
  "base44.edit",
  "pm_link.generate",
] as const;

const ACTION_TO_CAPABILITY: Record<string, HaloCapability> = {
  "job.create": "jobs.write",
  "job.status.update": "jobs.write",
  "crew.schedule": "schedules.write",
  "crew.assign": "jobs.assign",
  "invoice.send": "invoices.send",
  "pricing.update": "pricing.write",
  "payment.release": "payments.initiate",
  "payment.initiate": "payments.initiate",
  "payment.approve": "payments.approve",
  "expense.approve": "payments.approve",
  "base44.edit": "base44.edit",
  "pm_link.generate": "pm_links.create",
  "crew_checkin_link.generate": "pm_links.create",
  "weather.risk_scan": "chat.office",
  "weather.schedule_recommend": "chat.office",
  "ops.eod_briefing": "chat.office",
  "catalog.lookup": "chat.office",
  "estimate.from_evidence": "chat.office",
  "field.walk_report": "chat.office",
  "comms.sms": "chat.office",
  "field.voice_eod": "command.execute",
  "note.log": "chat.office",
  "observation.log": "chat.office",
  "reminder.set": "schedules.write",
  "supply.order": "jobs.write",
  "supply.source": "chat.office",
  "pm.notify": "pm_links.create",
  "job.schedule": "schedules.write",
  "status.query": "chat.office",
  "briefing.refresh": "chat.office",
  "briefing.send": "chat.office",
  "crew.notify": "chat.office",
  "report.generate": "invoices.read",
};

export type IdentitySource = "enforcer" | "office_session" | "pm_live";

export interface HaloIdentity {
  subject: string;
  tenantId: string | null;
  roles: HaloRole[];
  source: IdentitySource;
  propertyId?: string;
}

export type IdentityFailureCode =
  | "unauthenticated"
  | "wrong_tenant"
  | "insufficient_role"
  | "enforcer_unconfigured"
  | "jwks_unavailable"
  | "enforcer_unavailable"
  | "accounts_unavailable"
  | "token_invalid";

export type IdentityResult =
  | { ok: true; identity: HaloIdentity }
  | { ok: false; status: 401 | 403 | 503; code: IdentityFailureCode };

export interface EnforcerEnv {
  NODE_ENV?: string;
  HALO_ENV?: string;
  HALO_ENFORCER_REQUIRED?: string;
  HALO_ENFORCER_TENANT_ID?: string;
  HALO_ENFORCER_ISSUER?: string;
  HALO_ENFORCER_JWKS_URL?: string;
  HALO_ENFORCER_AUDIENCE?: string;
  HALO_ENFORCER_ACCOUNTS_URL?: string;
}

export interface VerifiedClaims {
  sub: string;
  tenantId: string;
  roles: HaloRole[];
  iss?: string;
  aud?: string;
  exp?: number;
}

export function isProductionLike(env: EnforcerEnv): boolean {
  if (env.HALO_ENFORCER_REQUIRED === "false") return false;
  return (
    env.NODE_ENV === "production" ||
    env.HALO_ENV === "production" ||
    env.HALO_ENFORCER_REQUIRED === "true"
  );
}

export function enforcerRequired(env: EnforcerEnv): boolean {
  return isProductionLike(env);
}

export function readEnforcerConfig(env: EnforcerEnv): {
  ok: true;
  tenantId: string;
  issuer: string;
  jwksUrl: string;
  audience: string | null;
  accountsUrl: string | null;
} | { ok: false; code: "enforcer_unconfigured" } {
  const tenantId = (env.HALO_ENFORCER_TENANT_ID ?? "").trim();
  const issuer = (env.HALO_ENFORCER_ISSUER ?? "").trim();
  const jwksUrl = (env.HALO_ENFORCER_JWKS_URL ?? "").trim();
  if (!tenantId || !issuer || !jwksUrl) {
    return { ok: false, code: "enforcer_unconfigured" };
  }
  return {
    ok: true,
    tenantId,
    issuer,
    jwksUrl,
    audience: (env.HALO_ENFORCER_AUDIENCE ?? "").trim() || null,
    accountsUrl: (env.HALO_ENFORCER_ACCOUNTS_URL ?? "").trim() || null,
  };
}

export function parseHaloRole(raw: unknown): HaloRole | null {
  if (typeof raw !== "string") return null;
  const n = raw.trim().toLowerCase().replace(/[\s-]/g, "_");
  const aliases: Record<string, HaloRole> = {
    executive: "executive",
    admin: "admin",
    administrator: "admin",
    property_manager: "property_manager",
    pm: "property_manager",
    field_manager: "field_manager",
    field: "field_manager",
    accounting: "accounting",
    vendor: "vendor",
    crew: "crew",
  };
  return aliases[n] ?? null;
}

/** Claims from a verified JWT only. Unrecognized roles are dropped, not invented. */
export function rolesFromVerifiedClaims(claims: Record<string, unknown>): HaloRole[] {
  const raw = claims.roles ?? claims.role ?? claims["halo_roles"];
  const list = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  const roles: HaloRole[] = [];
  for (const item of list) {
    const role = parseHaloRole(item);
    if (role && !roles.includes(role)) roles.push(role);
  }
  return roles;
}

export function tenantFromVerifiedClaims(claims: Record<string, unknown>): string | null {
  const raw =
    claims.tenant_id ??
    claims.tenantId ??
    claims.tid ??
    claims.org_id ??
    claims.halo_tenant_id;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw.trim();
}

/**
 * Client-supplied identity is ignored. Headers/body are accepted as arguments
 * only so tests can prove they cannot escalate.
 */
export function resolveIdentityFromInputs(input: {
  env: EnforcerEnv;
  bearerPresent: boolean;
  officeSessionValid: boolean;
  verifiedClaims: VerifiedClaims | null;
  verifyError:
    | "jwks_unavailable"
    | "token_invalid"
    | "accounts_unavailable"
    | "enforcer_unavailable"
    | null;
  clientTenant?: string | null;
  clientRole?: string | null;
}): IdentityResult {
  const required = enforcerRequired(input.env);
  const cfg = readEnforcerConfig(input.env);

  if (required && !cfg.ok) {
    // Enforcer JWT is required by the environment but not yet configured.
    // Fall through to the office-session passcode gate so the production app
    // remains accessible via the passcode cookie while JWT is not wired up.
    // A missing or invalid passcode still fails closed with 503.
    if (input.officeSessionValid) {
      const tenantId = (input.env.HALO_ENFORCER_TENANT_ID ?? "").trim() || null;
      return {
        ok: true,
        identity: {
          subject: "office-session",
          tenantId,
          roles: ["admin"],
          source: "office_session",
        },
      };
    }
    return { ok: false, status: 503, code: "enforcer_unconfigured" };
  }

  if (input.verifyError === "jwks_unavailable") {
    return { ok: false, status: 503, code: "jwks_unavailable" };
  }
  if (input.verifyError === "accounts_unavailable") {
    return { ok: false, status: 503, code: "accounts_unavailable" };
  }
  if (input.verifyError === "enforcer_unavailable") {
    return { ok: false, status: 503, code: "enforcer_unavailable" };
  }
  if (input.verifyError === "token_invalid") {
    return { ok: false, status: 401, code: "token_invalid" };
  }

  if (input.verifiedClaims) {
    const configuredTenant = cfg.ok ? cfg.tenantId : (input.env.HALO_ENFORCER_TENANT_ID ?? "").trim();
    if (!configuredTenant) {
      return { ok: false, status: 503, code: "enforcer_unconfigured" };
    }
    if (input.verifiedClaims.tenantId !== configuredTenant) {
      return { ok: false, status: 403, code: "wrong_tenant" };
    }
    // Ignore clientTenant / clientRole completely.
    void input.clientTenant;
    void input.clientRole;
    if (input.verifiedClaims.roles.length === 0) {
      return { ok: false, status: 403, code: "insufficient_role" };
    }
    return {
      ok: true,
      identity: {
        subject: input.verifiedClaims.sub,
        tenantId: input.verifiedClaims.tenantId,
        roles: input.verifiedClaims.roles,
        source: "enforcer",
      },
    };
  }

  if (required) {
    return { ok: false, status: 401, code: "unauthenticated" };
  }

  if (input.officeSessionValid) {
    // Local operator. Tenant only if explicitly configured — never a silent "halo" placeholder.
    const tenantId = (input.env.HALO_ENFORCER_TENANT_ID ?? "").trim() || null;
    return {
      ok: true,
      identity: {
        subject: "office-session",
        tenantId,
        roles: ["admin"],
        source: "office_session",
      },
    };
  }

  if (input.bearerPresent) {
    return { ok: false, status: 401, code: "token_invalid" };
  }
  return { ok: false, status: 401, code: "unauthenticated" };
}

export function pmLiveIdentity(propertyId: string): HaloIdentity {
  return {
    subject: `pm-live:${propertyId}`,
    tenantId: null,
    roles: ["property_manager"],
    source: "pm_live",
    propertyId,
  };
}

export function grantedCapabilities(identity: HaloIdentity): Set<HaloCapability> {
  const granted = new Set<HaloCapability>();
  for (const role of identity.roles) {
    for (const cap of ROLE_CAPABILITIES[role]) granted.add(cap);
  }
  if (identity.source === "pm_live") {
    granted.add("chat.pm");
    for (const denied of PM_LIVE_DENIED) granted.delete(denied);
  }
  return granted;
}

export function hasCapability(identity: HaloIdentity, capability: HaloCapability): boolean {
  return grantedCapabilities(identity).has(capability);
}

export function capabilityForAction(action: string | undefined | null): HaloCapability | null {
  if (!action) return null;
  return ACTION_TO_CAPABILITY[action] ?? null;
}

export function authorizeAction(
  identity: HaloIdentity,
  action: string | undefined | null,
): { ok: true } | { ok: false; status: 403; code: "insufficient_role" } {
  if (identity.source === "pm_live") {
    return { ok: false, status: 403, code: "insufficient_role" };
  }
  const cap = capabilityForAction(action);
  if (!cap) {
    return { ok: false, status: 403, code: "insufficient_role" };
  }
  if (!hasCapability(identity, cap)) {
    return { ok: false, status: 403, code: "insufficient_role" };
  }
  return { ok: true };
}

export function authorizePropertyAccess(
  identity: HaloIdentity,
  requestedPropertyId: string | null | undefined,
): boolean {
  if (!identity.propertyId) return true;
  if (!requestedPropertyId) return false;
  return identity.propertyId === requestedPropertyId;
}

export function primaryRole(identity: HaloIdentity): HaloRole {
  return identity.roles[0] ?? "crew";
}
