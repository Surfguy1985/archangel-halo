import { Router, type IRouter } from "express";
import { randomBytes } from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  jobsTable,
  crewsTable,
  jobBroadcastsTable,
  schedulesTable,
  propertiesTable,
  priceItemsTable,
  activitiesTable,
  invoicesTable,
  expensesTable,
  jobLineItemsTable,
  clientCardCommentsTable,
  clientDashboardCardsTable,
  crewMessagesTable,
  crewPhotosTable,
  paymentRequestsTable,
  paymentRequestJobsTable,
} from "@workspace/db";
import { threadKeysFor, notifyClientBoard } from "./clientBoard";
import { emitBoardEvent } from "../lib/boardEvents";
import { syncExpenseLedger } from "../lib/ledger";
import { recomputeJobFinancials } from "../lib/jobFinance";
import {
  ListJobBoardResponse,
  BroadcastJobParams,
  BroadcastJobBody,
  BroadcastJobResponse,
  ReopenJobParams,
  ReopenJobResponse,
  UnlistJobParams,
  UnlistJobResponse,
  UpdateBoardSettingsParams,
  UpdateBoardSettingsBody,
  UpdateBoardSettingsResponse,
  GetPhotoLibraryResponse,
  AssignPhotosToJobParams,
  AssignPhotosToJobBody,
  AssignPhotosToJobResponse,
} from "@workspace/api-zod";
import { ser } from "../lib/serialize";
import { completeJsonWithImages } from "../lib/ai";
import { ObjectStorageService } from "../lib/objectStorage";
import { rateLimit } from "../lib/rateLimit";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// AI quality check — compares a job's before/after photos, verdict pass|fail.
// ---------------------------------------------------------------------------
const IMAGE_TYPES: Record<string, "image/jpeg" | "image/png" | "image/webp" | "image/gif"> = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "image/gif": "image/gif",
};

// Expensive AI endpoint — cap per job+IP so rapid clicks can't fan out spend.
const qualityCheckLimit = rateLimit({
  limit: 4,
  windowMs: 60_000,
  key: (req) => `quality-check:${req.params.id}:${(req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown"}`,
});

router.post("/jobs/:id/quality-check", qualityCheckLimit, async (req, res): Promise<void> => {
  try {
    const [job] = await db
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.id, String(req.params.id)));
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const acts = await db
      .select()
      .from(activitiesTable)
      .where(
        and(
          eq(activitiesTable.entityType, "job"),
          eq(activitiesTable.entityId, job.id),
        ),
      )
      .orderBy(desc(activitiesTable.createdAt));
    const befores = acts.filter((a) => a.kind === "photo_before" && a.storagePath);
    const afters = acts.filter((a) => a.kind === "photo_after" && a.storagePath);
    if (afters.length === 0) {
      res.status(400).json({
        error: "No after photos on this job yet — the crew hasn't uploaded finished-work photos.",
      });
      return;
    }

    // Cap the photo set so requests stay small: up to 4 of each phase.
    const storage = new ObjectStorageService();
    const picks = [
      ...befores.slice(0, 4).map((a, i) => ({ a, label: `BEFORE photo ${i + 1}` })),
      ...afters.slice(0, 4).map((a, i) => ({ a, label: `AFTER photo ${i + 1}` })),
    ];
    const images: { label: string; base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" }[] = [];
    for (const { a, label } of picks) {
      try {
        const file = await storage.getObjectEntityFile(a.storagePath!);
        const [meta] = await file.getMetadata();
        // Skip unsupported types instead of mislabeling them — mislabeled
        // payloads make the model error and burn retries.
        const mediaType = IMAGE_TYPES[String(meta.contentType || "").toLowerCase()];
        if (!mediaType) continue;
        // Skip anything over ~8MB — base64 inflation would blow the request.
        if (Number(meta.size ?? 0) > 8 * 1024 * 1024) continue;
        const [buf] = await file.download();
        images.push({ label, base64: buf.toString("base64"), mediaType });
      } catch {
        // Skip photos that can't be read; the check runs on what loads.
      }
    }
    if (!images.some((i) => i.label.startsWith("AFTER"))) {
      res.status(400).json({ error: "Could not load the after photos for this job." });
      return;
    }

    const result = await completeJsonWithImages<{ verdict: string; summary: string }>(
      "You are a strict but fair quality inspector for a property maintenance company. " +
        "You are shown BEFORE photos (state when the crew arrived, may be absent) and AFTER photos (finished work). " +
        "Verdict rules: PASS only if the after photos show the work completed to a professional standard — clean, finished, no visible damage, debris, or obviously incomplete areas. " +
        "FAIL if work looks unfinished, sloppy, dirty, damaged, or the after photos are too unclear to judge.",
      `Job: ${job.jobNo}${job.category ? ` (${job.category})` : ""}${job.unitNo ? `, unit ${job.unitNo}` : ""}. ` +
        `Scope of work: ${job.description || "not specified"}. ` +
        `Return JSON: {"verdict": "pass" | "fail", "summary": "<1-2 sentences explaining the verdict in plain language>"}`,
      images,
    );
    const verdict = result.verdict === "pass" ? "pass" : "fail";
    // Passing the AI check finishes the card — move it straight to Done.
    if (verdict === "pass") {
      await db
        .update(jobsTable)
        .set({ boardStatus: "completed" })
        .where(eq(jobsTable.id, job.id));
      emitBoardEvent(job.propertyId);
    }
    res.json({
      verdict,
      summary: result.summary || (verdict === "pass" ? "Work looks complete." : "Work needs a manual look."),
      beforeCount: befores.length,
      afterCount: afters.length,
    });
  } catch (err) {
    console.error("quality-check failed", err);
    res.status(500).json({ error: "Quality check failed — try again in a moment." });
  }
});

