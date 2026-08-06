import { Fragment, useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline, useMap } from "react-leaflet";
import { divIcon, latLngBounds } from "leaflet";
import "leaflet/dist/leaflet.css";

export type TrackerPin = {
  id: string;
  lat: number;
  lng: number;
  accuracy?: number | null;
  label: string;
  sublabel?: string;
  kind: "checkin" | "checkout";
  /** Set on checkout when crew is en-route to a next job; cleared on next check-in. */
  movingToUnit?: string | null;
};

// Brand-colored pin: lime for check-ins, dark for check-outs.
function pinIcon(kind: "checkin" | "checkout") {
  const bg = kind === "checkin" ? "#B4FF44" : "#101318";
  const fg = kind === "checkin" ? "#101318" : "#ffffff";
  return divIcon({
    className: "",
    html: `<div style="width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${bg};border:2px solid #101318;display:grid;place-items:center;box-shadow:0 2px 6px rgba(0,0,0,0.3)"><div style="transform:rotate(45deg);color:${fg};font-size:13px;font-weight:900;line-height:1">${kind === "checkin" ? "↓" : "↑"}</div></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 28],
    popupAnchor: [0, -26],
  });
}

// Leaflet doesn't react to MapContainer prop changes after mount — the page
// polls every 10s, so re-fit the viewport whenever the pin set changes.
function FitToPins({ pins }: { pins: TrackerPin[] }) {
  const map = useMap();
  useEffect(() => {
    if (pins.length === 0) return;
    const bounds = latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number]));
    map.fitBounds(bounds.pad(0.3), { maxZoom: 17 });
  }, [map, pins.map((p) => p.id).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export type TrailPt = { lat: number; lng: number };

export function TrackerMap({ pins, trail = [] }: { pins: TrackerPin[]; trail?: TrailPt[] }) {
  if (pins.length === 0 && trail.length === 0) return null;
  const all = pins.length ? pins : trail;
  const lat = all.reduce((s, p) => s + p.lat, 0) / all.length;
  const lng = all.reduce((s, p) => s + p.lng, 0) / all.length;
  return (
    <div className="rounded-[16px] overflow-hidden border border-[var(--hairline)]" data-testid="tracker-map">
      <MapContainer
        center={[lat, lng]}
        zoom={16}
        style={{ height: 260, width: "100%" }}
        scrollWheelZoom={false}
        attributionControl={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitToPins pins={pins} />
        {trail.length > 1 && (
          <Polyline
            positions={trail.map((p) => [p.lat, p.lng] as [number, number])}
            pathOptions={{ color: "#16a34a", weight: 4, opacity: 0.85 }}
          />
        )}
        {pins.map((p) => (
          <Fragment key={p.id}>
            <Marker position={[p.lat, p.lng]} icon={pinIcon(p.kind)}>
              <Popup>
                <div style={{ fontWeight: 700 }}>{p.label}</div>
                {p.sublabel && <div style={{ fontSize: 12 }}>{p.sublabel}</div>}
                {p.movingToUnit && (
                  <div style={{ fontSize: 12, marginTop: 4, padding: "3px 7px", background: "#fef3c7", borderRadius: 8, fontWeight: 600, color: "#92400e" }}>
                    🚶 Moving to {p.movingToUnit}
                  </div>
                )}
              </Popup>
            </Marker>
            {p.accuracy != null && p.accuracy > 0 && p.accuracy < 500 && (
              <Circle
                center={[p.lat, p.lng]}
                radius={p.accuracy}
                pathOptions={{ color: "#101318", weight: 1, fillColor: "#B4FF44", fillOpacity: 0.12 }}
              />
            )}
          </Fragment>
        ))}
      </MapContainer>
    </div>
  );
}
