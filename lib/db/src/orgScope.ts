/**
 * Multi-tenancy guard. Every client-board query is constructed with an org
 * scope from the session. Passing a missing orgId throws at construction —
 * not after a row leaks.
 */

export class MissingOrgScopeError extends Error {
  readonly code = "missing_org_scope" as const;
  constructor() {
    super("Client board query is missing org scope");
    this.name = "MissingOrgScopeError";
  }
}

export function assertOrgScope(orgId: string | null | undefined): asserts orgId is string {
  if (typeof orgId !== "string" || orgId.trim().length === 0) {
    throw new MissingOrgScopeError();
  }
}

export class ClientBoardRepo {
  readonly orgId: string;

  constructor(orgId: string | null | undefined) {
    assertOrgScope(orgId);
    this.orgId = orgId;
  }
}

export const DEFAULT_EVIDENCE_RETENTION_YEARS = 7;

export const RESIDENT_PII_KEYS = [
  "residentName",
  "resident_name",
  "residentEmail",
  "resident_email",
  "residentPhone",
  "resident_phone",
  "tenantName",
  "tenant_name",
  "tenantEmail",
  "tenant_email",
  "tenantPhone",
  "tenant_phone",
] as const;

const PII_KEY_RE = /^(resident|tenant)(Name|Email|Phone|_name|_email|_phone)$/i;

/** Units are identified by number. Resident contact details never ride along. */
export function stripResidentPii<T>(value: T): T {
  return stripUnknown(value) as T;
}

function stripUnknown(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUnknown);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (PII_KEY_RE.test(key) || (RESIDENT_PII_KEYS as readonly string[]).includes(key)) continue;
    out[key] = stripUnknown(child);
  }
  return out;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEMO_SAFE_KEY_RE = /^(.*email.*|.*phone.*|capturedByName|capturedByUserId)$/i;

export function isDemoSafeEnabled(): boolean {
  return process.env.DEMO_SAFE === "true";
}

/**
 * Screen-share redaction. Resident PII is always stripped; DEMO_SAFE also
 * hides emails, phones, capturer names, and actor ids that look like emails.
 */
export function applyDemoSafe<T>(value: T): T {
  return redactDemo(stripUnknown(value)) as T;
}

function redactDemo(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactDemo);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "capturedByName" && typeof child === "string") {
      out[key] = "Crew";
      continue;
    }
    if (DEMO_SAFE_KEY_RE.test(key) && typeof child === "string") {
      out[key] = /name/i.test(key) ? "Crew" : "••••";
      continue;
    }
    if (typeof child === "string" && EMAIL_RE.test(child) && /email|actor|user/i.test(key)) {
      out[key] = "••••";
      continue;
    }
    out[key] = redactDemo(child);
  }
  return out;
}
