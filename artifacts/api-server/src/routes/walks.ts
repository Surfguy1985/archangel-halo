import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
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
  AddWalkCaptureResponse,
  DeleteWalkCaptureParams,
  CompleteWalkParams,
  CompleteWalkBody,
  CompleteWalkResponse,
} from "@workspace/api-zod";

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

router.post("/walks", async (req, res): Promise<void> => {
  const body = CreateWalkBody.parse(req.body);
  const [property] = await db
    .select({ id: propertiesTable.id, name: propertiesTable.name })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, body.propertyId));
  if (!property) {
    res.status(400).json({ error: "Property not found" });
    return;
  }
  const [row] = await db
    .insert(walksTable)
    .values({
      propertyId: body.propertyId,
      kind: body.kind ?? "discovery",
      notes: body.notes ?? null,
    })
    .returning();
  res.status(201).json(CreateWalkResponse.parse(walkDto(row, property.name, 0)));
});

async function loadWalk(id: string): Promise<WalkRow | undefined> {
  const [walk] = await db.select().from(walksTable).where(eq(walksTable.id, id));
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

router.delete("/walks/:id", async (req, res): Promise<void> => {
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

router.post("/walks/:id/captures", async (req, res): Promise<void> => {
  const { id } = AddWalkCaptureParams.parse(req.params);
  const body = AddWalkCaptureBody.parse(req.body);
  const outcome = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(walksTable)
      .where(eq(walksTable.id, id))
      .for("update");
    if (!locked) return { status: 404 as const };
    if (locked.status === "completed") return { status: 409 as const };
    const [row] = await tx
      .insert(walkCapturesTable)
      .values({
        walkId: id,
        unitNo: body.unitNo?.trim() || null,
        storagePath: body.storagePath ?? null,
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

router.delete("/walk-captures/:id", async (req, res): Promise<void> => {
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
router.post("/walks/:id/complete", async (req, res): Promise<void> => {
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
      const photoCount = unitCaptures.filter((c) => c.storagePath).length;
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

export default router;
