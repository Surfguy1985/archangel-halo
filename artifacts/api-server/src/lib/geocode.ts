import { eq } from "drizzle-orm";
import { db, propertiesTable } from "@workspace/db";
import { logger } from "./logger";

const GEOCODE_RETRY_MS = 1000 * 60 * 60 * 24 * 7;

let lastNominatimAt = 0;
const NOMINATIM_MIN_INTERVAL_MS = 1100;
let geocodeQueue: Promise<void> = Promise.resolve();

export async function nominatimForward(
  query: string,
): Promise<{ lat: number; lng: number } | null> {
  const wait = Math.max(0, lastNominatimAt + NOMINATIM_MIN_INTERVAL_MS - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatimAt = Date.now();
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "HALO-ArchangelOps/1.0 (admin@archangelcontractors.com)",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    logger.warn({ status: res.status }, "Nominatim forward geocode failed");
    return null;
  }
  const data: any = await res.json().catch(() => null);
  const first = Array.isArray(data) ? data[0] : null;
  const lat = Number(first?.lat);
  const lng = Number(first?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * Lazily geocode any active properties that have an address but no
 * coordinates yet. Serialized through a queue to respect Nominatim's
 * 1 req/sec policy. Failures are stamped with geocodedAt so we do not
 * hammer the API; retried after GEOCODE_RETRY_MS.
 */
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
  const run = geocodeQueue.then(async () => {
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
  });
  geocodeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  await run;
}
