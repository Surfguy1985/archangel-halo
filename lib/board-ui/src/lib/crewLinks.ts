/**
 * Canonical crew link builder.
 *
 * Crews reach HALO through three unauthenticated token links, and every one of
 * them is served by the ROOT web app — never by an artifact that lives under a
 * base path. Hand-built variants have shipped pointing at `/halo-crew/…` (the
 * Expo bundler) and at base-prefixed paths that resolve only inside one app, so
 * a link that worked in the office failed on the crew's phone.
 *
 * Build every crew link here. `origin` defaults to the current page's origin,
 * which is correct from the root app and from the desktop app at `/desktop/`
 * alike — both are the same host.
 */

function siteOrigin(explicit?: string): string {
  if (explicit) return explicit.replace(/\/+$/, "");
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

/** Permanent crew portal (bearer token). */
export function crewPortalUrl(token: string, origin?: string): string {
  return `${siteOrigin(origin)}/portal/${token}`;
}

/** Printable paycard / one-tap check-in link. */
export function crewCheckinUrl(token: string, origin?: string): string {
  return `${siteOrigin(origin)}/checkin/${token}`;
}

/** Single-use foreman invite ("join my crew") link. */
export function crewJoinUrl(token: string, origin?: string): string {
  return `${siteOrigin(origin)}/join/${token}`;
}

/**
 * Server responses hand back either a bare token, a path (`/portal/<token>`),
 * or an already-absolute URL. Normalize any of them to the canonical URL so a
 * call site never has to guess which shape it holds.
 */
export function normalizeCrewPortalLink(
  value: string | null | undefined,
  origin?: string,
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const token = trimmed.replace(/^https?:\/\/[^/]+/i, "").replace(/^.*\/portal\//, "");
  return crewPortalUrl(token || trimmed, origin);
}
