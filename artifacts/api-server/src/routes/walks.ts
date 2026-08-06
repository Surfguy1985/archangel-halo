import { Router, type IRouter } from "express";
import { and, desc, eq, ilike } from "drizzle-orm";
import {
  db,
  walksTable,
  walkCapturesTable,
  jobsTable,
  jobLineItemsTable,
  propertiesTable,
  priceItemsTable,
  activitiesTable,
} from "@workspace/db";
import {
  ListWalksQueryParams,
  ListWalksResponse,
  CreateWalkBody,
  CreateWalkResponse,
  GetWalkParams,
  GetWalkResponse,
  DeleteWalkParams,
  AddWalkCaptureParams,
  AddWalkCaptureBody,
  AddWalkCaptureBatchParams,
  AddWalkCaptureBatchBody,
  AddWalkCaptureBatchResponse,
  AddWalkCaptureResponse,
  DeleteWalkCaptureParams,
  CompleteWalkParams,
  CompleteWalkBody,
  CompleteWalkResponse,
  ParseWalkVoiceParams,
  ParseWalkVoiceBody,
  ParseWalkVoiceResponse,
  ApproveWalkParams,
  ApproveWalkResponse,
} from "@workspace/api-zod";
import { raiseClientCard } from "../lib/clientBoard";
import { openai, toFile } from "@workspace/integrations-openai-ai-server";
import { limits } from "../lib/rateLimit";
import { ensurePropertiesGeocoded } from "../lib/geocode";
import { completeJson } from "../lib/ai";
import { logger } from "../lib/logger";

const router: IRouter = Router();

type WalkRow = typeof walksTable.$inferSelect;
type CaptureRow = typeof walkCapturesTable.$inferSelect;

function walkDto(
  w: WalkRow,
  propertyName: string | null,
  captureCount: number,
) {
  return {
    id: w.id,
    propertyId: w.propertyId,
    propertyName,
    kind: w.kind,
    status: w.status,
    startedAt: w.startedAt.toISOString(),
    endedAt: w.endedAt ? w.endedAt.toISOString() : null,
    notes: w.notes,
    captureCount,
  };
}

function captureDto(c: CaptureRow) {
  return {
    id: c.id,
    walkId: c.walkId,
    unitNo: c.unitNo,
    storagePath: c.storagePath,
    photos: c.photos ?? (c.storagePath ? [c.storagePath] : null),
    service: c.service,
    qty: c.qty,
    unitPrice: c.unitPrice,
    note: c.note,
    lat: c.lat,
    lng: c.lng,
    createdAt: c.createdAt.toISOString(),
  };
}

async function propertyNames(): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: propertiesTable.id, name: propertiesTable.name })
    .from(propertiesTable);
  return new Map(rows.map((r) => [r.id, r.name]));
}

// The Walk app is gated by its own passcode (see /walk-auth in officeAuth.ts),
// a single shared office field credential. Walks may target ANY active
// property: the GPS locator on /walk-target picks the nearest one, and this
// default (Thornbury) is only the fallback when no coordinates are available.
// Every mutation below is rate-limited and validates that the walk's property
// still exists.
async function getWalkTargetProperty(): Promise<
  { id: string; name: string } | undefined
> {
  const [row] = await db
    .select({ id: propertiesTable.id, name: propertiesTable.name })
    .from(propertiesTable)
    .where(ilike(propertiesTable.name, "%thornbur%"))
    .limit(1);
  return row;
}

// Straight-line meters between two lat/lng points (haversine).
function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

