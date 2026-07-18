import { Router, type IRouter } from "express";
import { eq, and, gt, notInArray, desc } from "drizzle-orm";
import {
  db,
  propertiesTable,
  jobsTable,
  invoicesTable,
  activitiesTable,
} from "@workspace/db";
import { CheckArrivalBody, CheckArrivalResponse } from "@workspace/api-zod";
import { completeJson } from "../lib/ai";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const MATCH_RADIUS_METERS = 250;
const GEOCODE_RETRY_MS = 1000 * 60 * 60 * 24 * 7;

let lastNominatimAt = 0;
const NOMINATIM_MIN_INTERVAL_MS = 1100;
let geocodeQueue: Promise<void> = Promise.resolve();

async function nominatimForward(
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

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Lazily geocode any active properties that have an address but no
 * coordinates yet. Serialized through a queue to respect Nominatim's
 * 1 req/sec policy. Failures are stamped with geocodedAt so we do not
 * hammer the API; retried after GEOCODE_RETRY_MS.
 */
async function ensurePropertiesGeocoded(): Promise<void> {
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

router.post("/arrivals/check", async (req, res): Promise<void> => {
  const input = CheckArrivalBody.parse(req.body);
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) {
    res.json(CheckArrivalResponse.parse({ match: false }));
    return;
  }

  // Kick off geocoding of any not-yet-located properties in the background —
  // never block the arrival check on Nominatim's 1 req/sec queue.
  void ensurePropertiesGeocoded().catch((err) =>
    logger.warn({ err }, "Background property geocoding failed"),
  );

  const props = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.status, "active"));

  let best: { id: string; name: string; distance: number } | null = null;
  for (const p of props) {
    if (p.latitude == null || p.longitude == null) continue;
    const d = haversineMeters(input.lat, input.lng, p.latitude, p.longitude);
    if (d <= MATCH_RADIUS_METERS && (!best || d < best.distance)) {
      best = { id: p.id, name: p.name, distance: d };
    }
  }

  if (!best) {
    res.json(CheckArrivalResponse.parse({ match: false }));
    return;
  }

  const property = props.find((p) => p.id === best!.id)!;

  const openJobs = await db
    .select()
    .from(jobsTable)
    .where(
      and(
        eq(jobsTable.propertyId, best.id),
        notInArray(jobsTable.status, ["complete", "paid", "cancelled", "cleared"]),
      ),
    )
    .orderBy(desc(jobsTable.createdAt))
    .limit(6);

  const unpaidInvoices = await db
    .select()
    .from(invoicesTable)
    .where(
      and(
        eq(invoicesTable.propertyId, best.id),
        notInArray(invoicesTable.status, ["paid", "draft", "cancelled"]),
      ),
    )
    .limit(10);

  const recentActivity = await db
    .select()
    .from(activitiesTable)
    .where(
      and(
        eq(activitiesTable.entityType, "property"),
        eq(activitiesTable.entityId, best.id),
      ),
    )
    .orderBy(desc(activitiesTable.createdAt))
    .limit(5);

  const openJobsOut = openJobs.map((j) => ({
    id: j.id,
    jobNo: j.jobNo,
    description: j.description,
    status: j.status,
    unitNo: j.unitNo ?? null,
    category: j.category ?? null,
  }));

  const ownerLabel = (input.owner ?? "").trim() || "Owner";
  let headline = `You're at ${property.name}`;
  let message =
    openJobsOut.length > 0
      ? `There ${openJobsOut.length === 1 ? "is 1 open job" : `are ${openJobsOut.length} open jobs`} at this property. Want to start another one while you're here?`
      : "No open jobs here right now. Want to start one while you're on site?";
  let jobIdeas: { category: string; description: string; unitNo: string | null }[] =
    [];

  try {
    const ai = await completeJson<{
      headline?: string;
      message?: string;
      jobIdeas?: { category?: string; description?: string; unitNo?: string }[];
    }>(
      `You are HALO, the operations copilot for Archangel, a contracting company serving apartment communities. One of the owners has just physically arrived at a property. Write a short, sharp on-site greeting and suggest up to 3 concrete jobs they could start right now. Base suggestions on the property's open work, notes and history — think turns, punch lists, follow-ups, inspections of in-progress work. Keep headline under 8 words, message under 40 words, direct and useful. Categories should be short trade words like Paint, Plumbing, Turnover, Cleaning, Inspection, Repair.`,
      JSON.stringify({
        owner: ownerLabel,
        property: {
          name: property.name,
          pmc: property.pmcName,
          units: property.units,
          accessNotes: property.accessNotes,
          brief: property.brief,
        },
        openJobs: openJobsOut,
        unpaidInvoiceCount: unpaidInvoices.length,
        recentActivity: recentActivity.map((a) => ({
          kind: a.kind,
          body: a.body,
          at: a.createdAt,
        })),
      }) +
        `\n\nRespond as JSON: { "headline": string, "message": string, "jobIdeas": [{ "category": string, "description": string, "unitNo": string | null }] }`,
      1024,
    );
    if (ai?.headline?.trim()) headline = ai.headline.trim();
    if (ai?.message?.trim()) message = ai.message.trim();
    if (Array.isArray(ai?.jobIdeas)) {
      jobIdeas = ai.jobIdeas
        .filter((i) => i?.category?.trim() && i?.description?.trim())
        .slice(0, 3)
        .map((i) => ({
          category: i.category!.trim(),
          description: i.description!.trim(),
          unitNo: i.unitNo?.trim() || null,
        }));
    }
  } catch (err) {
    logger.warn({ err }, "Arrival AI suggestion failed; using fallback copy");
  }

  // Server-side dedupe: only log one arrival per owner+property per 4 hours,
  // regardless of client-side cooldown state (multiple devices, cleared storage).
  const arrivalBody = `${ownerLabel} arrived on site at ${property.name} (auto-detected)`;
  const [recentArrival] = await db
    .select()
    .from(activitiesTable)
    .where(
      and(
        eq(activitiesTable.entityType, "property"),
        eq(activitiesTable.entityId, best.id),
        eq(activitiesTable.body, arrivalBody),
        gt(activitiesTable.createdAt, new Date(Date.now() - 4 * 60 * 60 * 1000)),
      ),
    )
    .limit(1);
  if (!recentArrival) {
    await db.insert(activitiesTable).values({
      entityType: "property",
      entityId: best.id,
      kind: "note",
      body: arrivalBody,
    });
  }

  res.json(
    CheckArrivalResponse.parse({
      match: true,
      propertyId: best.id,
      propertyName: property.name,
      distanceMeters: Math.round(best.distance),
      suggestion: { headline, message, openJobs: openJobsOut, jobIdeas },
    }),
  );
});

export default router;
