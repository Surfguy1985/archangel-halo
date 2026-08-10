import { useEffect, useRef, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { MapContainer, TileLayer, Marker, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  useGetCrewMapPins,
  useSendCrewMessage,
  getListCrewMessagesQueryKey,
  getGetCrewMapPinsQueryKey,
} from "@workspace/api-client-react";
import type { CrewMapPin } from "@workspace/api-client-react";
import { X, Navigation, MapPin, Send, Clock, ChevronLeft, CheckCircle2, Circle, Camera, Wrench } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const FALLBACK_CENTER: [number, number] = [39.8283, -98.5795];
const FALLBACK_ZOOM = 4;

function MapBoundsFitter({ pins, selectedId }: { pins: CrewMapPin[]; selectedId: string | null }) {
  const map = useMap();
  useEffect(() => {
    if (selectedId) {
      const pin = pins.find(p => p.id === selectedId);
      if (pin && pin.lat != null && pin.lng != null) {
        map.flyTo([pin.lat, pin.lng], 16, { animate: true, duration: 1 });
      }
    } else {
      const coords = pins.filter(p => p.lat != null && p.lng != null);
      if (coords.length > 0) {
        const bounds = L.latLngBounds(coords.map(p => [p.lat!, p.lng!]));
        map.flyToBounds(bounds, { padding: [50, 50], animate: true, duration: 1, maxZoom: 16 });
      } else {
        map.setView(FALLBACK_CENTER, FALLBACK_ZOOM);
      }
    }
  }, [map, pins, selectedId]);
  return null;
}

function statusColor(status?: string | null) {
  switch (status) {
    case "site": return "#22c55e";
    case "route": return "#f59e0b";
    case "done": return "#020617";
    case "idle":
    default: return "#94a3b8";
  }
}

function createCustomIcon(pin: CrewMapPin) {
  const color = statusColor(pin.todayStatus);
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const imgHtml = pin.selfiePath
    ? `<img src="${esc(`/api/storage${pin.selfiePath}`)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`
    : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#020617;color:#b4ff44;border-radius:50%;font-weight:bold;font-size:12px;">${esc(pin.name.substring(0, 1))}</div>`;

  const html = `
    <div style="
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: 3px solid ${color};
      background: white;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    ">
      ${imgHtml}
    </div>
  `;
  return L.divIcon({ html, className: "custom-crew-marker", iconSize: [36, 36], iconAnchor: [18, 18] });
}

function timeSince(iso?: string | null) {
  if (!iso) return "Unknown";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function PhotoGrid({ photos }: { photos: NonNullable<CrewMapPin["photos"]> }) {
  const before = photos.filter(p => p.phase === "before");
  const after = photos.filter(p => p.phase === "after");
  const other = photos.filter(p => p.phase !== "before" && p.phase !== "after");

  const Section = ({ label, items }: { label: string; items: typeof photos }) => (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">{label}</div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {items.map(p => (
          <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="shrink-0">
            <img
              src={p.url}
              alt={p.note ?? label}
              className="w-[72px] h-[72px] rounded-lg object-cover border border-black/10 hover:opacity-90 transition-opacity"
            />
          </a>
        ))}
      </div>
    </div>
  );

  if (!photos.length) return null;

  return (
    <div className="space-y-3">
      {before.length > 0 && <Section label="Before" items={before} />}
      {after.length > 0 && <Section label="After" items={after} />}
      {other.length > 0 && <Section label="Photos" items={other} />}
    </div>
  );
}

