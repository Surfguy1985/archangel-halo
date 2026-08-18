/**
 * Crew check-in / check-out policy (pure, no I/O).
 *
 * Paycard flow (printed QR): log the unit → check in with GPS (green pin) →
 * before photo → after photo → check out. Completing the card is how they
 * get paid. Dispatch still pre-fills the unit; they confirm it.
 * GPS is required to place the map pin. Background tracking after the
 * browser suspends is not claimed.
 */

import { createHash, randomBytes } from "node:crypto";

export const CREW_TOKEN_PREFIX = "crew_";
export const CHECKIN_COOLDOWN_MS = 15_000;
export const GPS_STALE_MS = 5 * 60_000;
export const GPS_LOW_ACCURACY_M = 150;
export const BACKGROUND_GPS_SUPPORTED = false;

export type CrewLinkStatus = "valid" | "expired" | "revoked" | "malformed" | "not_found";

export interface CrewLinkRecord {
  id: string;
  tokenHash: string;
  tokenPrefix: string;
  crewId: string;
  expiresAt: string;
  revokedAt: string | null;
  lastAccessedAt: string | null;
}

export interface GpsFix {
  lat?: unknown;
  lng?: unknown;
  accuracy?: unknown;
  capturedAt?: unknown;
}

export type GpsVerdict =
  | { status: "ok"; lat: number; lng: number; accuracy: number | null }
  | { status: "low_accuracy"; lat: number; lng: number; accuracy: number }
  | { status: "unavailable" }
  | { status: "stale"; ageMs: number }
  | { status: "invalid" };

export interface PunchEvent {
  id: string;
  kind: "checkin" | "checkout" | string;
  createdAt: Date;
  jobId: string | null;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
}

export interface SessionState {
  status: "in" | "out";
  openCheckin: PunchEvent | null;
  lastEvent: PunchEvent | null;
}

export interface DispatchJob {
  id: string;
  propertyId: string;
  propertyName: string | null;
  unitNo: string | null;
  description: string | null;
  scheduledOn: string | null;
  boardStatus: string;
  crewLeaderId: string | null;
}

export type CheckinDecision =
  | { ok: true; action: "create" | "replay"; reason: "ok" | "duplicate_tap" | "second_device" }
  | { ok: false; code: "wrong_crew" | "crew_inactive" | "malformed"; status: 400 | 403 };

export type CheckoutDecision =
  | { ok: true; action: "create" | "replay"; reason: "ok" | "duplicate_tap"; trackingEnds: true }
  | {
      ok: false;
      code: "wrong_crew" | "crew_inactive" | "checkout_without_checkin" | "malformed";
      status: 400 | 403 | 409;
    };

export type LocationDecision =
  | { ok: true }
  | { ok: false; code: "session_ended" | "gps_unavailable" | "gps_stale" | "gps_invalid"; status: 400 | 409 };

export function mintCrewToken(): { token: string; tokenHash: string; tokenPrefix: string } {
  const token = CREW_TOKEN_PREFIX + randomBytes(24).toString("hex");
  return { token, tokenHash: hashCrewToken(token), tokenPrefix: token.slice(0, 14) };
}

export function hashCrewToken(token: string): string {
  return createHash("sha256").update(`halo-crew-checkin:${token}`).digest("hex");
}

export function classifyCrewTokenShape(token: unknown): "ok" | "malformed" {
  if (typeof token !== "string") return "malformed";
  const t = token.trim();
  if (!t || t.length > 128) return "malformed";
  if (t.includes("/") || t.includes("..") || t.includes("\0")) return "malformed";
  if (!/^crew_[0-9a-f]+$/i.test(t)) return "malformed";
  if (t.length < CREW_TOKEN_PREFIX.length + 16) return "malformed";
  return "ok";
}

export function evaluateCrewLink(
  token: unknown,
  record: CrewLinkRecord | null,
  now: Date,
): { status: CrewLinkStatus; link?: CrewLinkRecord } {
  if (classifyCrewTokenShape(token) === "malformed") return { status: "malformed" };
  if (!record) return { status: "not_found" };
  if (record.revokedAt) return { status: "revoked" };
  if (new Date(record.expiresAt).getTime() <= now.getTime()) return { status: "expired" };
  return { status: "valid", link: record };
}

