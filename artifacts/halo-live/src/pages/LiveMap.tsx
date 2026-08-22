import { useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { MapContainer, TileLayer, CircleMarker, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import {
  MessageCircle, Camera, ChevronUp, ChevronDown, Navigation,
  Phone, Filter, ArrowLeft,
} from "lucide-react";
import { fetchPlate, setSelection, DEFAULT_PROPERTY, type Plate, type Role } from "@/lib/api";
import { cn } from "@/lib/cn";
import logo from "@/assets/halo-logo.png";

function FitBounds({ plate }: { plate: Plate }) {
  const map = useMap();
  useEffect(() => {
    const pts: [number, number][] = [];
    plate.buildings?.forEach((b) => pts.push([b.lat, b.lng]));
    plate.presence?.forEach((p) => {
      if (p.onSite && p.lat != null && p.lng != null) pts.push([p.lat, p.lng]);
    });
    if (pts.length) map.fitBounds(pts, { padding: [40, 40] });
    else if (plate.site) map.setView([plate.site.lat, plate.site.lng], 16);
  }, [plate, map]);
  return null;
}

function riskColor(risk?: string) {
  if (risk === "hot") return "#FF5A4A";
  if (risk === "watch") return "#FFB020";
  return "#B4FF44";
}

function crewIcon() {
  return L.divIcon({
    className: "",
    html: `<div class="halo-marker crew">●</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

export function LiveMap() {
  const search = useSearch();
  const role = (new URLSearchParams(search).get("role") as Role) || "punchlist";
  const canMoney = role === "punchlist";
  const [plate, setPlate] = useState<Plate | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"half" | "full" | "min">("half");
  const [filter, setFilter] = useState<"all" | "hot" | "crew">("all");
  const propertyId = DEFAULT_PROPERTY;

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchPlate(propertyId)
        .then((p) => { if (alive) { setPlate(p); setErr(null); } })
        .catch((e) => { if (alive) setErr(e.message); });
    load();
    const t = setInterval(load, 10000);
    return () => { alive = false; clearInterval(t); };
  }, [propertyId]);

  const buildings = useMemo(() => {
    if (!plate) return [];
    if (filter === "hot") return plate.buildings.filter((b) => b.risk === "hot" || b.risk === "watch");
    return plate.buildings;
  }, [plate, filter]);

  const onSite = plate?.presence?.filter((p) => p.onSite) ?? [];

  async function selectBldg(b: number, unitNo?: string | null, jobId?: string | null) {
    await setSelection(propertyId, { building: b, unitNo, jobId, source: `live-${role}` });
  }

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-halo-ink">
      {/* Full-bleed map — DoorDash pattern */}
      <div className="absolute inset-0">
        {plate ? (
          <MapContainer
            center={[plate.site.lat, plate.site.lng]}
            zoom={16}
            className="h-full w-full"
            zoomControl={false}
          >
            <TileLayer
              attribution='&copy; <a href="https://carto.com/">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            />
            <FitBounds plate={plate} />
            {buildings.map((b) => (
              <CircleMarker
                key={b.building}
                center={[b.lat, b.lng]}
                radius={12}
                pathOptions={{
                  color: "#0A0F0C",
                  weight: 2,
                  fillColor: riskColor(b.risk),
                  fillOpacity: 0.95,
                }}
                eventHandlers={{
                  click: () => selectBldg(b.building),
                }}
              />
            ))}
            {filter !== "hot" &&
              onSite.map((c) =>
                c.lat != null && c.lng != null ? (
                  <Marker
                    key={c.crewId}
                    position={[c.lat, c.lng]}
                    icon={crewIcon()}
                    eventHandlers={{
                      click: () => c.building && selectBldg(c.building, c.unitNo, c.jobId),
                    }}
                  />
                ) : null,
              )}
          </MapContainer>
        ) : (
          <div className="grid h-full place-items-center text-halo-mist">
            {err ? `Offline · ${err}` : "Loading live plate…"}
          </div>
        )}
      </div>

      {/* Top chrome */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[1000] p-3">
        <div className="pointer-events-auto flex items-center justify-between gap-2">
          <Link href="/enter" className="grid h-10 w-10 place-items-center rounded-full bg-halo-panel/95 text-white shadow-lg backdrop-blur">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex items-center gap-2 rounded-full bg-halo-panel/95 px-3 py-2 shadow-lg backdrop-blur">
            <img src={logo} alt="" className="h-5 w-5" />
            <span className="text-xs font-semibold uppercase tracking-wide text-halo-mist">{role}</span>
          </div>
          <div className="flex gap-2">
            <Link href="/messages" className="grid h-10 w-10 place-items-center rounded-full bg-halo-panel/95 shadow-lg backdrop-blur">
              <MessageCircle className="h-5 w-5" />
            </Link>
            <Link href="/field" className="grid h-10 w-10 place-items-center rounded-full bg-halo-lime text-halo-ink shadow-lg">
              <Camera className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </div>

      {/* Recenter / filters */}
      <div className="absolute right-3 top-20 z-[1000] flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setFilter((f) => (f === "all" ? "hot" : f === "hot" ? "crew" : "all"))}
          className="grid h-10 w-10 place-items-center rounded-full bg-halo-panel/95 shadow-lg backdrop-blur"
          title="Filter"
        >
          <Filter className="h-4 w-4" />
        </button>
        <button type="button" className="grid h-10 w-10 place-items-center rounded-full bg-halo-panel/95 shadow-lg backdrop-blur">
          <Navigation className="h-4 w-4" />
        </button>
      </div>

      {/* Bottom sheet — DoorDash status card */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 z-[1000] rounded-t-3xl border-t border-halo-line bg-halo-panel/98 shadow-2xl backdrop-blur-xl transition-all",
          sheet === "min" && "h-[88px]",
          sheet === "half" && "h-[42%]",
          sheet === "full" && "h-[78%]",
        )}
      >
        <button
          type="button"
          className="w-full pt-3"
          onClick={() => setSheet((s) => (s === "half" ? "full" : s === "full" ? "min" : "half"))}
        >
          <div className="sheet-handle" />
        </button>
        <div className="px-4 pb-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-halo-lime">Live</p>
              <h1 className="text-xl font-semibold leading-tight">
                {plate?.summary?.headline || "Connecting…"}
              </h1>
              <p className="mt-1 text-sm text-halo-mist">{plate?.propertyName}</p>
            </div>
            <button type="button" onClick={() => setSheet((s) => (s === "full" ? "half" : "full"))} className="text-halo-mist">
              {sheet === "full" ? <ChevronDown /> : <ChevronUp />}
            </button>
          </div>

          {/* Progress strip */}
          <div className="mt-4 flex items-center gap-2 text-[11px] font-medium text-halo-mist">
            <span className="rounded-full bg-halo-lime/15 px-2 py-0.5 text-halo-lime">{onSite.length} on site</span>
            <span className="rounded-full bg-white/5 px-2 py-0.5">{plate?.summary?.liveJobs ?? 0} live jobs</span>
            {(plate?.summary?.overdueTurns ?? 0) > 0 && (
              <span className="rounded-full bg-halo-hot/20 px-2 py-0.5 text-halo-hot">
                {plate?.summary?.overdueTurns} overdue
              </span>
            )}
            <span className="rounded-full bg-white/5 px-2 py-0.5">filter: {filter}</span>
          </div>

          {sheet !== "min" && (
            <div className="mt-4 max-h-[calc(100%-5rem)] space-y-2 overflow-y-auto pb-8">
              {/* Crew row */}
              {onSite.slice(0, 6).map((c) => (
                <button
                  key={c.crewId}
                  type="button"
                  onClick={() => c.building && selectBldg(c.building, c.unitNo, c.jobId)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-halo-line bg-halo-card p-3 text-left"
                >
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-halo-lime/15 text-sm font-bold text-halo-lime">
                    {(c.crewName || "?").slice(0, 1)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{c.crewName}</div>
                    <div className="truncate text-xs text-halo-mist">{c.title || "On site"}</div>
                  </div>
                  <Phone className="h-4 w-4 text-halo-mist" />
                </button>
              ))}

              {/* Turn radar */}
              {(plate?.turnRadar || [])
                .filter((t) => t.risk !== "ok")
                .slice(0, 8)
                .map((t) => (
                  <button
                    key={t.jobId}
                    type="button"
                    onClick={() => t.building && selectBldg(t.building, t.unitNo, t.jobId)}
                    className="flex w-full items-center justify-between rounded-2xl border border-halo-line bg-halo-card px-3 py-3 text-left"
                  >
                    <div>
                      <div className="font-medium">Unit {t.unitNo || t.jobNo || "—"}</div>
                      <div className="text-xs text-halo-mist">{t.status} · {t.ageHours}h</div>
                    </div>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                        t.risk === "overdue" ? "bg-halo-hot/20 text-halo-hot" : "bg-halo-watch/20 text-halo-watch",
                      )}
                    >
                      {t.risk}
                    </span>
                  </button>
                ))}

              {canMoney && (
                <div className="rounded-2xl border border-dashed border-halo-lime/30 bg-halo-lime/5 p-3 text-sm text-halo-mist">
                  <span className="font-semibold text-halo-lime">Punchlist</span> — money, crew payouts, and invoice tools stay here. Portfolio & Pulse never see them.
                </div>
              )}

              {!canMoney && (
                <div className="rounded-2xl border border-halo-line bg-halo-card p-3 text-sm text-halo-mist">
                  View-only ops for <span className="text-white">{role}</span> — no vendor money surfaces.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