router.get("/walk-target", async (req, res): Promise<void> => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    // Kick lazy geocoding for properties still missing coordinates, but keep
    // it OFF this request path (Nominatim is rate-limited to 1 req/sec).
    void ensurePropertiesGeocoded().catch(() => undefined);
    const props = await db
      .select({
        id: propertiesTable.id,
        name: propertiesTable.name,
        latitude: propertiesTable.latitude,
        longitude: propertiesTable.longitude,
      })
      .from(propertiesTable)
      .where(eq(propertiesTable.status, "active"));
    let best: { id: string; name: string; dist: number } | null = null;
    for (const p of props) {
      if (p.latitude == null || p.longitude == null) continue;
      const dist = distanceMeters(lat, lng, p.latitude, p.longitude);
      if (!best || dist < best.dist) best = { id: p.id, name: p.name, dist };
    }
    if (best) {
      res.json({
        propertyId: best.id,
        name: best.name,
        located: true,
        distanceM: Math.round(best.dist),
      });
      return;
    }
  }
  const target = await getWalkTargetProperty();
  if (!target) {
    res.status(404).json({ error: "Walk target property not found" });
    return;
  }
  res.json({ propertyId: target.id, name: target.name, located: false });
});

router.get("/walks", async (req, res): Promise<void> => {
  const { propertyId } = ListWalksQueryParams.parse(req.query);
  let walks = await db
    .select()
    .from(walksTable)
    .orderBy(desc(walksTable.startedAt));
  if (propertyId) walks = walks.filter((w) => w.propertyId === propertyId);
  const captures = await db
    .select({ walkId: walkCapturesTable.walkId })
    .from(walkCapturesTable);
  const counts = new Map<string, number>();
  for (const c of captures) counts.set(c.walkId, (counts.get(c.walkId) ?? 0) + 1);
  const names = await propertyNames();
  res.json(
    ListWalksResponse.parse(
      walks.map((w) =>
        walkDto(w, names.get(w.propertyId) ?? null, counts.get(w.id) ?? 0),
      ),
    ),
  );
});

router.post("/walks", limits.walkWrite, async (req, res): Promise<void> => {
  const body = CreateWalkBody.parse(req.body);
  // GPS-picked target: any real, ACTIVE property is a valid walk target.
  const [property] = await db
    .select({ id: propertiesTable.id, name: propertiesTable.name })
    .from(propertiesTable)
    .where(
      and(
        eq(propertiesTable.id, body.propertyId),
        eq(propertiesTable.status, "active"),
      ),
    );
  if (!property) {
    res.status(400).json({ error: "That property is not available for walks" });
    return;
  }
  const [row] = await db
    .insert(walksTable)
    .values({
      propertyId: property.id,
      kind: body.kind ?? "discovery",
      notes: body.notes ?? null,
    })
    .returning();
  res.status(201).json(CreateWalkResponse.parse(walkDto(row, property.name, 0)));
});

async function loadWalk(id: string): Promise<WalkRow | undefined> {
  const [walk] = await db.select().from(walksTable).where(eq(walksTable.id, id));
  if (!walk) return undefined;
  // A walk is only visible while its property still exists (walk-session
  // cookie already gates every route; walks may target any property now).
  const [prop] = await db
    .select({ id: propertiesTable.id })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, walk.propertyId));
  if (!prop) return undefined;
  return walk;
}

router.get("/walks/:id", async (req, res): Promise<void> => {
  const { id } = GetWalkParams.parse(req.params);
  const walk = await loadWalk(id);
  if (!walk) {
    res.status(404).json({ error: "Walk not found" });
    return;
  }
  const captures = await db
    .select()
    .from(walkCapturesTable)
    .where(eq(walkCapturesTable.walkId, id))
    .orderBy(desc(walkCapturesTable.createdAt));
  const names = await propertyNames();
  res.json(
    GetWalkResponse.parse({
      walk: walkDto(walk, names.get(walk.propertyId) ?? null, captures.length),
      captures: captures.map(captureDto),
      createdJobs: Array.isArray(walk.createdJobs)
        ? (walk.createdJobs as { id: string; jobNo: string; unitNo?: string | null }[])
        : [],
    }),
  );
});