function ServicesList({ services }: { services: NonNullable<CrewMapPin["services"]> }) {
  const done = services.filter(s => s.done).length;
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Services</div>
        <div className="text-[10px] text-muted-foreground font-medium">{done}/{services.length} done</div>
      </div>
      <div className="space-y-1">
        {services.map(s => (
          <div key={s.id} className="flex items-center gap-2 py-1">
            {s.done
              ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
              : <Circle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
            <span className={`text-xs leading-snug ${s.done ? "line-through text-muted-foreground" : "text-[var(--ink)]"}`}>
              {s.service}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CrewCommandCenter({ onClose }: { onClose: () => void }) {
  const { data: pins = [], isLoading } = useGetCrewMapPins({
    query: { queryKey: getGetCrewMapPinsQueryKey(), refetchInterval: 10000 }
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selectedId) setSelectedId(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [selectedId, onClose]);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const sendMessage = useSendCrewMessage();
  const [draft, setDraft] = useState("");

  const selectedPin = useMemo(() => pins.find(p => p.id === selectedId), [pins, selectedId]);
  const mapPins = pins.filter(p => p.lat != null && p.lng != null);

  const handleSend = () => {
    if (!selectedId || !draft.trim()) return;
    sendMessage.mutate(
      { id: selectedId, data: { body: draft.trim() } },
      {
        onSuccess: () => {
          setDraft("");
          queryClient.invalidateQueries({ queryKey: getListCrewMessagesQueryKey(selectedId) });
          toast({ title: "Message sent", description: "Crew notified." });
        },
        onError: (err) => {
          toast({ title: "Failed to send", description: err.message, variant: "destructive" });
        }
      }
    );
  };

  const hasPhotos = (selectedPin?.photos?.length ?? 0) > 0;
  const hasServices = (selectedPin?.services?.length ?? 0) > 0;

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-black/5 animate-in fade-in">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-[60] bg-black/60 backdrop-blur-xl border-b border-white/10 px-6 py-4 flex items-center justify-between text-white shadow-xl">
        <div className="flex items-center gap-3">
          <Navigation className="w-5 h-5 text-[var(--gold-light)]" />
          <h1 className="font-display font-bold text-xl tracking-tight">HALO Command Center</h1>
          <span className="ml-3 px-2.5 py-0.5 rounded-full bg-white/10 text-xs font-bold text-white/80">
            {pins.length} Crews Live
          </span>
        </div>
        <button
          onClick={onClose}
          className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 transition-colors text-white"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 relative flex">
        {/* Roster Panel */}
        <div className="absolute left-6 top-24 bottom-6 z-[60] w-72 bg-white/90 backdrop-blur-xl border border-white rounded-3xl shadow-2xl overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-black/5 bg-white/50">
            <h2 className="font-display font-bold text-[var(--ink)]">Live Roster</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
            {pins.length === 0 && !isLoading && (
              <div className="p-4 text-center text-sm text-muted-foreground">No crews active today.</div>
            )}
            {pins.map(pin => {
              const active = selectedId === pin.id;
              const hasCoords = pin.lat != null && pin.lng != null;
              const photoCount = pin.photos?.length ?? 0;
              const servicesDone = pin.services?.filter(s => s.done).length ?? 0;
              const servicesTotal = pin.services?.length ?? 0;
              return (
                <button
                  key={pin.id}
                  onClick={() => setSelectedId(active ? null : pin.id)}
                  className={`w-full text-left flex items-start gap-3 p-3 rounded-2xl transition-all ${
                    active ? "bg-[var(--ink)] text-white shadow-md" : "hover:bg-white/80"
                  }`}
                >
                  <div className="shrink-0 mt-1">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: statusColor(pin.todayStatus) }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`font-bold truncate ${active ? "text-white" : "text-[var(--ink)]"}`}>
                      {pin.name}
                    </div>
                    <div className={`text-xs truncate ${active ? "text-white/70" : "text-muted-foreground"}`}>
                      {pin.todayJob
                        ? `${pin.todayJob}${pin.unitNo ? ` · Unit ${pin.unitNo}` : ""}`
                        : (pin.trade || "General")}
                    </div>
                    {(photoCount > 0 || servicesTotal > 0) && (
                      <div className={`flex items-center gap-2 mt-1 text-[10px] ${active ? "text-white/60" : "text-muted-foreground"}`}>
                        {photoCount > 0 && <span className="flex items-center gap-0.5"><Camera className="w-2.5 h-2.5" />{photoCount}</span>}
                        {servicesTotal > 0 && <span className="flex items-center gap-0.5"><Wrench className="w-2.5 h-2.5" />{servicesDone}/{servicesTotal}</span>}
                      </div>
                    )}
                    {!hasCoords && (
                      <div className={`text-[10px] mt-1 italic ${active ? "text-white/50" : "text-black/40"}`}>
                        No GPS data today
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Crew Detail Panel */}
        {selectedPin && (
          <div className="absolute right-6 top-24 z-[60] w-88 bg-white border border-border rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-in slide-in-from-right-8 fade-in"
               style={{ maxHeight: "calc(100vh - 7rem)" }}>
            {/* Panel Header */}
            <div className="p-5 pb-4 border-b border-black/5 shrink-0">
              <div className="flex items-center gap-3">
                <div
                  className="w-12 h-12 rounded-full overflow-hidden shrink-0 border-2"
                  style={{ borderColor: statusColor(selectedPin.todayStatus) }}
                >
                  {selectedPin.selfiePath ? (
                    <img src={`/api/storage${selectedPin.selfiePath}`} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-[var(--ink)] text-[var(--gold-light)] flex items-center justify-center font-bold text-lg">
                      {selectedPin.name.substring(0, 1)}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-display font-bold text-[var(--ink)] text-lg truncate leading-tight">
                    {selectedPin.name}
                  </h3>
                  <div className="text-sm text-muted-foreground truncate">{selectedPin.trade || "General"}</div>
                </div>
                <button
                  onClick={() => setSelectedId(null)}
                  className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center hover:bg-black/5 transition-colors text-muted-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              <div className="p-5 space-y-5">
                {/* Status + Unit block */}
                <div className="bg-black/5 rounded-2xl p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <Navigation className="w-4 h-4 mt-0.5 shrink-0" style={{ color: statusColor(selectedPin.todayStatus) }} />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-[var(--ink)] text-sm capitalize">
                        {selectedPin.todayStatus || "Unknown"}
                      </div>
                      {selectedPin.todayJob && (
                        <div className="text-muted-foreground text-xs mt-0.5">
                          {selectedPin.todayJob}
                          {selectedPin.todayProperty ? ` at ${selectedPin.todayProperty}` : ""}
                        </div>
                      )}
                    </div>
                  </div>

                  {selectedPin.unitNo && (
                    <div className="flex items-center gap-2 pt-2 border-t border-black/5">
                      <MapPin className="w-4 h-4 text-[var(--gold)] shrink-0" />
                      <div>
                        <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Current Unit</div>
                        <div className="text-sm font-bold text-[var(--ink)] font-mono">{selectedPin.unitNo}</div>
                      </div>
                    </div>
                  )}

                  <div className="flex items-start gap-2 pt-2 border-t border-black/5">
                    <Clock className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                    <div className="flex-1">
                      <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Last Check-in</div>
                      <div className="text-xs text-[var(--ink)] mt-0.5">
                        {selectedPin.lastCheckinLabel || "—"} · {timeSince(selectedPin.lastCheckinAt)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Photos */}
                {hasPhotos && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Camera className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-semibold text-[var(--ink)]">Job Photos</span>
                      <span className="text-xs text-muted-foreground">({selectedPin.photos!.length})</span>
                    </div>
                    <PhotoGrid photos={selectedPin.photos!} />
                  </div>
                )}

                {/* Services */}
                {hasServices && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Wrench className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-semibold text-[var(--ink)]">Today's Services</span>
                    </div>
                    <ServicesList services={selectedPin.services!} />
                  </div>
                )}

                {!hasPhotos && !hasServices && (
                  <div className="text-center py-4 text-xs text-muted-foreground italic">
                    No photos or services recorded yet.
                  </div>
                )}
              </div>

              {/* Message composer */}
              <div className="px-5 pb-5">
                <div className="border-t border-black/5 pt-4 flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    placeholder="Message crew..."
                    rows={1}
                    className="flex-1 resize-none rounded-xl border border-border bg-black/5 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gold-light)]"
                  />
                  <button
                    onClick={handleSend}
                    disabled={!draft.trim() || sendMessage.isPending}
                    className="w-10 h-10 shrink-0 rounded-xl bg-[var(--ink)] text-white flex items-center justify-center disabled:opacity-50 hover:bg-black/80 transition-colors"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Map */}
        <div className="absolute inset-0 z-0">
          <MapContainer
            center={FALLBACK_CENTER}
            zoom={FALLBACK_ZOOM}
            className="w-full h-full"
            zoomControl={false}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapBoundsFitter pins={pins} selectedId={selectedId} />
            {mapPins.map(pin =>
              (pin.trail ?? []).length > 1 ? (
                <Polyline
                  key={`trail-${pin.id}`}
                  positions={(pin.trail ?? []).map(p => [p.lat, p.lng] as [number, number])}
                  pathOptions={{
                    color: "#16a34a",
                    weight: selectedId === pin.id ? 5 : 4,
                    opacity: selectedId && selectedId !== pin.id ? 0.35 : 0.85,
                  }}
                />
              ) : null
            )}
            {mapPins.map(pin => (
              <Marker
                key={pin.id}
                position={[pin.lat!, pin.lng!]}
                icon={createCustomIcon(pin)}
                eventHandlers={{ click: () => setSelectedId(pin.id) }}
              />
            ))}
          </MapContainer>
        </div>
      </div>
    </div>,
    document.body
  );
}