export function crewLinkHttpStatus(status: CrewLinkStatus): number {
  switch (status) {
    case "valid":
      return 200;
    case "malformed":
      return 400;
    case "not_found":
      return 404;
    case "expired":
    case "revoked":
      return 410;
  }
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function evaluateGps(fix: GpsFix | null | undefined, now: Date): GpsVerdict {
  const lat = asFiniteNumber(fix?.lat);
  const lng = asFiniteNumber(fix?.lng);
  if (lat == null || lng == null) return { status: "unavailable" };
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return { status: "invalid" };

  if (typeof fix?.capturedAt === "string" && fix.capturedAt.trim()) {
    const captured = Date.parse(fix.capturedAt);
    if (!Number.isNaN(captured)) {
      const ageMs = now.getTime() - captured;
      if (ageMs > GPS_STALE_MS) return { status: "stale", ageMs };
    }
  }

  const accuracy = asFiniteNumber(fix?.accuracy);
  if (accuracy != null && accuracy > GPS_LOW_ACCURACY_M) {
    return { status: "low_accuracy", lat, lng, accuracy };
  }
  return { status: "ok", lat, lng, accuracy };
}

export function gpsAllowsCheckin(verdict: GpsVerdict): boolean {
  return verdict.status === "ok" || verdict.status === "low_accuracy" || verdict.status === "unavailable";
}

/** Paycard check-in must drop a live pin — a missing fix cannot be paid. */
export function gpsPlacesMapPin(verdict: GpsVerdict): boolean {
  return verdict.status === "ok" || verdict.status === "low_accuracy";
}

export const PAYCARD_LABEL_PREFIX = "HALO paycard";

export function encodePaycardLabel(url: string): string {
  return `${PAYCARD_LABEL_PREFIX} | ${url}`;
}

export function decodePaycardUrl(label: string | null | undefined): string | null {
  if (!label) return null;
  const idx = label.indexOf("|");
  if (idx < 0) return null;
  if (!label.slice(0, idx).trim().startsWith(PAYCARD_LABEL_PREFIX)) return null;
  const url = label.slice(idx + 1).trim();
  return /^https?:\/\//i.test(url) ? url : null;
}

export function paycardUnitLabel(unitRaw: unknown): string | null {
  if (typeof unitRaw !== "string") return null;
  const u = unitRaw.trim().replace(/^unit\s+/i, "").trim();
  if (!u || u.length > 32) return null;
  return u;
}

export function matchDispatchJob(jobs: DispatchJob[], unit: string | null): DispatchJob | null {
  if (jobs.length === 0) return null;
  if (!unit) return jobs[0] ?? null;
  const want = unit.trim().toLowerCase();
  return jobs.find((j) => (j.unitNo ?? "").trim().toLowerCase() === want) ?? jobs[0] ?? null;
}

export function checkoutPhotosReady(before: number, after: number): boolean {
  return before > 0 && after > 0;
}

export function sessionFromEvents(events: PunchEvent[], _now?: Date): SessionState {
  const lastEvent = events
    .slice()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .at(-1) ?? null;
  if (lastEvent?.kind === "checkin") {
    return { status: "in", openCheckin: lastEvent, lastEvent };
  }
  return { status: "out", openCheckin: null, lastEvent };
}

function identityGate(
  linkCrewId: string,
  requestedCrewId: unknown,
  crewActive: boolean,
): { ok: true } | { ok: false; code: "wrong_crew" | "crew_inactive" | "malformed"; status: 400 | 403 } {
  if (requestedCrewId != null && requestedCrewId !== "") {
    if (typeof requestedCrewId !== "string") return { ok: false, code: "malformed", status: 400 };
    if (requestedCrewId !== linkCrewId) return { ok: false, code: "wrong_crew", status: 403 };
  }
  if (!crewActive) return { ok: false, code: "crew_inactive", status: 403 };
  return { ok: true };
}

export function decideCheckin(input: {
  session: SessionState;
  now: Date;
  linkCrewId: string;
  requestedCrewId?: unknown;
  crewActive: boolean;
}): CheckinDecision {
  const ident = identityGate(input.linkCrewId, input.requestedCrewId, input.crewActive);
  if (!ident.ok) return ident;
  if (input.session.status === "in" && input.session.lastEvent) {
    const age = input.now.getTime() - input.session.lastEvent.createdAt.getTime();
    if (age <= CHECKIN_COOLDOWN_MS) {
      return { ok: true, action: "replay", reason: "duplicate_tap" };
    }
    return { ok: true, action: "replay", reason: "second_device" };
  }
  return { ok: true, action: "create", reason: "ok" };
}

export function decideCheckout(input: {
  session: SessionState;
  now: Date;
  linkCrewId: string;
  requestedCrewId?: unknown;
  crewActive: boolean;
}): CheckoutDecision {
  const ident = identityGate(input.linkCrewId, input.requestedCrewId, input.crewActive);
  if (!ident.ok) return ident;
  if (input.session.status === "out") {
    if (
      input.session.lastEvent?.kind === "checkout" &&
      input.now.getTime() - input.session.lastEvent.createdAt.getTime() <= CHECKIN_COOLDOWN_MS
    ) {
      return { ok: true, action: "replay", reason: "duplicate_tap", trackingEnds: true };
    }
    return { ok: false, code: "checkout_without_checkin", status: 409 };
  }
  return { ok: true, action: "create", reason: "ok", trackingEnds: true };
}

export function decideLocationPing(input: {
  session: SessionState;
  gps: GpsVerdict;
}): LocationDecision {
  if (input.session.status !== "in") return { ok: false, code: "session_ended", status: 409 };
  if (input.gps.status === "unavailable") return { ok: false, code: "gps_unavailable", status: 400 };
  if (input.gps.status === "stale") return { ok: false, code: "gps_stale", status: 400 };
  if (input.gps.status === "invalid") return { ok: false, code: "gps_invalid", status: 400 };
  return { ok: true };
}

const OPEN_BOARD = new Set(["active", "filled", "assigned", "scheduled"]);

export function todaysDispatch(jobs: DispatchJob[], crewId: string, todayIsoDate: string): DispatchJob[] {
  return jobs.filter((job) => {
    if (job.crewLeaderId !== crewId) return false;
    if (!OPEN_BOARD.has(job.boardStatus)) return false;
    if (job.scheduledOn && job.scheduledOn !== todayIsoDate) return false;
    return true;
  });
}

export function formatTodayAssignment(jobs: DispatchJob[]): {
  propertyName: string | null;
  unitLabel: string | null;
  jobDescription: string | null;
  units: string[];
  jobIds: string[];
} | null {
  if (jobs.length === 0) return null;
  const units = [...new Set(jobs.map((j) => (j.unitNo ?? "").trim()).filter(Boolean))];
  const names = [...new Set(jobs.map((j) => j.propertyName).filter((n): n is string => Boolean(n)))];
  return {
    propertyName: names[0] ?? null,
    unitLabel: units.length ? units.join(", ") : null,
    jobDescription: jobs.map((j) => j.description).find((d) => d && d.trim()) ?? null,
    units,
    jobIds: jobs.map((j) => j.id),
  };
}

export function mapSessionView(input: {
  session: SessionState;
  now: Date;
  lastPing?: { lat: number; lng: number; accuracy: number | null; at: Date } | null;
}): {
  status: "in" | "out";
  checkedInAt: string | null;
  lastKnownPosition: { lat: number; lng: number; accuracy: number | null; at: string } | null;
  freshnessSeconds: number | null;
  trackingActive: boolean;
  backgroundGpsSupported: false;
} {
  const fromPing = input.lastPing
    ? {
        lat: input.lastPing.lat,
        lng: input.lastPing.lng,
        accuracy: input.lastPing.accuracy,
        at: input.lastPing.at,
      }
    : null;
  const fromCheckin =
    input.session.openCheckin &&
    input.session.openCheckin.lat != null &&
    input.session.openCheckin.lng != null
      ? {
          lat: input.session.openCheckin.lat,
          lng: input.session.openCheckin.lng,
          accuracy: input.session.openCheckin.accuracy,
          at: input.session.openCheckin.createdAt,
        }
      : null;
  const pos = fromPing ?? fromCheckin;
  const freshnessSeconds = pos ? Math.max(0, Math.round((input.now.getTime() - pos.at.getTime()) / 1000)) : null;
  return {
    status: input.session.status,
    checkedInAt: input.session.openCheckin?.createdAt.toISOString() ?? null,
    lastKnownPosition: pos
      ? { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy, at: pos.at.toISOString() }
      : null,
    freshnessSeconds,
    trackingActive: input.session.status === "in",
    backgroundGpsSupported: BACKGROUND_GPS_SUPPORTED,
  };
}

export function crewPortalExposed(env: {
  NODE_ENV?: string;
  HALO_ENV?: string;
  HALO_CREW_PORTAL_ENABLED?: string;
}): boolean {
  const flag = (env.HALO_CREW_PORTAL_ENABLED ?? "").trim().toLowerCase();
  if (flag === "true" || flag === "1") return true;
  if (flag === "false" || flag === "0") return false;
  const prod = env.NODE_ENV === "production" || env.HALO_ENV === "production";
  return !prod;
}

export function localIsoDate(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