router.get("/job-board", async (_req, res): Promise<void> => {
  const [jobs, props, priceItems, broadcasts, crews, invoices, lineItems, photoActs, payRequests, payReqJobs] =
    await Promise.all([
      db.select().from(jobsTable).orderBy(desc(jobsTable.createdAt)),
      db.select().from(propertiesTable),
      db.select().from(priceItemsTable),
      db.select().from(jobBroadcastsTable).orderBy(desc(jobBroadcastsTable.sentAt)),
      db.select().from(crewsTable),
      db.select().from(invoicesTable).orderBy(desc(invoicesTable.createdAt)),
      db.select().from(jobLineItemsTable),
      db
        .select()
        .from(activitiesTable)
        .where(eq(activitiesTable.entityType, "job"))
        .orderBy(desc(activitiesTable.createdAt)),
      db.select().from(paymentRequestsTable).orderBy(desc(paymentRequestsTable.createdAt)),
      db.select().from(paymentRequestJobsTable),
    ]);

  // Client board placements: where the property moved each job's card on
  // their board. Surfaced on the vendor board so office sees client intent.
  const laneOverrides = await db
    .select({
      propertyId: clientDashboardCardsTable.propertyId,
      cardKey: clientDashboardCardsTable.cardKey,
      lane: clientDashboardCardsTable.lane,
    })
    .from(clientDashboardCardsTable)
    .where(eq(clientDashboardCardsTable.kind, "override"));
  const clientLaneByJob = new Map<string, string>();
  for (const o of laneOverrides) {
    if (o.lane && o.cardKey.startsWith("job:"))
      clientLaneByJob.set(o.cardKey.slice("job:".length), o.lane);
  }

  const propsById = new Map(props.map((p) => [p.id, p]));
  const crewsById = new Map(crews.map((c) => [c.id, c]));
  const priceByProp = new Map<string, typeof priceItems>();
  for (const pi of priceItems) {
    const list = priceByProp.get(pi.propertyId) ?? [];
    list.push(pi);
    priceByProp.set(pi.propertyId, list);
  }
  const photosByJob = new Map<string, { kind: string | null; storagePath: string }[]>();
  for (const a of photoActs) {
    if (!a.storagePath) continue;
    if (a.kind !== "photo_before" && a.kind !== "photo_after") continue;
    const list = photosByJob.get(a.entityId) ?? [];
    list.push({ kind: a.kind, storagePath: a.storagePath });
    photosByJob.set(a.entityId, list);
  }
  // Newest invoice per job — powers the billing-rail pay flow on the board.
  const invoiceByJob = new Map<string, (typeof invoices)[number]>();
  for (const inv of invoices) {
    if (!inv.jobId || invoiceByJob.has(inv.jobId)) continue;
    invoiceByJob.set(inv.jobId, inv);
  }
  // Distinct service names per job from its line items — the tile pill shows
  // the exact work sold, not a generic category.
  const itemsByJob = new Map<string, typeof lineItems>();
  for (const li of lineItems) {
    const list = itemsByJob.get(li.jobId) ?? [];
    list.push(li);
    itemsByJob.set(li.jobId, list);
  }
  const servicesByJob = new Map<string, string[]>();
  for (const li of lineItems) {
    if (!li.service || li.service === "Quoted price") continue;
    const list = servicesByJob.get(li.jobId) ?? [];
    if (!list.includes(li.service)) list.push(li.service);
    servicesByJob.set(li.jobId, list);
  }
  const broadcastsByJob = new Map<string, typeof broadcasts>();
  for (const b of broadcasts) {
    const list = broadcastsByJob.get(b.jobId) ?? [];
    list.push(b);
    broadcastsByJob.set(b.jobId, list);
  }

  // Payment requests: prefer per-job link (payment_request_jobs table) then
  // fall back to newest active request for the job's property.
  const payReqById = new Map(payRequests.map((r) => [r.id, r]));
  // Map jobId → requestId from the join table (newest wins for same job).
  const payReqIdByJob = new Map<string, string>();
  for (const prj of payReqJobs) {
    if (prj.jobId && prj.requestId && !payReqIdByJob.has(prj.jobId)) {
      payReqIdByJob.set(prj.jobId, prj.requestId);
    }
  }
  // Newest non-paid active request per property (fallback).
  const activePayReqByProp = new Map<string, (typeof payRequests)[number]>();
  for (const r of payRequests) {
    if (r.status === "returned") continue;
    if (!activePayReqByProp.has(r.propertyId)) {
      activePayReqByProp.set(r.propertyId, r);
    }
  }

  const cards = jobs.filter((j) => j.boardStatus !== "removed").map((j) => {
    const prop = propsById.get(j.propertyId);
    const boardStatus =
      j.status === "complete" ? "completed" : (j.boardStatus ?? "active");
    return {
      job: {
        ...ser(j),
        boardStatus,
        propertyName: prop?.name ?? null,
        crewLeaderName: j.crewLeaderId
          ? (crewsById.get(j.crewLeaderId)?.name ?? null)
          : null,
        services: servicesByJob.get(j.id) ?? null,
      },
      clientLane: clientLaneByJob.get(j.id) ?? null,
      invoice: (() => {
        const inv = invoiceByJob.get(j.id);
        if (!inv) return null;
        return {
          id: inv.id,
          invoiceNo: inv.invoiceNo,
          total: inv.amount + (inv.taxAmount ?? 0),
          status: inv.status,
          paymentChoice: inv.paymentChoice ?? null,
          paymentChoicePlatform: inv.paymentChoicePlatform ?? null,
          paidAt: inv.paidAt ? inv.paidAt.toISOString() : null,
          clientPaidReportedAt: inv.clientPaidReportedAt
            ? inv.clientPaidReportedAt.toISOString()
            : null,
        };
      })(),
      priceItems: (priceByProp.get(j.propertyId) ?? []).map((pi) => ser(pi)),
      lineItems: (itemsByJob.get(j.id) ?? []).map((li) => ({
        ...ser(li),
        amount: Math.round(li.rate * li.qty * 100) / 100,
        assignedCrewName: li.assignedCrewId
          ? (crewsById.get(li.assignedCrewId)?.name ?? null)
          : null,
      })),
      photos: photosByJob.get(j.id) ?? [],
      broadcasts: (broadcastsByJob.get(j.id) ?? [])
        .filter((b) => b.status !== "withdrawn")
        .map((b) => ({
          id: b.id,
          crewId: b.crewId,
          crewName: crewsById.get(b.crewId)?.name ?? "Unknown crew",
          trade: crewsById.get(b.crewId)?.trade ?? null,
          status: b.status,
          sentAt: b.sentAt ? b.sentAt.toISOString() : null,
          respondedAt: b.respondedAt ? b.respondedAt.toISOString() : null,
        })),
      paymentRequest: (() => {
        // Per-job link takes priority; fall back to newest property-level request.
        const reqId = payReqIdByJob.get(j.id);
        const req = reqId ? (payReqById.get(reqId) ?? null) : (activePayReqByProp.get(j.propertyId) ?? null);
        if (!req) return null;
        return {
          id: req.id,
          requestNo: req.requestNo,
          total: req.total,
          status: req.status,
          memo: req.memo ?? null,
          sentAt: req.sentAt ? req.sentAt.toISOString() : null,
          paidAt: req.paidAt ? req.paidAt.toISOString() : null,
        };
      })(),
    };
  });

  res.json(ListJobBoardResponse.parse(cards));
});

