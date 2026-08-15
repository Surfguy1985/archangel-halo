import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import { divIcon } from "leaflet";
import "leaflet/dist/leaflet.css";
import "./pulseHud.css";
import {
  AlertTriangle,
  CalendarDays,
  Camera,
  CircleDollarSign,
  Columns3,
  History,
  Home,
  LayoutGrid,
  MessageCircle,
  MoreVertical,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Timer,
  User,
  X,
} from "lucide-react";
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
import { TurnCloseoutStrip } from "../turn-ring/TurnCloseout";
import { UnitPhotoPairs } from "./UnitPhotoPairs";
import { PulseGuide } from "./PulseGuide";
import type { GuideAction, GuideContext } from "./pulseGuideBrain";

const LIME = "#B4FF44";
const NAVY = "#0F1B2D";
const FALLBACK: [number, number] = [32.7767, -96.797];
const OPEN_KEY = "halo_client_pulse_hud_open_v5";
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

const NAV: Array<{ id: PanelId; label: string; Icon: typeof Home }> = [
  { id: "chat", label: "Ask", Icon: MessageCircle },
  { id: "vacancy", label: "Vacancy $", Icon: CircleDollarSign },
  { id: "turns", label: "Turns", Icon: Timer },
  { id: "photos", label: "Photos", Icon: Camera },
  { id: "crew", label: "Crew", Icon: User },
  { id: "overview", label: "Overview", Icon: Home },
  { id: "sites", label: "Sites", Icon: LayoutGrid },
  { id: "attention", label: "Needs you", Icon: AlertTriangle },
  { id: "range", label: "Range", Icon: CalendarDays },
  { id: "compliance", label: "Compliance", Icon: ShieldCheck },
  { id: "activity", label: "Activity", Icon: History },
  { id: "tools", label: "Tools", Icon: Settings },
];

