import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import { divIcon, latLngBounds } from "leaflet";
import "leaflet/dist/leaflet.css";

export type OfficePropertyPin = {
  id: string;
  lat: number;
  lng: number;
  name: string;
  address: string | null;
  activeJobs: number;
};

// Escape user-controlled text before it goes into divIcon HTML.
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

// Brand pin: lime with the active-job count, dark when the property is idle.
function propertyPinIcon(activeJobs: number) {
  const bg = activeJobs > 0 ? "#B4FF44" : "#101318";
  const fg = activeJobs > 0 ? "#101318" : "#ffffff";
  const label = activeJobs > 0 ? String(activeJobs) : "•";
  return divIcon({
    className: "",
    html: `<div style="width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${bg};border:2px solid #101318;display:grid;place-items:center;box-shadow:0 2px 6px rgba(0,0,0,0.3)"><div style="transform:rotate(45deg);color:${fg};font-size:12px;font-weight:900;line-height:1">${esc(label)}</div></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 28],
    popupAnchor: [0, -26],
  });
}

// Leaflet doesn't react to MapContainer prop changes after mount; re-fit the
// viewport whenever the pin set changes (the portal polls every 60s).
function FitToPins({ pins }: { pins: OfficePropertyPin[] }) {
  const map = useMap();
  useEffect(() => {
    if (pins.length === 0) return;
    const bounds = latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number]));
    map.fitBounds(bounds.pad(0.3), { maxZoom: 16 });
  }, [map, pins.map((p) => p.id).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function OfficePropertyMap({
  pins,
  onViewJobs,
}: {
  pins: OfficePropertyPin[];
  onViewJobs?: (propertyId: string) => void;
}) {
  if (pins.length === 0) return null;
  const lat = pins.reduce((s, p) => s + p.lat, 0) / pins.length;
  const lng = pins.reduce((s, p) => s + p.lng, 0) / pins.length;
  return (
    <div
      className="rounded-[16px] overflow-hidden border border-[var(--hairline)] mb-[10px]"
      data-testid="office-property-map"
    >
      <MapContainer
        center={[lat, lng]}
        zoom={13}
        style={{ height: 260, width: "100%" }}
        scrollWheelZoom={false}
        attributionControl={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitToPins pins={pins} />
        {pins.map((p) => (
          <Marker key={p.id} position={[p.lat, p.lng]} icon={propertyPinIcon(p.activeJobs)}>
            <Popup>
              <div style={{ fontWeight: 700 }}>{p.name}</div>
              {p.address && <div style={{ fontSize: 12 }}>{p.address}</div>}
              <div style={{ fontSize: 12, marginTop: 2 }}>
                {p.activeJobs} active job{p.activeJobs === 1 ? "" : "s"}
              </div>
              {onViewJobs && (
                <button
                  type="button"
                  onClick={() => onViewJobs(p.id)}
                  data-testid={`button-view-jobs-${p.id}`}
                  style={{
                    marginTop: 6,
                    display: "inline-block",
                    background: "#B4FF44",
                    color: "#101318",
                    border: "1px solid #101318",
                    borderRadius: 8,
                    padding: "4px 10px",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  View jobs
                </button>
              )}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