// "Client says the check is on its way" follow-up: posts an office message
// into the invoice card's thread on the client board asking the property to
// verify the payment was actually sent. Used from the Alerts rail after the
// reported payment has sat unverified for 7+ days.
router.post("/job-board/:jobId/check-followup", async (req, res): Promise<void> => {
  try {
  const jobId = String(req.params.jobId);
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const invoices = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.jobId, jobId))
    .orderBy(desc(invoicesTable.createdAt));
  const inv = invoices[0];
  if (!inv) {
    res.status(404).json({ error: "No invoice on this job" });
    return;
  }
  if (!inv.clientPaidReportedAt || inv.status === "paid") {
    res.status(409).json({ error: "This invoice isn't waiting on a reported check" });
    return;
  }
  const reportedOn = inv.clientPaidReportedAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const { canonical } = await threadKeysFor(inv.propertyId, `invoice:${inv.id}`);
  await db.insert(clientCardCommentsTable).values({
    propertyId: inv.propertyId,
    cardKey: canonical,
    authorType: "office",
    authorName: "Archangel Office",
    body: `Following up on invoice ${inv.invoiceNo} ($${(inv.amount + (inv.taxAmount ?? 0)).toFixed(2)}): payment was marked as sent on your side on ${reportedOn}, but we haven't received the check yet. Could you verify it was mailed, and let us know the check number or date sent? Thank you!`,
  });
  await notifyClientBoard(
    inv.propertyId,
    "comment",
    "New reply from Archangel",
    `Please verify the check for invoice ${inv.invoiceNo} was sent — we haven't received it yet.`,
    canonical,
  );
  emitBoardEvent(inv.propertyId, "dashboard");
  await db.insert(activitiesTable).values({
    kind: "note",
    body: `Check follow-up sent for ${inv.invoiceNo} — client reported paid ${reportedOn}, not yet received`,
    entityType: "invoice",
    entityId: inv.id,
  });
  res.json({ ok: true });
  } catch (err) {
    console.error("check-followup failed", err);
    if (!res.headersSent) res.status(500).json({ error: "Couldn't send the follow-up" });
  }
});

