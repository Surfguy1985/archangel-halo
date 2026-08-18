/**
 * One crew pin, shared by every map that shows where people are.
 *
 * Six maps used to draw their own marker: two office Pulse maps, the crew
 * command center, and three client surfaces. Each showed a different subset of
 * what the office actually needs to know — one had a trade, one had a unit,
 * none said which contractor the person works for. A pin that can't be
 * identified is just a coloured dot, so the shape below is the contract: who,
 * for whom, doing what, and where.
 *
 * Pins take this normalized shape, never a raw endpoint payload — the office
 * and client endpoints return different objects and both feed these maps.
 */

import { divIcon, type DivIcon } from "leaflet";
import type { ClientBoardMapCrew, CrewMapPin } from "@workspace/api-client-react";
import type { HaloMapCrew } from "../pulse/haloDeskIntel";
import "./crewPin.css";

/** site = standing on the property; route = assigned but not checked in. */
export type CrewPinStatus = "site" | "route";

export type CrewPin = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  status: CrewPinStatus;
  /** Company the person works for — ours or a sub's. */
  contractor?: string | null;
  /** One short line naming today's work. */
  service?: string | null;
  unitNo?: string | null;
  propertyName?: string | null;
  /**
   * Team colour: gold for the contractor's own staff, the foreman's colour for
   * everyone on that foreman's crew. Resolved server-side so every map agrees.
   * Falls back to the status colour when the payload predates the rule.
   */
  color?: string | null;
  /** Absolute URL (e.g. /api/storage/...), already resolved by the caller. */
  selfieUrl?: string | null;
  lastCheckinKind?: string | null;
  lastCheckinAt?: string | null;
  /** Overrides the derived check-in line (Pulse uses it for demo pins). */
  statusNote?: string | null;
  /** Demo pin — drawn with a dashed ring so nobody reads it as a real crew. */
  mock?: boolean;
};

const ON_SITE = "#22c55e";
const EN_ROUTE = "#E4C25A";
const SELECTED_RING = "#B4FF44";

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * The dot is the person's team colour; the small badge keeps the check-in
 * status the dot used to carry. Anything that isn't a plain hex is ignored —
 * this value is interpolated into an inline style.
 */
function pinFill(pin: CrewPin): string {
  const color = pin.color?.trim();
  if (color && HEX.test(color)) return color;
  return pin.status === "site" ? ON_SITE : EN_ROUTE;
}

export function escapeCrewPinHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** First name only — a full name never fits under a 36px dot. */
export function crewPinShortName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first || "Crew";
}

function initial(name: string): string {
  const c = name.trim()[0];
  return (c ? c : "?").toUpperCase();
}

/** "Checked in 20m ago" — the line under the service on the popup. */
export function crewPinStatusLine(pin: CrewPin): string {
  if (pin.statusNote) return pin.statusNote;
  if (pin.lastCheckinAt) {
    const ms = Date.now() - new Date(pin.lastCheckinAt).getTime();
    const verb = pin.lastCheckinKind === "checkout" ? "Checked out" : "Checked in";
    if (!Number.isFinite(ms) || ms < 0) return verb;
    const mins = Math.floor(ms / 60_000);
    if (mins < 1) return `${verb} just now`;
    if (mins < 60) return `${verb} ${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${verb} ${hrs}h ago`;
    return `${verb} ${Math.floor(hrs / 24)}d ago`;
  }
  return pin.status === "site" ? "On site" : "En route";
}

