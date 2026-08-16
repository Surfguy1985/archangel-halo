/**
 * Property Pulse — Figma Make HUD.
 * Map stays. Each nav tab toggles a movable, hideable live box.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { useLocation } from "wouter";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import { divIcon } from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Box,
  CalendarDays,
  Clock,
  History,
  Home,
  LayoutGrid,
  Loader2,
  Maximize2,
  MessageCircle,
  Minimize2,
  MoreVertical,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings,
  User,
  X,
} from "lucide-react";
import {
  useGetBusinessSettings,
  useGetCrewMapPins,
  useGetToday,
  useListJobs,
  useListNotifications,
  useListProperties,
  getGetCrewMapPinsQueryKey,
  getGetTodayQueryKey,
  getListJobsQueryKey,
  getListNotificationsQueryKey,
  getListPropertiesQueryKey,
  type CrewMapPin,
  type FeedCard,
  type Job,
  type PropertySummary,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { GpsFinder } from "@/components/GpsFinder";
import { SiteTwin } from "@/components/SiteTwin";
import { CommandModule } from "@/components/CommandModule";
import haloLogo from "../assets/halo-logo.png";

// Module visibility is session-only: on EVERY page load the HALO command module
// appears again (centered).  Hiding it sets this flag for the current tab only.
const MODULE_HIDDEN_KEY = "halo_command_module_hidden";

const LIME = "#B4FF44";
const NAVY = "#0F1B2D";
const BASE44_URL = "https://wakeful-ready-track-flow.base44.app";
const FALLBACK: [number, number] = [32.7767, -96.797];
const HUD_KEY = "halo_pulse_hud_v1";
const OPEN_KEY = "halo_pulse_hud_open_v1";

const DESKTOP = String(import.meta.env.BASE_URL ?? "").includes("desktop");
const HREF = {
  home: "/",
  pulse: "/pulse",
  crews: "/crews",
  calendar: "/calendar",
  properties: "/properties",
  dispatch: DESKTOP ? "/dispatch" : "/jobboard",
  settings: DESKTOP ? "/admin" : "/settings",
  work: DESKTOP ? "/work" : "/",
};

type PanelId = "overview" | "sites" | "crew" | "schedule" | "units" | "calendar" | "activity" | "settings";
type PanelMode = "docked" | "floating";
type BoxPos = { x: number; y: number; w: number; h: number };
type SmsStatus = { configured: boolean; fromLast4: string | null };
type SyncStatus = { finishedAt: string | null; stale: boolean };
type RankedSite = PropertySummary & { crewsOnSite: number; overdueJobs: number; hotJob: Job | null };

const NAV: Array<{ id: PanelId; label: string; Icon: typeof Home }> = [
  { id: "overview", label: "Overview", Icon: Home },
  { id: "sites", label: "Sites", Icon: LayoutGrid },
  { id: "crew", label: "Crew", Icon: User },
  { id: "schedule", label: "Schedule", Icon: Clock },
  { id: "units", label: "Units", Icon: Box },
  { id: "calendar", label: "Calendar", Icon: CalendarDays },
  { id: "activity", label: "Activity", Icon: History },
  { id: "settings", label: "Settings", Icon: Settings },
];

const DEFAULT_POS: Record<PanelId, BoxPos> = {
  sites: { x: 12, y: 12, w: 228, h: 520 },
  overview: { x: -1, y: 12, w: 240, h: 248 },
  crew: { x: -1, y: 272, w: 240, h: 300 },
  schedule: { x: -1, y: -1, w: 260, h: 220 },
  activity: { x: 252, y: -1, w: 340, h: 200 },
  units: { x: 604, y: -1, w: 360, h: 200 },
  calendar: { x: 252, y: 12, w: 420, h: 360 },
  settings: { x: 300, y: 80, w: 320, h: 300 },
};

/**
 * Docked layout, ranked by operational importance.
 *
 * Left rail answers "where do I look right now" — the live count of the
 * portfolio and the ranked site list that drives map selection.  Right rail
 * carries the supporting detail an operator consults after picking a site.
 * The map keeps the whole centre channel; rails scroll independently when
 * more panels are open than fit.
 */
/**
 * Docked placement, ranked by how urgently the office needs it.
 *  left  = "where do I look right now"  (drives map selection)
 *  right = supporting detail, consulted after a site is picked
 * `h` is the preferred height; `grow` marks list-style panels that should
 * absorb leftover rail space instead of leaving a dead gap beneath them.
 */
const DOCK: Record<PanelId, { rail: "left" | "right"; order: number; h: number; grow: number }> = {
  overview: { rail: "left",  order: 0, h: 332, grow: 0 },
  sites:    { rail: "left",  order: 1, h: 400, grow: 1 },
  crew:     { rail: "right", order: 0, h: 264, grow: 1 },
  schedule: { rail: "right", order: 1, h: 248, grow: 1 },
  units:    { rail: "right", order: 2, h: 272, grow: 1 },
  activity: { rail: "right", order: 3, h: 256, grow: 1 },
  calendar: { rail: "right", order: 4, h: 300, grow: 1 },
  settings: { rail: "right", order: 5, h: 216, grow: 0 },
};

const MODE_KEY = "halo_pulse_hud_mode_v1";

const DEFAULT_MODE: Record<PanelId, PanelMode> = {
  overview: "docked",
  sites: "docked",
  crew: "docked",
  schedule: "docked",
  units: "docked",
  calendar: "docked",
  activity: "docked",
  settings: "docked",
};

const PANEL_IDS = Object.keys(DOCK) as PanelId[];

/**
 * localStorage is user-writable and outlives schema changes, so every
 * persisted value is validated before it reaches React state. A corrupt or
 * stale entry must degrade to defaults, never crash the page or silently
 * strand a panel in an unrenderable mode.
 */
function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function loadModes(): Record<PanelId, PanelMode> {
  const out = { ...DEFAULT_MODE };
  const raw = readJson(MODE_KEY);
  if (!isPlainObject(raw)) return out;
  for (const id of PANEL_IDS) {
    const v = raw[id];
    if (v === "docked" || v === "floating") out[id] = v;
  }
  return out;
}

function parseSyncPayload(j: unknown): SyncStatus {
  const row = j as {
    finishedAt?: string;
    result?: { finishedAt?: string };
    health?: { lastSuccessfulAt?: string | null; stale?: boolean };
  };
  const finishedAt = row.health?.lastSuccessfulAt || row.result?.finishedAt || row.finishedAt || null;
  return { finishedAt, stale: !!row.health?.stale };
}

function localYmd(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, (d ?? 1) + n);
  return localYmd(dt);
}

function isLiveJob(j: Job): boolean {
  return !["complete", "paid", "cancelled"].includes(j.status);
}

