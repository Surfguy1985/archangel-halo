/**
 * Deterministic fallback coords when property lat/lng missing —
 * keeps maps useful for demos without inventing real addresses.
 * DFW-ish center with stable per-id offset.
 */
export function fallbackLatLng(id: string): { lat: number; lng: number } {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const lat = 32.75 + ((h % 200) - 100) / 1000; // ~±0.1°
  const lng = -97.13 + (((h >> 8) % 200) - 100) / 1000;
  return { lat, lng };
}

export function resolveCoords(
  lat: number | null | undefined,
  lng: number | null | undefined,
  id: string,
): { lat: number; lng: number; approx: boolean } {
  if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng, approx: false };
  }
  const f = fallbackLatLng(id);
  return { ...f, approx: true };
}
