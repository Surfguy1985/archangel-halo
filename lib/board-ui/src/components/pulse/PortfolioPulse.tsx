import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import { divIcon } from "leaflet";
import "leaflet/dist/leaflet.css";
import "./pulseHud.css";
import haloLogo from "../../assets/halo-logo.png";
import {
  AlertTriangle,
  Columns3,
  Expand,
  Home,
  Shrink,
  LayoutGrid,
  MessageCircle,
  MoreVertical,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";
import { HaloLevelBar } from "./HaloLevelBar";
import { HaloProofPair, PulseWatchRings } from "./PulseWatchRings";
import { HALO_STORY, haloStoryTitle, type HaloStoryLevel } from "./haloLevels";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type {
  PortfolioAttentionDocument,
  PortfolioPulseDocument,
  PortfolioPulseTile,
  PulseRangePreset,
  PulseTileSort,
  WorkSourceFilter,
} from "@workspace/api-client-react";
import { useBoardEvents } from "../../hooks/useBoardEvents";
import { formatUsdCents, signedUsdCents } from "./formatUsdCents";
import { VirtualList } from "../virtual/VirtualList";
import { TurnCloseoutStrip, type TurnClockFields } from "../turn-ring/TurnCloseout";
import { UnitPhotoPairs } from "./UnitPhotoPairs";
import { PulseGuide } from "./PulseGuide";
import { interpretPulseQuestion, type GuideAction, type GuideContext } from "./pulseGuideBrain";

const LIME = "#B4FF44";
const NAVY = "#0F1B2D";
const FALLBACK: [number, number] = [32.7767, -96.797];
const OPEN_KEY = "halo_client_pulse_hud_open_v7";
const MODE_KEY = "halo_client_pulse_hud_mode_v7";
const POS_KEY = "halo_client_pulse_hud_pos_v7";
type BoxPos = { x: number; y: number; w: number; h: number };
type PanelMode = "dock" | "float";
export type PortfolioPulseProps = {
  pulse: PortfolioPulseDocument | undefined;
  attention: PortfolioAttentionDocument | undefined;
  streamUrl: string | null;
  onRefetch: () => void;
  onTileClick: (propertyId: string) => void;
  onAttentionClick: (href: string) => void;
  onRangeChange: (range: PulseRangePreset, from?: string, to?: string) => void;
  onSortChange: (sort: PulseTileSort) => void;
  isLoading?: boolean;
  errorMessage?: string;
  homeHref?: { label: string; onClick: () => void };
  importHref?: { label: string; onClick: () => void };
  costHref?: { label: string; onClick: () => void };
  pipelineHref?: { label: string; onClick: () => void };
  auditHref?: { label: string; onClick: () => void };
  workSource?: WorkSourceFilter;
  onWorkSourceChange?: (next: WorkSourceFilter) => void;
  portfolios?: Array<{ id: string; name: string }>;
  selectedPortfolioId?: string;
  onPortfolioChange?: (id: string) => void;
  addProperty?: {
    available: Array<{ propertyId: string; name: string; city?: string | null }>;
    onAttach: (propertyId: string) => Promise<void> | void;
    onCreate: (input: { name: string; city: string }) => Promise<void> | void;
    busy?: boolean;
    error?: string;
  };
  onKanban?: (propertyId: string | null) => void;
  askUrl?: string | null;
  /**
   * Visual theme for the Pulse HUD chrome. Defaults to "dark" (the original
   * navy flight-control look). "light" renders a readable paper-white surface
   * for the halo-desktop Clients hub; the headline vacancy figure stays coral
   * in both themes.
   */
  theme?: "dark" | "light";
  /** Which of the three HALO desks this board is telling. */
  storyLevel?: HaloStoryLevel;
  deskHrefs?: Partial<Record<HaloStoryLevel, string>>;
  /** When true, the three desk tiles are the story — they do not navigate. */
  deskLocked?: boolean;
  onDeskGo?: (href: string, level: HaloStoryLevel) => void;
};

type PanelId =
  | "chat"
  | "vacancy"
  | "turns"
  | "photos"
  | "overview"
  | "sites"
  | "attention"
  | "crew"
  | "range"
  | "compliance"
  | "activity"
  | "tools";

const PRIMARY_NAV: Array<{ id: PanelId; label: string; Icon: LucideIcon }> = [
  { id: "overview", label: "Overview", Icon: Home },
  { id: "sites", label: "Sites", Icon: LayoutGrid },
  { id: "attention", label: "Needs", Icon: AlertTriangle },
];

const MORE_NAV: Array<{ id: PanelId; label: string }> = [
  { id: "vacancy", label: "Vacancy $" },
  { id: "turns", label: "Turns" },
  { id: "photos", label: "Photos" },
  { id: "range", label: "Range" },
  { id: "compliance", label: "Compliance" },
  { id: "tools", label: "Tools" },
];

const NEED_KIND_ORDER = [
  "awaiting_approval",
  "variance_pending",
  "stalled",
  "failed_qc",
  "blocked_invoices",
] as const;

function shortCommunity(name: string): string {
  return name.replace(/^caf\s+demo\s*[—–-]\s*/i, "").trim();
}

function TurnHudRow(props: {
  unitNumber: string;
  propertyName: string;
  days: number;
  href: string;
  onOpen: (href: string) => void;
  clock: TurnClockFields;
}) {
  return (
    <button type="button" className="cb-turn-row" onClick={() => props.onOpen(props.href)}>
      <b>{props.unitNumber}</b>
      <span>
        {shortCommunity(props.propertyName)}
        <i>{props.days === 1 ? "1 day vacant" : `${props.days} days vacant`}</i>
      </span>
      <TurnCloseoutStrip compact tone="dark" daysVacant={props.days} {...props.clock} />
    </button>
  );
}

function needLine(kind: string, days: number): { text: string; tone: "gold" | "coral" | "ink" } {
  const d = days === 1 ? "1 day" : `${days} days`;
  if (kind === "awaiting_approval") return { text: `waiting on you, ${d}`, tone: "gold" };
  if (kind === "variance_pending") return { text: `waiting on a price exception, ${d}`, tone: "gold" };
  if (kind === "stalled") return { text: `stalled, ${d}`, tone: "coral" };
  if (kind === "failed_qc") return { text: `needs another look, ${d}`, tone: "coral" };
  if (kind === "blocked_invoices") return { text: `invoice blocked, ${d}`, tone: "coral" };
  return { text: `needs you, ${d}`, tone: "ink" };
}

const DEFAULT_POS: Record<PanelId, BoxPos> = {
  chat: { x: 24, y: 16, w: 380, h: 300 },
  vacancy: { x: 420, y: 16, w: 320, h: 280 },
  turns: { x: 24, y: 330, w: 420, h: 420 },
  photos: { x: 460, y: 330, w: 400, h: 440 },
  crew: { x: 760, y: 16, w: 320, h: 280 },
  overview: { x: 24, y: 16, w: 340, h: 440 },
  sites: { x: 24, y: 16, w: 260, h: 480 },
  attention: { x: 420, y: 310, w: 360, h: 280 },
  range: { x: 800, y: 16, w: 300, h: 260 },
  compliance: { x: 800, y: 290, w: 320, h: 220 },
  activity: { x: 420, y: 600, w: 340, h: 240 },
  tools: { x: 300, y: 80, w: 320, h: 320 },
};

const DEFAULT_OPEN: Record<PanelId, boolean> = {
  chat: false,
  vacancy: false,
  turns: false,
  photos: false,
  crew: false,
  overview: true,
  sites: true,
  attention: false,
  range: false,
  compliance: false,
  activity: false,
  tools: false,
};

const RANGES: Array<{ id: PulseRangePreset; label: string }> = [
  { id: "this_month", label: "This month" },
  { id: "last_30", label: "Last 30" },
  { id: "qtd", label: "QTD" },
  { id: "custom", label: "Custom" },
];

const SOURCES: Array<{ id: WorkSourceFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "in_house", label: "In-house" },
  { id: "third_party", label: "Third-party" },
];