/**
 * Vendor-side turn health, recomputed on every jobs poll so the Overview tiles
 * are live rather than a nightly rollup.
 *
 * - Average turn time: mean days from job creation to completion across the
 *   last 30 days of finished work.  Older jobs are excluded so the figure
 *   tracks how the crews are running now, not last quarter.
 * - Re-works: jobs the office pushed back onto the board after they were
 *   called done (board status "reopened").
 * - POs needed: live work that cannot reach Billing until the client sends a
 *   PO number.
 */
const TURN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Overview tiles that expand into a shorthand list. */
type DrillId = "sites" | "crews" | "turns" | "done" | "turntime" | "rework" | "po";
type DrillRow = { id: string; label: string; meta: string; propertyId?: string | null };
/** Cap the expanded list so the panel stays scannable, not a report. */
const DRILL_MAX = 8;

function turnHealth(jobs: Job[], liveJobs: Job[]) {
  const cutoff = Date.now() - TURN_WINDOW_MS;
  const finished: { job: Job; ms: number; doneAt: number }[] = [];
  let spanTotal = 0;
  let spanCount = 0;
  for (const j of jobs) {
    if (!j.completedAt || !j.createdAt) continue;
    const done = new Date(j.completedAt).getTime();
    const start = new Date(j.createdAt).getTime();
    if (!Number.isFinite(done) || !Number.isFinite(start) || done < start || done < cutoff) continue;
    spanTotal += done - start;
    spanCount += 1;
    finished.push({ job: j, ms: done - start, doneAt: done });
  }
  const poJobs = liveJobs.filter((j) => !j.poNumber?.trim());
  const reworkJobs = jobs.filter((j) => j.boardStatus === "reopened" && j.status !== "cancelled");
  finished.sort((a, b) => b.doneAt - a.doneAt);
  return {
    avgTurnDays: spanCount > 0 ? spanTotal / spanCount / 86_400_000 : null,
    turnSample: spanCount,
    finished,
    reworks: reworkJobs.length,
    reworkJobs,
    posNeeded: poJobs.length,
    poJobs,
  };
}

/** Short service bullets for a job — the work sold on that unit. */
function jobServiceBullets(j: Job): string[] {
  const list = (j.services ?? []).filter((s) => s.trim());
  if (list.length > 0) return list;
  const fallback = j.category?.trim() || j.description?.trim();
  return fallback ? [fallback] : ["Turn work"];
}

/** Shorthand for a drill row: two services max, then "+N". */
function svcShort(j: Job): string {
  const b = jobServiceBullets(j);
  return b.slice(0, 2).join(" · ") + (b.length > 2 ? ` +${b.length - 2}` : "");
}

function unitLabel(j: Job): string {
  return j.unitNo ? `Unit ${j.unitNo}` : j.jobNo;
}

/** "2d 4h" / "6h" — turn length at a glance. */
function spanShort(ms: number): string {
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.round((ms % 86_400_000) / 3_600_000);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}

/** "Aug 3" from an ISO instant; em dash when never received. */
function stampShort(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "—";
}

/** "Aug 3" from a date-only YYYY-MM-DD, read as LOCAL parts (never UTC). */
function ymdShort(ymd?: string | null): string {
  const parts = ymd?.split("-").map(Number);
  if (!parts || parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return "—";
  return new Date(parts[0]!, parts[1]! - 1, parts[2]!).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function loadLayout(): Partial<Record<PanelId, BoxPos>> {
  const out: Partial<Record<PanelId, BoxPos>> = {};
  const raw = readJson(HUD_KEY);
  if (!isPlainObject(raw)) return out;
  for (const id of PANEL_IDS) {
    const v = raw[id];
    if (!isPlainObject(v)) continue;
    const { x, y, w, h } = v;
    if (
      typeof x === "number" && Number.isFinite(x) &&
      typeof y === "number" && Number.isFinite(y) &&
      typeof w === "number" && Number.isFinite(w) && w > 0 &&
      typeof h === "number" && Number.isFinite(h) && h > 0
    ) {
      out[id] = { x, y, w, h };
    }
  }
  return out;
}

function savePos(id: PanelId, pos: BoxPos) {
  const all = loadLayout();
  all[id] = pos;
  localStorage.setItem(HUD_KEY, JSON.stringify(all));
}

const DEFAULT_OPEN: Record<PanelId, boolean> = {
  overview: true,
  sites: true,
  crew: false,
  schedule: false,
  units: false,
  calendar: false,
  activity: false,
  settings: false,
};

function loadOpen(): Record<PanelId, boolean> {
  const out = { ...DEFAULT_OPEN };
  const raw = readJson(OPEN_KEY);
  if (!isPlainObject(raw)) return out;
  for (const id of PANEL_IDS) {
    const v = raw[id];
    if (typeof v === "boolean") out[id] = v;
  }
  return out;
}

function pinIcon(hot: boolean, pulse = false) {
  const fill = hot ? LIME : NAVY;
  const inner = hot ? NAVY : "#fff";
  return divIcon({
    className: "",
    iconSize: [28, 34],
    iconAnchor: [14, 34],
    html: `<div style="position:relative">${pulse ? `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-70%);width:36px;height:36px;border-radius:50%;background:${LIME}40;animation:pulse-dot 1.5s infinite"></div>` : ""}<svg width="28" height="34" viewBox="0 0 28 34" fill="none"><path d="M14 0C8.48 0 4 4.48 4 10c0 7.87 10 24 10 24S24 17.87 24 10C24 4.48 19.52 0 14 0z" fill="${fill}"/><circle cx="14" cy="10" r="4.5" fill="${inner}"/></svg></div>`,
  });
}

function FitPins({ points, selected }: { points: [number, number][]; selected: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 80);
    return () => clearTimeout(t);
  }, [map]);
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (selected) {
      if (reduce) map.setView(selected, Math.max(map.getZoom(), 15));
      else map.flyTo(selected, Math.max(map.getZoom(), 15), { duration: 0.55 });
      return;
    }
    if (points.length === 0) {
      map.setView(FALLBACK, 11);
      return;
    }
    if (points.length === 1) {
      map.setView(points[0], 14);
      return;
    }
    map.fitBounds(points, { padding: [48, 48], maxZoom: 15 });
  }, [map, points.map((p) => p.join(",")).join("|"), selected?.join(",")]);
  return null;
}