router.post("/jobs/:id/broadcast", async (req, res): Promise<void> => {
  const { id } = BroadcastJobParams.parse(req.params);
  const body = BroadcastJobBody.parse(req.body);

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (job.status === "complete" || job.boardStatus === "completed") {
    res.status(409).json({ error: "Job is already completed" });
    return;
  }

  const crews = await db
    .select()
    .from(crewsTable)
    .where(eq(crewsTable.active, true));

  // Specialty broadcast: each crew is offered only the line items whose
  // service matches their specialty profile (crews.services names, with the
  // trade field as a fallback). Staggered start times ride on the offer.
  if (body.mode === "specialties") {
    const items = await db
      .select()
      .from(jobLineItemsTable)
      .where(eq(jobLineItemsTable.jobId, id));
    const openItems = items.filter((li) => !li.completedAt);
    if (openItems.length === 0) {
      res.status(400).json({ error: "This job has no line items to match specialties against" });
      return;
    }
    // Persist per-item staggered start times first, so offers and the crew
    // checklist show the same times.
    const timeById = new Map(
      (body.itemTimes ?? []).map((t) => [t.lineItemId, t.startTime?.trim() || null]),
    );
    for (const li of openItems) {
      if (timeById.has(li.id)) {
        const startTime = timeById.get(li.id) ?? null;
        if (startTime !== (li.startTime ?? null)) {
          await db
            .update(jobLineItemsTable)
            .set({ startTime })
            .where(eq(jobLineItemsTable.id, li.id));
          li.startTime = startTime;
        }
      }
    }
    // Match each service to crews. Already-assigned items only go to their
    // assigned crew; unassigned items go to every specialty match.
    const perCrew = new Map<string, { services: string[]; startTime: string | null }>();
    const unmatched: string[] = [];
    for (const li of openItems) {
      const matches = li.assignedCrewId
        ? crews.filter((c) => c.id === li.assignedCrewId)
        : crews.filter((c) => crewCoversService(c, li.service));
      if (matches.length === 0) {
        unmatched.push(li.service);
        continue;
      }
      for (const c of matches) {
        const cur = perCrew.get(c.id) ?? { services: [], startTime: null };
        if (!cur.services.includes(li.service)) cur.services.push(li.service);
        // Earliest start wins when one crew covers several services.
        if (li.startTime && (!cur.startTime || li.startTime < cur.startTime)) {
          cur.startTime = li.startTime;
        }
        perCrew.set(c.id, cur);
      }
    }
    if (perCrew.size === 0) {
      res.status(400).json({
        error:
          "No active crew has these services in their specialty profile. Add the services to crew profiles or broadcast to everyone.",
      });
      return;
    }
    const result = await sendBroadcasts(
      job,
      crews.filter((c) => perCrew.has(c.id)),
      body,
      (crewId) => perCrew.get(crewId) ?? null,
    );
    res.json(
      BroadcastJobResponse.parse({ ...result, unmatchedServices: [...new Set(unmatched)] }),
    );
    return;
  }

  let targets = crews;
  if (body.mode === "trade") {
    const wanted = (body.trade ?? "").trim().toLowerCase();
    if (!wanted) {
      res.status(400).json({ error: "Select a trade to broadcast to" });
      return;
    }
    targets = crews.filter((c) => (c.trade ?? "").trim().toLowerCase() === wanted);
  } else if (body.mode === "crews") {
    const ids = new Set(body.crewIds ?? []);
    if (ids.size === 0) {
      res.status(400).json({ error: "Select at least one crew" });
      return;
    }
    targets = crews.filter((c) => ids.has(c.id));
  }

  if (targets.length === 0) {
    res.status(400).json({ error: "No matching active crews to broadcast to" });
    return;
  }

  const result = await sendBroadcasts(job, targets, body, () => null);
  res.json(BroadcastJobResponse.parse(result));
});