router.delete("/walks/:id", limits.walkWrite, async (req, res): Promise<void> => {
  const { id } = DeleteWalkParams.parse(req.params);
  const walk = await loadWalk(id);
  if (!walk) {
    res.status(404).json({ error: "Walk not found" });
    return;
  }
  const conflict = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(walksTable)
      .where(eq(walksTable.id, id))
      .for("update");
    if (!locked || locked.status === "completed") return true;
    await tx.delete(walkCapturesTable).where(eq(walkCapturesTable.walkId, id));
    await tx.delete(walksTable).where(eq(walksTable.id, id));
    return false;
  });
  if (conflict) {
    res.status(409).json({ error: "Completed walks cannot be discarded" });
    return;
  }
  res.status(204).end();
});

router.post("/walks/:id/captures", limits.walkWrite, async (req, res): Promise<void> => {
  const { id } = AddWalkCaptureParams.parse(req.params);
  const body = AddWalkCaptureBody.parse(req.body);
  const outcome = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(walksTable)
      .where(eq(walksTable.id, id))
      .for("update");
    if (!locked) return { status: 404 as const };
    const [prop] = await tx
      .select({ id: propertiesTable.id })
      .from(propertiesTable)
      .where(eq(propertiesTable.id, locked.propertyId));
    if (!prop) return { status: 404 as const };
    if (locked.status === "completed") return { status: 409 as const };
    const [row] = await tx
      .insert(walkCapturesTable)
      .values({
        walkId: id,
        unitNo: body.unitNo?.trim() || null,
        // Multi-photo: photos[] is the source of truth; storagePath mirrors
        // the first photo so older readers keep working.
        storagePath: body.storagePath ?? body.photos?.[0] ?? null,
        photos:
          body.photos && body.photos.length > 0
            ? body.photos
            : body.storagePath
              ? [body.storagePath]
              : null,
        service: body.service?.trim() || null,
        qty: body.qty ?? null,
        unitPrice: body.unitPrice ?? null,
        note: body.note?.trim() || null,
        lat: body.lat ?? null,
        lng: body.lng ?? null,
      })
      .returning();
    return { status: 201 as const, row };
  });
  if (outcome.status === 404) {
    res.status(404).json({ error: "Walk not found" });
    return;
  }
  if (outcome.status === 409) {
    res.status(409).json({ error: "Walk already completed" });
    return;
  }
  res.status(201).json(AddWalkCaptureResponse.parse(captureDto(outcome.row)));
});

// Several service lines for ONE walk item, committed atomically — either
// every line lands or none do, so a mid-save failure can't leave a partial
// service set. Photos ride on the first line's row.
router.post("/walks/:id/captures/batch", limits.walkWrite, async (req, res): Promise<void> => {
  const { id } = AddWalkCaptureBatchParams.parse(req.params);
  const parsedBody = AddWalkCaptureBatchBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: "At least one service line is required" });
    return;
  }
  const body = parsedBody.data;
  const outcome = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(walksTable)
      .where(eq(walksTable.id, id))
      .for("update");
    if (!locked) return { status: 404 as const };
    if (locked.status === "completed") return { status: 409 as const };
    const photos = body.photos && body.photos.length > 0 ? body.photos : null;
    const rows = await tx
      .insert(walkCapturesTable)
      .values(
        body.lines.map((line, i) => ({
          walkId: id,
          unitNo: body.unitNo?.trim() || null,
          storagePath: i === 0 ? (photos?.[0] ?? null) : null,
          photos: i === 0 ? photos : null,
          service: line.service.trim() || null,
          qty: line.qty ?? null,
          unitPrice: line.unitPrice ?? null,
          note: body.note?.trim() || null,
          lat: body.lat ?? null,
          lng: body.lng ?? null,
        })),
      )
      .returning();
    return { status: 201 as const, rows };
  });
  if (outcome.status === 404) {
    res.status(404).json({ error: "Walk not found" });
    return;
  }
  if (outcome.status === 409) {
    res.status(409).json({ error: "Walk already completed" });
    return;
  }
  res
    .status(201)
    .json(AddWalkCaptureBatchResponse.parse({ captures: outcome.rows.map(captureDto) }));
});

