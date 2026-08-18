/**
 * Which /api paths are token-, signature- or link-authenticated surfaces.
 *
 * There is no office passcode any more — the owner asked for every password
 * and login in HALO to be removed, so /api is open and holding a URL is the
 * only credential. This map survives that removal because two guards still
 * need to know which paths carry their own proof and must therefore be left
 * alone: the Falkon mutation gate (a signed peer, not an operator) and the
 * enforcer identity check (an external JWT).
 *
 * Treat an entry here as "this path proves itself" — a client board token, a
 * crew link, an Ed25519-signed webhook — not as "this path is unprotected".
 */

// Token-authenticated, public-share, or webhook surfaces.
export const PUBLIC_PREFIXES = [
  "/healthz",
  "/client/",
  "/pay/",
  "/portal/",
  "/track/",
  "/recap-shares/",
  "/photo-shares/",
  "/job-summaries/",
  "/storage/",
  "/vapi/",
  // Source legal PDFs that crews must read during onboarding — the template
  // key + form code are not secret.
  "/packets/templates/",
  // Presentation Mode: an unauthenticated audience device drives the scripted
  // card lifecycle and renders the office-side board. Both endpoints are
  // token-guarded (current demo dashboardToken + active demo) and only ever
  // touch the demo property's data. See routes/presentation.ts.
  "/presentation/demo/step",
  "/presentation/demo/office-board",
  // Falkon Ops inbound webhook and round-trip ping — Ed25519-signed by Falkon,
  // verified in routes/falkon.ts before any processing.
  "/falkon/inbound/",
  "/falkon/ping",
  // Falkon Phase 1: Ed25519-verified inbound webhook + trust document
  "/falkon/webhook",
  "/.well-known/",
  // Falkon Network Phase 1: public capability catalog (external peers need to discover HALO)
  "/falkon/network/capabilities",
  // PM live view — token-validated, property-scoped, sent via SMS to property managers
  "/live/",
  // Crew check-in — one-tap GPS check-in/checkout via a texted link
  "/checkin/",
  "/join/",
  // Shared crew roster code — one unguessable code the whole crew scans to pick
  // their own name. Validated per request in routes/roster.ts; it exposes names
  // and team colours only.
  "/roster/",
  "/twilio/",
];

// Walk app routes. Boundary-anchored so a future "/walks-report" style route
// does NOT silently join this bucket.
const WALK_RE = /^\/(walk-target$|walks(\/|$)|walk-captures\/)/;

export function isPublicApiPath(path: string): boolean {
  if (/^\/v1\/records\/[^/]+\/file$/.test(path)) return true;
  if (/^\/v1\/evidence\/[^/]+\/file$/.test(path)) return true;
  return PUBLIC_PREFIXES.some((p) => path.startsWith(p));
}

/** Invited vendor submitting via x-halo-vendor-org-id. */
export function isVendorBidAuth(req: {
  method?: string;
  path: string;
  headers: { [key: string]: string | string[] | undefined };
}): boolean {
  if ((req.method ?? "GET").toUpperCase() !== "POST") return false;
  if (!/^\/v1\/bid-requests\/[^/]+\/bids$/.test(req.path)) return false;
  const raw = req.headers["x-halo-vendor-org-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.trim().length > 0;
}

export function isIdentityExemptPath(
  path: string,
  method: string,
  headers?: { [key: string]: string | string[] | undefined },
): boolean {
  if (isPublicApiPath(path)) return true;
  if (WALK_RE.test(path)) return true;
  if ((method === "GET" || method === "HEAD") && path === "/presentation/demo") return true;
  if (headers && isVendorBidAuth({ method, path, headers })) return true;
  return false;
}
