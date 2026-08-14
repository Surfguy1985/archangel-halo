import { eq } from "drizzle-orm";
import { db, propertiesTable } from "@workspace/db";
import { logger } from "./logger";
import type { GeoPoint } from "./siteTwinCore";

const GEOCODE_RETRY_MS = 1000 * 60 * 60 * 24 * 7;
const NOMINATIM_MIN_INTERVAL_MS = 1100;
const UA = "HALO-ArchangelOps/1.0 (admin@archangelcontractors.com)";

let lastNominatimAt = 0;
let nominatimQueue: Promise<void> = Promise.resolve();

async function nominatimGate<T>(fn: () => Promise<T>): Promise<T> {
  let result!: T;
  const run = nominatimQueue.then(async () => {
    const wait = Math.max(0, lastNominatimAt + NOMINATIM_MIN_INTERVAL_MS - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastNominatimAt = Date.now();
    result = await fn();
  });
  nominatimQueue = run.then(
    () => undefined,
    () => undefined,
  );
  await run;
  return result;
}

export type GeoHit = {
  lat: number;
  lng: number;
  label: string;
  city: string | null;
};

export async function nominatimSearch(query: string, limit = 5): Promise<GeoHit[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  return nominatimGate(async () => {
    const url =
      `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=${Math.min(8, Math.max(1, limit))}` +
      `&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "Nominatim search failed");
      return [];
    }
    const data: unknown = await res.json().catch(() => null);
    if (!Array.isArray(data)) return [];
    const hits: GeoHit[] = [];
    for (const raw of data) {
      const row = raw as {
        lat?: string;
        lon?: string;
        display_name?: string;
        address?: { city?: string; town?: string; village?: string };
      };
      const lat = Number(row.lat);
      const lng = Number(row.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      hits.push({
        lat,
        lng,
        label: typeof row.display_name === "string" ? row.display_name : q,
        city: row.address?.city || row.address?.town || row.address?.village || null,
      });
    }
    return hits;
  });
}

export async function nominatimForward(
  query: string,
): Promise<{ lat: number; lng: number } | null> {
  const hits = await nominatimSearch(query, 1);
  const first = hits[0];
  return first ? { lat: first.lat, lng: first.lng } : null;
}

export async function nominatimReverse(lat: number, lng: number): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return nominatimGate(async () => {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=0`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "Nominatim reverse geocode failed");
      return null;
    }
    const data = (await res.json().catch(() => null)) as { display_name?: string } | null;
    return typeof data?.display_name === "string" ? data.display_name : null;
  });
}

export async function fetchBuildingFootprint(
  center: GeoPoint,
): Promise<{ ring: GeoPoint[]; source: "osm" | "pad" }> {
  try {
    const body =
      `[out:json][timeout:12];way(around:90,${center.lat},${center.lng})[building];out geom qt;`;
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(body)}`,
    });
    if (res.ok) {
      const json = (await res.json()) as {
        elements?: Array<{ geometry?: Array<{ lat: number; lon: number }> }>;
      };
      let best: GeoPoint[] | null = null;
      for (const el of json.elements ?? []) {
        const ring = (el.geometry ?? [])
          .map((g) => ({ lat: g.lat, lng: g.lon }))
          .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
        if (ring.length < 4) continue;
        if (!best || ring.length > best.length) best = ring;
      }
      if (best) return { ring: best, source: "osm" };
    }
  } catch (err) {
    logger.warn({ err }, "Overpass building lookup failed");
  }
  const pad = 0.00036; // ~40m
  return {
    ring: [
      { lat: center.lat - pad, lng: center.lng - pad },
      { lat: center.lat - pad, lng: center.lng + pad },
      { lat: center.lat + pad, lng: center.lng + pad },
      { lat: center.lat + pad, lng: center.lng - pad },
      { lat: center.lat - pad, lng: center.lng - pad },
    ],
    source: "pad",
  };
}

/**
 * Lazily geocode any active properties that have an address but no
 * coordinates yet. Serialized through a queue to respect Nominatim's
 * 1 req/sec policy. Failures are stamped with geocodedAt so we do not
 * hammer the API; retried after GEOCODE_RETRY_MS.
 */
/** Immediate geocode for one property that has an address but no pin. */
export async function geocodePropertyNow(id: string): Promise<boolean> {
  const [p] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, id));
  if (!p) return false;
  if (p.latitude != null && p.longitude != null) return true;
  const query = [p.address, p.city].filter(Boolean).join(", ");
  if (!query) return false;
  try {
    const coords = await nominatimForward(query);
    await db
      .update(propertiesTable)
      .set({
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
        geocodedAt: new Date(),
      })
      .where(eq(propertiesTable.id, id));
    logger.info({ propertyId: id, query, found: Boolean(coords) }, "Property geocoded now");
    return Boolean(coords);
  } catch (err) {
    logger.warn({ err, propertyId: id }, "Immediate property geocode failed");
    return false;
  }
}

export async function ensurePropertiesGeocoded(): Promise<void> {
  const props = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.status, "active"));
  const pending = props.filter(
    (p) =>
      (p.latitude == null || p.longitude == null) &&
      (p.address || p.city) &&
      (!p.geocodedAt ||
        Date.now() - new Date(p.geocodedAt).getTime() > GEOCODE_RETRY_MS),
  );
  if (pending.length === 0) return;
  for (const p of pending) {
    const query = [p.address, p.city].filter(Boolean).join(", ");
    try {
      const coords = await nominatimForward(query);
      await db
        .update(propertiesTable)
        .set({
          latitude: coords?.lat ?? null,
          longitude: coords?.lng ?? null,
          geocodedAt: new Date(),
        })
        .where(eq(propertiesTable.id, p.id));
      logger.info(
        { propertyId: p.id, query, found: Boolean(coords) },
        "Property geocoded",
      );
    } catch (err) {
      logger.warn({ err, propertyId: p.id }, "Property geocode error");
    }
  }
}