// Hold-to-talk: transcribe a short clip and parse it into capture DRAFTS.
// Nothing is saved here — the walker confirms each prefilled item in the UI.
router.post("/walks/:id/voice-capture", limits.walkWrite, async (req, res): Promise<void> => {
  const { id } = ParseWalkVoiceParams.parse(req.params);
  const body = ParseWalkVoiceBody.parse(req.body);
  const walk = await loadWalk(id);
  if (!walk) {
    res.status(404).json({ error: "Walk not found" });
    return;
  }
  if (walk.status === "completed") {
    res.status(409).json({ error: "Walk already completed" });
    return;
  }
  // ~60s of compressed audio is well under this; reject runaway payloads.
  if (body.audioBase64.length > 8 * 1024 * 1024) {
    res.status(422).json({ error: "Recording too long — keep it under a minute" });
    return;
  }
  let audio: Buffer;
  try {
    audio = Buffer.from(body.audioBase64, "base64");
  } catch {
    res.status(422).json({ error: "Could not read the audio — try again" });
    return;
  }
  if (audio.length < 1000) {
    res.status(422).json({ error: "That was too short — hold the button while you talk" });
    return;
  }

  const ext = body.mimeType.includes("mp4") || body.mimeType.includes("m4a")
    ? "m4a"
    : body.mimeType.includes("mpeg") || body.mimeType.includes("mp3")
      ? "mp3"
      : body.mimeType.includes("ogg")
        ? "ogg"
        : body.mimeType.includes("wav")
          ? "wav"
          : "webm";
  let transcript = "";
  try {
    const result = await openai.audio.transcriptions.create({
      file: await toFile(audio, `capture.${ext}`, { type: body.mimeType }),
      model: "gpt-4o-mini-transcribe",
    });
    transcript = (result.text ?? "").trim();
  } catch (err) {
    logger.warn({ err }, "Walk voice transcription failed");
    res.status(422).json({ error: "Couldn't hear that — try again" });
    return;
  }
  if (!transcript) {
    res.status(422).json({ error: "Couldn't hear anything — hold the button and speak" });
    return;
  }

  // Parse into drafts, aligned to the property's price book where possible.
  const priceRows = await db
    .select({ service: priceItemsTable.service })
    .from(priceItemsTable)
    .where(eq(priceItemsTable.propertyId, walk.propertyId));
  const services = priceRows.map((p) => p.service);
  type Draft = { unitNo?: string | null; service?: string | null; qty?: number | null; note?: string | null };
  let items: Draft[] = [];
  try {
    const parsed = await completeJson<{ items: Draft[] }>(
      `You turn a contractor's spoken walk note into capture items. Each item: { "unitNo": string|null (unit number or area like "Gym", null if not said), "service": string|null (what work is needed), "qty": number|null (default 1), "note": string|null (extra detail) }.
The property's price-book services are: ${services.join(", ") || "none"}. When the spoken work clearly matches one of them, use the price-book service name EXACTLY as listed. Otherwise use the speaker's own short phrase.
One utterance can contain multiple items and multiple units ("unit 204 two blinds, unit 206 paint touch-up" = 2 items). Carry a spoken unit forward to following items until a new unit is named. Do not invent work that was not said. Return {"items": [...]}; return {"items": []} if nothing actionable.`,
      transcript,
      2048,
    );
    items = Array.isArray(parsed.items) ? parsed.items : [];
  } catch (err) {
    logger.warn({ err }, "Walk voice parse failed");
    res.status(422).json({ error: "Heard you, but couldn't make out the items — try again" });
    return;
  }

  res.json(
    ParseWalkVoiceResponse.parse({
      transcript,
      items: items.slice(0, 20).map((i) => ({
        unitNo: i.unitNo?.toString().trim() || null,
        service: i.service?.toString().trim() || null,
        qty: typeof i.qty === "number" && Number.isFinite(i.qty) && i.qty > 0 ? i.qty : null,
        note: i.note?.toString().trim() || null,
      })),
    }),
  );
});