/** Normalize a service/specialty name for matching: lowercase alphanumeric tokens. */
function serviceTokens(s: string): string[] {
  return s
    .toLowerCase()
    // Drop bedroom sizing so "Cabinet Paint — 2 BR" matches specialty "Cabinet Paint".
    .replace(/\d\s*br\b/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

/**
 * Does this crew's specialty profile cover the service? A crew covers a
 * service when one of their profile service names (or their trade) shares
 * a containment relationship with the line item's service tokens.
 */
function crewCoversService(
  crew: typeof crewsTable.$inferSelect,
  service: string,
): boolean {
  const want = serviceTokens(service);
  if (want.length === 0) return false;
  const profiles: string[] = [];
  if (Array.isArray(crew.services)) {
    for (const s of crew.services as { name?: unknown }[]) {
      if (typeof s?.name === "string") profiles.push(s.name);
    }
  }
  if (crew.trade) profiles.push(crew.trade);
  return profiles.some((p) => {
    const have = serviceTokens(p);
    if (have.length === 0) return false;
    // Either direction: specialty "Cleaning" covers "Deep Cleaning" and
    // specialty "Full Make Ready" covers item "Make Ready".
    return (
      want.every((t) => have.includes(t)) || have.every((t) => want.includes(t))
    );
  });
}

/**
 * Shared broadcast writer: sets posting terms on the job, then creates or
 * revives one offer row per (job, crew). `metaFor` supplies the specialty
 * payload (forServices + startTime) for specialty-mode sends; other modes
 * pass () => null and clear any prior specialty scoping on rebroadcast.
 */
async function sendBroadcasts(
  job: typeof jobsTable.$inferSelect,
  targets: (typeof crewsTable.$inferSelect)[],
  body: { scheduleType?: string; flexDays?: number; crewsNeeded?: number },
  metaFor: (crewId: string) => { services: string[]; startTime: string | null } | null,
) {
  const id = job.id;
  // Posting terms: schedule type, flex deadline, and crew slots — set at broadcast time.
  const scheduleType = body.scheduleType === "flex" ? "flex" : "scheduled";
  const crewsNeeded = Math.max(1, Math.round(body.crewsNeeded ?? job.crewsNeeded ?? 1));
  let flexDueBy: string | null = null;
  if (scheduleType === "flex") {
    const days = Math.max(1, Math.round(body.flexDays ?? 7));
    const due = new Date();
    due.setDate(due.getDate() + days);
    flexDueBy = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`;
  }
  await db
    .update(jobsTable)
    .set({ scheduleType, flexDueBy, crewsNeeded })
    .where(eq(jobsTable.id, id));

  const existing = await db
    .select()
    .from(jobBroadcastsTable)
    .where(
      and(
        eq(jobBroadcastsTable.jobId, id),
        inArray(
          jobBroadcastsTable.crewId,
          targets.map((c) => c.id),
        ),
      ),
    );
  const activeExisting = new Set(
    existing
      .filter((b) => b.status === "pending" || b.status === "approved")
      .map((b) => b.crewId),
  );

  const toSend = targets.filter((c) => !activeExisting.has(c.id));
  const sentNames: string[] = [];
  // Crews with a resolved offer (declined/withdrawn) get their existing row
  // reset to pending instead of a duplicate row per (job, crew).
  const resolvedExisting = new Map(
    existing
      .filter((b) => b.status === "declined" || b.status === "withdrawn")
      .map((b) => [b.crewId, b.id]),
  );

  // Crews that already hold a live offer keep it, but its specialty scope and
  // start time must reflect THIS broadcast — otherwise a rebroadcast in a
  // different mode leaves stale forServices/startTime on the offer.
  for (const b of existing) {
    if (b.status !== "pending" && b.status !== "approved") continue;
    const meta = metaFor(b.crewId);
    const forServices = meta && meta.services.length > 0 ? meta.services : null;
    const startTime = meta?.startTime ?? null;
    const prevServices = Array.isArray(b.forServices) ? (b.forServices as string[]) : null;
    if (
      JSON.stringify(prevServices) !== JSON.stringify(forServices) ||
      (b.startTime ?? null) !== startTime
    ) {
      await db
        .update(jobBroadcastsTable)
        .set({ forServices, startTime })
        .where(eq(jobBroadcastsTable.id, b.id));
    }
  }

  for (const crew of toSend) {
    // Every recipient needs a live link — mint one if the crew doesn't have it yet.
    if (!crew.portalToken) {
      const token = randomBytes(24).toString("base64url");
      await db
        .update(crewsTable)
        .set({ portalToken: token })
        .where(eq(crewsTable.id, crew.id));
    }
    const meta = metaFor(crew.id);
    const forServices = meta && meta.services.length > 0 ? meta.services : null;
    const startTime = meta?.startTime ?? null;
    const priorId = resolvedExisting.get(crew.id);
    if (priorId) {
      await db
        .update(jobBroadcastsTable)
        .set({
          status: "pending",
          sentAt: new Date(),
          respondedAt: null,
          forServices,
          startTime,
        })
        .where(eq(jobBroadcastsTable.id, priorId));
    } else {
      // Upsert against the (job, crew) unique index so concurrent broadcasts
      // can't create duplicate offer rows.
      await db
        .insert(jobBroadcastsTable)
        .values({
          jobId: id,
          crewId: crew.id,
          status: "pending",
          forServices,
          startTime,
        })
        .onConflictDoUpdate({
          target: [jobBroadcastsTable.jobId, jobBroadcastsTable.crewId],
          set: {
            status: "pending",
            sentAt: new Date(),
            respondedAt: null,
            forServices,
            startTime,
          },
        });
    }
    sentNames.push(crew.name);
  }

  if (
    toSend.length > 0 &&
    (job.boardStatus === "reopened" || job.boardStatus === "removed")
  ) {
    await db
      .update(jobsTable)
      .set({ boardStatus: "active" })
      .where(eq(jobsTable.id, id));
    emitBoardEvent(job.propertyId);
  }

  return {
    sent: toSend.length,
    alreadySent: targets.length - toSend.length,
    crewNames: sentNames,
  };
}

// Move a board card between rails: manual_check → Alerts, completed → Done.
router.post("/jobs/:id/board-status", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const boardStatus = String(req.body?.boardStatus ?? "");
  if (boardStatus !== "manual_check" && boardStatus !== "completed") {
    res.status(400).json({ error: "boardStatus must be manual_check or completed" });
    return;
  }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const [updated] = await db
    .update(jobsTable)
    .set({ boardStatus })
    .where(eq(jobsTable.id, id))
    .returning();
  emitBoardEvent(job.propertyId);
  res.json(ser(updated));
});

// ---------------------------------------------------------------------------
// Crew pay flow — office pays each crew member from the billing card, then
// manually clears each "pay pending" row from the Alerts rail to history.
// ---------------------------------------------------------------------------
type CrewPayEntry = {
  crewId: string;
  name: string;
  amount: number;
  paidAt: string | null;
  clearedAt: string | null;
};

function crewPayList(job: { crewPay: unknown }): CrewPayEntry[] {
  return Array.isArray(job.crewPay) ? (job.crewPay as CrewPayEntry[]) : [];
}

/** Leader + active teammates for a job — the roster that has to be paid. */
async function jobCrewRoster(job: { crewLeaderId: string | null }) {
  if (!job.crewLeaderId) return [];
  const crews = await db.select().from(crewsTable);
  const leader = crews.find((c) => c.id === job.crewLeaderId);
  if (!leader) return [];
  const team = crews.filter(
    (c) => c.leaderId === leader.id && c.active !== false,
  );
  return [leader, ...team];
}

router.post("/jobs/:id/crew-pay", async (req, res): Promise<void> => {
  try {
    const id = String(req.params.id);
    const crewId = String(req.body?.crewId ?? "");
    const amount = Number(req.body?.amount);
    if (!crewId || !Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: "crewId and a positive amount are required" });
      return;
    }
    // Transactional with a row lock so two concurrent pays for the same crew
    // member can't both pass the "already paid" check and double-book money.
    const result = await db.transaction(async (tx) => {
      const [job] = await tx
        .select()
        .from(jobsTable)
        .where(eq(jobsTable.id, id))
        .for("update");
      if (!job) return { status: 404 as const, error: "Job not found" };
      // Cash-control: crews get paid out of the client's payment. The linked
      // invoice must actually be paid before any crew payout goes out.
      if (job.id) {
        const [inv] = await tx
          .select()
          .from(invoicesTable)
          .where(eq(invoicesTable.jobId, job.id))
          .orderBy(desc(invoicesTable.createdAt))
          .limit(1);
        if (!inv) return { status: 409 as const, error: "No invoice on this job yet — create and collect it first" };
        if (inv.status !== "paid" && !inv.paidAt) {
          return { status: 409 as const, error: "Client payment hasn't been received yet — mark the invoice paid first" };
        }
      }
      const roster = await jobCrewRoster(job);
      const crew = roster.find((c) => c.id === crewId);
      if (!crew) return { status: 400 as const, error: "That crew member is not on this job" };
      const entries = crewPayList(job);
      if (entries.find((e) => e.crewId === crewId && e.paidAt)) {
        return { status: 409 as const, error: `${crew.name} is already marked paid` };
      }
      // Crew pay lands on the books as an approved labor expense — job
      // financials and the ledger pick it up like any other crew cost.
      const [exp] = await tx
        .insert(expensesTable)
        .values({
          jobId: job.id,
          propertyId: job.propertyId,
          vendor: crew.name,
          category: "crew labor",
          amount: Math.round(amount * 100) / 100,
          source: "job_board_pay",
          paymentStatus: "paid",
          paidAt: new Date(),
          approvalStatus: "approved",
          approvedAt: new Date(),
        })
        .returning();
      const next = entries.filter((e) => e.crewId !== crewId);
      next.push({
        crewId,
        name: crew.name,
        amount: Math.round(amount * 100) / 100,
        paidAt: new Date().toISOString(),
        clearedAt: null,
      });
      // Every roster member paid → the card moves to Alerts until each row is
      // manually cleared.
      const allPaid = roster.every((c) =>
        next.find((e) => e.crewId === c.id && e.paidAt),
      );
      const [updated] = await tx
        .update(jobsTable)
        .set({ crewPay: next, ...(allPaid ? { boardStatus: "pay_alert" } : {}) })
        .where(eq(jobsTable.id, job.id))
        .returning();
      await tx.insert(activitiesTable).values({
        entityType: "job",
        entityId: job.id,
        kind: "note",
        body: `Crew pay recorded — ${crew.name} paid ${amount.toLocaleString("en-US", { style: "currency", currency: "USD" })} for Job ${job.jobNo}`,
      });
      return { status: 200 as const, updated, expenseId: exp.id };
    });
    if (result.status !== 200) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    // Derived books after the durable state change — safe to re-run if a
    // retry hits, both are idempotent rebuild-style syncs.
    await syncExpenseLedger(result.expenseId);
    await recomputeJobFinancials(id);
    emitBoardEvent(result.updated.propertyId);
    // Let the crew know on their live portal link — payment is on its way.
    // Never fail the payout over the courtesy message.
    try {
      const job = result.updated;
      const [crew] = await db.select().from(crewsTable).where(eq(crewsTable.id, crewId));
      if (crew) {
        const [prop] = await db
          .select()
          .from(propertiesTable)
          .where(eq(propertiesTable.id, job.propertyId));
        const amt = Number(req.body?.amount).toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
        });
        const via = crew.preferredPaymentMethod ? ` via ${crew.preferredPaymentMethod}` : "";
        const where = [prop?.name, job.unitNo ? `Unit ${job.unitNo}` : null]
          .filter(Boolean)
          .join(" · ");
        const today = new Date().toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        await db.insert(crewMessagesTable).values({
          crewId: crew.id,
          sender: "admin",
          body: `Your payment of ${amt} for Job ${job.jobNo}${where ? ` (${where})` : ""} has been sent${via} — ${today}. Thank you for the work!`,
        });
      }
    } catch (msgErr) {
      console.error("crew pay message failed", msgErr);
    }
    res.json(ser(result.updated));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || "Crew pay failed" });
  }
});

router.post("/jobs/:id/crew-pay/clear", async (req, res): Promise<void> => {
  try {
    const id = String(req.params.id);
    const crewId = String(req.body?.crewId ?? "");
    // Same lock discipline as crew-pay: concurrent clears must not race the
    // "all cleared → removed" transition or double-fire the history snapshot.
    const result = await db.transaction(async (tx) => {
      const [job] = await tx
        .select()
        .from(jobsTable)
        .where(eq(jobsTable.id, id))
        .for("update");
      if (!job) return { status: 404 as const, error: "Job not found" };
      const entries = crewPayList(job);
      const entry = entries.find((e) => e.crewId === crewId && e.paidAt);
      if (!entry) return { status: 400 as const, error: "That crew member has not been paid yet" };
      if (entry.clearedAt) return { status: 409 as const, error: "Already cleared" };
      entry.clearedAt = new Date().toISOString();
      const roster = await jobCrewRoster(job);
      const allCleared =
        roster.length > 0 &&
        roster.every((c) =>
          entries.find((e) => e.crewId === c.id && e.paidAt && e.clearedAt),
        );
      const [updated] = await tx
        .update(jobsTable)
        .set({
          crewPay: entries,
          // Last clear sends the card to history — off the board for good.
          ...(allCleared
            ? { boardStatus: "removed", clearedAt: new Date() }
            : {}),
        })
        .where(eq(jobsTable.id, job.id))
        .returning();
      if (allCleared) {
        const totals = entries
          .map((e) => `${e.name} ${e.amount.toLocaleString("en-US", { style: "currency", currency: "USD" })}`)
          .join(", ");
        await tx.insert(activitiesTable).values({
          entityType: "job",
          entityId: job.id,
          kind: "note",
          body: `Job ${job.jobNo} cleared to history — crew pay settled (${totals})`,
        });
      }
      return { status: 200 as const, updated };
    });
    if (result.status !== 200) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    emitBoardEvent(result.updated.propertyId);
    res.json(ser(result.updated));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || "Clear failed" });
  }
});

router.post("/jobs/:id/board-settings", async (req, res): Promise<void> => {
  const { id } = UpdateBoardSettingsParams.parse(req.params);
  const body = UpdateBoardSettingsBody.parse(req.body);

  const result = await db.transaction(async (tx) => {
    // Row-lock the job so a concurrent portal slot-claim can't change
    // crewsFilled/boardStatus between our read and write.
    const [job] = await tx
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.id, id))
      .for("update");
    if (!job) return { status: 404 as const, error: "Job not found" };
    if (job.status === "complete" || job.boardStatus === "completed") {
      return { status: 409 as const, error: "Job is already completed" };
    }

    const scheduleType = body.scheduleType === "flex" ? "flex" : "scheduled";
    let flexDueBy: string | null = null;
    if (scheduleType === "flex") {
      if (body.flexDays != null) {
        const days = Math.max(1, Math.round(body.flexDays));
        const due = new Date();
        due.setDate(due.getDate() + days);
        flexDueBy = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`;
      } else {
        flexDueBy = job.flexDueBy ?? null;
        if (!flexDueBy) {
          const due = new Date();
          due.setDate(due.getDate() + 7);
          flexDueBy = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`;
        }
      }
    }

    const filled = job.crewsFilled ?? 0;
    let crewsNeeded = job.crewsNeeded ?? 1;
    if (body.crewsNeeded != null) {
      const wanted = Math.max(1, Math.round(body.crewsNeeded));
      if (wanted < filled) {
        return {
          status: 409 as const,
          error: `${filled} crew${filled === 1 ? " has" : "s have"} already accepted — crew slots can't go below ${filled}.`,
        };
      }
      crewsNeeded = wanted;
    }

    // Adding slots to a filled posting reopens it for more crews; shrinking
    // slots down to the filled count marks it filled.
    let boardStatus = job.boardStatus;
    if (boardStatus === "filled" && filled < crewsNeeded) {
      boardStatus = "active";
    } else if (
      (boardStatus === "active" || boardStatus === "reopened") &&
      filled >= crewsNeeded &&
      filled > 0
    ) {
      boardStatus = "filled";
    }

    const [row] = await tx
      .update(jobsTable)
      .set({ scheduleType, flexDueBy, crewsNeeded, boardStatus })
      .where(eq(jobsTable.id, id))
      .returning();
    return { status: 200 as const, job: row! };
  });

  if (result.status !== 200) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  emitBoardEvent(result.job.propertyId);
  const [props, crews] = await Promise.all([
    db.select().from(propertiesTable),
    db.select().from(crewsTable),
  ]);
  const prop = props.find((p) => p.id === result.job.propertyId);
  res.json(
    UpdateBoardSettingsResponse.parse({
      ...ser(result.job),
      propertyName: prop?.name ?? null,
      crewLeaderName: result.job.crewLeaderId
        ? (crews.find((c) => c.id === result.job.crewLeaderId)?.name ?? null)
        : null,
    }),
  );
});

