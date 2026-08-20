/**
 * Minimal map for Pulse / Portfolio — status colors only, no money.
 */
import { useEffect, useMemo } from "react";
import { MapContainer, Marker, TileLayer, useMap, Popup } from "react-leaflet";
import { divIcon } from "leaflet";
import "leaflet/dist/leaflet.css";

export type MapPin = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  sublabel?: string;
  tone: "attention" | "turning" | "waiting" | "done" | "good" | "watch";
  onClick?: () => void;
};

const toneHex: Record<string, string> = {
  attention: "#FF453A",
  blocked: "#FF453A",
  turning: "#0A84FF",
  waiting: "#FFD60A",
  done: "#30D158",
  good: "#30D158",
  watch: "#0A84FF",
};

function pinIcon(tone: string) {
  const color = toneHex[tone] || "#ffffff";
  return divIcon({
    className: "",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,0.9);box-shadow:0 1px 4px rgba(0,0,0,0.45)"></div>`,
  });
}

function FitBounds({ pins }: { pins: MapPin[] }) {
  const map = useMap();
  useEffect(() => {
    if (pins.length === 0) return;
    if (pins.length === 1) {
      map.setView([pins[0].lat, pins[0].lng], 13);
      return;
    }
    const lats = pins.map((p) => p.lat);
    const lngs = pins.map((p) => p.lng);
    map.fitBounds(
      [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)],
      ],
      { padding: [40, 40] },
    );
  }, [map, pins]);
  return null;
}

export function SimpleOpsMap({
  pins,
  className = "",
  height = 280,
}: {
  pins: MapPin[];
  className?: string;
  height?: number;
}) {
  const valid = useMemo(
    () => pins.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)),
    [pins],
  );
  const center = useMemo((): [number, number] => {
    if (valid.length === 0) return [32.75, -97.13]; // DFW default
    return [
      valid.reduce((s, p) => s + p.lat, 0) / valid.length,
      valid.reduce((s, p) => s + p.lng, 0) / valid.length,
    ];
  }, [valid]);

  if (valid.length === 0) {
    return (
      <div
        className={`flex items-center justify-center rounded-[16px] border border-white/10 bg-white/[0.03] text-[14px] text-white/35 ${className}`}
        style={{ height }}
      >
        Map pins appear when properties have locations
      </div>
    );
  }

  return (
    <div className={`overflow-hidden rounded-[16px] border border-white/10 ${className}`} style={{ height }}>
      <MapContainer
        center={center}
        zoom={11}
        style={{ height: "100%", width: "100%", background: "#111" }}
        zoomControl={false}
        attributionControl={false}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <FitBounds pins={valid} />
        {valid.map((p) => (
          <Marker
            key={p.id}
            position={[p.lat, p.lng]}
            icon={pinIcon(p.tone)}
            eventHandlers={p.onClick ? { click: () => p.onClick?.() } : undefined}
          >
            <Popup>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{p.label}</div>
              {p.sublabel && <div style={{ fontSize: 12, opacity: 0.7 }}>{p.sublabel}</div>}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

export default SimpleOpsMap;