router.delete("/walk-captures/:id", limits.walkWrite, async (req, res): Promise<void> => {
  const { id } = DeleteWalkCaptureParams.parse(req.params);
  const status = await db.transaction(async (tx) => {
    const [capture] = await tx
      .select()
      .from(walkCapturesTable)
      .where(eq(walkCapturesTable.id, id));
    if (!capture) return 404 as const;
    const [walk] = await tx
      .select()
      .from(walksTable)
      .where(eq(walksTable.id, capture.walkId))
      .for("update");
    if (walk) {
      const [prop] = await tx
        .select({ id: propertiesTable.id })
        .from(propertiesTable)
        .where(eq(propertiesTable.id, walk.propertyId));
      if (!prop) return 404 as const;
    }
    if (walk && walk.status === "completed") return 409 as const;
    await tx.delete(walkCapturesTable).where(eq(walkCapturesTable.id, id));
    return 204 as const;
  });
  if (status === 404) {
    res.status(404).json({ error: "Capture not found" });
    return;
  }
  if (status === 409) {
    res.status(409).json({ error: "Walk already completed" });
    return;
  }
  res.status(204).end();
});

// Completing a walk turns captures into real HALO jobs: one flex job per
// unit, price-book scopes become line items, and photos stay linked so the
// job timeline in the main app can surface them.
router.post("/walks/:id/complete", limits.walkWrite, async (req, res): Promise<void> => {
  const { id } = CompleteWalkParams.parse(req.params);
  const body = CompleteWalkBody.parse(req.body ?? {});
  // Flex deadline a week out, built from LOCAL date parts (never UTC).
  const due = new Date();
  due.setDate(due.getDate() + 7);
  const flexDueBy = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`;

  const createdJobs: {
    id: string;
    jobNo: string;
    unitNo: string | null;
    photoCount: number;
  }[] = [];

  // Everything happens inside one transaction with the walk row locked, so a
  // second concurrent completion (or a capture racing in) waits and then
  // fails deterministically with 409.
  const outcome = await db.transaction(async (tx) => {
    const [walk] = await tx
      .select()
      .from(walksTable)
      .where(eq(walksTable.id, id))
      .for("update");
    if (!walk) return { status: 404 as const };
    const [walkProp] = await tx
      .select({ id: propertiesTable.id })
      .from(propertiesTable)
      .where(eq(propertiesTable.id, walk.propertyId));
    if (!walkProp) return { status: 404 as const };
    if (walk.status === "completed")
      return { status: 409 as const, error: "Walk already completed" };
    const captures = await tx
      .select()
      .from(walkCapturesTable)
      .where(eq(walkCapturesTable.walkId, id));
    if (captures.length === 0)
      return {
        status: 409 as const,
        error: "Add at least one capture before finishing",
      };
    const [property] = await tx
      .select({ id: propertiesTable.id, name: propertiesTable.name })
      .from(propertiesTable)
      .where(eq(propertiesTable.id, walk.propertyId));

    // Server-authoritative pricing: rates come from the property's price
    // book (matched by normalized service name), not from client input.
    const priceRows = await tx
      .select()
      .from(priceItemsTable)
      .where(eq(priceItemsTable.propertyId, walk.propertyId));
    const bookRate = new Map<string, number>();
    for (const p of priceRows) {
      const key = p.service.trim().toLowerCase();
      if (!bookRate.has(key)) bookRate.set(key, p.rate);
    }

    // Group captures by unit ("" = whole property / no unit).
    const byUnit = new Map<string, CaptureRow[]>();
    for (const c of captures) {
      const key = c.unitNo?.trim() || "";
      const list = byUnit.get(key);
      if (list) list.push(c);
      else byUnit.set(key, [c]);
    }

    const kindLabel =
      walk.kind === "baseline"
        ? "Baseline walk"
        : walk.kind === "qa"
          ? "QA walk"
          : walk.kind === "completion"
            ? "Completion walk"
            : "Discovery walk";

    // Same count-based J-#### convention the other job routes use, but read
    // inside this transaction to narrow the window.
    const existingJobs = await tx.select({ id: jobsTable.id }).from(jobsTable);
    let jobSeq = 2000 + existingJobs.length;

    for (const [unitKey, unitCaptures] of byUnit) {
      jobSeq += 1;
      const jobNo = `J-${jobSeq}`;
      const scopeLines = unitCaptures
        .filter((c) => c.service)
        .map(
          (c) =>
            `• ${c.service}${c.qty && c.qty !== 1 ? ` × ${c.qty}` : ""}${c.note ? ` — ${c.note}` : ""}`,
        );
      const noteOnly = unitCaptures
        .filter((c) => !c.service && c.note)
        .map((c) => `• ${c.note}`);
      const photoCount = unitCaptures.reduce(
        (n, c) => n + (c.photos?.length ?? (c.storagePath ? 1 : 0)),
        0,
      );
      const description = [
        `${kindLabel} findings${unitKey ? ` — Unit ${unitKey}` : ""}`,
        ...scopeLines,
        ...noteOnly,
        photoCount > 0 ? `${photoCount} photo${photoCount === 1 ? "" : "s"} attached from the walk` : null,
        walk.notes ? `Walk notes: ${walk.notes}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      const [job] = await tx
        .insert(jobsTable)
        .values({
          propertyId: walk.propertyId,
          unitNo: unitKey || null,
          description,
          scheduleType: "flex",
          flexDueBy,
          jobNo,
        })
        .returning();

      // Scoped captures become line items; same service bumps qty.
      const byService = new Map<string, { service: string; qty: number; unitPrice: number | null }>();
      for (const c of unitCaptures) {
        if (!c.service) continue;
        const cur = byService.get(c.service);
        const qty = c.qty && c.qty > 0 ? c.qty : 1;
        if (cur) {
          cur.qty += qty;
          if (cur.unitPrice == null && c.unitPrice != null) cur.unitPrice = c.unitPrice;
        } else {
          byService.set(c.service, { service: c.service, qty, unitPrice: c.unitPrice ?? null });
        }
      }
      for (const li of byService.values()) {
        // Price book wins; the capture's unitPrice only covers "Other"
        // scopes that aren't in the book.
        const rate =
          bookRate.get(li.service.trim().toLowerCase()) ?? li.unitPrice ?? 0;
        await tx.insert(jobLineItemsTable).values({
          jobId: job.id,
          service: li.service,
          qty: li.qty,
          rate,
        });
      }

      // Link this unit's captures to the job so photos surface in HALO.
      for (const c of unitCaptures) {
        await tx
          .update(walkCapturesTable)
          .set({ jobId: job.id })
          .where(eq(walkCapturesTable.id, c.id));
      }

      await tx.insert(activitiesTable).values({
        entityType: "job",
        entityId: job.id,
        kind: "note",
        body: `Job ${jobNo} created from a ${kindLabel.toLowerCase()}${property ? ` at ${property.name}` : ""}`,
      });

      createdJobs.push({ id: job.id, jobNo, unitNo: unitKey || null, photoCount });
    }

    const [updated] = await tx
      .update(walksTable)
      .set({
        status: "completed",
        endedAt: new Date(),
        notes: body.notes?.trim() || walk.notes,
        createdJobs,
      })
      .where(eq(walksTable.id, id))
      .returning();
    return {
      status: 200 as const,
      updated,
      propertyName: property?.name ?? null,
      captureCount: captures.length,
    };
  });

  if (outcome.status === 404) {
    res.status(404).json({ error: "Walk not found" });
    return;
  }
  if (outcome.status === 409) {
    res.status(409).json({ error: outcome.error });
    return;
  }
  res.json(
    CompleteWalkResponse.parse({
      walk: walkDto(outcome.updated, outcome.propertyName, outcome.captureCount),
      jobs: createdJobs,
    }),
  );
});

