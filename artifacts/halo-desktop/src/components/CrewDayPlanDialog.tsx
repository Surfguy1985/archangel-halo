import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { MapContainer, TileLayer, Marker, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import {
  useGetCrewDayPlan,
  useSaveCrewDayPlan,
  getGetCrewDayPlanQueryKey,
} from "@workspace/api-client-react";
import type { CrewDayPlanStop } from "@workspace/api-client-react";
import {
  X,
  ChevronUp,
  ChevronDown,
  MapPin,
  Clock,
  Wand2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const FALLBACK_CENTER: [number, number] = [39.8283, -98.5795];

function localDayStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayLabel(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function numberIcon(n: number, dimmed: boolean) {
  return L.divIcon({
    html: `<div style="width:30px;height:30px;border-radius:50%;background:${dimmed ? "#94a3b8" : "#020617"};color:#b4ff44;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.25);">${n}</div>`,
    className: "",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function FitStops({ stops }: { stops: CrewDayPlanStop[] }) {
  const map = useMap();
  useEffect(() => {
    const coords = stops.filter((s) => s.lat != null && s.lng != null);
    if (coords.length > 0) {
      const bounds = L.latLngBounds(coords.map((s) => [s.lat!, s.lng!]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    } else {
      map.setView(FALLBACK_CENTER, 4);
    }
  }, [map, stops]);
  return null;
}

// Straight-line nearest-neighbor ordering starting from the first stop with
// coordinates; coordinate-less stops keep their place at the end.
function suggestOrder(stops: CrewDayPlanStop[]): string[] {
  const withCoords = stops.filter((s) => s.lat != null && s.lng != null);
  const without = stops.filter((s) => s.lat == null || s.lng == null);
  if (withCoords.length <= 1)
    return [...withCoords, ...without].map((s) => s.key);
  const remaining = [...withCoords];
  const ordered: CrewDayPlanStop[] = [remaining.shift()!];
  while (remaining.length) {
    const last = ordered[ordered.length - 1]!;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const s = remaining[i]!;
      const dLat = s.lat! - last.lat!;
      const dLng = (s.lng! - last.lng!) * Math.cos((last.lat! * Math.PI) / 180);
      const dist = dLat * dLat + dLng * dLng;
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    ordered.push(remaining.splice(bestIdx, 1)[0]!);
  }
  return [...ordered, ...without].map((s) => s.key);
}

export function CrewDayPlanDialog({
  crewId,
  crewName,
  onClose,
}: {
  crewId: string;
  crewName: string;
  onClose: () => void;
}) {
  const [day, setDay] = useState(() => localDayStr());
  const { data: plan, isLoading } = useGetCrewDayPlan(crewId, day);
  const save = useSaveCrewDayPlan();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // Local order override while the user is arranging; null = server order.
  const [draftKeys, setDraftKeys] = useState<string[] | null>(null);

  const stops = useMemo(() => {
    const base = plan?.stops ?? [];
    if (!draftKeys) return base;
    const byKey = new Map(base.map((s) => [s.key, s]));
    const ordered = draftKeys
      .filter((k) => byKey.has(k))
      .map((k) => byKey.get(k)!);
    const inDraft = new Set(draftKeys);
    return [...ordered, ...base.filter((s) => !inDraft.has(s.key))];
  }, [plan, draftKeys]);

  const dirty = draftKeys != null;

  const move = (idx: number, delta: number) => {
    const keys = stops.map((s) => s.key);
    const to = idx + delta;
    if (to < 0 || to >= keys.length) return;
    const next = [...keys];
    const [k] = next.splice(idx, 1);
    next.splice(to, 0, k!);
    setDraftKeys(next);
  };

  const changeDay = (offset: number) => {
    const [y, m, d] = day.split("-").map(Number);
    const dt = new Date(y!, m! - 1, d! + offset);
    setDay(
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`,
    );
    setDraftKeys(null);
  };

  const handleSave = async () => {
    try {
      await save.mutateAsync({
        id: crewId,
        day,
        data: { day, stopKeys: stops.map((s) => s.key) },
      });
      await queryClient.invalidateQueries({
        queryKey: getGetCrewDayPlanQueryKey(crewId, day),
      });
      setDraftKeys(null);
      toast({ title: "Route saved", description: `${crewName} — ${dayLabel(day)}` });
    } catch {
      toast({
        title: "Couldn't save the route",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  const noCoords = stops.filter((s) => s.lat == null || s.lng == null);

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-6">
      <div className="bg-white rounded-[24px] shadow-2xl w-full max-w-5xl h-[80vh] overflow-hidden flex">
        {/* List panel */}
        <div className="w-[380px] shrink-0 border-r border-border flex flex-col">
          <div className="p-5 border-b border-border">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-xl text-[var(--ink)]">
                {crewName}'s day
              </h2>
              <button
                onClick={onClose}
                className="p-2 rounded-full hover:bg-black/5"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={() => changeDay(-1)}
                className="p-1.5 rounded-full hover:bg-black/5"
                aria-label="Previous day"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="text-sm font-semibold flex-1 text-center">
                {dayLabel(day)}
              </div>
              <button
                onClick={() => changeDay(1)}
                className="p-1.5 rounded-full hover:bg-black/5"
                aria-label="Next day"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {isLoading ? (
              <div className="text-sm text-muted-foreground p-4">Loading…</div>
            ) : stops.length === 0 ? (
              <div className="text-sm text-muted-foreground p-4 text-center border border-dashed border-border rounded-2xl">
                Nothing scheduled for this day.
              </div>
            ) : (
              stops.map((s, i) => (
                <div
                  key={s.key}
                  className="rounded-2xl border border-border p-3 flex items-start gap-3 bg-white"
                >
                  <div
                    className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-[13px] font-extrabold ${s.lat != null ? "bg-[var(--ink)] text-[var(--gold-light)]" : "bg-slate-200 text-slate-500"}`}
                  >
                    {i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm truncate">
                      {s.propertyName || s.title}
                      {s.unitNo ? ` · Unit ${s.unitNo}` : ""}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {s.address || "No address on file"}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                      {s.windowStart && (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {s.windowStart}
                        </span>
                      )}
                      {s.jobNo && <span className="font-mono">{s.jobNo}</span>}
                      {s.kind === "event" && <span>Event</span>}
                    </div>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <button
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      className="p-1 rounded hover:bg-black/5 disabled:opacity-30"
                      aria-label="Move up"
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => move(i, 1)}
                      disabled={i === stops.length - 1}
                      className="p-1 rounded hover:bg-black/5 disabled:opacity-30"
                      aria-label="Move down"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
            {noCoords.length > 0 && stops.length > 0 && (
              <div className="text-[11px] text-muted-foreground px-1">
                Gray stops have no map location yet — they stay on the list but
                not the map.
              </div>
            )}
          </div>

          <div className="p-4 border-t border-border flex items-center gap-2">
            <button
              onClick={() => setDraftKeys(suggestOrder(stops))}
              disabled={stops.length < 3}
              className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-full border border-border hover:bg-black/5 disabled:opacity-40"
            >
              <Wand2 className="w-4 h-4" /> Suggest order
            </button>
            <button
              onClick={handleSave}
              disabled={!dirty || save.isPending}
              className="btn-gold px-5 py-2 ml-auto text-sm disabled:opacity-40"
            >
              {save.isPending ? "Saving…" : "Save route"}
            </button>
          </div>
        </div>

        {/* Map panel */}
        <div className="flex-1 relative">
          <MapContainer
            center={FALLBACK_CENTER}
            zoom={4}
            className="w-full h-full"
            zoomControl={false}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitStops stops={stops} />
            {(() => {
              const pts = stops
                .filter((s) => s.lat != null && s.lng != null)
                .map((s) => [s.lat!, s.lng!] as [number, number]);
              return pts.length > 1 ? (
                <Polyline
                  positions={pts}
                  pathOptions={{ color: "#020617", weight: 3, opacity: 0.6, dashArray: "6 8" }}
                />
              ) : null;
            })()}
            {stops.map((s, i) =>
              s.lat != null && s.lng != null ? (
                <Marker
                  key={s.key}
                  position={[s.lat, s.lng]}
                  icon={numberIcon(i + 1, false)}
                />
              ) : null,
            )}
          </MapContainer>
          {stops.length > 0 && stops.every((s) => s.lat == null) && (
            <div className="absolute inset-0 z-[500] flex items-center justify-center pointer-events-none">
              <div className="bg-white/90 rounded-2xl px-5 py-3 text-sm text-muted-foreground shadow flex items-center gap-2">
                <MapPin className="w-4 h-4" /> No map locations for these stops yet
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
