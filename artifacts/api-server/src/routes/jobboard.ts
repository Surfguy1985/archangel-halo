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
} from "@workspace/db";
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
  const [jobs, props, priceItems, broadcasts, crews, invoices, lineItems, photoActs] =
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
    ]);

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
        };
      })(),
      priceItems: (priceByProp.get(j.propertyId) ?? []).map((pi) => ser(pi)),
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
    };
  });

  res.json(ListJobBoardResponse.parse(cards));
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

  for (const crew of toSend) {
    // Every recipient needs a live link — mint one if the crew doesn't have it yet.
    if (!crew.portalToken) {
      const token = randomBytes(24).toString("base64url");
      await db
        .update(crewsTable)
        .set({ portalToken: token })
        .where(eq(crewsTable.id, crew.id));
    }
    const priorId = resolvedExisting.get(crew.id);
    if (priorId) {
      await db
        .update(jobBroadcastsTable)
        .set({ status: "pending", sentAt: new Date(), respondedAt: null })
        .where(eq(jobBroadcastsTable.id, priorId));
    } else {
      await db.insert(jobBroadcastsTable).values({
        jobId: id,
        crewId: crew.id,
        status: "pending",
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
  }

  res.json(
    BroadcastJobResponse.parse({
      sent: toSend.length,
      alreadySent: targets.length - toSend.length,
      crewNames: sentNames,
    }),
  );
});

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
    return { status: 200 as const };
  });

  if (result.status !== 200) {
    res.status(result.status).json({ error: result.error });
    return;
  }
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

export default router;