// Approve a completed walk: push one photos card per created job to the
// client board. Idempotent — sourceType/sourceId dedupe means re-approving
// refreshes the same cards instead of duplicating them.
router.post("/walks/:id/approve", async (req, res): Promise<void> => {
  const { id } = ApproveWalkParams.parse(req.params);
  const [walk] = await db.select().from(walksTable).where(eq(walksTable.id, id));
  if (!walk) {
    res.status(404).json({ error: "Walk not found" });
    return;
  }
  if (walk.status !== "completed") {
    res.status(409).json({ error: "Finish the walk first — approve sends the created jobs to the client board." });
    return;
  }
  const created = (walk.createdJobs ?? []) as { id: string; jobNo?: string; unitNo?: string | null }[];
  if (created.length === 0) {
    res.status(409).json({ error: "This walk created no jobs to share." });
    return;
  }
  let cards = 0;
  for (const cj of created) {
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, cj.id));
    if (!job || job.propertyId !== walk.propertyId) continue;
    // Walk photos live on walk_captures (not crew photos) — build the photo
    // strip straight from this job's captures.
    const caps = await db
      .select()
      .from(walkCapturesTable)
      .where(eq(walkCapturesTable.jobId, job.id));
    const allPhotos = caps.flatMap((c) =>
      c.photos?.length ? c.photos : c.storagePath ? [c.storagePath] : [],
    );
    // Aggregate captures by service → line items the PM can review.
    const serviceMap = new Map<string, { qty: number; rate: number | null }>();
    for (const c of caps) {
      const svc = (c.service ?? "General").trim();
      const existing = serviceMap.get(svc);
      serviceMap.set(svc, {
        qty: (existing?.qty ?? 0) + (typeof (c as any).qty === "number" ? (c as any).qty : 1),
        rate: existing?.rate ?? (typeof (c as any).unitPrice === "number" ? (c as any).unitPrice : null),
      });
    }
    const lineItems = Array.from(serviceMap.entries()).map(([service, v]) => ({
      service,
      qty: v.qty,
      rate: v.rate,
    }));
    // Flat service names for the card body summary.
    const services = lineItems.map((li) => li.service);
    const module = {
      type: "photos",
      jobId: job.id,
      jobNo: job.jobNo,
      unitNo: job.unitNo ?? null,
      totalCount: allPhotos.length,
      photoUrls: allPhotos.slice(0, 12).map((p) => `/api/storage${p}`),
      phases: [],
      // Line items let the PM review the scope of work per service.
      lineItems,
      walkNotes: (walk as any).notes ?? null,
      // Client-side Approve: the PM taps Approve All from their board,
      // which moves this job into the work queue with a gold glow.
      canApprove: true,
    };
    const title = job.unitNo ? `Walk findings — Unit ${job.unitNo}` : "Walk findings";
    const bodyText = [
      services.length > 0 ? `Scope: ${services.slice(0, 6).join(", ")}${services.length > 6 ? "…" : ""}` : null,
      allPhotos.length > 0 ? `${allPhotos.length} photo${allPhotos.length === 1 ? "" : "s"} from the walk` : null,
      `Job ${job.jobNo} has been opened for this work.`,
    ]
      .filter(Boolean)
      .join(" · ");
    const card = await raiseClientCard({
      propertyId: walk.propertyId,
      kind: "photos",
      module,
      title,
      body: bodyText,
      actionLabel: null,
      amount: null,
      dueDate: null,
      links: [],
      sourceType: "walk_job",
      sourceId: job.id,
      jobId: job.id,
    });
    if (card) cards += 1;
  }
  res.json(ApproveWalkResponse.parse({ cards }));
});

export default router;