const SORTS: Array<{ id: PulseTileSort; label: string }> = [
  { id: "vacancy_cost", label: "Vacancy $" },
  { id: "turn_days", label: "Turn days" },
  { id: "units_in_turn", label: "Units in turn" },
  { id: "name", label: "Name" },
];

function loadOpen(): Record<PanelId, boolean> {
  try {
    const raw = JSON.parse(localStorage.getItem(OPEN_KEY) || "null") as Partial<Record<PanelId, boolean>> | null;
    if (raw && typeof raw === "object") return { ...DEFAULT_OPEN, ...raw };
  } catch {
    /* */
  }
  return { ...DEFAULT_OPEN };
}

function emptyModes(): Record<PanelId, PanelMode> {
  return Object.fromEntries((Object.keys(DEFAULT_OPEN) as PanelId[]).map((id) => [id, "dock"])) as Record<
    PanelId,
    PanelMode
  >;
}

function loadModes(): Record<PanelId, PanelMode> {
  const all = emptyModes();
  try {
    const raw = JSON.parse(localStorage.getItem(MODE_KEY) || "null") as Partial<Record<PanelId, unknown>> | null;
    if (!raw || typeof raw !== "object") return all;
    for (const id of Object.keys(all) as PanelId[]) {
      if (raw[id] === "float" || raw[id] === "dock") all[id] = raw[id];
    }
  } catch {
    /* */
  }
  return all;
}

function loadPos(): Partial<Record<PanelId, BoxPos>> {
  try {
    const raw = JSON.parse(localStorage.getItem(POS_KEY) || "null") as Partial<Record<PanelId, BoxPos>> | null;
    if (!raw || typeof raw !== "object") return {};
    const out: Partial<Record<PanelId, BoxPos>> = {};
    for (const id of Object.keys(DEFAULT_OPEN) as PanelId[]) {
      const p = raw[id];
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.w) && Number.isFinite(p.h)) {
        out[id] = p;
      }
    }
    return out;
  } catch {
    return {};
  }
}

type HudLayoutValue = {
  ready: boolean;
  modes: Record<PanelId, PanelMode>;
  pos: Partial<Record<PanelId, BoxPos>>;
  zOf: (id: PanelId) => number;
  floatLayer: RefObject<HTMLElement | null>;
  detach: (id: PanelId, from?: BoxPos) => void;
  dock: (id: PanelId) => void;
  move: (id: PanelId, pos: BoxPos) => void;
  focus: (id: PanelId) => void;
};

const HudLayout = createContext<HudLayoutValue | null>(null);

function pinIcon(hot: boolean, pulse = false) {
  const fill = hot ? LIME : NAVY;
  const inner = hot ? NAVY : "#fff";
  return divIcon({
    className: "",
    iconSize: [28, 34],
    iconAnchor: [14, 34],
    html: `<div style="position:relative">${pulse ? `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-70%);width:36px;height:36px;border-radius:50%;background:${LIME}40;animation:cb-pulse-dot 1.5s infinite"></div>` : ""}<svg width="28" height="34" viewBox="0 0 28 34" fill="none"><path d="M14 0C8.48 0 4 4.48 4 10c0 7.87 10 24 10 24S24 17.87 24 10C24 4.48 19.52 0 14 0z" fill="${fill}"/><circle cx="14" cy="10" r="4.5" fill="${inner}"/></svg></div>`,
  });
}

/**
 * The map stage is `display:none` below 820px (see pulseHud.css) — Leaflet
 * cannot lay a map out inside a hidden, zero-size container, and any camera
 * move (`flyTo`, `fitBounds`, `invalidateSize`) then throws
 * "cannot read properties of undefined (reading '_leaflet_pos')".  That throw
 * escapes into React and blanks the WHOLE pulse view, which reads to the user
 * as "the Board button does nothing".  So: don't mount the map when the stage
 * is hidden, and guard every camera move even when it is.
 */
const MAP_STAGE_QUERY = "(min-width: 821px)";

function useMapStageVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia(MAP_STAGE_QUERY).matches,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(MAP_STAGE_QUERY);
    const onChange = () => setVisible(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return visible;
}

function FitPins({ points, selected }: { points: [number, number][]; selected: [number, number] | null }) {
  const map = useMap();
  // True only when the map really has layout — hidden or zero-size containers
  // make Leaflet's pixel math throw.
  const laidOut = useCallback(() => {
    try {
      const el = map.getContainer();
      if (!el || !el.isConnected || el.offsetParent === null) return false;
      const size = map.getSize();
      return size.x > 0 && size.y > 0;
    } catch {
      return false;
    }
  }, [map]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (!laidOut()) return;
      try {
        map.invalidateSize();
      } catch {
        /* container went away mid-timeout */
      }
    }, 80);
    return () => clearTimeout(t);
  }, [map, laidOut]);
  useEffect(() => {
    if (!laidOut()) return;
    try {
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
    } catch {
      /* Leaflet wasn't ready — the next points/selection change re-runs this,
         and a broken camera must never take the page down with it. */
    }
  }, [map, laidOut, points.map((p) => p.join(",")).join("|"), selected?.join(",")]);
  return null;
}