const DEFAULT_OPEN: Record<PanelId, boolean> = {
  chat: true,
  vacancy: true,
  turns: true,
  photos: true,
  crew: true,
  overview: false,
  sites: true,
  attention: true,
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
  if (!open) return null;
  return (
    <article className={`cb-hud-box size-${size}`} data-panel={id}>
      <header className="cb-hud-box-head">
        <div>
          <h2>{title}</h2>
          {kicker ? <p>{kicker}</p> : null}
        </div>
        <button type="button" aria-label={`Hide ${title}`} onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <div className="cb-hud-box-body">{children}</div>
    </article>
  );
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
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customFrom, setCustomFrom] = useState(pulse?.from ?? "");
  const [customTo, setCustomTo] = useState(pulse?.to ?? "");
  const [now, setNow] = useState(() => new Date());
  const [open, setOpen] = useState<Record<PanelId, boolean>>(loadOpen);
  const [zOrder, setZOrder] = useState<PanelId[]>(() =>
    (Object.keys(DEFAULT_OPEN) as PanelId[]).filter((id) => loadOpen()[id]),
  );

  useEffect(() => {
    localStorage.setItem(OPEN_KEY, JSON.stringify(open));
  }, [open]);

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
    setOpen({ ...DEFAULT_OPEN });
    setZOrder((Object.keys(DEFAULT_OPEN) as PanelId[]).filter((id) => DEFAULT_OPEN[id]));
  };

  const attentionCount = (props.attention?.groups ?? []).reduce((n, g) => n + g.items.length, 0);
  const title = pulse?.viewLabel ?? pulse?.portfolioName ?? "Portfolio";
  const crewToday = props.attention?.crewToday ?? [];
  const guideContext: GuideContext = {
    title,
    vacancyLabel: pulse?.headline.label,
    vacancyCostCents: pulse?.headline.vacancyCostCents,
    unitsInTurn: pulse?.supporting.unitsInTurn,
    medianTurnDays: pulse?.supporting.medianTurnDays,
    sites: tiles.map((t) => ({
      propertyId: t.propertyId,
      name: t.name,
      city: t.city,
      unitsInTurn: t.unitsInTurn,
      statusLabel: t.statusLabel,
      vacancyCostCents: t.vacancyCostCents,
    })),
    turns: (props.attention?.turns ?? []).map((t) => ({
      propertyId: t.propertyId,
      propertyName: t.propertyName,
      unitNumber: t.unitNumber,
      days: t.days,
    })),
    photoCount: props.attention?.photoUnits?.length ?? 0,
    attentionCount,
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
      setOpen((o) => ({ ...o, [action.panel]: true }));
      focus(action.panel);
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

  const delta = pulse?.headline.vacancyCostDeltaCents ?? "0";
  const deltaUp = !delta.startsWith("-") && delta !== "0";
  const activityItems = (props.attention?.groups ?? []).flatMap((g) =>
    g.items.map((item) => ({ ...item, group: g.title })),
  );
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  const dateStr = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const kicker = propertyOnly ? "Property Pulse" : "Portfolio Pulse";

  return (
    <div className="cb-hud">
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
          <span className="cb-hud-mark">C</span>
          <div>
            <p>{kicker}</p>
            <h1>{title}</h1>
          </div>
        </button>
        <div className="cb-hud-head-right">
          <div className="cb-hud-clock">
            <strong>{timeStr}</strong>
            <span>{dateStr}</span>
          </div>
          <span className={`cb-hud-live${live === "live" ? " on" : ""}`} aria-live="polite">
            <i />
            {live === "live" ? "Live" : live === "reconnecting" ? "Reconnecting" : "Idle"}
          </span>
          <label className="cb-hud-search">
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
              placeholder="Search communities"
              aria-label="Search communities"
            />
          </label>
          <div className="cb-menu-wrap">
            <button type="button" className="cb-hud-icon" aria-label="More" onClick={() => setMenuOpen((v) => !v)}>
              <MoreVertical size={16} />
            </button>
            {menuOpen ? (
              <div className="cb-menu" role="menu">
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
          <button
            type="button"
            className="cb-hud-dispatch"
            disabled={!selected}
            onClick={() => selected && props.onTileClick(selected.propertyId)}
          >
            <Send size={14} /> Open turns
          </button>
        </div>
      </header>

      <div className="cb-hud-body">
        <nav className="cb-hud-nav" aria-label="Pulse panels">
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
          <div className="cb-hud-nav-spacer" />
          {props.onKanban ? (
            <button
              type="button"
              title="Full board"
              aria-label="Open the full kanban board"
              className="cb-hud-kanban"
              onClick={() => props.onKanban?.(selectedId)}
            >
              <Columns3 size={18} strokeWidth={2.2} />
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
            <PulseGuide context={guideContext} askUrl={props.askUrl} onAction={onGuideAction} />
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
                estimateSize={168}
                maxHeight={420}
                getKey={(item) => item.turnId}
                renderItem={(item) => (
                  <button type="button" className="cb-act-row" onClick={() => props.onAttentionClick(item.href)}>
                    <span className="cb-check" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong>
                        {item.propertyName} · {item.unitNumber}
                      </strong>
                      <TurnCloseoutStrip compact daysVacant={item.days} {...item} />
                    </div>
                  </button>
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
                : "Work App"
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
            kicker={crewToday.length ? `${crewToday.length} jobs` : "Work App"}
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
            kicker="This window"
            open={open.overview}
            z={zOf("overview")}
            stageRef={stageRef}
            onClose={() => toggle("overview")}
            onFocus={() => focus("overview")}
          >
            <div className="cb-stat-grid">
              <div className="cb-stat lime">
                <b>{pulse?.supporting.unitsInTurn ?? "—"}</b>
                <span>Units in turn</span>
              </div>
              <div className="cb-stat ink">
                <b>{pulse?.supporting.medianTurnDays ?? "—"}</b>
                <span>Median days</span>
              </div>
              <div className="cb-stat gold">
                <b>{pulse?.supporting.targetTurnDays ?? "—"}</b>
                <span>Target days</span>
              </div>
              <div className="cb-stat coral">
                <b>{pulse?.supporting.predictedLateThisWeek ?? "—"}</b>
                <span>Late this week</span>
              </div>
            </div>
            {selected ? (
              <div className="cb-overview-site">
                <strong>{selected.name}</strong>
                <p>
                  {selected.unitsInTurn} in turn · {selected.statusLabel}
                  {selected.city ? ` · ${selected.city}` : ""}
                </p>
                <div className="cb-hud-actions">
                  <button type="button" className="cb-overlay-cta" onClick={() => props.onTileClick(selected.propertyId)}>
                    Open turns
                  </button>
                </div>
              </div>
            ) : null}
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
            <p className="cb-hud-portfolio">{title}</p>
            {filtered.length === 0 ? <p className="cb-empty">No communities match.</p> : null}
            {filtered.map((tile) => {
              const on = tile.propertyId === selectedId;
              return (
                <button
                  key={tile.propertyId}
                  type="button"
                  className={`cb-site-row${on ? " sel" : ""}${tile.status === "at_risk" ? " hot" : ""}`}
                  onClick={() => {
                    if (tile.propertyId === selectedId) props.onTileClick(tile.propertyId);
                    else setSelectedId(tile.propertyId);
                  }}
                >
                  <span>{tile.name}</span>
                  <em>
                    {tile.unitsInTurn} in turn · {tile.statusLabel}
                  </em>
                  <small>
                    {formatUsdCents(tile.vacancyCostCents)} vacancy
                    {tile.medianTurnDays != null ? ` · ${tile.medianTurnDays}d median` : ""}
                    {tile.city ? ` · ${tile.city}` : ""}
                  </small>
                  <Sparkline values={tile.sparkline} />
                  <HairlineBar median={tile.medianTurnDays} portfolioMedian={pulse?.supporting.medianTurnDays ?? null} />
                </button>
              );
            })}
          </HudBox>

          <HudBox
            id="attention"
            title="Needs you"
            kicker={attentionCount === 0 ? "Clear" : `${attentionCount} waiting`}
            open={open.attention}
            z={zOf("attention")}
            stageRef={stageRef}
            onClose={() => toggle("attention")}
            onFocus={() => focus("attention")}
          >
            {(props.attention?.groups ?? []).length === 0 ? (
              <p className="cb-empty">All clear — nothing stalled or waiting.</p>
            ) : (
              (props.attention?.groups ?? []).map((group) => (
                <div key={group.kind} className="cb-group">
                  <h3>{group.title}</h3>
                  <p>{group.summary}</p>
                  <VirtualList
                    items={group.items}
                    estimateSize={140}
                    maxHeight={240}
                    getKey={(item) => item.turnId}
                    renderItem={(item) => (
                      <button type="button" className="cb-act-row" onClick={() => props.onAttentionClick(item.href)}>
                        <span className="cb-check" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <strong>
                            {item.propertyName} · {item.unitNumber}
                          </strong>
                          <TurnCloseoutStrip compact daysVacant={item.days} {...item} />
                        </div>
                      </button>
                    )}
                  />
                </div>
              ))
            )}
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
                estimateSize={140}
                maxHeight={360}
                getKey={(item) => item.turnId}
                renderItem={(item) => (
                  <button type="button" className="cb-act-row" onClick={() => props.onAttentionClick(item.href)}>
                    <span className="cb-check" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong>
                        {item.propertyName} · {item.unitNumber}
                      </strong>
                      <TurnCloseoutStrip compact daysVacant={item.days} {...item} />
                    </div>
                  </button>
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

        <div className="cb-hud-stage" ref={stageRef}>
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
          <div className="cb-hud-map-fade" aria-hidden />
        </div>
      </div>
    </div>
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

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const w = 200;
  const h = 28;
  const pts = values
    .map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * w;
      const y = h - (v / max) * (h - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg className="cb-spark" width="100%" height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline fill="none" stroke={NAVY} strokeWidth="1.5" points={pts} />
    </svg>
  );
}

function HairlineBar(props: { median: number | null; portfolioMedian: number | null }) {
  const { median, portfolioMedian } = props;
  const pct =
    median != null && portfolioMedian && portfolioMedian > 0
      ? Math.min(100, (median / (portfolioMedian * 2)) * 100)
      : 0;
  return (
    <div className="cb-bar" aria-label="Median turn days versus portfolio">
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}
