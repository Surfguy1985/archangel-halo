/**
 * LiveMapCard — embedded Leaflet + OSM map (desktop variant, taller).
 *
 * Crew markers with name/status tooltip, last-ping, colour-coded.
 * No API key — OpenStreetMap tiles.
 * "Expand →" navigates to /map.
 */

import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useListCrews, useListProperties } from "@workspace/api-client-react";
import { MapPin, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import "leaflet/dist/leaflet.css";

function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface CrewMarker {
  id: string;
  name: string;
  lat: number;
  lng: number;
  isCheckedIn: boolean;
  trade?: string | null;
  lastPing?: string | null;
  /** Team colour from the server (gold = Archangel staff). Null = fall back to status. */
  pinColor?: string | null;
}

/** Only a plain hex may reach an inline style — these strings hit the DOM raw. */
const safeHex = (value: unknown): string | null =>
  typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : null;

function LeafletMap({ markers, center, zoom }: {
  markers: CrewMarker[];
  center: [number, number];
  zoom: number;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<any>(null);

  useEffect(() => {
    if (!mapRef.current || leafletRef.current) return;

    import("leaflet").then((L) => {
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
        iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
        shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
      });
      if (!mapRef.current) return;

      const map = L.map(mapRef.current, {
        center, zoom, zoomControl: true,
        attributionControl: false, scrollWheelZoom: false,
      });
      leafletRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);

      markers.forEach(crew => {
        // Team colour owns the pin; the fill still says whether they're in.
        const color = safeHex(crew.pinColor) ?? (crew.isCheckedIn ? "#22C55E" : "#3B82F6");
        const initials = crew.name.split(" ").map(w => w[0] ?? "").join("").slice(0, 2).toUpperCase();
        const lastPingStr = crew.lastPing ? (() => {
          try {
            const d = new Date(crew.lastPing!);
            const diff = Math.round((Date.now() - d.getTime()) / 60000);
            return diff < 2 ? "Just now" : diff < 60 ? `${diff}m ago` : `${Math.round(diff / 60)}h ago`;
          } catch { return ""; }
        })() : "";

        const icon = L.divIcon({
          html: `<div style="width:34px;height:34px;border-radius:50%;background:${crew.isCheckedIn ? "rgba(34,197,94,0.18)" : "rgba(59,130,246,0.15)"};border:2px solid ${color};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:${color};box-shadow:0 2px 8px rgba(0,0,0,0.4);cursor:pointer">${initials}</div>`,
          className: "", iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -20],
        });

        L.marker([crew.lat, crew.lng], { icon }).addTo(map).bindPopup(`
          <div style="font-family:system-ui;padding:2px 0;min-width:120px">
            <div style="font-size:13px;font-weight:600;color:#111;margin-bottom:2px">${escHtml(crew.name)}</div>
            ${crew.trade ? `<div style="font-size:11px;color:#555;margin-bottom:3px">${escHtml(crew.trade)}</div>` : ""}
            <div style="display:flex;align-items:center;gap:4px;font-size:11px;color:${color}">
              <div style="width:6px;height:6px;border-radius:50%;background:${color}"></div>
              ${crew.isCheckedIn ? "Checked in" : "Available"}
            </div>
            ${lastPingStr ? `<div style="font-size:10px;color:#888;margin-top:2px">${escHtml(lastPingStr)}</div>` : ""}
          </div>
        `);
      });

      if (markers.length > 1) {
        map.fitBounds(L.latLngBounds(markers.map(m => [m.lat, m.lng] as [number, number])).pad(0.3));
      }
    }).catch(() => {});

    return () => { if (leafletRef.current) { leafletRef.current.remove(); leafletRef.current = null; } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={mapRef} style={{ width: "100%", height: "100%", borderRadius: "inherit" }} />;
}

export function LiveMapCard({ query: _q }: { query?: string }) {
  const [, navigate] = useLocation();
  const { data: crews, isLoading: cLoading, refetch } = useListCrews();
  const { data: properties, isLoading: pLoading } = useListProperties();
  const [mapKey, setMapKey] = useState(0);

  if (cLoading || pLoading) {
    return (
      <div className="rounded-[18px] overflow-hidden mb-3 border border-[#22C55E]/18 bg-[#060C18]">
        <div className="h-[320px] flex items-center justify-center gap-2.5">
          <Loader2 className="w-4 h-4 animate-spin text-[#22C55E]/45" />
          <span className="text-[12px] text-white/30">Loading map…</span>
        </div>
      </div>
    );
  }

  const crewList = (crews ?? []) as any[];
  const propList = (properties ?? []) as any[];

  const markers: CrewMarker[] = crewList
    .filter(c => c.lastLat ?? c.lat ?? c.gpsLat)
    .map(c => ({
      id: c.id,
      name: c.name ?? "Crew",
      lat: parseFloat(String(c.lastLat ?? c.lat ?? c.gpsLat)),
      lng: parseFloat(String(c.lastLng ?? c.lng ?? c.gpsLng)),
      isCheckedIn: !!(c.isCheckedIn || c.checkedInAt || c.lastCheckinAt),
      trade: c.trade ?? c.role ?? null,
      lastPing: c.lastPingAt ?? c.lastCheckinAt ?? null,
      pinColor: c.pinColor ?? null,
    }))
    .filter(m => !isNaN(m.lat) && !isNaN(m.lng));

  const checkedIn = crewList.filter(c => c.isCheckedIn || c.checkedInAt || c.lastCheckinAt);
  const center: [number, number] = markers.length > 0
    ? [markers.reduce((s, m) => s + m.lat, 0) / markers.length, markers.reduce((s, m) => s + m.lng, 0) / markers.length]
    : [32.7767, -96.7970];

  return (
    <div className="rounded-[18px] overflow-hidden mb-3" style={{
      border: "1px solid rgba(34,197,94,0.18)", background: "rgba(6,12,24,0.96)",
      boxShadow: "0 8px 32px rgba(0,0,0,0.3)", animation: "dcIn 0.2s ease-out both",
    }}>
      <div className="px-4 py-3 border-b border-white/[0.04] flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#22C55E] animate-pulse" />
          <span className="text-[12px] font-bold text-[#22C55E]/85">Live Ops</span>
        </div>
        <span className="text-[11.5px] text-white/45">
          <span className="font-semibold text-white/70">{checkedIn.length}</span> on site
          {propList.length > 0 && <> · <span className="font-semibold text-white/70">{propList.length}</span> propert{propList.length === 1 ? "y" : "ies"}</>}
        </span>
        <div className="flex-1" />
        <button type="button" onClick={() => { refetch(); setMapKey(k => k + 1); }}
          className="w-7 h-7 grid place-items-center text-white/25 hover:text-white/55 transition-colors" title="Refresh">
          <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.8} />
        </button>
      </div>

      <div style={{ height: 320, position: "relative" }}>
        {markers.length > 0 ? (
          <LeafletMap key={mapKey} markers={markers} center={center} zoom={13} />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <MapPin className="w-8 h-8 text-white/12" strokeWidth={1.2} />
            <div className="text-center">
              <div className="text-[13px] text-white/35 font-medium">No GPS data</div>
              <div className="text-[11px] text-white/22 mt-1">Crew GPS pings appear when they check in</div>
            </div>
            {crewList.length > 0 && (
              <div className="flex flex-wrap gap-2 px-6 justify-center">
                {crewList.slice(0, 6).map(c => (
                  <div key={c.id} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px]"
                    style={{
                      background: (c.isCheckedIn || c.lastCheckinAt) ? "rgba(34,197,94,0.10)" : "rgba(255,255,255,0.04)",
                      border: `1px solid ${(c.isCheckedIn || c.lastCheckinAt) ? "rgba(34,197,94,0.22)" : "rgba(255,255,255,0.07)"}`,
                      color: (c.isCheckedIn || c.lastCheckinAt) ? "rgba(34,197,94,0.85)" : "rgba(255,255,255,0.32)",
                    }}>
                    <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: (c.isCheckedIn || c.lastCheckinAt) ? "#22C55E" : "rgba(255,255,255,0.2)" }} />
                    {c.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <button type="button" onClick={() => navigate("/map")}
          className="absolute bottom-2 right-2 flex items-center gap-1 text-[10.5px] text-white/35 hover:text-white/65 transition-colors px-2.5 py-1.5 rounded-[8px]"
          style={{ background: "rgba(6,12,24,0.82)", backdropFilter: "blur(6px)" }}>
          Expand <ExternalLink className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