function HudBox({
  id,
  title,
  kicker,
  open,
  size = "md",
  onClose,
  children,
}: {
  id: PanelId;
  title: string;
  kicker?: string;
  open: boolean;
  size?: "sm" | "md" | "lg";
  z?: number;
  stageRef?: unknown;
  onClose: () => void;
  onFocus?: () => void;
  children: ReactNode;
}) {
  const layout = useContext(HudLayout);
  const boxRef = useRef<HTMLElement>(null);
  const posRef = useRef<BoxPos>(DEFAULT_POS[id]);
  const drag = useRef<{ ox: number; oy: number } | null>(null);
  const resize = useRef<{ ox: number; oy: number; w: number; h: number } | null>(null);
  const floating = layout?.modes[id] === "float";
  const pos = layout?.pos[id] ?? DEFAULT_POS[id];
  posRef.current = pos;

  if (!open) return null;

  const onDragMove = (e: ReactPointerEvent) => {
    if (!drag.current || !layout || !floating) return;
    const layer = layout.floatLayer.current;
    if (!layer) return;
    const cur = posRef.current;
    const next = {
      ...cur,
      x: Math.max(8, Math.min(layer.clientWidth - cur.w - 8, e.clientX - drag.current.ox)),
      y: Math.max(8, Math.min(layer.clientHeight - 48, e.clientY - drag.current.oy)),
    };
    posRef.current = next;
    layout.move(id, next);
  };

  const onResizeMove = (e: ReactPointerEvent) => {
    if (!resize.current || !layout || !floating) return;
    const layer = layout.floatLayer.current;
    if (!layer) return;
    const cur = posRef.current;
    const next = {
      ...cur,
      w: Math.max(240, Math.min(layer.clientWidth - cur.x - 8, resize.current.w + (e.clientX - resize.current.ox))),
      h: Math.max(180, Math.min(layer.clientHeight - cur.y - 8, resize.current.h + (e.clientY - resize.current.oy))),
    };
    posRef.current = next;
    layout.move(id, next);
  };

  const card = (
    <article
      ref={boxRef}
      className={`cb-hud-box size-${size}${floating ? " float" : ""}`}
      data-panel={id}
      style={
        floating
          ? { left: pos.x, top: pos.y, width: pos.w, height: pos.h, zIndex: 1100 + (layout?.zOf(id) ?? 1) }
          : undefined
      }
      onPointerDown={() => layout?.focus(id)}
    >
      <header
        className="cb-hud-box-head"
        onPointerDown={(e) => {
          if (!floating || !layout) return;
          if ((e.target as HTMLElement).closest("button")) return;
          layout.focus(id);
          const layer = layout.floatLayer.current?.getBoundingClientRect();
          drag.current = {
            ox: e.clientX - posRef.current.x,
            oy: e.clientY - posRef.current.y,
          };
          void layer;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={onDragMove}
        onPointerUp={(e) => {
          if (!drag.current) return;
          drag.current = null;
          try {
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
          } catch {
            /* */
          }
        }}
      >
        <div className="cb-hud-box-title">
          <i className="cb-cmd-dot" aria-hidden />
          <div>
            <h2>{title}</h2>
            {kicker ? <p>{kicker}</p> : null}
          </div>
        </div>
        <div className="cb-hud-box-actions">
          <button
            type="button"
            className="cb-detach"
            aria-label={floating ? `Dock ${title} in the stack` : `Detach ${title}`}
            onClick={() => {
              if (!layout) return;
              if (floating) {
                layout.dock(id);
                return;
              }
              const el = boxRef.current;
              const layer = layout.floatLayer.current;
              if (el && layer) {
                const a = el.getBoundingClientRect();
                const b = layer.getBoundingClientRect();
                layout.detach(id, {
                  x: Math.max(8, a.left - b.left),
                  y: Math.max(8, a.top - b.top),
                  w: Math.max(240, a.width),
                  h: Math.max(180, a.height),
                });
              } else {
                layout.detach(id);
              }
            }}
          >
            {floating ? <Shrink size={14} /> : <Expand size={14} />}
          </button>
          <button type="button" aria-label={`Hide ${title}`} onClick={onClose}>
            <X size={14} />
          </button>
        </div>
      </header>
      <div className="cb-hud-box-body">{children}</div>
      {floating ? (
        <div
          className="cb-hud-resize"
          aria-hidden
          onPointerDown={(e) => {
            e.stopPropagation();
            layout?.focus(id);
            resize.current = { ox: e.clientX, oy: e.clientY, w: posRef.current.w, h: posRef.current.h };
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={onResizeMove}
          onPointerUp={(e) => {
            if (!resize.current) return;
            resize.current = null;
            try {
              (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
            } catch {
              /* */
            }
          }}
        />
      ) : null}
    </article>
  );

  if (floating) {
    if (!layout?.ready || !layout.floatLayer.current) return null;
    return createPortal(card, layout.floatLayer.current);
  }
  return card;
}

function tileCoord(tile: PortfolioPulseTile): [number, number] | null {
  const lat = tile.latitude;
  const lng = tile.longitude;
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return [lat, lng];
}

export function PortfolioPulse(props: PortfolioPulseProps) {
  const reduceMotion = useReducedMotion();
  const live = useBoardEvents(props.streamUrl, props.onRefetch, "pulse");
  const pulse = props.pulse;
  const tiles = pulse?.tiles ?? [];
  const propertyOnly = pulse?.viewKind === "property";
  const showRegionalLinks = !propertyOnly;
  const stageRef = useRef<HTMLDivElement>(null);
  const mapStageVisible = useMapStageVisible();
  const floatLayer = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [ask, setAsk] = useState("");
  const [pendingAsk, setPendingAsk] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customFrom, setCustomFrom] = useState(pulse?.from ?? "");
  const [customTo, setCustomTo] = useState(pulse?.to ?? "");
  const [now, setNow] = useState(() => new Date());
  const [open, setOpen] = useState<Record<PanelId, boolean>>(loadOpen);
  const [modes, setModes] = useState<Record<PanelId, PanelMode>>(loadModes);
  const [pos, setPos] = useState<Partial<Record<PanelId, BoxPos>>>(loadPos);
  const [zOrder, setZOrder] = useState<PanelId[]>(() =>
    (Object.keys(DEFAULT_OPEN) as PanelId[]).filter((id) => loadOpen()[id]),
  );
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    localStorage.setItem(OPEN_KEY, JSON.stringify(open));
  }, [open]);
  useEffect(() => {
    localStorage.setItem(MODE_KEY, JSON.stringify(modes));
  }, [modes]);
  useEffect(() => {
    localStorage.setItem(POS_KEY, JSON.stringify(pos));
  }, [pos]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (pulse?.from) setCustomFrom(pulse.from);
    if (pulse?.to) setCustomTo(pulse.to);
  }, [pulse?.from, pulse?.to]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tiles;
    return tiles.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.city ?? "").toLowerCase().includes(q) ||
        t.statusLabel.toLowerCase().includes(q),
    );
  }, [tiles, query]);

  useEffect(() => {
    if (selectedId && filtered.some((t) => t.propertyId === selectedId)) return;
    setSelectedId(filtered[0]?.propertyId ?? tiles[0]?.propertyId ?? null);
  }, [filtered, tiles, selectedId]);

  const selected = tiles.find((t) => t.propertyId === selectedId) ?? null;
  const mapPoints = tiles.flatMap((t) => {
    const c = tileCoord(t);
    return c ? [c] : [];
  });
  const selectedCoord = selected ? tileCoord(selected) : null;

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

  const resetLayout = () => {
    localStorage.setItem(OPEN_KEY, JSON.stringify(DEFAULT_OPEN));
    localStorage.setItem(MODE_KEY, JSON.stringify(emptyModes()));
    localStorage.removeItem(POS_KEY);
    setOpen({ ...DEFAULT_OPEN });
    setModes(emptyModes());
    setPos({});
    setZOrder((Object.keys(DEFAULT_OPEN) as PanelId[]).filter((id) => DEFAULT_OPEN[id]));
  };

  const hudLayout: HudLayoutValue = {
    ready: mounted,
    modes,
    pos,
    zOf,
    floatLayer,
    detach: (id, from) => {
      setModes((m) => ({ ...m, [id]: "float" }));
      if (from) setPos((p) => ({ ...p, [id]: from }));
      else if (!pos[id]) setPos((p) => ({ ...p, [id]: DEFAULT_POS[id] }));
      setOpen((o) => ({ ...o, [id]: true }));
      focus(id);
    },
    dock: (id) => {
      setModes((m) => ({ ...m, [id]: "dock" }));
    },
    move: (id, next) => {
      setPos((p) => ({ ...p, [id]: next }));
    },
    focus,
  };

  const attentionCount = (props.attention?.groups ?? []).reduce((n, g) => n + g.items.length, 0);
  const needItems = useMemo(() => {
    const groups = props.attention?.groups ?? [];
    const seen = new Set<string>();
    const rows: Array<(typeof groups)[number]["items"][number] & { kind: string }> = [];
    for (const kind of NEED_KIND_ORDER) {
      const group = groups.find((g) => g.kind === kind);
      for (const item of group?.items ?? []) {
        seen.add(item.turnId);
        rows.push({ ...item, kind });
      }
    }
    for (const group of groups) {
      for (const item of group.items) {
        if (seen.has(item.turnId)) continue;
        rows.push({ ...item, kind: group.kind });
      }
    }
    return rows;
  }, [props.attention?.groups]);
  const nextNeed = needItems[0] ?? null;
  const title = pulse?.viewLabel ?? pulse?.portfolioName ?? "Portfolio";
  const crewToday = props.attention?.crewToday ?? [];
  const guideContext: GuideContext = {
    title,
    vacancyLabel: pulse?.headline.label,
    vacancyCostCents: pulse?.headline.vacancyCostCents,
    unitsInTurn: pulse?.supporting.unitsInTurn,
    medianTurnDays: pulse?.supporting.medianTurnDays,
    selectedPropertyId: selectedId,
    sites: tiles.map((t) => ({
      propertyId: t.propertyId,
      name: t.name,
      city: t.city,
      unitsInTurn: t.unitsInTurn,
      statusLabel: t.statusLabel,
      vacancyCostCents: t.vacancyCostCents,
      latitude: t.latitude,
      longitude: t.longitude,
    })),
    photos: (props.attention?.photoUnits ?? []).map((u) => ({
      propertyId: u.propertyId,
      propertyName: u.propertyName,
      unitNumber: u.unitNumber,
      beforeUrl: u.before[0]?.url,
      afterUrl: u.after[0]?.url,
    })),
    turns: (props.attention?.turns ?? []).map((t) => ({
      propertyId: t.propertyId,
      propertyName: t.propertyName,
      unitNumber: t.unitNumber,
      days: t.days,
    })),
    photoCount: props.attention?.photoUnits?.length ?? 0,
    attentionCount,
    needs: needItems.map((item) => ({
      kind: item.kind,
      propertyId: item.propertyId,
      propertyName: item.propertyName,
      unitNumber: item.unitNumber,
      days: item.days,
    })),
    crew: crewToday.map((c) => ({
      propertyId: c.propertyId,
      propertyName: c.propertyName,
      unitNumber: c.unitNumber ?? null,
      crewName: c.crewName,
      status: c.status,
    })),
  };

  const onGuideAction = (action: GuideAction) => {
    if (action.type === "open") {
      const panel = action.panel === "crew" || action.panel === "activity" ? "overview" : action.panel;
      setOpen((o) => ({ ...o, [panel]: true }));
      focus(panel);
    } else if (action.type === "select") {
      setSelectedId(action.propertyId);
      setOpen((o) => ({ ...o, sites: true }));
    } else if (action.type === "kanban") {
      props.onKanban?.(selectedId);
    } else if (action.type === "turns") {
      if (action.propertyId) setSelectedId(action.propertyId);
      setOpen((o) => ({ ...o, turns: true }));
    }
  };

  const submitHeaderAsk = (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    const local = interpretPulseQuestion(q, guideContext);
    for (const action of local.actions) onGuideAction(action);
    const showThread = q.includes("?") || local.actions.some((a) => a.type === "open" && a.panel === "chat");
    if (showThread) {
      setOpen((o) => ({ ...o, chat: true }));
      setPendingAsk(q);
    }
    setAsk("");
  };

  const delta = pulse?.headline.vacancyCostDeltaCents ?? "0";
  const deltaUp = !delta.startsWith("-") && delta !== "0";
  const activityItems = (props.attention?.groups ?? []).flatMap((g) =>
    g.items.map((item) => ({ ...item, group: g.title })),
  );
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  const dateStr = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const storyLevel: HaloStoryLevel = props.storyLevel ?? (propertyOnly ? "pulse" : "portfolio");
  const proofUnit = (props.attention?.photoUnits ?? [])[0] ?? null;

  return (
    <HudLayout.Provider value={hudLayout}>
    <div className={`cb-hud${props.theme === "light" ? " cb-hud--light" : ""}`}>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=Outfit:wght@500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap"
      />
      <header className="cb-hud-head">
        <button
          type="button"
          className="cb-hud-brand"
          onClick={() => props.homeHref?.onClick()}
          aria-label={props.homeHref?.label ?? "Client Board"}
        >
          <img className="cb-hud-logo" src={haloLogo} alt="HALO" />
          <span className="cb-hud-brand-rule" aria-hidden />
          <div>
            <h1>
              {haloStoryTitle(storyLevel)}
              <sup className="cb-hud-tm">™</sup>
            </h1>
            <p className="halo-story-line">{title}</p>
          </div>
        </button>
        <HaloLevelBar
          active={storyLevel}
          hrefs={props.deskHrefs}
          locked={props.deskLocked}
          onGo={(href, level) => props.onDeskGo?.(href, level)}
        />
        <div className="cb-hud-head-right">
          <button
            type="button"
            className={`cb-hud-vacancy-whisper${open.vacancy ? " on" : ""}`}
            onClick={() => toggle("vacancy")}
            aria-pressed={open.vacancy}
            aria-label="Vacancy cost this month"
          >
            <b>{formatUsdCents(pulse?.headline.vacancyCostCents ?? "0")}</b>
            <span>this month</span>
          </button>
          <form
            className="cb-hud-ask"
            onSubmit={(e) => {
              e.preventDefault();
              submitHeaderAsk(ask);
            }}
          >
            <Search size={14} />
            <input
              value={ask}
              onChange={(e) => {
                const next = e.target.value;
                setAsk(next);
                if (!next.includes("?")) {
                  setQuery(next);
                  if (next && !open.sites) {
                    setOpen((o) => ({ ...o, sites: true }));
                    focus("sites");
                  }
                }
              }}
              placeholder="Ask about a community or unit"
              aria-label="Ask about a community or unit"
            />
          </form>
          <div className="cb-hud-clock">
            <strong>{timeStr}</strong>
            <span>{dateStr}</span>
          </div>
          <span className={`cb-hud-live${live === "live" ? " on" : ""}`} aria-live="polite">
            <i />
            {live === "live" ? "Live" : live === "reconnecting" ? "Reconnecting" : "Idle"}
          </span>
          <div className="cb-menu-wrap">
            <button type="button" className="cb-hud-icon" aria-label="More" onClick={() => setMenuOpen((v) => !v)}>
              <MoreVertical size={16} />
            </button>
            {menuOpen ? (
              <div className="cb-menu" role="menu">
                {MORE_NAV.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={open[item.id]}
                    onClick={() => {
                      setMenuOpen(false);
                      toggle(item.id);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
                {props.homeHref ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      props.homeHref?.onClick();
                    }}
                  >
                    {props.homeHref.label}
                  </button>
                ) : null}
                {showRegionalLinks && props.pipelineHref ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      props.pipelineHref?.onClick();
                    }}
                  >
                    {props.pipelineHref.label}
                  </button>
                ) : null}
                {showRegionalLinks && props.importHref ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      props.importHref?.onClick();
                    }}
                  >
                    {props.importHref.label}
                  </button>
                ) : null}
                {showRegionalLinks && props.costHref ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      props.costHref?.onClick();
                    }}
                  >
                    {props.costHref.label}
                  </button>
                ) : null}
                {showRegionalLinks && props.auditHref ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      props.auditHref?.onClick();
                    }}
                  >
                    {props.auditHref.label}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    resetLayout();
                  }}
                >
                  Reset layout
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="cb-hud-body">
        <nav className="cb-hud-nav" aria-label="Pulse panels">
          {PRIMARY_NAV.map(({ id, label, Icon }) => (
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
              <span>{label}</span>
            </button>
          ))}
          <div className="cb-hud-nav-spacer" />
          {props.onKanban ? (
            <button
              type="button"
              title="Board"
              aria-label="Open the full board"
              className="cb-hud-board"
              onClick={() => props.onKanban?.(selectedId)}
            >
              <Columns3 size={16} strokeWidth={2} />
              <span>Board</span>
            </button>
          ) : null}
        </nav>

        <div className="cb-hud-dock">
          <div className="cb-masonry">
          <HudBox
            id="chat"
            title="Ask this board"
            kicker="Guide"
            open={open.chat}
            size="md"
            onClose={() => toggle("chat")}
          >
            <PulseGuide
              context={guideContext}
              askUrl={props.askUrl}
              onAction={onGuideAction}
              pendingAsk={pendingAsk}
              onPendingConsumed={() => setPendingAsk(null)}
            />
          </HudBox>

          <HudBox
            id="vacancy"
            title="Vacancy cost"
            kicker="Rent lost"
            open={open.vacancy}
            size={tiles.length > 4 ? "lg" : "md"}
            onClose={() => toggle("vacancy")}
          >
            {props.isLoading && !pulse ? <p className="cb-empty">Loading portfolio…</p> : null}
            {props.errorMessage ? <p className="cb-error">{props.errorMessage}</p> : null}
            <TweenCents cents={pulse?.headline.vacancyCostCents ?? "0"} reduceMotion={!!reduceMotion} />
            <p className="cb-vacancy-label">{pulse?.headline.label ?? "rent lost to vacancy days this month"}</p>
            <p className={`cb-delta${deltaUp ? " up" : " down"}`}>
              <b>{signedUsdCents(delta)}</b> {pulse?.headline.priorLabel ?? "last month, same day"}
            </p>
            {tiles.length > 0 ? (
              <div className="cb-vacancy-sites">
                <p className="cb-hud-portfolio">By community</p>
                {tiles
                  .slice()
                  .sort((a, b) => {
                    try {
                      const diff = BigInt(b.vacancyCostCents) - BigInt(a.vacancyCostCents);
                      if (diff === 0n) return a.name.localeCompare(b.name);
                      return diff > 0n ? 1 : -1;
                    } catch {
                      return a.name.localeCompare(b.name);
                    }
                  })
                  .map((tile) => (
                    <button
                      key={tile.propertyId}
                      type="button"
                      className={`cb-site-row${tile.propertyId === selectedId ? " sel" : ""}`}
                      onClick={() => {
                        setSelectedId(tile.propertyId);
                        if (!open.sites) {
                          setOpen((o) => ({ ...o, sites: true }));
                          focus("sites");
                        }
                      }}
                    >
                      <span>{tile.name}</span>
                      <em>{formatUsdCents(tile.vacancyCostCents)}</em>
                      <small>
                        {tile.unitsInTurn} in turn
                        {tile.city ? ` · ${tile.city}` : ""}
                      </small>
                    </button>
                  ))}
              </div>
            ) : null}
          </HudBox>

          <HudBox
            id="turns"
            title="Turns"
            kicker={`${(props.attention?.turns ?? []).length} open`}
            open={open.turns}
            size={(props.attention?.turns?.length ?? 0) > 3 ? "lg" : "md"}
            onClose={() => toggle("turns")}
          >
            {(props.attention?.turns ?? []).length === 0 ? (
              <p className="cb-empty">No open turns in this window.</p>
            ) : (
              <VirtualList
                items={props.attention?.turns ?? []}
                estimateSize={108}
                maxHeight={420}
                getKey={(item) => item.turnId}
                renderItem={(item) => (
                  <TurnHudRow
                    unitNumber={item.unitNumber}
                    propertyName={item.propertyName}
                    days={item.days}
                    href={item.href}
                    onOpen={props.onAttentionClick}
                    clock={item}
                  />
                )}
              />
            )}
          </HudBox>

          <HudBox
            id="photos"
            title="Before / after"
            kicker={
              (props.attention?.photoUnits?.length ?? 0) > 0
                ? `${props.attention?.photoUnits?.length} units`
                : "By unit"
            }
            open={open.photos}
            size={(props.attention?.photoUnits?.length ?? 0) > 0 ? "lg" : "sm"}
            onClose={() => toggle("photos")}
          >
            <UnitPhotoPairs
              units={props.attention?.photoUnits ?? []}
              selectedPropertyId={selectedId}
              selectedPropertyName={selected?.name}
              propertyOnly={propertyOnly}
            />
          </HudBox>

          <HudBox
            id="crew"
            title="Crew today"
            kicker={crewToday.length ? `${crewToday.length} scheduled` : "Today"}
            open={open.crew}
            size={crewToday.length > 3 ? "lg" : "md"}
            onClose={() => toggle("crew")}
          >
            {crewToday.length === 0 ? (
              <p className="cb-empty">No crews scheduled on these communities today.</p>
            ) : (
              (selectedId ? crewToday.filter((c) => c.propertyId === selectedId) : crewToday).map((c) => (
                <button
                  key={`${c.propertyId}:${c.jobNo}:${c.unitNumber ?? ""}`}
                  type="button"
                  className="cb-site-row"
                  onClick={() => {
                    setSelectedId(c.propertyId);
                    setOpen((o) => ({ ...o, sites: true, turns: true }));
                  }}
                >
                  <span>
                    {c.crewName}
                    {c.unitNumber ? ` · Unit ${c.unitNumber}` : ""}
                  </span>
                  <em>{c.propertyName}</em>
                  <small>
                    {c.jobNo} · {c.status.replace(/_/g, " ")}
                    {c.scheduledOn ? ` · ${c.scheduledOn}` : ""}
                  </small>
                </button>
              ))
            )}
          </HudBox>

          <HudBox
            id="overview"
            title="Overview"
            kicker={HALO_STORY[storyLevel].kicker}
            open={open.overview}
            z={zOf("overview")}
            stageRef={stageRef}
            onClose={() => toggle("overview")}
            onFocus={() => focus("overview")}
          >
            <p className="cb-overview-who">{HALO_STORY[storyLevel].who} · {HALO_STORY[storyLevel].line}</p>
            <PulseWatchRings
              days={pulse?.supporting.medianTurnDays ?? null}
              target={pulse?.supporting.targetTurnDays ?? 7}
              openTurns={pulse?.supporting.unitsInTurn ?? 0}
              doneToday={0}
            />
            <HaloProofPair
              title={
                proofUnit
                  ? `${shortCommunity(proofUnit.propertyName)} · ${proofUnit.unitNumber}`
                  : "Before / after"
              }
              caption={
                proofUnit
                  ? "Field pictures already on this turn"
                  : "Pictures show up when the field posts them"
              }
              before={proofUnit?.before[0]?.url}
              after={proofUnit?.after[0]?.url}
              onOpen={() => {
                setOpen((o) => ({ ...o, photos: true }));
                focus("photos");
              }}
            />
            <div className="cb-stat-grid">
              <button type="button" className="cb-stat lime" onClick={() => toggle("vacancy")}>
                <b>{formatUsdCents(pulse?.headline.vacancyCostCents ?? "0")}</b>
                <span>Empty-home rent</span>
              </button>
              <button type="button" className="cb-stat ink" onClick={() => toggle("turns")}>
                <b>{pulse?.supporting.unitsInTurn ?? "—"}</b>
                <span>Units in turn</span>
              </button>
              <button type="button" className="cb-stat gold" onClick={() => toggle("attention")}>
                <b>{attentionCount || "—"}</b>
                <span>Needs your name</span>
              </button>
              <button type="button" className="cb-stat coral" onClick={() => toggle("turns")}>
                <b>{pulse?.supporting.predictedLateThisWeek ?? "—"}</b>
                <span>Late this week</span>
              </button>
            </div>
            {selected ? (
              <div className="cb-overview-site">
                <strong>{selected.name}</strong>
                <p>
                  {selected.unitsInTurn} in turn · {selected.statusLabel}
                  {selected.city ? ` · ${selected.city}` : ""}
                </p>
                <div className="cb-hud-actions">
                  <button type="button" className="cb-overlay-ghost" onClick={() => props.onTileClick(selected.propertyId)}>
                    Open this community
                  </button>
                </div>
              </div>
            ) : null}
          </HudBox>

          <HudBox
            id="attention"
            title="Needs you"
            kicker={attentionCount === 0 ? "Clear" : `${attentionCount}`}
            open={open.attention}
            size={needItems.length > 2 ? "lg" : "md"}
            z={zOf("attention")}
            stageRef={stageRef}
            onClose={() => toggle("attention")}
            onFocus={() => focus("attention")}
          >
            {needItems.length === 0 ? (
              <p className="cb-empty">All clear — nothing is waiting on you.</p>
            ) : (
              needItems.map((item, index) => {
                const line = needLine(item.kind, item.days);
                return (
                  <button
                    key={item.turnId}
                    type="button"
                    className={`cb-need-row${index === 0 ? " hero" : ""}`}
                    onClick={() => {
                      setSelectedId(item.propertyId);
                      props.onAttentionClick(item.href);
                    }}
                  >
                    <b>{item.unitNumber}</b>
                    <span>{shortCommunity(item.propertyName)}</span>
                    <em className={`tone-${line.tone}`}>{line.text}</em>
                  </button>
                );
              })
            )}
          </HudBox>

          <HudBox
            id="sites"
            title="Sites"
            kicker={`${filtered.length} ${propertyOnly ? "community" : "communities"}`}
            open={open.sites}
            z={zOf("sites")}
            stageRef={stageRef}
            onClose={() => toggle("sites")}
            onFocus={() => focus("sites")}
          >
            {filtered.length === 0 ? <p className="cb-empty">No communities match.</p> : null}
            {filtered.map((tile) => {
              const on = tile.propertyId === selectedId;
              return (
                <button
                  key={tile.propertyId}
                  type="button"
                  className={`cb-site-row${on ? " sel" : ""}${tile.status === "at_risk" ? " risk" : ""}`}
                  onClick={() => {
                    if (tile.propertyId === selectedId) props.onTileClick(tile.propertyId);
                    else setSelectedId(tile.propertyId);
                  }}
                >
                  <span>{shortCommunity(tile.name)}</span>
                  <em>
                    {tile.unitsInTurn} in turn · {tile.statusLabel}
                  </em>
                  <small>
                    {tile.city ? `${tile.city} · ` : ""}
                    {formatUsdCents(tile.vacancyCostCents)} vacancy
                  </small>
                </button>
              );
            })}
          </HudBox>

          <HudBox
            id="range"
            title="Range"
            kicker={pulse?.range?.replace("_", " ") ?? "Window"}
            open={open.range}
            z={zOf("range")}
            stageRef={stageRef}
            onClose={() => toggle("range")}
            onFocus={() => focus("range")}
          >
            <p className="cb-hud-portfolio">Date window</p>
            <div className="cb-chips" role="tablist" aria-label="Date range">
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  role="tab"
                  aria-selected={pulse?.range === r.id}
                  className={`cb-chip${pulse?.range === r.id ? " on" : ""}`}
                  onClick={() => props.onRangeChange(r.id, customFrom, customTo)}
                >
                  {r.label}
                </button>
              ))}
            </div>
            {pulse?.range === "custom" ? (
              <>
                <label className="cb-field">
                  From
                  <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                </label>
                <label className="cb-field">
                  To
                  <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
                </label>
                <button
                  type="button"
                  className="cb-overlay-cta"
                  onClick={() => props.onRangeChange("custom", customFrom, customTo)}
                >
                  Apply
                </button>
              </>
            ) : null}
            {props.onWorkSourceChange ? (
              <>
                <p className="cb-hud-portfolio" style={{ marginTop: 16 }}>
                  Work source
                </p>
                <div className="cb-chips" role="tablist" aria-label="Work source">
                  {SOURCES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      role="tab"
                      aria-selected={(props.workSource ?? "all") === s.id}
                      className={`cb-chip${(props.workSource ?? "all") === s.id ? " on" : ""}`}
                      onClick={() => props.onWorkSourceChange?.(s.id)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            <p className="cb-hud-portfolio" style={{ marginTop: 8 }}>
              Sort sites
            </p>
            <div className="cb-chips">
              {SORTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`cb-chip${pulse?.sort === s.id ? " on" : ""}`}
                  onClick={() => props.onSortChange(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </HudBox>

          <HudBox
            id="compliance"
            title="Compliance"
            kicker="Invoices"
            open={open.compliance}
            z={zOf("compliance")}
            stageRef={stageRef}
            onClose={() => toggle("compliance")}
            onFocus={() => focus("compliance")}
          >
            {pulse?.compliance ? (
              <>
                <div className="cb-stat-grid" title={pulse.compliance.assumption}>
                  <div className="cb-stat lime">
                    <b>{pulse.compliance.invoicesAutoValidated}</b>
                    <span>Auto-validated</span>
                  </div>
                  <div className="cb-stat coral">
                    <b>{pulse.compliance.offScheduleBlocked}</b>
                    <span>Blocked</span>
                  </div>
                  <div className="cb-stat ink">
                    <b>{pulse.compliance.assumedHoursSaved}</b>
                    <span>Hours saved</span>
                  </div>
                  <div className="cb-stat gold">
                    <b>{pulse.compliance.firstPassAcceptRate == null ? "—" : `${pulse.compliance.firstPassAcceptRate}%`}</b>
                    <span>First-pass</span>
                  </div>
                </div>
                <p className="cb-footnote">{pulse.compliance.assumption}</p>
              </>
            ) : (
              <p className="cb-empty">Invoice compliance is not on this view.</p>
            )}
          </HudBox>

          <HudBox
            id="activity"
            title="Activity"
            kicker="Waiting on you"
            open={open.activity}
            z={zOf("activity")}
            stageRef={stageRef}
            onClose={() => toggle("activity")}
            onFocus={() => focus("activity")}
          >
            {activityItems.length === 0 ? (
              <p className="cb-empty">Waiting on the first site event.</p>
            ) : (
              <VirtualList
                items={activityItems}
                estimateSize={108}
                maxHeight={360}
                getKey={(item) => item.turnId}
                renderItem={(item) => (
                  <TurnHudRow
                    unitNumber={item.unitNumber}
                    propertyName={item.propertyName}
                    days={item.days}
                    href={item.href}
                    onOpen={props.onAttentionClick}
                    clock={item}
                  />
                )}
              />
            )}
          </HudBox>

          <HudBox
            id="tools"
            title="Tools"
            kicker={propertyOnly ? "This property" : "Regional"}
            open={open.tools}
            z={zOf("tools")}
            stageRef={stageRef}
            onClose={() => toggle("tools")}
            onFocus={() => focus("tools")}
          >
            {props.portfolios && props.portfolios.length > 1 && props.onPortfolioChange ? (
              <label className="cb-field">
                Portfolio
                <select
                  aria-label="Portfolio"
                  value={props.selectedPortfolioId ?? pulse?.portfolioId ?? ""}
                  onChange={(e) => props.onPortfolioChange?.(e.target.value)}
                >
                  {props.portfolios.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="cb-hud-actions">
              {showRegionalLinks && props.pipelineHref ? (
                <button type="button" className="cb-overlay-ghost" onClick={props.pipelineHref.onClick}>
                  {props.pipelineHref.label}
                </button>
              ) : null}
              {showRegionalLinks && props.importHref ? (
                <button type="button" className="cb-overlay-ghost" onClick={props.importHref.onClick}>
                  {props.importHref.label}
                </button>
              ) : null}
              {showRegionalLinks && props.costHref ? (
                <button type="button" className="cb-overlay-ghost" onClick={props.costHref.onClick}>
                  {props.costHref.label}
                </button>
              ) : null}
              {showRegionalLinks && props.auditHref ? (
                <button type="button" className="cb-overlay-ghost" onClick={props.auditHref.onClick}>
                  {props.auditHref.label}
                </button>
              ) : null}
              <button type="button" className="cb-overlay-ghost" onClick={resetLayout}>
                Reset layout
              </button>
            </div>
            {pulse?.canAddProperties && props.addProperty ? <AddPropertyPanel add={props.addProperty} /> : null}
          </HudBox>
          </div>
        </div>

        <div className="cb-hud-stage cb-map-apple" ref={stageRef}>
          {mapStageVisible ? (
          <MapContainer
            center={selectedCoord ?? mapPoints[0] ?? FALLBACK}
            zoom={13}
            className="cb-map-apple"
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
            {tiles.map((t) => {
              const coord = tileCoord(t);
              if (!coord) return null;
              const hot = t.status === "at_risk" || t.propertyId === selectedId;
              return (
                <Marker
                  key={t.propertyId}
                  position={coord}
                  icon={pinIcon(hot, t.status === "at_risk")}
                  eventHandlers={{
                    click: () => {
                      setSelectedId(t.propertyId);
                      if (!open.sites) toggle("sites");
                    },
                  }}
                >
                  <Popup>
                    <div className="cb-popup">
                      <strong>{t.name}</strong>
                      <em>
                        {t.unitsInTurn} in turn · {t.statusLabel}
                      </em>
                      <span>{t.city || formatUsdCents(t.vacancyCostCents)}</span>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
          ) : null}
          <div className="cb-hud-map-frame" aria-hidden />
          <div className="cb-hud-map-chrome">
            {tiles.length > 0 ? (
              <p className="cb-map-chip">
                {tiles.length} {propertyOnly ? "community" : "communities"}
                {pulse?.supporting.unitsInTurn
                  ? ` · ${pulse.supporting.unitsInTurn} in turn`
                  : ""}
              </p>
            ) : null}
            {nextNeed ? (
              <button
                type="button"
                className="cb-map-cta"
                onClick={() => {
                  setSelectedId(nextNeed.propertyId);
                  props.onAttentionClick(nextNeed.href);
                }}
              >
                Open {shortCommunity(nextNeed.propertyName)} · {nextNeed.unitNumber}
              </button>
            ) : selected ? (
              <button
                type="button"
                className="cb-map-cta"
                onClick={() => props.onTileClick(selected.propertyId)}
              >
                Open {shortCommunity(selected.name)}
              </button>
            ) : null}
          </div>
        </div>
        <div className="cb-hud-float-layer" ref={floatLayer} data-ready={mounted ? "1" : "0"} />
      </div>
      {!open.chat ? (
        <button
          type="button"
          className="halo-ask-pill"
          onClick={() => {
            setOpen((o) => ({ ...o, chat: true }));
            focus("chat");
          }}
          aria-label="Ask HALO"
          title="Ask HALO"
        >
          <MessageCircle size={28} />
          Ask HALO
        </button>
      ) : null}
    </div>
    </HudLayout.Provider>
  );
}

function TweenCents(props: { cents: string; reduceMotion: boolean }) {
  const target = useMemo(() => {
    try {
      return BigInt(props.cents);
    } catch {
      return 0n;
    }
  }, [props.cents]);
  const [shown, setShown] = useState(target);

  useEffect(() => {
    if (props.reduceMotion || shown === target) {
      setShown(target);
      return;
    }
    const from = shown;
    const started = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / 300);
      const mixed = from + BigInt(Math.round(Number(target - from) * t));
      setShown(mixed);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Intentionally only re-run when the cents string changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.cents, props.reduceMotion]);

  return (
    <AnimatePresence mode="wait">
      <motion.p
        key={props.cents}
        className="cb-vacancy"
        initial={props.reduceMotion ? false : { opacity: 0.55 }}
        animate={{ opacity: 1 }}
      >
        {formatUsdCents(shown.toString())}
      </motion.p>
    </AnimatePresence>
  );
}

function AddPropertyPanel(props: { add: NonNullable<PortfolioPulseProps["addProperty"]> }) {
  const [mode, setMode] = useState<"attach" | "create">("create");
  const [propertyId, setPropertyId] = useState("");
  const [name, setName] = useState("");
  const [city, setCity] = useState("");

  const submit = async () => {
    if (mode === "attach") {
      if (!propertyId) return;
      await props.add.onAttach(propertyId);
    } else {
      if (!name.trim() || !city.trim()) return;
      await props.add.onCreate({ name: name.trim(), city: city.trim() });
    }
    setName("");
    setCity("");
    setPropertyId("");
  };

  return (
    <div style={{ marginTop: 16 }}>
      <p className="cb-hud-portfolio">Add property</p>
      <div className="cb-chips" role="tablist" aria-label="Add property">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "create"}
          className={`cb-chip${mode === "create" ? " on" : ""}`}
          onClick={() => setMode("create")}
        >
          New
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "attach"}
          className={`cb-chip${mode === "attach" ? " on" : ""}`}
          onClick={() => setMode("attach")}
        >
          Existing
        </button>
      </div>
      {mode === "attach" ? (
        <label className="cb-field">
          Community
          <select aria-label="Existing property" value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
            <option value="">Select…</option>
            {props.add.available.map((p) => (
              <option key={p.propertyId} value={p.propertyId}>
                {p.name}
                {p.city ? ` · ${p.city}` : ""}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <label className="cb-field">
            Name
            <input aria-label="New property name" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="cb-field">
            City
            <input aria-label="New property city" value={city} onChange={(e) => setCity(e.target.value)} />
          </label>
        </>
      )}
      {props.add.error ? <p className="cb-error">{props.add.error}</p> : null}
      <button type="button" className="cb-overlay-cta" disabled={props.add.busy} onClick={() => void submit()}>
        {props.add.busy ? "Saving…" : "Add to region"}
      </button>
    </div>
  );
}

