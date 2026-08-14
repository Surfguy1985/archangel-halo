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
  MessageCircle,
  MoreVertical,
  RefreshCw,
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

function loadLayout(): Partial<Record<PanelId, BoxPos>> {
  try {
    return JSON.parse(localStorage.getItem(HUD_KEY) || "{}") as Partial<Record<PanelId, BoxPos>>;
  } catch {
    return {};
  }
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
  try {
    const raw = JSON.parse(localStorage.getItem(OPEN_KEY) || "null") as Partial<Record<PanelId, boolean>> | null;
    if (raw && typeof raw === "object") return { ...DEFAULT_OPEN, ...raw };
  } catch {
    /* */
  }
  return { ...DEFAULT_OPEN };
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
  stageRef,
  onClose,
  onFocus,
  children,
}: {
  id: PanelId;
  title: string;
  kicker?: string;
  open: boolean;
  z: number;
  stageRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onFocus: () => void;
  children: ReactNode;
}) {
  const [pos, setPos] = useState<BoxPos>(() => resolvePos(id, stageRef.current));
  const posRef = useRef(pos);
  posRef.current = pos;
  const drag = useRef<{ ox: number; oy: number } | null>(null);
  const resize = useRef<{ ox: number; oy: number; w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const next = resolvePos(id, stageRef.current);
    posRef.current = next;
    setPos(next);
  }, [open, id, stageRef]);

  if (!open) return null;

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
        <button type="button" aria-label={`Hide ${title}`} onClick={onClose}>
          <X size={14} />
        </button>
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
  const [twinOpen, setTwinOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [open, setOpen] = useState<Record<PanelId, boolean>>(loadOpen);
  const [zOrder, setZOrder] = useState<PanelId[]>(() =>
    (Object.keys(DEFAULT_OPEN) as PanelId[]).filter((id) => loadOpen()[id]),
  );

  useEffect(() => {
    localStorage.setItem(OPEN_KEY, JSON.stringify(open));
  }, [open]);

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

  return (
    <div className="pulse-hud">
      <header className="pulse-hud-head">
        <button type="button" className="pulse-hud-brand" onClick={() => navigate(HREF.home)} aria-label="HALO chat">
          <span className="pulse-hud-mark">H</span>
          <div>
            <p>Archangel Operations</p>
            <h1>Property Pulse</h1>
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
          <button type="button" title="HALO chat" aria-label="HALO chat" onClick={() => navigate(HREF.home)}>
            <MessageCircle size={18} />
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

          <HudBox id="overview" title="Overview" kicker="Live" open={open.overview} z={zOf("overview")} stageRef={stageRef} onClose={() => toggle("overview")} onFocus={() => focus("overview")}>
            <div className="pulse-stat-grid">
              <div className="pulse-stat lime"><b>{liveCount}</b><span>Active sites</span></div>
              <div className="pulse-stat green"><b>{crewsOnSite}</b><span>Crews out</span></div>
              <div className="pulse-stat amber"><b>{liveJobs.length}</b><span>Open turns</span></div>
              <div className="pulse-stat violet"><b>{doneToday}</b><span>Done today</span></div>
            </div>
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
          </HudBox>

          <HudBox id="sites" title="Sites" kicker={`${liveCount} live`} open={open.sites} z={zOf("sites")} stageRef={stageRef} onClose={() => toggle("sites")} onFocus={() => focus("sites")}>
            <p className="pulse-hud-portfolio">{portfolio}</p>
            {propsLoading && <p className="pulse-empty">Loading sites…</p>}
            {filtered.map((p) => {
              const st = statusLines(p.openJobs, p.crewsOnSite, p.overdueJobs);
              const on = p.id === selectedId;
              const dark = p.crewsOnSite > 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`pulse-site-row ${on ? "sel" : ""} ${dark ? "dark" : ""}`}
                  onClick={() => setSelectedId(p.id)}
                >
                  <span>{p.name}</span>
                  <em>{st.primary}</em>
                  <small>{p.hotJob?.jobNo || p.city || st.secondary}</small>
                </button>
              );
            })}
          </HudBox>

          <HudBox id="crew" title="Crew" kicker={`${(pins ?? []).length} tracked`} open={open.crew} z={zOf("crew")} stageRef={stageRef} onClose={() => toggle("crew")} onFocus={() => focus("crew")}>
            {(pins ?? []).length === 0 && <p className="pulse-empty">No crew GPS yet today.</p>}
            {(pins ?? []).map((c) => (
              <div key={c.id} className="pulse-crew-row">
                <b>{c.name}</b>
                <em>{c.todayProperty || c.trade || "—"} · {c.todayStatus || "idle"}</em>
                <span>{c.todayJob || c.unitNo || ""}</span>
              </div>
            ))}
            <button type="button" className="pulse-overlay-ghost" onClick={() => navigate(HREF.crews)}>Open crew records</button>
          </HudBox>

          <HudBox id="schedule" title="Schedule" kicker="Today + tomorrow" open={open.schedule} z={zOf("schedule")} stageRef={stageRef} onClose={() => toggle("schedule")} onFocus={() => focus("schedule")}>
            {scheduleRows.length === 0 && <p className="pulse-empty">Nothing scheduled.</p>}
            {scheduleRows.map((j) => (
              <div key={j.id} className="pulse-sched-row">
                <b>{j.scheduledOn === todayStr ? "Today" : "Tomorrow"}</b>
                <span>{j.jobNo} {j.unitNo ? `· Unit ${j.unitNo}` : ""} · {j.category}</span>
                <em>{j.crewLeaderName || "Uncrewed"}</em>
              </div>
            ))}
          </HudBox>

          <HudBox id="units" title="Active units" kicker={`${unitRows.length} turns`} open={open.units} z={zOf("units")} stageRef={stageRef} onClose={() => toggle("units")} onFocus={() => focus("units")}>
            {unitRows.length === 0 && <p className="pulse-empty">No unit turns on the board.</p>}
            {unitRows.map((u) => (
              <div key={u.job.id} className="pulse-unit-row">
                <div className="pulse-unit-chip">
                  <b>{u.job.unitNo}</b>
                  <small>{u.siteName.slice(0, 3).toUpperCase()}</small>
                </div>
                <div className="pulse-unit-meta">
                  <span>{u.job.category || "Turn"} · {u.pct}%</span>
                  <div className="pulse-progress"><span style={{ width: `${u.pct}%` }} /></div>
                </div>
              </div>
            ))}
          </HudBox>

          <HudBox id="calendar" title="Calendar" kicker="Next 7 days" open={open.calendar} z={zOf("calendar")} stageRef={stageRef} onClose={() => toggle("calendar")} onFocus={() => focus("calendar")}>
            {calDays.map((d) => (
              <div key={d.day} className="pulse-cal-day">
                <b>{d.day === todayStr ? "Today" : d.day}</b>
                {d.jobs.length === 0 && <em>Clear</em>}
                {d.jobs.slice(0, 4).map((j) => (
                  <p key={j.id}>{j.jobNo} {j.unitNo ? `Unit ${j.unitNo}` : ""} · {j.crewLeaderName || "open"}</p>
                ))}
              </div>
            ))}
            <button type="button" className="pulse-overlay-ghost" onClick={() => navigate(HREF.calendar)}>Open full calendar</button>
          </HudBox>

          <HudBox id="activity" title="Activity" kicker="Live feed" open={open.activity} z={zOf("activity")} stageRef={stageRef} onClose={() => toggle("activity")} onFocus={() => focus("activity")}>
            {activity.length === 0 && <p className="pulse-empty">Waiting on the first site event.</p>}
            {activity.map((it) => (
              <div key={it.id} className="pulse-act-row">
                <span className="pulse-check" />
                <div>
                  <strong>{it.label}</strong>
                  {it.sub && <em>{it.sub}</em>}
                </div>
              </div>
            ))}
          </HudBox>

          <HudBox id="settings" title="Settings" kicker={sms.configured ? `Twilio ···${sms.fromLast4 ?? ""}` : "Twilio off"} open={open.settings} z={zOf("settings")} stageRef={stageRef} onClose={() => toggle("settings")} onFocus={() => focus("settings")}>
            <p className="pulse-empty">{sync?.finishedAt ? `Work app ${ageMinutes(sync.finishedAt) ?? 0}m ago` : "Work app idle"}{sync?.stale ? " · stale" : ""}</p>
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
          </HudBox>
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
        />
      )}
    </div>
  );
}
