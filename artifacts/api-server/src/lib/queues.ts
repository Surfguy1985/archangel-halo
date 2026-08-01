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
} from "@workspace/db";
import { localToday } from "./localDate";

const DAY = 1000 * 60 * 60 * 24;

export type FeedItem = {
  id: string;
  queue: string;
  tier: string;
  title: string;
  sub: string;
  entityType?: string | null;
  entityId?: string | null;
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
      amount: i.amount,
      meta: [{ label: `${late}d late`, warn: true }],
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
      meta: r.emergency ? [{ label: "≤24h notice", warn: true }] : undefined,
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
      amount: b.amount,
      actions: [{ label: "Nudge", action: "nudgeBid", kind: "gold" }],
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
      actions: [{ label: "Create invoice", action: "createInvoice", kind: "gold" }],
    });
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
    });
  }

  const queueMeta: Record<string, { label: string; color: string }> = {
    requests: { label: "Client requests", color: "gold" },
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