function rankSites(properties: PropertySummary[], jobs: Job[], pins: CrewMapPin[]): RankedSite[] {
  const today = localYmd();
  const onSite = new Set(
    pins.filter((p) => p.todayStatus === "site" || p.todayStatus === "route").map((p) => p.todayProperty),
  );
  return [...properties]
    .map((p) => {
      const siteJobs = jobs.filter((j) => j.propertyId === p.id && isLiveJob(j));
      const overdueJobs = siteJobs.filter((j) => j.scheduledOn && j.scheduledOn < today).length;
      const crewsOnSite = pins.filter(
        (c) =>
          (c.todayStatus === "site" || c.todayStatus === "route") &&
          (c.todayProperty === p.name || siteJobs.some((j) => j.jobNo === c.todayJob)),
      ).length;
      const named = onSite.has(p.name) ? Math.max(crewsOnSite, 1) : crewsOnSite;
      const hotJob =
        siteJobs.find((j) => j.crewLeaderId) ??
        siteJobs.find((j) => j.scheduledOn === today) ??
        siteJobs[0] ??
        null;
      return { ...p, crewsOnSite: named, overdueJobs, hotJob };
    })
    .sort((a, b) => {
      if (b.crewsOnSite !== a.crewsOnSite) return b.crewsOnSite - a.crewsOnSite;
      if (b.overdueJobs !== a.overdueJobs) return b.overdueJobs - a.overdueJobs;
      if (b.openJobs !== a.openJobs) return b.openJobs - a.openJobs;
      return a.name.localeCompare(b.name);
    });
}

function statusLines(openJobs: number, crewsOnSite: number, overdueJobs: number) {
  return {
    primary: openJobs > 0 ? `${openJobs} Open Turn${openJobs === 1 ? "" : "s"}` : "Clear",
    secondary: crewsOnSite > 0 ? "Crew on Site" : overdueJobs > 0 ? `${overdueJobs} Behind` : openJobs > 0 ? "Needs Dispatch" : "Quiet",
  };
}

function ageMinutes(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

function weekdayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString("en-US", { weekday: "short" });
}

/** Severity ring for a site row — drives the coloured status dot. */
function siteTone(crewsOnSite: number, overdueJobs: number, openJobs: number): "live" | "late" | "queued" | "quiet" {
  if (crewsOnSite > 0) return "live";
  if (overdueJobs > 0) return "late";
  if (openJobs > 0) return "queued";
  return "quiet";
}

function resolvePos(id: PanelId, stage: HTMLElement | null): BoxPos {
  const saved = loadLayout()[id];
  const pos = { ...(saved ?? DEFAULT_POS[id]) };
  const sw = stage?.clientWidth ?? Math.max(320, (typeof window !== "undefined" ? window.innerWidth : 1200) - 64);
  const sh = stage?.clientHeight ?? Math.max(320, (typeof window !== "undefined" ? window.innerHeight : 800) - 58);
  if (pos.x < 0) pos.x = Math.max(12, sw - pos.w - 12);
  if (pos.y < 0) pos.y = Math.max(12, sh - pos.h - 12);
  pos.w = Math.min(pos.w, sw - 16);
  pos.h = Math.min(pos.h, sh - 16);
  return pos;
}

function HudBox({
  id,
  title,
  kicker,
  open,
  z,
  mode,
  stageRef,
  onClose,
  onFocus,
  onToggleDock,
  children,
}: {
  id: PanelId;
  title: string;
  kicker?: string;
  open: boolean;
  z: number;
  mode: PanelMode;
  stageRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onFocus: () => void;
  onToggleDock: () => void;
  children: ReactNode;
}) {
  const [pos, setPos] = useState<BoxPos>(() => resolvePos(id, stageRef.current));
  const posRef = useRef(pos);
  posRef.current = pos;
  const drag = useRef<{ ox: number; oy: number } | null>(null);
  const resize = useRef<{ ox: number; oy: number; w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || mode !== "floating") return;
    const next = resolvePos(id, stageRef.current);
    posRef.current = next;
    setPos(next);
  }, [open, id, stageRef, mode]);

  if (!open) return null;

  // ── Docked: the rail owns placement, so no absolute position, drag or resize.
  if (mode === "docked") {
    return (
      <article
        className="pulse-hud-box docked"
        /* grow:0 panels have fixed-size content, so they size to it exactly
           ("auto"); list panels take their ranked height and absorb slack. */
        style={{ flexBasis: DOCK[id].grow ? DOCK[id].h : "auto", flexGrow: DOCK[id].grow }}
      >
        <header className="pulse-hud-box-head">
          <div>
            <h2>{title}</h2>
            {kicker && <p>{kicker}</p>}
          </div>
          <div className="pulse-hud-box-tools">
            <button type="button" aria-label={`Pop out ${title}`} title="Pop out" onClick={onToggleDock}>
              <Maximize2 size={13} />
            </button>
            <button type="button" aria-label={`Hide ${title}`} title="Hide" onClick={onClose}>
              <X size={14} />
            </button>
          </div>
        </header>
        <div className="pulse-hud-box-body">{children}</div>
      </article>
    );
  }

  const commit = () => savePos(id, posRef.current);

  const onDragMove = (e: ReactPointerEvent) => {
    if (!drag.current) return;
    const stage = stageRef.current;
    if (!stage) return;
    const cur = posRef.current;
    const next = {
      ...cur,
      x: Math.max(8, Math.min(stage.clientWidth - cur.w - 8, e.clientX - drag.current.ox)),
      y: Math.max(8, Math.min(stage.clientHeight - 48, e.clientY - drag.current.oy)),
    };
    posRef.current = next;
    setPos(next);
  };

  const onResizeMove = (e: ReactPointerEvent) => {
    if (!resize.current) return;
    const stage = stageRef.current;
    if (!stage) return;
    const cur = posRef.current;
    const next = {
      ...cur,
      w: Math.max(220, Math.min(stage.clientWidth - cur.x - 8, resize.current.w + (e.clientX - resize.current.ox))),
      h: Math.max(160, Math.min(stage.clientHeight - cur.y - 8, resize.current.h + (e.clientY - resize.current.oy))),
    };
    posRef.current = next;
    setPos(next);
  };

  return (
    <article
      className="pulse-hud-box"
      // Floating panels sit above every Leaflet layer (panes 400-700, controls
      // 800-1000); the stage's own stacking context keeps them under the modals.
      style={{ left: pos.x, top: pos.y, width: pos.w, height: pos.h, zIndex: 1100 + z }}
      onPointerDown={onFocus}
      onWheel={(e) => e.stopPropagation()}
    >
      <header
        className="pulse-hud-box-head"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          onFocus();
          drag.current = { ox: e.clientX - posRef.current.x, oy: e.clientY - posRef.current.y };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={onDragMove}
        onPointerUp={(e) => {
          if (!drag.current) return;
          drag.current = null;
          commit();
          try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* */ }
        }}
      >
        <div>
          <h2>{title}</h2>
          {kicker && <p>{kicker}</p>}
        </div>
        <div className="pulse-hud-box-tools">
          <button type="button" aria-label={`Dock ${title}`} title="Dock" onClick={onToggleDock}>
            <Minimize2 size={13} />
          </button>
          <button type="button" aria-label={`Hide ${title}`} title="Hide" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
      </header>
      <div className="pulse-hud-box-body">{children}</div>
      <div
        className="pulse-hud-resize"
        aria-hidden
        onPointerDown={(e) => {
          e.stopPropagation();
          onFocus();
          resize.current = { ox: e.clientX, oy: e.clientY, w: posRef.current.w, h: posRef.current.h };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={onResizeMove}
        onPointerUp={(e) => {
          if (!resize.current) return;
          resize.current = null;
          commit();
          try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* */ }
        }}
      />
    </article>
  );
}

