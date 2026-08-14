/**
 * GPS Finder — type an address or drop a pin. Saves exact coordinates.
 */
import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { divIcon } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Crosshair, Loader2, MapPin, Navigation, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const LIME = "#B4FF44";
const CHARCOAL = "#1A1C1A";
const FALLBACK: [number, number] = [32.7767, -96.797];

export type GpsHit = { lat: number; lng: number; label: string; city: string | null };

const pinIcon = divIcon({
  className: "",
  html: `<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${LIME};border:2px solid ${CHARCOAL};box-shadow:0 3px 10px rgba(0,0,0,.3)"></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 26],
});

function FlyTo({ pos }: { pos: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) map.setView(pos, Math.max(map.getZoom(), 17));
    else map.flyTo(pos, Math.max(map.getZoom(), 17), { duration: 0.45 });
    const t = setTimeout(() => map.invalidateSize(), 80);
    return () => clearTimeout(t);
  }, [map, pos[0], pos[1]]);
  return null;
}

function DropOnClick({ onDrop }: { onDrop: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onDrop(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export function GpsFinder({
  propertyId,
  initialLat,
  initialLng,
  initialQuery,
  onPinned,
  onLocked,
}: {
  propertyId?: string;
  initialLat?: number | null;
  initialLng?: number | null;
  initialQuery?: string;
  onPinned?: (p: { lat: number; lng: number; address: string | null }) => void;
  onLocked?: (p: { lat: number; lng: number; address: string | null }) => void;
}) {
  const { toast } = useToast();
  const [query, setQuery] = useState(initialQuery ?? "");
  const [hits, setHits] = useState<GpsHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [pin, setPin] = useState<[number, number] | null>(
    initialLat != null && initialLng != null ? [initialLat, initialLng] : null,
  );

  useEffect(() => {
    if (!propertyId) return;
    void (async () => {
      try {
        const r = await fetch(`/api/properties/${propertyId}/gps`, { credentials: "include" });
        if (!r.ok) return;
        const j = (await r.json()) as { latitude?: number | null; longitude?: number | null; address?: string | null };
        if (j.latitude != null && j.longitude != null) {
          setPin([j.latitude, j.longitude]);
          setAddress(j.address ?? null);
        }
      } catch {
        /* optional */
      }
    })();
  }, [propertyId]);

  useEffect(() => {
    if (pin) return;
    const q = query.trim();
    if (q.length < 3) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => void search(q), 320);
    return () => clearTimeout(t);
    // search is stable enough for this finder; pin short-circuits after a drop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, pin]);

  const search = async (q: string) => {
    if (q.trim().length < 3) {
      setHits([]);
      return;
    }
    setSearching(true);
    try {
      const r = await fetch(`/api/geo/search?q=${encodeURIComponent(q.trim())}`, { credentials: "include" });
      const j = (await r.json()) as { hits?: GpsHit[] };
      setHits(j.hits ?? []);
    } catch {
      setHits([]);
    } finally {
      setSearching(false);
    }
  };

  const reverse = async (lat: number, lng: number) => {
    try {
      const r = await fetch(`/api/geo/reverse?lat=${lat}&lng=${lng}`, { credentials: "include" });
      const j = (await r.json()) as { address?: string | null };
      setAddress(j.address ?? null);
      onPinned?.({ lat, lng, address: j.address ?? null });
    } catch {
      onPinned?.({ lat, lng, address: null });
    }
  };

  const drop = (lat: number, lng: number) => {
    setPin([lat, lng]);
    setHits([]);
    void reverse(lat, lng);
  };

  const pickHit = (h: GpsHit) => {
    setPin([h.lat, h.lng]);
    setAddress(h.label);
    setQuery(h.label);
    setHits([]);
    onPinned?.({ lat: h.lat, lng: h.lng, address: h.label });
  };

  const here = () => {
    if (!("geolocation" in navigator)) {
      toast({ title: "Location unavailable on this device", variant: "destructive" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => drop(pos.coords.latitude, pos.coords.longitude),
      () => toast({ title: "Couldn't read this phone's GPS", variant: "destructive" }),
      { enableHighAccuracy: true, timeout: 20_000 },
    );
  };

  const save = async () => {
    if (!propertyId || !pin) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/properties/${propertyId}/gps`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude: pin[0],
          longitude: pin[1],
          address: address ?? undefined,
          updateAddress: true,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 202) {
        toast({ title: "Pin waiting on Falkon approval" });
      } else if (!r.ok) {
        throw new Error((j as { error?: string }).error || `Save failed (${r.status})`);
      } else {
        toast({ title: "GPS locked" });
        onPinned?.({ lat: pin[0], lng: pin[1], address });
        onLocked?.({ lat: pin[0], lng: pin[1], address });
      }
    } catch (e) {
      toast({
        title: "Couldn't save coordinates",
        description: e instanceof Error ? e.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const center = pin ?? FALLBACK;
  const coordLabel = useMemo(() => {
    if (!pin) return "Drop a pin or search an address";
    return `${pin[0].toFixed(6)}, ${pin[1].toFixed(6)}`;
  }, [pin]);

  return (
    <div className="gps-finder">
      <form
        className="gps-finder-search"
        onSubmit={(e) => {
          e.preventDefault();
          void search(query);
        }}
      >
        <Search size={16} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a street, city, or property name"
          aria-label="Search address"
        />
        <button type="submit" disabled={searching}>
          {searching ? <Loader2 size={14} className="animate-spin" /> : "Find"}
        </button>
      </form>
      {hits.length > 0 && (
        <ul className="gps-finder-hits">
          {hits.map((h, i) => (
            <li key={`${h.lat}-${h.lng}-${i}`}>
              <button type="button" onClick={() => pickHit(h)}>
                <MapPin size={14} />
                <span>{h.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="gps-finder-map">
        <MapContainer center={center} zoom={pin ? 17 : 11} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
          <TileLayer
            attribution="&copy; OSM"
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          />
          <DropOnClick onDrop={drop} />
          {pin && <FlyTo pos={pin} />}
          {pin && <Marker position={pin} icon={pinIcon} />}
        </MapContainer>
      </div>
      <div className="gps-finder-meta">
        <code>{coordLabel}</code>
        {address && <p>{address}</p>}
        <div className="gps-finder-actions">
          <button type="button" onClick={here}>
            <Navigation size={14} /> My GPS
          </button>
          {propertyId && (
            <button type="button" className="gps-save" disabled={!pin || saving} onClick={() => void save()}>
              <Crosshair size={14} />
              {saving ? "Locking…" : "Lock GPS"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
