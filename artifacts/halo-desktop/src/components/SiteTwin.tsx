/**
 * Site Twin — live unit plate, crew GPS snapped to an apartment, and the day
 * replayed. Three things the office cannot get anywhere else: what every unit
 * is doing right now, proof of who stood where and for how long, and a plate
 * whose boxes sit on the real roof.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, MapContainer, Marker, Polygon, Polyline, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { divIcon, type Marker as LeafletMarker } from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Camera,
  Clock,
  Crosshair,
  Loader2,
  MapPin,
  Move,
  Pause,
  Phone,
  Play,
  Radio,
  X,
} from "lucide-react";

const LIME = "#B4FF44";
const CHARCOAL = "#1A1C1A";
const DEMO_PIN = "#E879F9";

type UnitState = "blocked" | "active" | "turning" | "scheduled" | "ready" | "idle";

type PlatePhoto = { id: string; url: string; phase: string | null; at: string; geo: boolean };

type TwinUnit = {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  lat: number;
  lng: number;
  state: UnitState;
  reasons: string[];
  daysInStage: number | null;
  jobId: string | null;
  jobNo: string | null;
  jobLabel: string | null;
  jobStatus: string | null;
  scheduledOn: string | null;
  crewId: string | null;
  crewName: string | null;
  openJobs: number;
  unpaid: number;
  minutesToday: number;
  photos: PlatePhoto[];
  photoCount: number;
  occupied: boolean;
};

type TwinVisit = { unitId: string; label: string; start: string; end: string; minutes: number };

type TwinCrew = {
  id: string;
  name: string;
  trade: string | null;
  phone?: string | null;
  selfiePath: string | null;
  lat: number | null;
  lng: number | null;
  at?: string | null;
  jobId: string | null;
  unitId: string | null;
  unitLabel: string | null;
  confidence: "inside" | "near" | "site" | "far";
  title: string;
  jobNo: string | null;
  meters: number | null;
  minutesHere: number;
  onSiteMinutes: number;
  arrivedAt: string | null;
  visits: TwinVisit[];
  source?: "live" | "demo";
  demo?: boolean;
  building?: number | null;
  buildingLabel?: string | null;
  fresh?: boolean;
};

type TwinBuilding = {
  building: number;
  label: string;
  lat: number;
  lng: number;
  unitCount?: number;
};

type TwinCounts = {
  total: number;
  blocked: number;
  active: number;
  turning: number;
  scheduled: number;
  ready: number;
  idle: number;
  unpaid: number;
  minutesToday: number;
  photosToday: number;
};

type ReplayCrew = { id: string; name: string; points: { lat: number; lng: number; t: string }[] };

type TwinPayload = {
  ready: boolean;
  reason?: string;
  headline: string;
  latitude: number | null;
  longitude: number | null;
  property: { id: string; name: string; address?: string | null; city?: string | null; units?: number | null };
  footprint?: { ring: { lat: number; lng: number }[]; source: string } | null;
  bbox?: { south: number; west: number; north: number; east: number } | null;
  units: TwinUnit[];
  crews: TwinCrew[];
  presence?: TwinCrew[];
  buildings?: TwinBuilding[];
  demo?: { active: boolean; presentationOnly?: boolean };
  counts?: TwinCounts;
  replay?: { since: string; crews: ReplayCrew[] };
  setup?: {
    pinned: boolean;
    unitCount: number;
    expectedUnits: number;
    inferredUnits?: number;
    liveGps: number;
    freshGps?: number;
  };
};

type LatLng = { lat: number; lng: number };

const STATE_LABEL: Record<UnitState, string> = {
  blocked: "Blocked",
  active: "Crew inside",
  turning: "Turning",
  scheduled: "Scheduled",
  ready: "Ready",
  idle: "Idle",
};

function gpsAgeLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (!Number.isFinite(s)) return null;
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

function gpsFresh(iso: string | null | undefined): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() <= 5 * 60 * 1000;
}

function isDemoCrew(c: Pick<TwinCrew, "id" | "demo" | "source">): boolean {
  return c.demo === true || c.source === "demo" || c.id.startsWith("demo:");
}

function readTwinDemoQuery(): boolean {
  if (typeof window === "undefined") return false;
  const v = (new URLSearchParams(window.location.search).get("demo") ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "thornbury" || v === "on";
}

function writeTwinDemoQuery(on: boolean) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (on) url.searchParams.set("demo", "1");
  else url.searchParams.delete("demo");
  window.history.replaceState(window.history.state, "", url);
}

function dwellLabel(minutes: number): string {
  if (!minutes || minutes < 1) return "—";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h}h${m}m` : `${h}h`;
}

function money(n: number): string {
  return n >= 1000 ? `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `$${Math.round(n)}`;
}

function clockLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Floor read off the unit label — 204 is floor 2, 1B is floor 1, A is unknown. */
function floorOf(label: string): number | null {
  const trimmed = label.trim();
  const digits = trimmed.replace(/\D/g, "");
  // 204 -> 2, 12 -> 1: the leading digit is the floor once a unit number is
  // long enough to carry one.
  if (digits.length >= 2) return Number(digits[0]);
  // 1B / 3-C: a single digit followed by a letter is a floor plus a door, so
  // the digit is still the floor. A bare "7" is just unit seven — no floor
  // can be inferred from it, and guessing would file it under a floor that
  // may not exist.
  if (/^\d\s*[-.]?\s*[A-Za-z]/.test(trimmed)) return Number(digits[0]);
  return null;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

function crewIcon(opts: {
  hot: boolean;
  initial: string;
  name: string;
  demo: boolean;
  selected: boolean;
  fresh: boolean;
}) {
  const first = esc((opts.name.split(" ")[0] || opts.initial).slice(0, 12));
  if (opts.demo) {
    return divIcon({
      className: "site-twin-leaflet",
      html: `<div class="site-twin-pin demo ${opts.selected ? "sel" : ""}">
        <span class="site-twin-pin-badge">DEMO</span>
        <div class="site-twin-pin-body">${esc(opts.initial)}</div>
        <em>${first}</em>
      </div>`,
      iconSize: [88, 68],
      iconAnchor: [44, 30],
    });
  }
  return divIcon({
    className: "site-twin-leaflet",
    html: `<div class="site-twin-pin live ${opts.hot ? "hot" : ""} ${opts.fresh ? "fresh" : ""} ${opts.selected ? "sel" : ""}">
        <span class="site-twin-pin-radar" aria-hidden="true"></span>
        <div class="site-twin-pin-body">${esc(opts.initial)}</div>
        <em>${first}</em>
      </div>`,
    iconSize: [88, 62],
    iconAnchor: [44, 24],
  });
}

function buildingTone(
  b: number,
  crews: TwinCrew[],
  densest: number | null,
): "idle" | "live" | "demo" | "mixed" | "hot" {
  if (densest === b) return "hot";
  const here = crews.filter(
    (c) => c.building === b && (isDemoCrew(c) || c.confidence === "inside" || c.confidence === "near"),
  );
  const hasLive = here.some((c) => !isDemoCrew(c));
  const hasDemo = here.some(isDemoCrew);
  if (hasLive && hasDemo) return "mixed";
  if (hasDemo) return "demo";
  if (hasLive) return "live";
  return "idle";
}

function buildingIcon(n: number, tone: "idle" | "live" | "demo" | "mixed" | "hot") {
  return divIcon({
    className: "site-twin-leaflet",
    html: `<div class="site-twin-bldg ${tone}">${n}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

/** A unit box shown on the roof while the plate is being placed. */
function unitIcon(label: string, state: UnitState) {
  return divIcon({
    className: "",
    html: `<div class="site-twin-mapunit ${esc(state)}">${esc(label)}</div>`,
    iconSize: [46, 26],
    iconAnchor: [23, 13],
  });
}

/** The site anchor itself — lime and lifted while it is being repositioned. */
function siteIcon(moving: boolean) {
  const body = moving ? LIME : "rgba(26,28,26,0.92)";
  const trim = moving ? CHARCOAL : LIME;
  return divIcon({
    className: "",
    html: `<div style="width:32px;height:44px;filter:drop-shadow(0 4px 10px rgba(0,0,0,.45));${moving ? "cursor:grab;" : ""}">
      <svg width="32" height="44" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg">
        <path d="M15 40C15 40 27 25 27 15A12 12 0 0 0 3 15C3 25 15 40 15 40Z" fill="${body}" stroke="${trim}" stroke-width="2.5" stroke-linejoin="round"/>
        <circle cx="15" cy="15" r="4.5" fill="${trim}"/>
      </svg>
    </div>`,
    iconSize: [32, 44],
    iconAnchor: [16, 42],
  });
}

function Fit({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  const seeded = useRef(false);
  useEffect(() => {
    // First paint frames the site; later pin saves must not yank the operator's zoom.
    map.setView([lat, lng], seeded.current ? map.getZoom() : 18);
    seeded.current = true;
    const t = setTimeout(() => map.invalidateSize(), 80);
    return () => clearTimeout(t);
  }, [map, lat, lng]);
  return null;
}

function FlyToCrew({ target }: { target: { lat: number; lng: number; id: string } | null }) {
  const map = useMap();
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!target) return;
    if (last.current === target.id) return;
    last.current = target.id;
    map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 18), { duration: 0.65 });
  }, [map, target]);
  return null;
}

function PickPoint({ enabled, onPick }: { enabled: boolean; onPick: (p: LatLng) => void }) {
  useMapEvents({
    click(e) {
      if (enabled) onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

/**
 * A marker that walks to its new position instead of teleporting. Polling is
 * every few seconds, and a dot that jumps reads as a glitch rather than a
 * person moving.
 */
function GlideMarker({
  position,
  icon,
  onClick,
}: {
  position: [number, number];
  icon: ReturnType<typeof divIcon>;
  onClick?: () => void;
}) {
  const ref = useRef<LeafletMarker | null>(null);
  const frame = useRef<number | null>(null);
  // The position prop is frozen at mount on purpose: react-leaflet snaps the
  // marker whenever that prop changes, which would cancel the glide before it
  // could run. Movement is driven imperatively below instead.
  const mounted = useRef<[number, number]>(position);

  useEffect(() => {
    const marker = ref.current;
    if (!marker) return;
    const from = marker.getLatLng();
    const to = { lat: position[0], lng: position[1] };
    const far = Math.abs(from.lat - to.lat) > 0.002 || Math.abs(from.lng - to.lng) > 0.002;
    // A big jump is a different fix, not a walk — snap it.
    if (far) {
      marker.setLatLng(to);
      return;
    }
    const start = performance.now();
    const DURATION = 900;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      marker.setLatLng({
        lat: from.lat + (to.lat - from.lat) * ease,
        lng: from.lng + (to.lng - from.lng) * ease,
      });
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    };
  }, [position[0], position[1]]);

  useEffect(() => {
    ref.current?.setIcon(icon);
  }, [icon]);

  return (
    <Marker
      ref={ref}
      position={mounted.current}
      icon={icon}
      eventHandlers={onClick ? { click: onClick } : undefined}
    />
  );
}

export function SiteTwin({
  propertyId,
  onClose,
  onNeedPin,
  onRequestGps,
  onOpenJob,
  onRequestPhotos,
}: {
  propertyId: string;
  onClose: () => void;
  onNeedPin?: () => void;
  onRequestGps?: () => void;
  onOpenJob?: (jobId: string) => void;
  onRequestPhotos?: (unit: { unitId: string; label: string; crewId: string | null }) => void;
}) {
  const [data, setData] = useState<TwinPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selectedCrew, setSelectedCrew] = useState<string | null>(null);
  const [openUnit, setOpenUnit] = useState<string | null>(null);
  const [laying, setLaying] = useState(false);
  const [countDraft, setCountDraft] = useState("");
  const [moving, setMoving] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [pinDraft, setPinDraft] = useState<LatLng | null>(null);
  const [savingPin, setSavingPin] = useState(false);
  const [floor, setFloor] = useState<number | "all">("all");
  const [replayAt, setReplayAt] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [demoMode, setDemoMode] = useState(() => readTwinDemoQuery());
  const [flyTo, setFlyTo] = useState<{ id: string; lat: number; lng: number } | null>(null);
  const [clock, setClock] = useState(() => new Date());

  const pickCrew = useCallback((c: TwinCrew, fly = true) => {
    setSelectedCrew(c.id);
    if (fly && c.lat != null && c.lng != null) setFlyTo({ id: c.id, lat: c.lat, lng: c.lng });
  }, []);

  // Every fetch carries a generation stamp. Freezing the poll stops FUTURE
  // refreshes, but a request already in flight would still land mid-drag and
  // stomp the operator's work — bumping the generation retires it instead.
  const loadGen = useRef(0);
  const retireInFlight = useCallback(() => {
    loadGen.current += 1;
  }, []);
  const load = useCallback(async () => {
    const gen = ++loadGen.current;
    try {
      const qs = demoMode ? "?demo=1" : "";
      const r = await fetch(`/api/properties/${propertyId}/site-twin${qs}`, { credentials: "include" });
      if (!r.ok) throw new Error(`Twin failed (${r.status})`);
      const json = await r.json();
      if (gen !== loadGen.current) return;
      setData(json);
      setErr(null);
    } catch (e) {
      if (gen !== loadGen.current) return;
      setErr(e instanceof Error ? e.message : "Twin unavailable");
    }
  }, [propertyId, demoMode]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => retireInFlight, [retireInFlight]);

  // Polling pauses while the operator is moving the pin, dragging unit boxes or
  // scrubbing the day — a refresh must never stomp work in progress.
  const frozen = moving || placing || replayAt != null;
  useEffect(() => {
    if (frozen) {
      retireInFlight();
      return;
    }
    const id = setInterval(() => void load(), 8_000);
    return () => clearInterval(id);
  }, [load, frozen, retireInFlight]);

  useEffect(() => {
    const n = data?.setup?.expectedUnits || data?.setup?.inferredUnits || data?.property.units || 0;
    if (n > 0 && !countDraft) setCountDraft(String(n));
  }, [data, countDraft]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        setDemoMode((v) => {
          const next = !v;
          writeTwinDemoQuery(next);
          return next;
        });
        return;
      }
      if (e.key !== "Escape") return;
      // A pin save is already in flight and cannot be recalled — refuse to
      // imply it was discarded.
      if (savingPin) return;
      if (openUnit) {
        setOpenUnit(null);
        return;
      }
      if (replayAt != null) {
        setReplayAt(null);
        setPlaying(false);
        return;
      }
      if (placing) {
        setPlacing(false);
        return;
      }
      if (moving) {
        setMoving(false);
        setPinDraft(null);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, moving, placing, savingPin, openUnit, replayAt]);

  const layUnits = async () => {
    if (laying) return;
    const count = Math.max(1, Math.round(Number(countDraft) || data?.setup?.expectedUnits || data?.setup?.inferredUnits || data?.property.units || 0));
    if (count < 1) return;
    setLaying(true);
    try {
      const r = await fetch(`/api/admin/accounts/${propertyId}/unit-map/grid`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count, replace: false }),
      });
      if (!r.ok) throw new Error(`Grid failed (${r.status})`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not lay out units");
    } finally {
      setLaying(false);
    }
  };

  const savePin = async () => {
    if (!pinDraft || savingPin) return;
    setSavingPin(true);
    try {
      const r = await fetch(`/api/properties/${propertyId}/gps`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude: pinDraft.lat, longitude: pinDraft.lng }),
      });
      if (!r.ok) throw new Error(`Could not move the pin (${r.status})`);
      setMoving(false);
      setPinDraft(null);
      // Server drops its footprint cache on save, so the plate re-derives here.
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not move the pin");
    } finally {
      setSavingPin(false);
    }
  };

  /** Persist a unit box dropped onto the roof, as a fraction of the site box. */
  const saveUnitSpot = async (unit: TwinUnit, at: LatLng) => {
    const bbox = data?.bbox;
    if (!bbox) return;
    const x = (at.lng - bbox.west) / (bbox.east - bbox.west) - unit.w / 2;
    const y = (bbox.north - at.lat) / (bbox.north - bbox.south) - unit.h / 2;
    const clamp = (v: number, span: number) => Math.min(Math.max(v, 0), Math.max(0, 1 - span));
    try {
      const r = await fetch(`/api/admin/accounts/${propertyId}/unit-map/units/${unit.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x: clamp(x, unit.w), y: clamp(y, unit.h) }),
      });
      if (!r.ok) throw new Error(`Could not place ${unit.label} (${r.status})`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not place that unit");
    }
  };

  const active = useMemo(() => {
    if (!data?.crews.length) return null;
    return data.crews.find((c) => c.id === selectedCrew) ?? data.crews[0];
  }, [data, selectedCrew]);

  const hotUnit = active?.unitId ?? null;
  const counts = data?.counts ?? null;

  const floors = useMemo(() => {
    const set = new Set<number>();
    for (const u of data?.units ?? []) {
      const f = floorOf(u.label);
      if (f != null) set.add(f);
    }
    return [...set].sort((a, b) => a - b);
  }, [data]);

  const visibleUnits = useMemo(() => {
    const units = data?.units ?? [];
    if (floor === "all") return units;
    return units.filter((u) => floorOf(u.label) === floor);
  }, [data, floor]);

  // Crews clocked into a job here whose phone says otherwise. This is the
  // exception the office would never otherwise catch.
  const offSite = useMemo(
    () =>
      (data?.crews ?? []).filter(
        (c) => !isDemoCrew(c) && c.jobNo && c.lat != null && gpsFresh(c.at) && c.confidence === "far",
      ),
    [data],
  );

  // ---- Replay ------------------------------------------------------------
  const replay = data?.replay ?? null;
  const replayRange = useMemo(() => {
    const times: number[] = [];
    for (const c of replay?.crews ?? []) {
      for (const p of c.points) times.push(new Date(p.t).getTime());
    }
    if (!times.length) return null;
    return { start: Math.min(...times), end: Math.max(...times) };
  }, [replay]);

  useEffect(() => {
    if (!playing || replayAt == null || !replayRange) return;
    const id = setInterval(() => {
      setReplayAt((prev) => {
        if (prev == null) return prev;
        // Whole day in about half a minute, then hold at the end.
        const stepMs = Math.max(60_000, (replayRange.end - replayRange.start) / 300);
        const next = prev + stepMs;
        if (next >= replayRange.end) {
          setPlaying(false);
          return replayRange.end;
        }
        return next;
      });
    }, 100);
    return () => clearInterval(id);
  }, [playing, replayAt == null, replayRange]);

  /** Where each crew was at the scrubbed moment, plus the trail up to it. */
  const replayFrame = useMemo(() => {
    if (replayAt == null || !replay) return null;
    return replay.crews.map((c) => {
      const upto = c.points.filter((p) => new Date(p.t).getTime() <= replayAt);
      const here = upto[upto.length - 1] ?? null;
      return { id: c.id, name: c.name, here, trail: upto.slice(-120) };
    });
  }, [replay, replayAt]);

  const unitSheet = useMemo(
    () => data?.units.find((u) => u.id === openUnit) ?? null,
    [data, openUnit],
  );
  const sheetCrew = useMemo(
    () => (unitSheet?.crewId ? data?.crews.find((c) => c.id === unitSheet.crewId) ?? null : null),
    [data, unitSheet],
  );

  const live = (data?.setup?.freshGps ?? 0) > 0 || data?.crews.some((c) => !isDemoCrew(c) && gpsFresh(c.at));
  const demoOn = demoMode || !!data?.demo?.active;
  const liveCrews = (data?.crews ?? []).filter((c) => !isDemoCrew(c));
  const mockCrews = (data?.crews ?? []).filter(isDemoCrew);
  const densestBuilding = useMemo(() => {
    const tally = new Map<number, number>();
    for (const c of data?.crews ?? []) {
      if (c.building == null) continue;
      if (isDemoCrew(c) || c.confidence === "inside" || c.confidence === "near") {
        tally.set(c.building, (tally.get(c.building) ?? 0) + 1);
      }
    }
    let best = 0;
    let n = 0;
    for (const [b, count] of tally) {
      if (count > n) {
        n = count;
        best = b;
      }
    }
    return best || null;
  }, [data]);
  const kicker = !data?.ready
    ? "SITE TWIN · PIN GPS"
    : replayAt != null
      ? "SITE TWIN · REPLAY"
      : placing
        ? "SITE TWIN · PLACING UNITS"
        : moving
          ? "SITE TWIN · MOVING PIN"
          : demoOn
            ? "SITE TWIN · DEMO WALKTHROUGH"
            : live
              ? "SITE TWIN · LIVE"
              : "SITE TWIN · LAST SEEN";

  const sitePin: LatLng | null =
    pinDraft ??
    (data?.latitude != null && data?.longitude != null ? { lat: data.latitude, lng: data.longitude } : null);

  return (
    <div className={`site-twin${demoOn ? " is-demo" : live ? " is-live" : ""}`} role="dialog" aria-label="Site twin">
      <header className="site-twin-hud">
        <div>
          <p className={`site-twin-kicker${demoOn ? " demo" : ""}`}>
            <span className={`site-twin-live-dot${live && !demoOn ? " on" : ""}`} />
            {kicker}
          </p>
          <h2>{data?.headline ?? `${data?.property.name ?? "Site"} — acquiring plate`}</h2>
          <p className="site-twin-sub">
            {data?.property.name}
            {data?.property.address ? ` · ${data.property.address}` : ""}
            {" · "}
            {clock.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            <span className="site-twin-keys">D demo</span>
          </p>
        </div>
        <div className="site-twin-hud-actions">
          <button
            type="button"
            className="site-twin-movepin"
            aria-pressed={demoMode}
            title="Place labeled mock crews on Thornbury buildings. Live GPS still wins. Shortcut: D"
            onClick={() => {
              setDemoMode((v) => {
                const next = !v;
                writeTwinDemoQuery(next);
                return next;
              });
            }}
          >
            {demoMode ? "Hide demo" : "Thornbury demo"}
          </button>
          {densestBuilding != null && data?.ready && (
            <button
              type="button"
              className="site-twin-movepin"
              title="Jump to the densest building"
              onClick={() => {
                const crew = (data.crews ?? []).find((c) => c.building === densestBuilding && c.lat != null);
                if (crew) pickCrew(crew);
              }}
            >
              <Crosshair size={14} />
              Densest {densestBuilding}
            </button>
          )}
          {data?.ready && (replay?.crews.length ?? 0) > 0 && replayRange && (
            <button
              type="button"
              className="site-twin-movepin"
              aria-pressed={replayAt != null}
              onClick={() => {
                if (replayAt != null) {
                  setReplayAt(null);
                  setPlaying(false);
                } else {
                  setReplayAt(replayRange.start);
                  setPlaying(true);
                }
              }}
            >
              <Clock size={14} />
              {replayAt != null ? "Live" : "Replay day"}
            </button>
          )}
          {data?.ready && (data.units.length ?? 0) > 0 && (
            <button
              type="button"
              className="site-twin-movepin"
              aria-pressed={placing}
              disabled={savingPin}
              onClick={() => {
                setPlacing((v) => !v);
                setMoving(false);
                setPinDraft(null);
              }}
            >
              <Move size={14} />
              {placing ? "Done placing" : "Place units"}
            </button>
          )}
          {data?.ready && (
            <button
              type="button"
              className="site-twin-movepin"
              aria-pressed={moving}
              disabled={savingPin}
              onClick={() => {
                setMoving((v) => !v);
                setPlacing(false);
                setPinDraft(null);
              }}
            >
              <MapPin size={14} />
              {moving ? "Done moving" : "Move pin"}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={savingPin}
            aria-label="Close site twin"
            className="site-twin-close"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      {demoOn && (
        <div className="site-twin-demo-banner" role="status">
          <div>
            <strong>DEMO WALKTHROUGH</strong>
            Magenta MOCK pins are presentation only — never check-ins or GPS history. Lime radar is live GPS and still wins.
          </div>
          <div className="site-twin-stage" aria-label="Mock crew placements">
            {mockCrews.map((c) => (
              <button
                key={c.id}
                type="button"
                className={c.id === active?.id ? "on" : ""}
                onClick={() => pickCrew(c)}
              >
                <b>{c.building ?? "—"}</b>
                <span>{c.trade ?? c.name.split(" ")[0]}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {data && (
      <div className="site-twin-counts" role="list">
        <span role="listitem" className="tally active"><b>{liveCrews.filter((c) => gpsFresh(c.at)).length}</b> live GPS</span>
        {demoOn && <span role="listitem" className="tally demo"><b>{mockCrews.length}</b> mock</span>}
        {counts && counts.total > 0 && (
          <>
            <span role="listitem" className="tally turning"><b>{counts.turning}</b> turning</span>
            <span role="listitem" className="tally blocked"><b>{counts.blocked}</b> blocked</span>
            <span role="listitem" className="tally money"><b>{money(counts.unpaid)}</b> in flight</span>
            <span role="listitem" className="tally"><b>{dwellLabel(counts.minutesToday)}</b> on site today</span>
          </>
        )}
      </div>
      )}

      {offSite.length > 0 && (
        <div className="site-twin-exception">
          <Radio size={13} />
          <span>
            {offSite.map((c) => c.name.split(" ")[0]).join(", ")} {offSite.length === 1 ? "is" : "are"} on a job here but
            {" "}phone GPS puts {offSite.length === 1 ? "them" : "them"} off the property.
          </span>
        </div>
      )}

      {!data && !err && (
        <div className="site-twin-empty">
          <Loader2 className="animate-spin" /> Reading the building…
        </div>
      )}
      {err && <div className="site-twin-empty">{err}</div>}
      {data && !data.ready && (
        <div className="site-twin-empty">
          <p>This site has no GPS lock yet. Pin it once — then crew phones snap to units.</p>
          <button type="button" onClick={onNeedPin}>
            Pin GPS first
          </button>
        </div>
      )}

      {data?.ready && data.latitude != null && data.longitude != null && (
        <div className="site-twin-body">
          <section className="site-twin-plate" aria-label="Unit plate">
            {data.units.length === 0 ? (
              <div className="site-twin-setup">
                <p>Lay out the plate so phones snap to apartments.</p>
                <div className="site-twin-count">
                  <input
                    type="number"
                    min={1}
                    max={1500}
                    inputMode="numeric"
                    value={countDraft}
                    onChange={(e) => setCountDraft(e.target.value)}
                    placeholder="Unit count"
                    aria-label="Unit count"
                  />
                  <button type="button" disabled={laying || Number(countDraft) < 1} onClick={() => void layUnits()}>
                    {laying ? "Laying out…" : "Lay out units"}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {floors.length > 1 && (
                  <div className="site-twin-floors">
                    <button type="button" className={floor === "all" ? "on" : ""} onClick={() => setFloor("all")}>
                      All
                    </button>
                    {floors.map((f) => (
                      <button key={f} type="button" className={floor === f ? "on" : ""} onClick={() => setFloor(f)}>
                        Fl {f}
                      </button>
                    ))}
                  </div>
                )}
                <div className="site-twin-iso">
                  {visibleUnits.map((u) => {
                    const on = u.id === hotUnit;
                    return (
                      <button
                        key={u.id}
                        type="button"
                        className={`site-twin-unit ${u.state} ${on ? "hot" : ""}`}
                        style={{
                          left: `${u.x * 100}%`,
                          top: `${u.y * 100}%`,
                          width: `${u.w * 100}%`,
                          height: `${u.h * 100}%`,
                        }}
                        onClick={() => {
                          setOpenUnit(u.id);
                          if (u.crewId) {
                            const crew = data.crews.find((c) => c.id === u.crewId);
                            if (crew) pickCrew(crew, false);
                            else setSelectedCrew(u.crewId);
                          }
                        }}
                        title={`${u.label} — ${STATE_LABEL[u.state]}`}
                      >
                        <span>{u.label}</span>
                        {u.crewName && <em>{u.crewName.split(" ")[0]}</em>}
                        <i className="site-twin-unit-meta">
                          {u.daysInStage != null ? `${u.daysInStage}d` : ""}
                          {u.minutesToday >= 1 ? ` · ${dwellLabel(u.minutesToday)}` : ""}
                        </i>
                        {u.photoCount > 0 && <b className="site-twin-unit-cam"><Camera size={9} />{u.photoCount}</b>}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </section>

          <section className={`site-twin-map ${moving ? "moving" : ""}`}>
            <MapContainer
              center={[data.latitude, data.longitude]}
              zoom={18}
              style={{ height: "100%", width: "100%" }}
              zoomControl={false}
            >
              <TileLayer
                attribution="Tiles &copy; Esri"
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              />
              <Fit lat={data.latitude} lng={data.longitude} />
              <FlyToCrew target={flyTo} />
              <PickPoint enabled={moving} onPick={setPinDraft} />
              {data.footprint?.ring && data.footprint.ring.length > 2 && (
                <Polygon
                  positions={data.footprint.ring.map((p) => [p.lat, p.lng] as [number, number])}
                  pathOptions={{ color: LIME, weight: 2, fillColor: LIME, fillOpacity: 0.12 }}
                />
              )}
              {(data.buildings ?? []).map((b) => {
                const tone = buildingTone(b.building, data.crews, densestBuilding);
                return (
                  <Circle
                    key={`bldg-ring-${b.building}`}
                    center={[b.lat, b.lng]}
                    radius={tone === "hot" ? 28 : 22}
                    pathOptions={{
                      color: tone === "demo" ? DEMO_PIN : tone === "idle" ? "rgba(255,255,255,0.28)" : LIME,
                      weight: tone === "hot" ? 2 : 1,
                      fillColor: tone === "demo" ? DEMO_PIN : tone === "idle" ? "#64748b" : LIME,
                      fillOpacity: tone === "idle" ? 0.08 : 0.2,
                    }}
                  />
                );
              })}
              {(data.buildings ?? []).map((b) => {
                const tone = buildingTone(b.building, data.crews, densestBuilding);
                const here = data.crews.find((c) => c.building === b.building && c.lat != null);
                return (
                  <Marker
                    key={`bldg-${b.building}`}
                    position={[b.lat, b.lng]}
                    icon={buildingIcon(b.building, tone)}
                    zIndexOffset={-400}
                    eventHandlers={{
                      click: () => {
                        if (here) pickCrew(here);
                      },
                    }}
                  />
                );
              })}
              {sitePin && (
                <Marker
                  position={[sitePin.lat, sitePin.lng]}
                  icon={siteIcon(moving)}
                  draggable={moving}
                  zIndexOffset={-500}
                  eventHandlers={{
                    dragend: (e) => {
                      const ll = (e.target as LeafletMarker).getLatLng();
                      setPinDraft({ lat: ll.lat, lng: ll.lng });
                    },
                  }}
                />
              )}

              {/* Placing mode puts every box on the roof so it can be dragged
                  onto the apartment it actually is. */}
              {placing &&
                visibleUnits.map((u) => (
                  <Marker
                    key={`place-${u.id}`}
                    position={[u.lat, u.lng]}
                    icon={unitIcon(u.label, u.state)}
                    draggable
                    eventHandlers={{
                      dragend: (e) => {
                        const ll = (e.target as LeafletMarker).getLatLng();
                        void saveUnitSpot(u, { lat: ll.lat, lng: ll.lng });
                      },
                    }}
                  />
                ))}

              {/* Replay takes the map over; live dots would contradict it. */}
              {replayFrame
                ? replayFrame.map((c) => (
                    <Fragment key={`rp-${c.id}`}>
                      {c.trail.length > 1 && (
                        <Polyline
                          positions={c.trail.map((p) => [p.lat, p.lng] as [number, number])}
                          pathOptions={{ color: LIME, weight: 3, opacity: 0.55 }}
                        />
                      )}
                      {c.here && (
                        <Marker
                          position={[c.here.lat, c.here.lng]}
                          icon={crewIcon({
                            hot: true,
                            initial: c.name.slice(0, 1).toUpperCase(),
                            name: c.name,
                            demo: false,
                            selected: false,
                            fresh: true,
                          })}
                        />
                      )}
                    </Fragment>
                  ))
                : data.crews.map((c) =>
                    c.lat != null && c.lng != null ? (
                      <GlideMarker
                        key={c.id}
                        position={[c.lat, c.lng]}
                        icon={crewIcon({
                          hot: c.confidence === "inside" || c.confidence === "near",
                          initial: c.name.slice(0, 1).toUpperCase(),
                          name: c.name,
                          demo: isDemoCrew(c),
                          selected: c.id === active?.id,
                          fresh: !isDemoCrew(c) && gpsFresh(c.at),
                        })}
                        onClick={() => pickCrew(c)}
                      />
                    ) : null,
                  )}
            </MapContainer>

            <div className="site-twin-legend" aria-label="Crew legend">
              <span className="live"><i /> Live GPS radar</span>
              {demoOn && <span className="demo"><i /> DEMO / MOCK — not a check-in</span>}
            </div>

            {active && active.lat != null && (
              <div className={`site-twin-inspect${isDemoCrew(active) ? " demo" : ""}`} role="status">
                <p className="site-twin-inspect-kicker">
                  {isDemoCrew(active) ? "MOCK PLACEMENT" : gpsFresh(active.at) ? "LIVE FIX" : "LAST SEEN"}
                </p>
                <strong>{active.name}</strong>
                <em>{active.title}</em>
                <p>
                  {active.trade ? `${active.trade} · ` : ""}
                  {active.buildingLabel ?? (active.building != null ? `Building ${active.building}` : "On site")}
                  {active.unitLabel ? ` · Unit ${active.unitLabel}` : ""}
                </p>
                {!isDemoCrew(active) && (
                  <p className="site-twin-inspect-age">{gpsAgeLabel(active.at) ?? "waiting on phone"}</p>
                )}
              </div>
            )}

            {placing && (
              <div className="site-twin-pinbar">
                <p>Drag a unit box onto its apartment. Each drop saves.</p>
                <button type="button" className="go" onClick={() => setPlacing(false)}>
                  Done
                </button>
              </div>
            )}

            {moving && (
              <div className="site-twin-pinbar">
                <p>
                  {pinDraft
                    ? "Pin moved. Save to re-snap the plate and crew GPS."
                    : "Drag the pin — or tap the right spot on the roof."}
                </p>
                <button
                  type="button"
                  disabled={savingPin}
                  onClick={() => {
                    setMoving(false);
                    setPinDraft(null);
                  }}
                >
                  Cancel
                </button>
                <button type="button" className="go" disabled={!pinDraft || savingPin} onClick={() => void savePin()}>
                  {savingPin ? "Saving…" : "Save pin"}
                </button>
              </div>
            )}

            {replayAt != null && replayRange && (
              <div className="site-twin-scrub">
                <button
                  type="button"
                  aria-label={playing ? "Pause replay" : "Play replay"}
                  onClick={() => setPlaying((v) => !v)}
                >
                  {playing ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <input
                  type="range"
                  min={replayRange.start}
                  max={replayRange.end}
                  value={replayAt}
                  aria-label="Time of day"
                  onChange={(e) => {
                    setPlaying(false);
                    setReplayAt(Number(e.target.value));
                  }}
                />
                <span>{clockLabel(new Date(replayAt).toISOString())}</span>
              </div>
            )}
          </section>

          <aside className="site-twin-roster">
            {data.crews.length === 0 && (
              <div className="site-twin-hint">
                <p>No phone ping on this plate yet.</p>
                {onRequestGps && (
                  <button type="button" onClick={onRequestGps}>Text crew to keep GPS live</button>
                )}
              </div>
            )}
            {data.crews.map((c) => {
              const age = gpsAgeLabel(c.at);
              const fresh = !isDemoCrew(c) && gpsFresh(c.at);
              const mock = isDemoCrew(c);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`site-twin-crew ${mock ? "demo" : ""} ${c.id === active?.id ? "on" : ""}`}
                  onClick={() => pickCrew(c)}
                >
                  <span className={`site-twin-dot ${mock ? "demo" : fresh ? c.confidence : "far"}`} />
                  <div>
                    <strong>
                      {mock && <span className="site-twin-mock">DEMO</span>}
                      {c.title}
                    </strong>
                    <em>
                      {mock
                        ? `${c.buildingLabel ?? (c.building != null ? `Building ${c.building}` : "On site")} · mock placement, not live GPS`
                        : `${c.jobNo ? `${c.jobNo} · ` : ""}${c.lat == null ? "waiting on phone" : age ? (fresh ? age : `last seen ${age}`) : "no ping"}`}
                    </em>
                    {!mock && c.onSiteMinutes > 0 && (
                      <em className="site-twin-crew-dwell">
                        {dwellLabel(c.onSiteMinutes)} on site
                        {c.arrivedAt ? ` · in at ${clockLabel(c.arrivedAt)}` : ""}
                        {c.visits.length > 1 ? ` · ${c.visits.length} units` : ""}
                      </em>
                    )}
                  </div>
                  <Radio size={14} />
                </button>
              );
            })}
            {data.crews.filter((c) => !isDemoCrew(c)).length > 0 &&
              data.crews.filter((c) => !isDemoCrew(c)).every((c) => c.lat == null || !gpsFresh(c.at)) &&
              onRequestGps && (
              <button type="button" className="site-twin-wake" onClick={onRequestGps}>
                Text crew to keep GPS live
              </button>
            )}
          </aside>
        </div>
      )}

      {unitSheet && (
        <div className="site-twin-sheet" role="dialog" aria-label={`Unit ${unitSheet.label}`}>
          <header>
            <div>
              <p className={`site-twin-sheet-state ${unitSheet.state}`}>{STATE_LABEL[unitSheet.state]}</p>
              <h3>Unit {unitSheet.label}</h3>
            </div>
            <button type="button" aria-label="Close unit" onClick={() => setOpenUnit(null)}>
              <X size={16} />
            </button>
          </header>

          <dl className="site-twin-sheet-facts">
            <div>
              <dt>Job</dt>
              <dd>{unitSheet.jobNo ? `${unitSheet.jobNo}${unitSheet.jobLabel ? ` · ${unitSheet.jobLabel}` : ""}` : "None open"}</dd>
            </div>
            <div>
              <dt>Crew</dt>
              <dd>{unitSheet.crewName ?? "Unassigned"}</dd>
            </div>
            <div>
              <dt>In stage</dt>
              <dd>{unitSheet.daysInStage != null ? `${unitSheet.daysInStage} day${unitSheet.daysInStage === 1 ? "" : "s"}` : "—"}</dd>
            </div>
            <div>
              <dt>Time in unit today</dt>
              <dd>{dwellLabel(unitSheet.minutesToday)}</dd>
            </div>
            <div>
              <dt>Money in flight</dt>
              <dd>{unitSheet.unpaid > 0 ? money(unitSheet.unpaid) : "—"}</dd>
            </div>
            <div>
              <dt>Scheduled</dt>
              <dd>{unitSheet.scheduledOn ?? "—"}</dd>
            </div>
          </dl>

          {unitSheet.reasons.length > 0 && (
            <ul className="site-twin-sheet-flags">
              {unitSheet.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}

          {unitSheet.photos.length > 0 && (
            <div className="site-twin-sheet-photos">
              {unitSheet.photos.map((p) => (
                <a key={p.id} href={p.url} target="_blank" rel="noreferrer" title={`${p.phase ?? "photo"} · ${clockLabel(p.at)}`}>
                  <img src={p.url} alt={`${unitSheet.label} ${p.phase ?? "photo"}`} loading="lazy" />
                  {p.geo && <span title="Taken at this unit">GPS</span>}
                </a>
              ))}
            </div>
          )}

          <div className="site-twin-sheet-actions">
            {unitSheet.jobId && onOpenJob && (
              <button type="button" className="go" onClick={() => onOpenJob(unitSheet.jobId!)}>
                Open job
              </button>
            )}
            {onRequestPhotos && (
              <button
                type="button"
                onClick={() =>
                  onRequestPhotos({ unitId: unitSheet.id, label: unitSheet.label, crewId: unitSheet.crewId })
                }
              >
                <Camera size={13} /> Request photos
              </button>
            )}
            {sheetCrew?.phone && (
              <a className="site-twin-sheet-call" href={`tel:${sheetCrew.phone}`}>
                <Phone size={13} /> Call {sheetCrew.name.split(" ")[0]}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