export default function PropertyPulse() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const poll = { refetchInterval: 15_000 as const };
  const stageRef = useRef<HTMLDivElement>(null);

  const { data: properties, isLoading: propsLoading } = useListProperties(undefined, {
    query: { queryKey: getListPropertiesQueryKey(), ...poll },
  });
  const { data: jobs } = useListJobs(undefined, { query: { queryKey: getListJobsQueryKey(), ...poll } });
  const { data: pins } = useGetCrewMapPins({ query: { queryKey: getGetCrewMapPinsQueryKey(), ...poll } });
  const { data: today } = useGetToday({ query: { queryKey: getGetTodayQueryKey(), ...poll } });
  const { data: notes } = useListNotifications({ query: { queryKey: getListNotificationsQueryKey(), ...poll } });
  const { data: biz } = useGetBusinessSettings();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [sms, setSms] = useState<SmsStatus>({ configured: false, fromLast4: null });
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [gpsPinging, setGpsPinging] = useState(false);
  const [gpsOpen, setGpsOpen] = useState(false);
  // Overview tiles drill down: one open at a time so the panel stays a
  // 15-second read rather than a wall of lists.
  const [drill, setDrill] = useState<DrillId | null>(null);
  const [twinOpen, setTwinOpen] = useState(false);
  // The twin's unit sheet can ask whoever is standing in that unit for proof.
  const requestUnitPhotos = async (u: { unitId: string; label: string; crewId: string | null }) => {
    if (!u.crewId) {
      toast({
        title: `No crew on Unit ${u.label} yet`,
        description: "Assign a crew to that unit before asking for photos.",
        variant: "destructive",
      });
      return;
    }
    try {
      const r = await fetch("/api/sms/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          crewId: u.crewId,
          body: `HALO: please post photos of Unit ${u.label} in your crew portal — before and after for the work you are on.`,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 202) toast({ title: "Photo request waiting on Falkon approval" });
      else if (!r.ok) throw new Error((j as { error?: string }).error || "Photo request failed");
      else toast({ title: `Asked the crew for Unit ${u.label} photos` });
    } catch (e) {
      toast({
        title: "Could not text the crew",
        description: e instanceof Error ? e.message : "Twilio or Falkon blocked the send",
        variant: "destructive",
      });
    }
  };

  const [now, setNow] = useState(() => new Date());
  // The HALO command module: shown on every load, hidden only for this session.
  const [moduleOpen, setModuleOpen] = useState<boolean>(() => {
    try { return sessionStorage.getItem(MODULE_HIDDEN_KEY) !== "1"; } catch { return true; }
  });
  const hideModule = useCallback(() => {
    try { sessionStorage.setItem(MODULE_HIDDEN_KEY, "1"); } catch { /* */ }
    setModuleOpen(false);
  }, []);
  const showModule = useCallback(() => {
    try { sessionStorage.removeItem(MODULE_HIDDEN_KEY); } catch { /* */ }
    setModuleOpen(true);
  }, []);
  const [open, setOpen] = useState<Record<PanelId, boolean>>(loadOpen);
  const [mode, setMode] = useState<Record<PanelId, PanelMode>>(loadModes);
  const [zOrder, setZOrder] = useState<PanelId[]>(() =>
    (Object.keys(DEFAULT_OPEN) as PanelId[]).filter((id) => loadOpen()[id]),
  );

  useEffect(() => {
    localStorage.setItem(OPEN_KEY, JSON.stringify(open));
  }, [open]);

  useEffect(() => {
    localStorage.setItem(MODE_KEY, JSON.stringify(mode));
  }, [mode]);

  const loadSms = useCallback(async () => {
    try {
      const r = await fetch("/api/sms/status", { credentials: "include" });
      if (r.ok) {
        const j = (await r.json()) as SmsStatus & { ok?: boolean };
        setSms({ configured: !!j.configured, fromLast4: j.fromLast4 ?? null });
      }
    } catch {
      /* optional */
    }
  }, []);

  const loadSync = useCallback(async () => {
    try {
      const r = await fetch("/api/settings/sync-base44/status", { credentials: "include" });
      if (r.ok) setSync(parseSyncPayload(await r.json()));
    } catch {
      /* optional */
    }
  }, []);

  useEffect(() => {
    void loadSms();
    void loadSync();
    const id = setInterval(() => {
      void loadSms();
      void loadSync();
    }, 15_000);
    return () => clearInterval(id);
  }, [loadSms, loadSync]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (twinOpen) setTwinOpen(false);
      else if (gpsOpen) setGpsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [twinOpen, gpsOpen]);

  const liveJobs = useMemo(() => (jobs ?? []).filter(isLiveJob), [jobs]);
  const ranked = useMemo(
    () => rankSites(properties ?? [], liveJobs, pins ?? []),
    [properties, liveJobs, pins],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ranked;
    return ranked.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.city ?? "").toLowerCase().includes(q) ||
        (p.pmcName ?? "").toLowerCase().includes(q) ||
        (p.hotJob?.jobNo ?? "").toLowerCase().includes(q),
    );
  }, [ranked, query]);

  useEffect(() => {
    if (selectedId && filtered.some((p) => p.id === selectedId)) return;
    setSelectedId(filtered[0]?.id ?? ranked[0]?.id ?? null);
  }, [filtered, ranked, selectedId]);

  const selected = ranked.find((p) => p.id === selectedId) ?? null;
  const selectedPin =
    (pins ?? []).find(
      (c) =>
        (c.todayStatus === "site" || c.todayStatus === "route") &&
        (c.todayProperty === selected?.name || c.todayJob === selected?.hotJob?.jobNo),
    ) ??
    (pins ?? []).find((c) => c.todayProperty === selected?.name) ??
    null;
  const overlayJob = selected?.hotJob ?? null;
  const todayStr = localYmd();
  const uncrewed = liveJobs.filter((j) => !j.crewLeaderId).length;
  const overdueJobs = liveJobs.filter((j) => j.scheduledOn && j.scheduledOn < todayStr).length;
  const crewsOnSite = (pins ?? []).filter((p) => p.todayStatus === "site").length;
  const doneToday = (jobs ?? []).filter((j) => j.status === "complete" && j.scheduledOn === todayStr).length;
  const liveCount = ranked.filter((p) => p.crewsOnSite > 0).length;
  // The 30-day window slides with the clock, so the metric must recompute on
  // the tick too — jobs alone can stay referentially identical for hours.
  const turnBucket = Math.floor(now.getTime() / 3_600_000);
  const { avgTurnDays, turnSample, finished, reworks, reworkJobs, posNeeded, poJobs } = useMemo(
    () => turnHealth(jobs ?? [], liveJobs),
    [jobs, liveJobs, turnBucket],
  );

  // Every Overview tile expands into the same shorthand list: one line for the
  // unit, one dim line of context.  Nothing here is a paragraph.
  const drillData: Record<DrillId, { rows: DrillRow[]; empty: string }> = useMemo(
    () => ({
      sites: {
        rows: ranked
          .filter((p) => p.crewsOnSite > 0)
          .map((p) => ({
            id: p.id,
            label: p.name,
            meta: `${p.crewsOnSite} crew · ${p.openJobs} open`,
            propertyId: p.id,
          })),
        empty: "No crews on site right now.",
      },
      crews: {
        rows: (pins ?? [])
          .filter((c) => c.todayStatus === "site")
          .map((c) => ({
            id: c.id,
            label: c.name,
            meta: [c.todayProperty ?? "—", c.unitNo ? `Unit ${c.unitNo}` : c.todayJob]
              .filter(Boolean)
              .join(" · "),
          })),
        empty: "No crew checked in on site.",
      },
      turns: {
        rows: liveJobs.map((j) => ({
          id: j.id,
          label: unitLabel(j),
          meta: `${j.propertyName ?? "—"} · ${
            !j.crewLeaderId
              ? "no crew"
              : j.scheduledOn && j.scheduledOn < todayStr
                ? "behind"
                : j.scheduledOn
                  ? ymdShort(j.scheduledOn)
                  : "unscheduled"
          }`,
          propertyId: j.propertyId,
        })),
        empty: "No open turns.",
      },
      done: {
        rows: (jobs ?? [])
          .filter((j) => j.status === "complete" && j.scheduledOn === todayStr)
          .map((j) => ({
            id: j.id,
            label: unitLabel(j),
            meta: `${j.propertyName ?? "—"} · ${svcShort(j)}`,
            propertyId: j.propertyId,
          })),
        empty: "Nothing finished today yet.",
      },
      turntime: {
        rows: finished.map(({ job, ms }) => ({
          id: job.id,
          label: unitLabel(job),
          meta: `${spanShort(ms)} · PO ${stampShort(job.poReceivedAt)} · done ${stampShort(job.completedAt)}`,
          propertyId: job.propertyId,
        })),
        empty: "No jobs completed in the last 30 days.",
      },
      rework: {
        rows: reworkJobs.map((j) => ({
          id: j.id,
          label: unitLabel(j),
          meta: `${j.propertyName ?? "—"} · ${svcShort(j)}`,
          propertyId: j.propertyId,
        })),
        empty: "No re-works open.",
      },
      po: {
        rows: poJobs.map((j) => ({
          id: j.id,
          label: unitLabel(j),
          meta: `${j.propertyName ?? "—"} · ${svcShort(j)}`,
          propertyId: j.propertyId,
        })),
        empty: "Every live job has a client PO.",
      },
    }),
    [ranked, pins, liveJobs, jobs, todayStr, finished, reworkJobs, poJobs],
  );
  const lines = selected
    ? statusLines(selected.openJobs, selected.crewsOnSite, selected.overdueJobs)
    : { primary: "Open Turns", secondary: "Quiet" };

  const mapPoints: [number, number][] = [];
  for (const p of ranked) {
    if (p.latitude != null && p.longitude != null) mapPoints.push([p.latitude, p.longitude]);
  }
  for (const c of pins ?? []) {
    if (c.lat != null && c.lng != null) mapPoints.push([c.lat, c.lng]);
  }
  const selectedCoord: [number, number] | null =
    selected?.latitude != null && selected?.longitude != null
      ? [selected.latitude, selected.longitude]
      : selectedPin?.lat != null && selectedPin?.lng != null
        ? [selectedPin.lat, selectedPin.lng]
        : null;

  const calDays = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => addDays(todayStr, i));
    return days.map((day) => ({
      day,
      jobs: liveJobs.filter((j) => j.scheduledOn === day),
    }));
  }, [liveJobs, todayStr]);

  const unitRows = useMemo(() => {
    return liveJobs
      .filter((j) => j.unitNo)
      .slice(0, 12)
      .map((j) => {
        const items = j.lineItems ?? [];
        const pct = items.length ? Math.round((items.filter((i) => i.completedAt).length / items.length) * 100) : j.crewLeaderId ? 40 : 0;
        const site = ranked.find((p) => p.id === j.propertyId);
        return { job: j, pct, siteName: site?.name ?? "Site" };
      });
  }, [liveJobs, ranked]);

  const scheduleRows = useMemo(() => {
    return liveJobs
      .filter((j) => j.scheduledOn === todayStr || j.scheduledOn === addDays(todayStr, 1))
      .sort((a, b) => `${a.scheduledOn}${a.jobNo}`.localeCompare(`${b.scheduledOn}${b.jobNo}`))
      .slice(0, 10);
  }, [liveJobs, todayStr]);

  const activity = useMemo(() => {
    const items: { id: string; label: string; sub?: string }[] = [];
    for (const pin of pins ?? []) {
      if (pin.todayStatus === "site") items.push({ id: `crew-${pin.id}`, label: pin.todayJob || pin.name, sub: "Crew on site" });
    }
    for (const card of (today?.feed ?? []).slice(0, 8) as FeedCard[]) {
      items.push({ id: `feed-${card.id}`, label: card.title, sub: card.sub });
    }
    for (const n of (notes ?? []).slice(0, 6)) {
      items.push({ id: `note-${n.id}`, label: n.title, sub: n.body ?? undefined });
    }
    const seen = new Set<string>();
    return items.filter((it) => {
      const key = it.label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 12);
  }, [pins, today, notes]);

  const focus = (id: PanelId) => {
    setZOrder((z) => [...z.filter((x) => x !== id), id]);
  };

  const toggle = (id: PanelId) => {
    setOpen((o) => {
      const next = !o[id];
      if (next) focus(id);
      return { ...o, [id]: next };
    });
  };

  const zOf = (id: PanelId) => zOrder.indexOf(id) + 1;

  // Pop a docked panel out to float, or send a floating panel back to its rail.
  const toggleDock = (id: PanelId) => {
    setMode((m) => {
      const next: PanelMode = m[id] === "docked" ? "floating" : "docked";
      if (next === "floating") focus(id);
      return { ...m, [id]: next };
    });
  };

  // Forget every saved position/size/mode and return to the ranked default.
  const resetLayout = () => {
    localStorage.removeItem(HUD_KEY);
    localStorage.removeItem(MODE_KEY);
    localStorage.removeItem(OPEN_KEY);
    setMode({ ...DEFAULT_MODE });
    setOpen({ ...DEFAULT_OPEN });
    setZOrder((Object.keys(DEFAULT_OPEN) as PanelId[]).filter((id) => DEFAULT_OPEN[id]));
    toast({ title: "Layout reset" });
  };

  const syncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const r = await fetch("/api/settings/sync-base44", { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error(`Sync failed (${r.status})`);
      setSync(parseSyncPayload(await r.json()));
      toast({ title: "Work app synced" });
    } catch (e) {
      toast({ title: "Sync failed", description: e instanceof Error ? e.message : "Try again", variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const pingTarget = async () => {
    if (pinging) return;
    setPinging(true);
    try {
      const crewId = overlayJob?.crewLeaderId ?? selectedPin?.id;
      const unit = overlayJob?.unitNo || selectedPin?.unitNo;
      const site = selected?.name ?? "the site";
      if (crewId) {
        const r = await fetch("/api/sms/send", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            crewId,
            body: `HALO: you're needed at ${site}${unit ? ` Unit ${unit}` : ""}. Reply when rolling.`,
          }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.status === 202) toast({ title: "Ping waiting on Falkon approval" });
        else if (!r.ok) throw new Error((j as { error?: string }).error || "Ping failed");
        else toast({ title: "Crew pinged" });
      } else {
        const r = await fetch("/api/sms/admin", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body: `HALO admin: ${selected?.name ?? "a site"} needs a look${uncrewed ? ` — ${uncrewed} uncrewed` : ""}.`,
          }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.status === 202) toast({ title: "Admin ping waiting on Falkon approval" });
        else if (!r.ok) throw new Error((j as { error?: string }).error || "Admin ping failed");
        else toast({ title: "Admin pinged" });
      }
    } catch (e) {
      toast({ title: "Could not ping", description: e instanceof Error ? e.message : "Twilio or Falkon blocked the send", variant: "destructive" });
    } finally {
      setPinging(false);
    }
  };

  const pingGps = async () => {
    if (gpsPinging) return;
    setGpsPinging(true);
    try {
      const crewId = overlayJob?.crewLeaderId ?? selectedPin?.id;
      const unit = overlayJob?.unitNo || selectedPin?.unitNo;
      const site = selected?.name ?? "the site";
      if (!crewId) throw new Error("Assign a crew on this job first");
      const r = await fetch("/api/sms/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          crewId,
          body: `HALO: keep your crew portal open at ${site}${unit ? ` Unit ${unit}` : ""} so live GPS stays on. Native app tracks in the background when checked in. Reply when rolling.`,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 202) toast({ title: "GPS ping waiting on Falkon approval" });
      else if (!r.ok) throw new Error((j as { error?: string }).error || "GPS ping failed");
      else toast({ title: "GPS ping sent — portal must stay open on web" });
    } catch (e) {
      toast({ title: "Could not ping GPS", description: e instanceof Error ? e.message : "Twilio or Falkon blocked the send", variant: "destructive" });
    } finally {
      setGpsPinging(false);
    }
  };

  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  const dateStr = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const portfolio = biz?.companyName?.replace(/\s+LLC$/i, "") || "Property Pulse";

  const statTile = (id: DrillId, tone: string, value: ReactNode, label: string, hint: string) => (
    <button
      type="button"
      className={`pulse-stat ${tone} tap${drill === id ? " on" : ""}`}
      title={`${hint} — click for the list`}
      aria-expanded={drill === id}
      onClick={() => setDrill((d) => (d === id ? null : id))}
    >
      <b>{value}</b>
      <span>{label} {drill === id ? "▴" : "▾"}</span>
    </button>
  );

  // ── Panel registry ─────────────────────────────────────────────────────────
  // Each panel is built once here, then placed into a dock rail or the floating
  // layer below depending on its mode.  React elements are plain objects, so
  // building them up-front lets one definition serve both placements.
  const panelBody: Record<PanelId, { title: string; kicker: string; body: ReactNode }> = {
    overview: {
      title: "Overview",
      kicker: "Live",
      body: (
        <>
          <div className="pulse-stat-grid">
            {statTile("sites", "lime", liveCount, "Active sites", "Properties with a crew on site")}
            {statTile("crews", "green", crewsOnSite, "Crews out", "Crews checked in on a site right now")}
            {statTile("turns", "amber", liveJobs.length, "Open turns", "Jobs not yet complete, paid or cancelled")}
            {statTile("done", "violet", doneToday, "Done today", "Jobs completed on today's schedule")}
          </div>
          <div className="pulse-stat-grid three">
            {statTile(
              "turntime",
              "cyan",
              avgTurnDays == null ? "—" : `${avgTurnDays.toFixed(1)}d`,
              "Avg turn",
              turnSample > 0
                ? `${turnSample} jobs completed in the last 30 days`
                : "No jobs completed in the last 30 days",
            )}
            {statTile("rework", "rose", reworks, "Re-works", "Jobs reopened after being called done")}
            {statTile("po", "amber", posNeeded, "POs needed", "Live jobs still missing a client PO")}
          </div>
          {drill && (
            <div className="pulse-drill">
              {drillData[drill].rows.length === 0 ? (
                <p className="pulse-drill-empty">{drillData[drill].empty}</p>
              ) : (
                <>
                  {drillData[drill].rows.slice(0, DRILL_MAX).map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className="pulse-drill-row"
                      onClick={() => r.propertyId && setSelectedId(r.propertyId)}
                    >
                      <strong>{r.label}</strong>
                      <em>{r.meta}</em>
                    </button>
                  ))}
                  {drillData[drill].rows.length > DRILL_MAX && (
                    <p className="pulse-drill-more">
                      +{drillData[drill].rows.length - DRILL_MAX} more
                    </p>
                  )}
                </>
              )}
            </div>
          )}
          {(uncrewed > 0 || overdueJobs > 0) && (
            <div className="pulse-flags">
              {overdueJobs > 0 && <span className="pulse-flag late">{overdueJobs} behind schedule</span>}
              {uncrewed > 0 && <span className="pulse-flag open">{uncrewed} need a crew</span>}
            </div>
          )}
          {selected && (
            <div className="pulse-overview-site">
              <strong>{selected.name}</strong>
              <p>{lines.primary} · {lines.secondary}</p>
              <div className="pulse-hud-actions">
                <button type="button" className="pulse-overlay-cta" onClick={() => selected.latitude == null ? setGpsOpen(true) : setTwinOpen(true)}>
                  {selected.latitude == null ? "Pin GPS" : "Open site twin"}
                </button>
                <button type="button" className="pulse-overlay-ghost" disabled={pinging} onClick={() => void pingTarget()}>
                  {pinging ? "Pinging…" : "Ping crew"}
                </button>
              </div>
            </div>
          )}
        </>
      ),
    },

    sites: {
      title: "Sites",
      kicker: `${liveCount} live`,
      body: (
        <>
          <p className="pulse-hud-portfolio">{portfolio}</p>
          {propsLoading && <p className="pulse-empty">Loading sites…</p>}
          {!propsLoading && filtered.length === 0 && <p className="pulse-empty">No sites match that search.</p>}
          {filtered.map((p) => {
            const st = statusLines(p.openJobs, p.crewsOnSite, p.overdueJobs);
            const tone = siteTone(p.crewsOnSite, p.overdueJobs, p.openJobs);
            return (
              <button
                key={p.id}
                type="button"
                className={`pulse-site-row tone-${tone} ${p.id === selectedId ? "sel" : ""}`}
                onClick={() => setSelectedId(p.id)}
              >
                <i className="pulse-dot" aria-hidden />
                <span>{p.name}</span>
                <em>{st.primary}</em>
                <small>{p.hotJob?.jobNo || p.city || st.secondary}</small>
              </button>
            );
          })}
        </>
      ),
    },

    crew: {
      title: "Crew",
      kicker: `${(pins ?? []).length} tracked`,
      body: (
        <>
          {(pins ?? []).length === 0 && <p className="pulse-empty">No crew GPS yet today.</p>}
          {(pins ?? []).map((c) => (
            <div key={c.id} className={`pulse-crew-row st-${c.todayStatus || "idle"}`}>
              <span className="pulse-avatar" aria-hidden>{initials(c.name)}</span>
              <div className="pulse-crew-meta">
                <b>{c.name}</b>
                <em>{c.todayProperty || c.trade || "Unassigned"}</em>
              </div>
              <span className="pulse-crew-state">{c.todayStatus || "idle"}</span>
            </div>
          ))}
          <button type="button" className="pulse-overlay-ghost" onClick={() => navigate(HREF.crews)}>Open crew records</button>
        </>
      ),
    },

    schedule: {
      title: "Schedule",
      kicker: "Today + tomorrow",
      body: (
        <>
          {scheduleRows.length === 0 && <p className="pulse-empty">Nothing scheduled.</p>}
          {(["today", "tomorrow"] as const).map((bucket) => {
            const day = bucket === "today" ? todayStr : addDays(todayStr, 1);
            const rows = scheduleRows.filter((j) => j.scheduledOn === day);
            if (rows.length === 0) return null;
            return (
              <div key={bucket} className="pulse-sched-group">
                <h3>{bucket === "today" ? "Today" : "Tomorrow"}<span>{rows.length}</span></h3>
                {rows.map((j) => (
                  <div key={j.id} className="pulse-sched-row">
                    <span>{j.jobNo}{j.unitNo ? ` · Unit ${j.unitNo}` : ""}</span>
                    <em className={j.crewLeaderName ? "" : "open"}>{j.crewLeaderName || "Uncrewed"}</em>
                  </div>
                ))}
              </div>
            );
          })}
        </>
      ),
    },

    units: {
      title: "Active units",
      kicker: `${unitRows.length} turns`,
      body: (
        <>
          {unitRows.length === 0 && <p className="pulse-empty">No unit turns on the board.</p>}
          {unitRows.map((u) => (
            <div key={u.job.id} className="pulse-unit-row">
              <div className="pulse-unit-chip">
                <b>{u.job.unitNo}</b>
                <small>{u.siteName.slice(0, 3).toUpperCase()}</small>
              </div>
              <div className="pulse-unit-meta">
                <span>{u.job.category || "Turn"}<strong>{u.pct}%</strong></span>
                <div className="pulse-progress"><span style={{ width: `${u.pct}%` }} /></div>
              </div>
            </div>
          ))}
        </>
      ),
    },

    calendar: {
      title: "Calendar",
      kicker: "Next 7 days",
      body: (
        <>
          {calDays.map((d) => (
            <div key={d.day} className={`pulse-cal-day ${d.day === todayStr ? "is-today" : ""}`}>
              <div className="pulse-cal-head">
                <b>{d.day === todayStr ? "Today" : weekdayLabel(d.day)}</b>
                {d.jobs.length > 0 && <span className="pulse-cal-count">{d.jobs.length}</span>}
              </div>
              {d.jobs.length === 0 && <em>Clear</em>}
              {d.jobs.slice(0, 4).map((j) => (
                <p key={j.id}>{j.jobNo}{j.unitNo ? ` · Unit ${j.unitNo}` : ""} · {j.crewLeaderName || "open"}</p>
              ))}
              {d.jobs.length > 4 && <em>+{d.jobs.length - 4} more</em>}
            </div>
          ))}
          <button type="button" className="pulse-overlay-ghost" onClick={() => navigate(HREF.calendar)}>Open full calendar</button>
        </>
      ),
    },

    activity: {
      title: "Activity",
      kicker: "Live feed",
      body: (
        <>
          {activity.length === 0 && <p className="pulse-empty">Waiting on the first site event.</p>}
          {activity.length > 0 && (
            <div className="pulse-timeline">
              {activity.map((it) => (
                <div key={it.id} className="pulse-act-row">
                  <span className="pulse-check" aria-hidden />
                  <div>
                    <strong>{it.label}</strong>
                    {it.sub && <em>{it.sub}</em>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ),
    },

    settings: {
      title: "Settings",
      kicker: sms.configured ? `Twilio ···${sms.fromLast4 ?? ""}` : "Twilio off",
      body: (
        <>
          <div className="pulse-sync-line">
            <span className={`pulse-pill ${sync?.stale ? "warn" : sync?.finishedAt ? "ok" : ""}`}>
              {sync?.stale ? "Stale" : sync?.finishedAt ? "Synced" : "Idle"}
            </span>
            <em>{sync?.finishedAt ? `Work app ${ageMinutes(sync.finishedAt) ?? 0}m ago` : "Work app idle"}</em>
          </div>
          <div className="pulse-hud-actions">
            <button type="button" className="pulse-overlay-cta" disabled={syncing} onClick={() => void syncNow()}>
              {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Sync Work
            </button>
            <button type="button" className="pulse-overlay-ghost" onClick={() => selected && setGpsOpen(true)}>Pin selected GPS</button>
            <button type="button" className="pulse-overlay-ghost" disabled={gpsPinging} onClick={() => void pingGps()}>
              {gpsPinging ? "Texting…" : "Keep GPS live"}
            </button>
            <button type="button" className="pulse-overlay-ghost" onClick={() => navigate(HREF.settings)}>Workspace settings</button>
          </div>
        </>
      ),
    },
  };

  const renderPanel = (id: PanelId) => {
    const def = panelBody[id];
    return (
      <HudBox
        key={id}
        id={id}
        title={def.title}
        kicker={def.kicker}
        open={open[id]}
        z={zOf(id)}
        mode={mode[id]}
        stageRef={stageRef}
        onClose={() => toggle(id)}
        onFocus={() => focus(id)}
        onToggleDock={() => toggleDock(id)}
      >
        {def.body}
      </HudBox>
    );
  };

  const railPanels = (rail: "left" | "right") =>
    (Object.keys(DOCK) as PanelId[])
      .filter((id) => open[id] && mode[id] === "docked" && DOCK[id].rail === rail)
      .sort((a, b) => DOCK[a].order - DOCK[b].order)
      .map(renderPanel);

  const floatingPanels = (Object.keys(DOCK) as PanelId[])
    .filter((id) => open[id] && mode[id] === "floating")
    .map(renderPanel);

  const leftRail = railPanels("left");
  const rightRail = railPanels("right");

  return (
    <div className="pulse-hud">
      <header className="pulse-hud-head">
        <button type="button" className="pulse-hud-brand" onClick={() => navigate(HREF.home)} aria-label="HALO chat">
          <img className="pulse-hud-logo" src={haloLogo} alt="HALO" />
          <span className="pulse-hud-brand-rule" aria-hidden />
          <div>
            <h1>
              Property Pulse<sup className="pulse-hud-tm">™</sup>
            </h1>
          </div>
        </button>
        <div className="pulse-hud-head-right">
          <div className="pulse-hud-clock">
            <strong>{timeStr}</strong>
            <span>{dateStr}</span>
          </div>
          <label className="pulse-hud-search">
            <Search size={14} />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (e.target.value && !open.sites) {
                  setOpen((o) => ({ ...o, sites: true }));
                  focus("sites");
                }
              }}
              placeholder="Search sites, units, jobs"
              aria-label="Search properties"
            />
          </label>
          <div className="relative">
            <button type="button" className="pulse-hud-icon" aria-label="More" onClick={() => setMenuOpen((v) => !v)}>
              <MoreVertical size={16} />
            </button>
            {menuOpen && (
              <div className="pulse-menu" role="menu">
                <button type="button" onClick={() => { setMenuOpen(false); navigate(HREF.home); }}>HALO chat</button>
                <button type="button" onClick={() => { setMenuOpen(false); navigate(HREF.properties); }}>Records</button>
                <button type="button" onClick={() => { setMenuOpen(false); window.open(BASE44_URL, "_blank", "noopener"); }}>Base44 Work</button>
              </div>
            )}
          </div>
          <button type="button" className="pulse-hud-dispatch" onClick={() => navigate(HREF.dispatch)}>
            <Send size={14} /> Dispatch
          </button>
        </div>
      </header>

      <div className="pulse-hud-body">
        <nav className="pulse-hud-nav" aria-label="Pulse panels">
          {NAV.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={open[id]}
              className={open[id] ? "on" : ""}
              onClick={() => toggle(id)}
            >
              <Icon size={18} strokeWidth={open[id] ? 2.4 : 1.8} />
            </button>
          ))}
          <div className="flex-1" />
          <button type="button" title="Reset layout" aria-label="Reset panel layout" onClick={resetLayout}>
            <RotateCcw size={17} />
          </button>
          <button
            type="button"
            title="HALO command"
            aria-label="HALO command"
            aria-pressed={moduleOpen}
            className={moduleOpen ? "on" : ""}
            onClick={() => (moduleOpen ? hideModule() : showModule())}
          >
            <MessageCircle size={18} strokeWidth={moduleOpen ? 2.4 : 1.8} />
          </button>
        </nav>

        <div className="pulse-hud-stage" ref={stageRef}>
          <MapContainer
            center={selectedCoord ?? mapPoints[0] ?? FALLBACK}
            zoom={13}
            style={{ height: "100%", width: "100%" }}
            zoomControl
            attributionControl={false}
            scrollWheelZoom
          >
            <TileLayer
              attribution="&copy; OSM &copy; CARTO"
              url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            />
            <FitPins points={mapPoints} selected={selectedCoord} />
            {ranked.map((p) =>
              p.latitude != null && p.longitude != null ? (
                <Marker
                  key={p.id}
                  position={[p.latitude, p.longitude]}
                  icon={pinIcon(p.id === selectedId || p.crewsOnSite > 0, p.crewsOnSite > 0)}
                  eventHandlers={{ click: () => { setSelectedId(p.id); if (!open.sites) toggle("sites"); } }}
                >
                  <Popup>
                    <div className="pulse-popup">
                      <strong>{p.name}</strong>
                      <em>{statusLines(p.openJobs, p.crewsOnSite, p.overdueJobs).secondary}</em>
                      <span>{p.hotJob?.jobNo || p.city || "—"}</span>
                    </div>
                  </Popup>
                </Marker>
              ) : null,
            )}
            {(pins ?? []).map((c) =>
              c.lat != null && c.lng != null ? (
                <Marker
                  key={`crew-${c.id}`}
                  position={[c.lat, c.lng]}
                  icon={pinIcon(c.todayStatus === "site" || c.todayStatus === "route", c.todayStatus === "site")}
                />
              ) : null,
            )}
          </MapContainer>

          {/* Docked rails — importance-ranked; the map keeps the centre channel. */}
          {leftRail.length > 0 && <div className="pulse-rail pulse-rail-left">{leftRail}</div>}
          {rightRail.length > 0 && <div className="pulse-rail pulse-rail-right">{rightRail}</div>}

          {/* Floating layer — popped-out panels drag and resize freely. */}
          {floatingPanels}
        </div>
      </div>

      {gpsOpen && selected && (
        <div className="pulse-modal" onClick={() => setGpsOpen(false)}>
          <div className="pulse-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="pulse-modal-head">
              <h3>GPS Finder · {selected.name}</h3>
              <button type="button" className="pulse-modal-close" aria-label="Close" onClick={() => setGpsOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <GpsFinder
              propertyId={selected.id}
              initialLat={selected.latitude}
              initialLng={selected.longitude}
              initialQuery={[selected.address, selected.city, selected.name].filter(Boolean).join(", ")}
              onPinned={() => { void queryClient.invalidateQueries({ queryKey: getListPropertiesQueryKey() }); }}
              onLocked={() => {
                void queryClient.invalidateQueries({ queryKey: getListPropertiesQueryKey() });
                setGpsOpen(false);
                setTwinOpen(true);
              }}
            />
          </div>
        </div>
      )}
      {twinOpen && selected && (
        <SiteTwin
          propertyId={selected.id}
          onClose={() => setTwinOpen(false)}
          onNeedPin={() => { setTwinOpen(false); setGpsOpen(true); }}
          onRequestGps={() => void pingGps()}
          onOpenJob={(jobId) => {
            setTwinOpen(false);
            navigate(`/jobs/${jobId}`);
          }}
          onRequestPhotos={(u) => void requestUnitPhotos(u)}
        />
      )}

      {/* HALO command — small floating chat window over the map. */}
      <CommandModule open={moduleOpen} onClose={hideModule} />

      {/* Bring-it-back pill (bottom-right) when the module is hidden. */}
      {!moduleOpen && (
        <button
          type="button"
          onClick={showModule}
          aria-label="Open HALO command"
          title="Open HALO command"
          style={{
            position: "fixed",
            right: 18,
            bottom: 18,
            zIndex: 3000,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 16px 10px 13px",
            borderRadius: 999,
            border: "1px solid rgba(180,255,68,0.28)",
            background: "#0B1626",
            color: "rgba(255,255,255,0.85)",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
          }}
        >
          <MessageCircle size={16} color="#B4FF44" />
          Ask HALO
        </button>
      )}
    </div>
  );
}