router.post("/jobs/:id/unlist", async (req, res): Promise<void> => {
  const { id } = UnlistJobParams.parse(req.params);
  const result = await db.transaction(async (tx) => {
    const [job] = await tx.select().from(jobsTable).where(eq(jobsTable.id, id));
    if (!job) return { status: 404 as const, error: "Job not found" };
    if (job.boardStatus === "filled") {
      return {
        status: 409 as const,
        error: "This job is filled. Reopen it first, then remove the posting.",
      };
    }

    // Clear the posting entirely: remove schedules created by any approved
    // offer, then delete every broadcast row for this job so nothing remains
    // visible in any crew portal (pending, approved, declined, or withdrawn).
    const rows = await tx
      .select()
      .from(jobBroadcastsTable)
      .where(eq(jobBroadcastsTable.jobId, id));
    for (const b of rows) {
      if (b.status === "approved") {
        await tx
          .delete(schedulesTable)
          .where(
            and(
              eq(schedulesTable.jobId, id),
              eq(schedulesTable.crewLeaderId, b.crewId),
            ),
          );
      }
    }
    await tx
      .delete(jobBroadcastsTable)
      .where(eq(jobBroadcastsTable.jobId, id));

    const hadApproved = rows.some((b) => b.status === "approved");
    await tx
      .update(jobsTable)
      .set({
        boardStatus: "removed",
        crewsFilled: 0,
        crewLeaderId: hadApproved ? null : job.crewLeaderId,
        status:
          hadApproved && job.status === "scheduled" ? "open" : job.status,
      })
      .where(eq(jobsTable.id, id));
    return { status: 200 as const, propertyId: job.propertyId };
  });

  if (result.status !== 200) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  emitBoardEvent(result.propertyId);
  res.json(UnlistJobResponse.parse({ ok: true }));
});