/** "Unit 214 · Paloma Ridge", or whichever half we actually know. */
export function crewPinPlaceLine(pin: CrewPin): string {
  const parts = [
    pin.unitNo ? `Unit ${pin.unitNo}` : null,
    pin.propertyName?.trim() || null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Location not set";
}

/**
 * Avatar dot plus a name chip, so a glance at the map answers "who is that"
 * without clicking. Everything interpolated here is escaped: crew names and
 * unit numbers are user input, and this string goes straight into the DOM.
 */
export function crewPinIcon(pin: CrewPin, opts?: { selected?: boolean }): DivIcon {
  const fill = pinFill(pin);
  const ring = pin.mock
    ? "3px dashed rgba(255,255,255,0.7)"
    : `3px solid ${opts?.selected ? SELECTED_RING : "#ffffff"}`;
  const face = pin.selfieUrl
    ? `<img src="${escapeCrewPinHtml(pin.selfieUrl)}" alt="" />`
    : `<span class="halo-crewpin-initial">${escapeCrewPinHtml(initial(pin.name))}</span>`;
  const chip = pin.unitNo
    ? `${crewPinShortName(pin.name)} · ${pin.unitNo}`
    : crewPinShortName(pin.name);
  // Status moved off the dot when the dot became the team colour — it lives on
  // as this badge, so "who" and "checked in?" are both answerable at a glance.
  const badge = pin.mock
    ? ""
    : `<i class="halo-crewpin-live" style="background:${pin.status === "site" ? ON_SITE : EN_ROUTE}"></i>`;
  const html = `
    <div class="halo-crewpin${opts?.selected ? " is-selected" : ""}">
      <div class="halo-crewpin-dot" style="background:${fill};border:${ring}">${face}${badge}</div>
      <div class="halo-crewpin-chip">${escapeCrewPinHtml(chip)}</div>
    </div>`;
  return divIcon({
    className: "halo-crewpin-icon",
    html,
    iconSize: [132, 56],
    iconAnchor: [66, 19],
    popupAnchor: [0, -19],
  });
}

const hasCoords = (lat: unknown, lng: unknown): boolean =>
  typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng);

/** Office `/crews/map` payload → pin. Null when the crew has no position yet. */
export function crewPinFromMapPin(p: CrewMapPin): CrewPin | null {
  if (!hasCoords(p.lat, p.lng)) return null;
  return {
    id: p.id,
    name: p.name,
    lat: p.lat as number,
    lng: p.lng as number,
    status: p.lastCheckinKind === "checkout" || p.todayStatus === "route" ? "route" : "site",
    contractor: p.contractor ?? null,
    color: p.pinColor ?? null,
    service: p.serviceLabel ?? p.trade ?? null,
    unitNo: p.unitNo ?? null,
    propertyName: p.todayProperty ?? null,
    selfieUrl: p.selfiePath ? `/api/storage${p.selfiePath}` : null,
    lastCheckinKind: p.lastCheckinKind ?? null,
    lastCheckinAt: p.lastCheckinAt ?? null,
  };
}

/** Client `/client/:token/board/map` payload → pin. */
export function crewPinFromClientCrew(c: ClientBoardMapCrew): CrewPin | null {
  if (!hasCoords(c.lat, c.lng)) return null;
  return {
    id: c.jobId || c.jobNo,
    name: c.crewName,
    lat: c.lat as number,
    lng: c.lng as number,
    status: c.onSite ? "site" : "route",
    contractor: c.contractor ?? null,
    color: c.pinColor ?? null,
    service: c.serviceLabel ?? c.crewTrade ?? null,
    unitNo: c.unitNo ?? null,
    propertyName: null,
    selfieUrl: c.selfieUrl ?? null,
    lastCheckinKind: c.lastCheckinKind ?? null,
    lastCheckinAt: c.lastCheckinAt ?? null,
  };
}

/** Pulse's map crew (live pins plus demo pins) → pin. */
export function crewPinFromHaloMapCrew(c: HaloMapCrew): CrewPin {
  return {
    id: c.id,
    name: c.name,
    lat: c.lat,
    lng: c.lng,
    status: c.status,
    contractor: c.contractor ?? null,
    color: c.pinColor ?? null,
    service: c.service ?? c.trade ?? null,
    unitNo: c.unitNo ?? null,
    propertyName: c.propertyName,
    selfieUrl: c.selfiePath ? `/api/storage${c.selfiePath}` : null,
    statusNote: c.mock ? "On the book" : "Live GPS",
    mock: c.mock,
  };
}
