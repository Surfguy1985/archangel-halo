import {
  db,
  invoicesTable,
  bidsTable,
  jobsTable,
  propertiesTable,
  inventoryItemsTable,
  vendorsTable,
  leadsTable,
  workRequestsTable,
  clientAccountsTable,
  clientBoardCardsTable,
  clientCardCommentsTable,
  crewCheckinsTable,
  crewPhotosTable,
  crewPayHoldsTable,
  crewPayoutsTable,
  crewPaymentsTable,
  crewsTable,
  emergencyPingsTable,
} from "@workspace/db";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { localToday } from "./localDate";
import { emergencySettledKeys, outstandingHoldAmount } from "./emergencySettlement";

const DAY = 1000 * 60 * 60 * 24;

export type FeedItem = {
  id: string;
  queue: string;
  tier: string;
  title: string;
  sub: string;
  entityType?: string | null;
  entityId?: string | null;
  propertyId?: string | null;
  amount?: number | null;
  meta?: Array<{ label: string; mono?: boolean; warn?: boolean; gold?: boolean }>;
  actions?: Array<{ label: string; action: string; kind: string }>;
};

export type QueueDef = {
  key: string;
  label: string;
  count: number;
  color?: string | null;
};

export async function computeQueues(): Promise<{
  feed: FeedItem[];
  queues: QueueDef[];
}> {
  const [invoices, bids, jobs, props, inventory, vendors, leads, workRequests] =
    await Promise.all([
      db.select().from(invoicesTable),
      db.select().from(bidsTable),
      db.select().from(jobsTable),
      db.select().from(propertiesTable),
      db.select().from(inventoryItemsTable),
      db.select().from(vendorsTable),
      db.select().from(leadsTable),
      db.select().from(workRequestsTable),
    ]);
  const propName = new Map(props.map((p) => [p.id, p.name]));
  const today = localToday();
  const feed: FeedItem[] = [];

  const daysLate = (due: Date | null) =>
    due ? Math.floor((Date.now() - due.getTime()) / DAY) : 0;

  // Money at risk — overdue invoices
  const overdue = invoices.filter(
    (i) => i.status !== "paid" && i.status !== "draft" && daysLate(i.dueAt) > 0,
  );
  for (const i of overdue) {
    const late = daysLate(i.dueAt);
    feed.push({
      id: `inv-${i.id}`,
      queue: "money",
      tier: late > 30 ? "now" : "today",
      title: `${propName.get(i.propertyId) ?? "Invoice"} — ${late} days past due`,
      sub: `Invoice ${i.invoiceNo}`,
      entityType: "invoice",
      entityId: i.id,
      propertyId: i.propertyId,
      amount: i.amount,
      meta: [{ label: `${late}d late`, warn: true }],
      actions: [{ label: "Send reminder", action: "remindInvoice", kind: "gold" }],
    });
  }

  // Money at risk — invoices the client hasn't marked paid for over 7 days
  // (since send), even if not past due yet. Mirrors the morning brief.
  const staleUnpaid = invoices.filter(
    (i) =>
      (i.status === "sent" || i.status === "overdue") &&
      !i.paidAt &&
      !i.clientPaidReportedAt &&
      (i.sentAt ?? i.createdAt) &&
      Date.now() - new Date(i.sentAt ?? i.createdAt).getTime() > 7 * DAY &&
      !overdue.some((o) => o.id === i.id),
  );
  for (const i of staleUnpaid) {
    const days = Math.floor(
      (Date.now() - new Date(i.sentAt ?? i.createdAt).getTime()) / DAY,
    );
    feed.push({
      id: `inv-stale-${i.id}`,
      queue: "money",
      tier: "today",
      title: `${propName.get(i.propertyId) ?? "Invoice"} — unpaid ${days} days after send`,
      sub: `Invoice ${i.invoiceNo}`,
      entityType: "invoice",
      entityId: i.id,
      propertyId: i.propertyId,
      amount: i.amount,
      meta: [{ label: `${days}d unpaid`, warn: true }],
      actions: [{ label: "Send reminder", action: "remindInvoice", kind: "gold" }],
    });
  }

  // Client requests awaiting a decision — approve/decline inline from Today.
  // Emergencies (≤24h notice) are tier "now"; everything else is "today".
  const pendingRequests = workRequests.filter((r) => r.status === "pending");
  for (const r of pendingRequests) {
    const units = Array.isArray(r.units)
      ? (r.units as unknown[]).filter((u): u is string => typeof u === "string")
      : [];
    const unitLabel = units.length
      ? `Unit${units.length > 1 ? "s" : ""} ${units.join(", ")}`
      : r.unitNo
        ? `Unit ${r.unitNo}`
        : "";
    feed.push({
      id: `wreq-${r.id}`,
      queue: "requests",
      tier: r.emergency ? "now" : "today",
      title: `${r.emergency ? "EMERGENCY: " : r.changeOrderJobId ? "Change order: " : "Client request: "}${r.serviceLabel}`,
      sub: [propName.get(r.propertyId) ?? "", unitLabel, r.neededBy ? `by ${r.neededBy}` : ""]
        .filter(Boolean)
        .join(" · "),
      entityType: "work_request",
      entityId: r.id,
      propertyId: r.propertyId,
      amount: r.budgetEstimate ?? undefined,
      meta: (() => {
        const pills: { label: string; warn?: boolean }[] = [];
        if (r.emergency) pills.push({ label: "≤24h notice", warn: true });
        if (r.budgetEstimate != null)
          pills.push({ label: `Budget $${r.budgetEstimate.toLocaleString()}` });
        return pills.length ? pills : undefined;
      })(),
      actions: [
        { label: "Approve", action: "approveRequest", kind: "gold" },
        { label: "Decline", action: "declineRequest", kind: "line" },
      ],
    });
  }

  // Bids awaiting decision (sent > 3 days, not decided)
  const stale = bids.filter(
    (b) =>
      b.status === "sent" &&
      b.sentAt &&
      Date.now() - b.sentAt.getTime() > 3 * DAY,
  );
  for (const b of stale) {
    feed.push({
      id: `bid-${b.id}`,
      queue: "bids",
      tier: "today",
      title: `Follow up: ${propName.get(b.propertyId ?? "") ?? "Bid"} ${b.unitNo ?? ""}`.trim(),
      sub: `Bid ${b.bidNo} — ${b.scope ?? ""}`,
      entityType: "bid",
      entityId: b.id,
      propertyId: b.propertyId ?? null,
      amount: b.amount,
      actions: [{ label: "Nudge", action: "nudgeBid", kind: "gold" }],
    });
  }

  // Jobs that lost their crew (pulled onto another job) — Action Required
  // until someone restaffs them, so nothing goes uncrewed silently.
  const vacated = jobs.filter(
    (j) =>
      j.crewVacatedAt != null &&
      !j.crewLeaderId &&
      j.status !== "complete" &&
      j.status !== "paid" &&
      j.status !== "cancelled",
  );
  for (const j of vacated) {
    feed.push({
      id: `vacated-${j.id}`,
      queue: "schedule",
      tier: "now",
      title: `Job ${j.jobNo} lost its crew`,
      sub: `${propName.get(j.propertyId) ?? ""} — ${j.description ?? "needs a new crew"}`.trim(),
      entityType: "job",
      entityId: j.id,
      meta: [{ label: "Uncrewed", warn: true }],
      actions: [{ label: "Restaff", action: "openJob", kind: "gold" }],
    });
  }

  // Emergency pings that expired with no commit — the office needs to know
  // the offer went unanswered so they can re-ping or staff the job manually.
  // Shown while the job is still uncrewed and not finished (recent expiries
  // only, so old history doesn't linger in Today forever).
  const expiredPings = await db
    .select()
    .from(emergencyPingsTable)
    .where(isNotNull(emergencyPingsTable.expiredAt));
  for (const p of expiredPings) {
    if (!p.expiredAt || Date.now() - p.expiredAt.getTime() > 3 * DAY) continue;
    const job = jobs.find((j) => j.id === p.jobId);
    if (
      !job ||
      job.crewLeaderId ||
      job.clearedAt ||
      ["complete", "paid", "cancelled"].includes(job.status)
    )
      continue;
    feed.push({
      id: `eping-expired-${p.id}`,
      queue: "schedule",
      tier: "now",
      title: `Emergency ping expired — no one committed (${job.jobNo})`,
      sub: `${propName.get(job.propertyId) ?? ""} — $${p.bonusAmount.toLocaleString()} bonus offer went unanswered`.trim(),
      entityType: "job",
      entityId: job.id,
      propertyId: job.propertyId,
      meta: [{ label: "No takers", warn: true }],
      actions: [{ label: "Open job", action: "openJob", kind: "gold" }],
    });
  }

  // Jobs on the board with no crew at all (never staffed) — distinct from
  // "lost its crew" above, which covers crews pulled off mid-flight.
  const unfilled = jobs.filter(
    (j) =>
      !j.crewLeaderId &&
      !j.crewVacatedAt &&
      (j.boardStatus === "active" || j.boardStatus === "reopened") &&
      !j.clearedAt &&
      !["complete", "paid", "cancelled"].includes(j.status),
  );
  for (const j of unfilled) {
    feed.push({
      id: `unfilled-${j.id}`,
      queue: "schedule",
      tier: "today",
      title: `Job ${j.jobNo} has no crew yet`,
      sub: `${propName.get(j.propertyId) ?? ""} — ${j.description ?? "waiting to be staffed"}`.trim(),
      entityType: "job",
      entityId: j.id,
      propertyId: j.propertyId,
      meta: [{ label: "Uncrewed", warn: true }],
      actions: [{ label: "Staff job", action: "openJob", kind: "gold" }],
    });
  }

  // Jobs waiting on the office's manual verification check.
  const manualChecks = jobs.filter(
    (j) =>
      j.boardStatus === "manual_check" &&
      !j.clearedAt &&
      !["complete", "paid", "cancelled"].includes(j.status),
  );
  for (const j of manualChecks) {
    feed.push({
      id: `mcheck-${j.id}`,
      queue: "schedule",
      tier: "now",
      title: `Verify work: ${j.description ?? j.jobNo}`,
      sub: `${propName.get(j.propertyId) ?? ""} ${j.unitNo ?? ""}`.trim(),
      entityType: "job",
      entityId: j.id,
      propertyId: j.propertyId,
      meta: [{ label: "Manual check", warn: true }],
      actions: [{ label: "Check work", action: "openJob", kind: "gold" }],
    });
  }

  // Jobs needing scheduling
  const toSchedule = jobs.filter((j) => j.status === "open" && !j.scheduledOn);
  for (const j of toSchedule) {
    feed.push({
      id: `job-${j.id}`,
      queue: "schedule",
      tier: "today",
      title: `Schedule: ${j.description ?? j.jobNo}`,
      sub: `${propName.get(j.propertyId) ?? ""} ${j.unitNo ?? ""}`.trim(),
      entityType: "job",
      entityId: j.id,
      propertyId: j.propertyId,
      actions: [{ label: "Schedule", action: "scheduleJob", kind: "line" }],
    });
  }

  // Jobs completed, awaiting invoice
  const toInvoice = jobs.filter(
    (j) =>
      j.status === "complete" &&
      !invoices.some((i) => i.jobId === j.id),
  );
  for (const j of toInvoice) {
    feed.push({
      id: `binv-${j.id}`,
      queue: "invoice",
      tier: "now",
      title: `Invoice ready: ${j.description ?? j.jobNo}`,
      sub: `${propName.get(j.propertyId) ?? ""} — $${(j.grossProfit ?? 0).toLocaleString()} GP`,
      entityType: "job",
      entityId: j.id,
      propertyId: j.propertyId,
      actions: [{ label: "Create invoice", action: "createInvoice", kind: "gold" }],
    });
  }

  // Pay today — released emergency holds (same-day pay overrides net-30):
  // Action Required until the crew is actually paid for that job.
  const releasedHolds = await db
    .select()
    .from(crewPayHoldsTable)
    .where(eq(crewPayHoldsTable.status, "RELEASED"));
  if (releasedHolds.length > 0) {
    const [paidPayouts, crewPays, crews] = await Promise.all([
      db
        .select()
        .from(crewPayoutsTable)
        .where(eq(crewPayoutsTable.status, "paid")),
      db.select().from(crewPaymentsTable),
      db.select({ id: crewsTable.id, name: crewsTable.name }).from(crewsTable),
    ]);
    // Shared settlement predicate — same rule as portal earnings and the
    // payout queue, so all surfaces agree when a hold is done.
    const paidSet = emergencySettledKeys(paidPayouts, crewPays);
    const crewName = new Map(crews.map((c) => [c.id, c.name]));
    for (const h of releasedHolds) {
      if (paidSet.has(`${h.crewId}|${h.jobId}`)) continue;
      // Shared outstanding computation — prior completed base payments
      // reduce what's actually owed today.
      const owed = outstandingHoldAmount(h.amount, h.crewId, h.jobId, crewPays);
      if (owed <= 0) continue;
      const job = jobs.find((j) => j.id === h.jobId);
      feed.push({
        id: `sdp-${h.id}`,
        queue: "money",
        tier: "now",
        title: `Pay today: ${crewName.get(h.crewId) ?? "Crew"} — $${owed.toLocaleString()}`,
        sub: `Emergency job${job ? ` ${job.jobNo}` : ""} approved — same-day pay overrides net-30`,
        entityType: "job",
        entityId: h.jobId,
        propertyId: job?.propertyId ?? null,
        amount: owed,
        meta: [{ label: "Same-day pay", warn: true }],
        actions: [{ label: "Pay now", action: "openPayHub", kind: "gold" }],
      });
    }
  }

  // Margin Guardian — active jobs below the property's margin floor (default 25%)
  const DEFAULT_MARGIN_FLOOR = 0.25;
  const propMarginMin = new Map(
    props.map((p) => [p.id, p.marginMin ?? DEFAULT_MARGIN_FLOOR]),
  );
  const floorFor = (propertyId: string) =>
    propMarginMin.get(propertyId) ?? DEFAULT_MARGIN_FLOOR;
  const thinMargin = jobs.filter(
    (j) =>
      j.marginPct != null &&
      j.marginPct < floorFor(j.propertyId) &&
      j.status !== "complete" &&
      j.status !== "paid" &&
      j.status !== "cancelled",
  );
  for (const j of thinMargin) {
    const pct = Math.round((j.marginPct ?? 0) * 100);
    const floorPct = Math.round(floorFor(j.propertyId) * 100);
    feed.push({
      id: `margin-${j.id}`,
      queue: "margin",
      tier: pct < 15 ? "now" : "today",
      title: `Thin margin: ${j.description ?? j.jobNo}`,
      sub: `${propName.get(j.propertyId) ?? ""} — ${pct}% margin, below ${floorPct}% floor`,
      entityType: "job",
      entityId: j.id,
      propertyId: j.propertyId,
      amount: j.grossProfit,
      meta: [{ label: `${pct}% margin`, warn: true }],
      actions: [{ label: "Review job", action: "openJob", kind: "line" }],
    });
  }

  // Inventory low
  const low = inventory.filter((it) => it.qty <= it.reorderAt);
  for (const it of low) {
    feed.push({
      id: `inv-item-${it.id}`,
      queue: "supply",
      tier: "week",
      title: `Reorder ${it.name}`,
      sub: `${it.qty} left · reorder at ${it.reorderAt}`,
      entityType: "inventory",
      entityId: it.id,
      meta: [{ label: "Low stock", warn: true }],
    });
  }

  // Vendor COI expiring / expired
  const badCoi = vendors.filter(
    (v) => !v.coiExpiresOn || v.coiExpiresOn < today,
  );
  for (const v of badCoi) {
    feed.push({
      id: `coi-${v.id}`,
      queue: "compliance",
      tier: "week",
      title: `COI issue: ${v.name}`,
      sub: v.coiExpiresOn ? `Expired ${v.coiExpiresOn}` : "No COI on file",
      entityType: "vendor",
      entityId: v.id,
      meta: [{ label: "Insurance", warn: true }],
    });
  }

  // New leads
  const newLeads = leads.filter((l) => l.status === "new");
  for (const l of newLeads) {
    feed.push({
      id: `lead-${l.id}`,
      queue: "leads",
      tier: "today",
      title: `New lead: ${l.summary ?? "Opportunity"}`,
      sub: `${l.propertyId ? (propName.get(l.propertyId) ?? "") : l.source ?? ""}`,
      entityType: "lead",
      entityId: l.id,
    });
  }

  // Warranty / follow-up — jobs completed recently without recap
  const recap = jobs.filter(
    (j) =>
      j.status === "complete" &&
      !j.recapSentAt &&
      j.completedAt &&
      Date.now() - j.completedAt.getTime() < 7 * DAY,
  );
  for (const j of recap) {
    feed.push({
      id: `recap-${j.id}`,
      queue: "followup",
      tier: "week",
      title: `Send recap: ${j.description ?? j.jobNo}`,
      sub: propName.get(j.propertyId) ?? "",
      entityType: "job",
      entityId: j.id,
      propertyId: j.propertyId,
      actions: [{ label: "Draft recap", action: "draftRecap", kind: "gold" }],
    });
  }

  // Client updates — contextual "share it while it's happening" prompts,
  // only for properties with an active client dashboard.
  const activeAccounts = await db
    .select({ propertyId: clientAccountsTable.propertyId })
    .from(clientAccountsTable)
    .where(eq(clientAccountsTable.status, "active"));
  const clientProps = new Set(activeAccounts.map((a) => a.propertyId));

  // Unanswered client messages on board cards — Slack-style threads. One feed
  // item per property so the office can jump straight into the board mirror.
  if (clientProps.size > 0) {
    const unreadMsgs = await db
      .select({
        propertyId: clientCardCommentsTable.propertyId,
        n: sql<number>`count(*)::int`,
      })
      .from(clientCardCommentsTable)
      .where(
        and(
          eq(clientCardCommentsTable.authorType, "client"),
          isNull(clientCardCommentsTable.readAt),
        ),
      )
      .groupBy(clientCardCommentsTable.propertyId);
    for (const row of unreadMsgs) {
      if (!clientProps.has(row.propertyId)) continue;
      feed.push({
        id: `upd-messages-${row.propertyId}`,
        queue: "updates",
        tier: "now",
        title: `${row.n} unanswered client message${row.n === 1 ? "" : "s"}`,
        sub: `${propName.get(row.propertyId) ?? "Client board"} — reply from the board card thread`,
        entityType: "property",
        entityId: row.propertyId,
        propertyId: row.propertyId,
        actions: [{ label: "Open board", action: "openClientBoard", kind: "gold" }],
      });
    }
  }

  if (clientProps.size > 0) {
    const activeJobs = jobs.filter(
      (j) =>
        clientProps.has(j.propertyId) &&
        j.status !== "cancelled" &&
        j.status !== "paid",
    );
    const activeJobIds = activeJobs.map((j) => j.id);
    if (activeJobIds.length > 0) {
      const [pushedCards, checkins, photos] = await Promise.all([
        db
          .select({
            sourceType: clientBoardCardsTable.sourceType,
            sourceId: clientBoardCardsTable.sourceId,
          })
          .from(clientBoardCardsTable)
          .where(inArray(clientBoardCardsTable.sourceType, ["tracker", "photos"])),
        db
          .select()
          .from(crewCheckinsTable)
          .where(inArray(crewCheckinsTable.jobId, activeJobIds))
          .orderBy(desc(crewCheckinsTable.createdAt)),
        db
          .select({ jobId: crewPhotosTable.jobId, createdAt: crewPhotosTable.createdAt })
          .from(crewPhotosTable)
          .where(inArray(crewPhotosTable.jobId, activeJobIds)),
      ]);
      const pushed = new Set(pushedCards.map((c) => `${c.sourceType}:${c.sourceId}`));
      const jobById = new Map(activeJobs.map((j) => [j.id, j]));

      // Crew on site right now (checked in within 4h, no later checkout) →
      // offer the live tracker.
      const latestByJob = new Map<string, (typeof checkins)[number]>();
      for (const c of checkins) {
        if (c.jobId && !latestByJob.has(c.jobId)) latestByJob.set(c.jobId, c);
      }
      for (const [jobId, c] of latestByJob) {
        const j = jobById.get(jobId);
        if (!j) continue;
        const onSite =
          c.kind === "checkin" && Date.now() - c.createdAt.getTime() < 4 * 60 * 60 * 1000;
        if (!onSite || pushed.has(`tracker:${jobId}`)) continue;
        feed.push({
          id: `upd-tracker-${jobId}`,
          queue: "updates",
          tier: "now",
          title: `Crew on site: ${j.description ?? j.jobNo}`,
          sub: `${propName.get(j.propertyId) ?? ""} — share the live tracker with the client`,
          entityType: "job",
          entityId: jobId,
          propertyId: j.propertyId,
          actions: [{ label: "Share tracker", action: "shareTracker", kind: "gold" }],
        });
      }

      // Fresh crew photos (last 48h) not yet on the client board.
      const freshPhotoJobs = new Map<string, number>();
      for (const p of photos) {
        if (!p.jobId) continue;
        if (Date.now() - p.createdAt.getTime() < 48 * 60 * 60 * 1000) {
          freshPhotoJobs.set(p.jobId, (freshPhotoJobs.get(p.jobId) ?? 0) + 1);
        }
      }
      for (const [jobId, count] of freshPhotoJobs) {
        const j = jobById.get(jobId);
        if (!j || pushed.has(`photos:${jobId}`)) continue;
        feed.push({
          id: `upd-photos-${jobId}`,
          queue: "updates",
          tier: "today",
          title: `New photos: ${j.description ?? j.jobNo}`,
          sub: `${propName.get(j.propertyId) ?? ""} — ${count} photo${count === 1 ? "" : "s"} ready to share`,
          entityType: "job",
          entityId: jobId,
          propertyId: j.propertyId,
          actions: [{ label: "Share photos", action: "sharePhotos", kind: "gold" }],
        });
      }
    }
  }

  const queueMeta: Record<string, { label: string; color: string }> = {
    requests: { label: "Client requests", color: "gold" },
    updates: { label: "Client updates", color: "gold" },
    money: { label: "Money at risk", color: "danger" },
    margin: { label: "Margin guardian", color: "danger" },
    invoice: { label: "Ready to invoice", color: "gold" },
    bids: { label: "Bids to chase", color: "gold" },
    schedule: { label: "To schedule", color: "ink" },
    leads: { label: "New leads", color: "ink" },
    supply: { label: "Supply runs", color: "warn" },
    compliance: { label: "Compliance", color: "warn" },
    followup: { label: "Follow-ups", color: "ink" },
  };
  const order = Object.keys(queueMeta);
  const queues: QueueDef[] = order.map((key) => ({
    key,
    label: queueMeta[key].label,
    count: feed.filter((f) => f.queue === key).length,
    color: queueMeta[key].color,
  }));

  const tierRank: Record<string, number> = { now: 0, today: 1, week: 2, handled: 3 };
  feed.sort((a, b) => (tierRank[a.tier] ?? 9) - (tierRank[b.tier] ?? 9));

  return { feed, queues };
}