router.post("/jobs/:id/reopen", async (req, res): Promise<void> => {
  const { id } = ReopenJobParams.parse(req.params);
  const result = await db.transaction(async (tx) => {
    const [job] = await tx.select().from(jobsTable).where(eq(jobsTable.id, id));
    if (!job) return { status: 404 as const, error: "Job not found" };

    const approved = await tx
      .select()
      .from(jobBroadcastsTable)
      .where(
        and(
          eq(jobBroadcastsTable.jobId, id),
          eq(jobBroadcastsTable.status, "approved"),
        ),
      );

    // Withdraw the fill: the previously approved crew comes off the job + calendar.
    for (const b of approved) {
      await tx
        .update(jobBroadcastsTable)
        .set({ status: "withdrawn", respondedAt: new Date() })
        .where(eq(jobBroadcastsTable.id, b.id));
      await tx
        .delete(schedulesTable)
        .where(
          and(
            eq(schedulesTable.jobId, id),
            eq(schedulesTable.crewLeaderId, b.crewId),
          ),
        );
    }

    const [row] = await tx
      .update(jobsTable)
      .set({
        boardStatus: "reopened",
        crewLeaderId: approved.length > 0 ? null : job.crewLeaderId,
        status: job.status === "scheduled" ? "open" : job.status,
        completedAt: null,
        crewsFilled: 0,
      })
      .where(eq(jobsTable.id, id))
      .returning();
    return { status: 200 as const, job: row! };
  });

  if (result.status !== 200) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  emitBoardEvent(result.job.propertyId);
  const [props, crews] = await Promise.all([
    db.select().from(propertiesTable),
    db.select().from(crewsTable),
  ]);
  const prop = props.find((p) => p.id === result.job.propertyId);
  res.json(
    ReopenJobResponse.parse({
      ...ser(result.job),
      propertyName: prop?.name ?? null,
      crewLeaderName: result.job.crewLeaderId
        ? (crews.find((c) => c.id === result.job.crewLeaderId)?.name ?? null)
        : null,
    }),
  );
});

