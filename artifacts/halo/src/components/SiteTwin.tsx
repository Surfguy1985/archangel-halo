/**
 * Site Twin — isometric unit plate + live crew GPS snapped to an apartment.
 */
import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Polygon, TileLayer, useMap } from "react-leaflet";
import { divIcon } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Loader2, Radio, X } from "lucide-react";

const LIME = "#B4FF44";
const CHARCOAL = "#1A1C1A";

type TwinUnit = {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  lat: number;
  lng: number;
};

type TwinCrew = {
  id: string;
  name: string;
  trade: string | null;
  selfiePath: string | null;
  lat: number | null;
  lng: number | null;
  at?: string | null;
  unitId: string | null;
  unitLabel: string | null;
  confidence: "inside" | "near" | "site" | "far";
  title: string;
  jobNo: string | null;
  meters: number | null;
};

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
  setup?: {
    pinned: boolean;
    unitCount: number;
    expectedUnits: number;
    inferredUnits?: number;
    liveGps: number;
    freshGps?: number;
  };
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

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

function crewIcon(hot: boolean, initial: string) {
  const bg = hot ? LIME : CHARCOAL;
  const fg = hot ? CHARCOAL : LIME;
  return divIcon({
    className: "",
    html: `<div style="width:30px;height:30px;border-radius:50%;background:${bg};border:2px solid ${CHARCOAL};color:${fg};display:grid;place-items:center;font-weight:800;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,.35)">${esc(initial)}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function Fit({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], 18);
    const t = setTimeout(() => map.invalidateSize(), 80);
    return () => clearTimeout(t);
  }, [map, lat, lng]);
  return null;
}

export function SiteTwin({
  propertyId,
  onClose,
  onNeedPin,
  onRequestGps,
}: {
  propertyId: string;
  onClose: () => void;
  onNeedPin?: () => void;
  onRequestGps?: () => void;
}) {
  const [data, setData] = useState<TwinPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selectedCrew, setSelectedCrew] = useState<string | null>(null);
  const [laying, setLaying] = useState(false);
  const [countDraft, setCountDraft] = useState("");

  const load = async () => {
    try {
      const r = await fetch(`/api/properties/${propertyId}/site-twin`, { credentials: "include" });
      if (!r.ok) throw new Error(`Twin failed (${r.status})`);
      setData(await r.json());
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Twin unavailable");
    }
  };

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 8_000);
    return () => clearInterval(id);
  }, [propertyId]);

  useEffect(() => {
    const n = data?.setup?.expectedUnits || data?.setup?.inferredUnits || data?.property.units || 0;
    if (n > 0 && !countDraft) setCountDraft(String(n));
  }, [data, countDraft]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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

  const active = useMemo(() => {
    if (!data?.crews.length) return null;
    return data.crews.find((c) => c.id === selectedCrew) ?? data.crews[0];
  }, [data, selectedCrew]);

  const hotUnit = active?.unitId ?? null;

  const live = (data?.setup?.freshGps ?? 0) > 0 || data?.crews.some((c) => gpsFresh(c.at));
  const kicker = !data?.ready ? "SITE TWIN · PIN GPS" : live ? "SITE TWIN · LIVE" : "SITE TWIN · LAST SEEN";

  return (
    <div className="site-twin" role="dialog" aria-label="Site twin">
      <header className="site-twin-hud">
        <div>
          <p className="site-twin-kicker">{kicker}</p>
          <h2>{data?.headline ?? `${data?.property.name ?? "Site"} — acquiring plate`}</h2>
          <p className="site-twin-sub">{data?.property.name}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close site twin" className="site-twin-close">
          <X size={18} />
        </button>
      </header>

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
            <div className="site-twin-iso">
              {data.units.map((u) => {
                const on = u.id === hotUnit;
                const occupant = data.crews.find((c) => c.unitId === u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    className={`site-twin-unit ${on ? "hot" : ""}`}
                    style={{
                      left: `${u.x * 100}%`,
                      top: `${u.y * 100}%`,
                      width: `${u.w * 100}%`,
                      height: `${u.h * 100}%`,
                    }}
                    onClick={() => occupant && setSelectedCrew(occupant.id)}
                  >
                    <span>{u.label}</span>
                    {occupant && <em>{occupant.name.split(" ")[0]}</em>}
                  </button>
                );
              })}
            </div>
              )}
          </section>

          <section className="site-twin-map">
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
              {data.footprint?.ring && data.footprint.ring.length > 2 && (
                <Polygon
                  positions={data.footprint.ring.map((p) => [p.lat, p.lng] as [number, number])}
                  pathOptions={{ color: LIME, weight: 2, fillColor: LIME, fillOpacity: 0.12 }}
                />
              )}
              {data.crews.map((c) =>
                c.lat != null && c.lng != null ? (
                  <Marker
                    key={c.id}
                    position={[c.lat, c.lng]}
                    icon={crewIcon(c.confidence === "inside" || c.confidence === "near", c.name.slice(0, 1).toUpperCase())}
                    eventHandlers={{ click: () => setSelectedCrew(c.id) }}
                  />
                ) : null,
              )}
            </MapContainer>
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
              const fresh = gpsFresh(c.at);
              return (
              <button
                key={c.id}
                type="button"
                className={`site-twin-crew ${c.id === active?.id ? "on" : ""}`}
                onClick={() => setSelectedCrew(c.id)}
              >
                <span className={`site-twin-dot ${fresh ? c.confidence : "far"}`} />
                <div>
                  <strong>{c.title}</strong>
                  <em>{c.jobNo ? `${c.jobNo} · ` : ""}{c.lat == null ? "waiting on phone" : age ? (fresh ? age : `last seen ${age}`) : "no ping"}</em>
                </div>
                <Radio size={14} />
              </button>
              );
            })}
            {data.crews.length > 0 && data.crews.every((c) => c.lat == null || !gpsFresh(c.at)) && onRequestGps && (
              <button type="button" className="site-twin-wake" onClick={onRequestGps}>
                Text crew to keep GPS live
              </button>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