// ---------------------------------------------------------------------------
// Photo library — every photo received from crews, labeled with property and
// crew, so the office can browse by property and attach shots to a job card.
router.get("/photo-library", async (_req, res): Promise<void> => {
  const [acts, vault, jobs, props, crews] = await Promise.all([
    db
      .select()
      .from(activitiesTable)
      .where(
        and(
          eq(activitiesTable.entityType, "job"),
          inArray(activitiesTable.kind, ["photo_before", "photo_after"]),
        ),
      )
      .orderBy(desc(activitiesTable.createdAt)),
    db.select().from(crewPhotosTable).orderBy(desc(crewPhotosTable.createdAt)),
    db.select({ id: jobsTable.id, propertyId: jobsTable.propertyId, unitNo: jobsTable.unitNo }).from(jobsTable),
    db.select({ id: propertiesTable.id, name: propertiesTable.name }).from(propertiesTable),
    db.select({ id: crewsTable.id, name: crewsTable.name }).from(crewsTable),
  ]);
  const jobsById = new Map(jobs.map((j) => [j.id, j]));
  const propsById = new Map(props.map((p) => [p.id, p]));
  const crewsById = new Map(crews.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const entries: unknown[] = [];
  const push = (e: {
    storagePath: string;
    kind: string;
    jobId: string | null;
    crewName: string | null;
    takenOn: string | null;
  }) => {
    if (!e.storagePath || seen.has(e.storagePath)) return;
    seen.add(e.storagePath);
    const job = e.jobId ? jobsById.get(e.jobId) : undefined;
    const prop = job?.propertyId ? propsById.get(job.propertyId) : undefined;
    entries.push({
      storagePath: e.storagePath,
      kind: e.kind,
      jobId: e.jobId,
      propertyId: prop?.id ?? null,
      propertyName: prop?.name ?? null,
      unitNo: job?.unitNo ?? null,
      crewName: e.crewName,
      takenOn: e.takenOn,
    });
  };
  for (const a of acts) {
    if (!a.storagePath) continue;
    push({
      storagePath: a.storagePath,
      kind: a.kind ?? "other",
      jobId: a.entityId,
      crewName: null,
      takenOn: a.createdAt ? a.createdAt.toISOString().slice(0, 10) : null,
    });
  }
  for (const p of vault) {
    push({
      storagePath: p.storagePath,
      kind: p.phase === "before" ? "photo_before" : p.phase === "after" ? "photo_after" : "other",
      jobId: p.jobId,
      crewName: crewsById.get(p.crewId)?.name ?? null,
      takenOn: p.takenOn ?? null,
    });
  }
  res.json(GetPhotoLibraryResponse.parse(entries));
});

// Attach library photos to a job card — copies them onto the job as
// before/after photo activities (source photos stay where they are).
router.post("/jobs/:id/photos/assign", async (req, res): Promise<void> => {
  const { id } = AssignPhotosToJobParams.parse(req.params);
  const body = AssignPhotosToJobBody.parse(req.body);
  const [job] = await db
    .select({ id: jobsTable.id, propertyId: jobsTable.propertyId })
    .from(jobsTable)
    .where(eq(jobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  // Only paths that actually exist in the photo library (crew vault shots or
  // job before/after photo activities) may be attached — the client's
  // selection is not an authorization boundary, so an arbitrary storage path
  // must never be laundered onto a card here.
  const requested = body.items.map((it) => it.storagePath);
  const [vaultRows, actRows, existing] = await Promise.all([
    db
      .select({ storagePath: crewPhotosTable.storagePath })
      .from(crewPhotosTable)
      .where(inArray(crewPhotosTable.storagePath, requested)),
    db
      .select({ storagePath: activitiesTable.storagePath })
      .from(activitiesTable)
      .where(
        and(
          eq(activitiesTable.entityType, "job"),
          inArray(activitiesTable.kind, ["photo_before", "photo_after"]),
          inArray(activitiesTable.storagePath, requested),
        ),
      ),
    // Skip photos the job already carries — assigning twice is a no-op.
    db
      .select({ storagePath: activitiesTable.storagePath })
      .from(activitiesTable)
      .where(
        and(eq(activitiesTable.entityType, "job"), eq(activitiesTable.entityId, id)),
      ),
  ]);
  const allowed = new Set([
    ...vaultRows.map((r) => r.storagePath),
    ...actRows.map((r) => r.storagePath).filter((p): p is string => !!p),
  ]);
  const unknown = body.items.filter((it) => !allowed.has(it.storagePath));
  if (unknown.length > 0) {
    res.status(400).json({ error: "One or more photos aren't in the photo library" });
    return;
  }
  const have = new Set(existing.map((e) => e.storagePath).filter(Boolean));
  const fresh = body.items.filter((it) => !have.has(it.storagePath));
  if (fresh.length > 0) {
    await db.insert(activitiesTable).values(
      fresh.map((it) => ({
        entityType: "job",
        entityId: id,
        kind: it.kind,
        storagePath: it.storagePath,
        body: "Photo attached from the photo library",
      })),
    );
    emitBoardEvent(job.propertyId);
  }
  res.json(AssignPhotosToJobResponse.parse({ ok: true, added: fresh.length }));
});

export default router;
