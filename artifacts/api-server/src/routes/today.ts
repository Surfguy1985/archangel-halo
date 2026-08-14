import { Router, type IRouter } from "express";
import { and, isNull, lte, or, sql } from "drizzle-orm";
import {
  db,
  notificationsTable,
  invoicesTable,
  jobsTable,
  workRequestsTable,
  propertiesTable,
  feedDismissalsTable,
  remindersTable,
} from "@workspace/db";
import type { FeedItem } from "../lib/queues";
import {
  GetTodayResponse,
  RefreshBriefResponse,
  GetQueuesResponse,
  AskHaloBody,
  AskHaloResponse,
  DismissFeedItemBody,
  DismissFeedItemResponse,
} from "@workspace/api-zod";
import { computeQueues } from "../lib/queues";
import { completeText } from "../lib/ai";

const router: IRouter = Router();

function whenLabel(): string {
  const h = new Date().getHours();
  if (h < 12) return "Morning";
  if (h < 17) return "Afternoon";
  return "Evening";
}

async function unreadCount(): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)` })
    .from(notificationsTable)
    .where(isNull(notificationsTable.readAt));
  return Number(row?.c ?? 0);
}

async function visibleQueues() {
  const [{ feed, queues }, dismissals] = await Promise.all([
    computeQueues(),
    db.select().from(feedDismissalsTable),
  ]);
  const dismissed = new Set(dismissals.map((d) => d.itemId));
  const visibleFeed = feed.filter((f) => !dismissed.has(f.id));
  const visible = new Map<string, number>();
  for (const f of visibleFeed) {
    visible.set(f.queue, (visible.get(f.queue) ?? 0) + 1);
  }
  const adjustedQueues = queues.map((q) => ({
    ...q,
    count: visible.get(q.key) ?? 0,
  }));
  return { feed: visibleFeed, queues: adjustedQueues };
}

// The morning brief pulls ONLY from the alert categories the owner asked
// for: new job requests, invoices the client hasn't marked paid for 7+ days,
// unfilled jobs, and jobs waiting on a manual verification check.
// The brief is derived from the SAME visible feed as the Needs attention
// section below it — same items, dismissals respected — so the two always
// agree. Categories: new job requests (wreq-), invoices unpaid by the client
// for 7+ days (inv-stale-), uncrewed jobs (unfilled-/vacated-), and jobs
// waiting on a manual verification check (mcheck-).
async function briefContext() {
  const { feed, queues } = await visibleQueues();
  const needsYou = feed.filter((f) => f.tier === "now" || f.tier === "today").length;

  const byPrefix = (...prefixes: string[]) =>
    feed.filter((f) => prefixes.some((p) => f.id.startsWith(p)));

  const staleItems = byPrefix("inv-stale-");
  return {
    feed,
    queues,
    needsYou,
    newRequests: byPrefix("wreq-").length,
    staleInvoiceCount: staleItems.length,
    staleInvoiceTotal: staleItems.reduce((s, f) => s + (f.amount ?? 0), 0),
    unfilledJobs: byPrefix("unfilled-", "vacated-").length,
    manualChecks: byPrefix("mcheck-").length,
  };
}

function deterministicBrief(ctx: {
  newRequests: number;
  staleInvoiceCount: number;
  staleInvoiceTotal: number;
  unfilledJobs: number;
  manualChecks: number;
}): string {
  const parts: string[] = [];
  if (ctx.newRequests > 0)
    parts.push(`${ctx.newRequests} new job request${ctx.newRequests === 1 ? "" : "s"} waiting`);
  if (ctx.staleInvoiceCount > 0)
    parts.push(
      `${ctx.staleInvoiceCount} invoice${ctx.staleInvoiceCount === 1 ? "" : "s"} ($${ctx.staleInvoiceTotal.toLocaleString()}) unpaid by the client for over 7 days`,
    );
  if (ctx.unfilledJobs > 0)
    parts.push(`${ctx.unfilledJobs} job${ctx.unfilledJobs === 1 ? "" : "s"} still without a crew`);
  if (ctx.manualChecks > 0)
    parts.push(
      `${ctx.manualChecks} job${ctx.manualChecks === 1 ? "" : "s"} waiting on your manual verification check`,
    );
  if (parts.length === 0)
    return "All clear — no new requests, no invoices past the 7-day mark, and every job is crewed and verified.";
  return `Needs your eye: ${parts.join("; ")}.`;
}

router.get("/today", async (_req, res): Promise<void> => {
  const ctx = await briefContext();
  const body = deterministicBrief(ctx);
  res.json(
    GetTodayResponse.parse({
      date: new Date().toISOString().slice(0, 10),
      brief: {
        body,
        when: whenLabel(),
        needsYou: ctx.needsYou,
        generatedAt: new Date().toISOString(),
      },
      feed: ctx.feed,
      queues: ctx.queues,
      unreadNotifications: await unreadCount(),
    }),
  );
});

router.post("/brief/refresh", async (_req, res): Promise<void> => {
  const ctx = await briefContext();
  let body: string;
  try {
    body = await completeText(
      "You are HALO, chief of staff for a property-maintenance contractor. Write a sharp morning brief in 2-3 short sentences covering ONLY the alert items in the snapshot: new job requests, invoices the client hasn't marked paid in over 7 days, jobs without a crew, and jobs waiting on a manual verification check. Mention only categories with a count above zero; if everything is zero, say it's all clear. Plain-spoken, confident, no headings or bullets. Do not mention anything else.",
      `Live snapshot:\n${JSON.stringify(
        {
          newJobRequests: ctx.newRequests,
          invoicesUnpaidOver7Days: ctx.staleInvoiceCount,
          invoicesUnpaidOver7DaysTotal: ctx.staleInvoiceTotal,
          jobsWithoutCrew: ctx.unfilledJobs,
          jobsAwaitingManualCheck: ctx.manualChecks,
        },
        null,
        2,
      )}`,
      512,
    );
  } catch {
    body = deterministicBrief(ctx);
  }
  res.json(
    RefreshBriefResponse.parse({
      body,
      when: whenLabel(),
      needsYou: ctx.needsYou,
      generatedAt: new Date().toISOString(),
    }),
  );
});

// ---------------------------------------------------------------------------
// Structured briefing endpoint — deterministic, no AI call
// ---------------------------------------------------------------------------

type BriefItem = {
  tier: "now" | "today" | "week";
  urgency: number;
  category: string;
  title: string;
  body: string;
  entityType?: string | null;
  entityId?: string | null;
  entityLabel?: string | null;
  actionLabel?: string | null;
  actionKey?: string | null;
  amount?: number | null;
  slaRisk?: boolean;
  customerImpact?: boolean;
};

const TIER_WEIGHT: Record<string, number> = { now: 100, today: 50, week: 10 };
const CUSTOMER_IMPACT_QUEUES = new Set(["requests", "updates", "invoice"]);
const SLA_RISK_QUEUES = new Set(["money", "margin", "schedule"]);
const CATEGORY_MAP: Record<string, string> = {
  requests: "Client Requests",
  updates: "Client Updates",
  money: "Money at Risk",
  margin: "Margin Guardian",
  invoice: "Ready to Invoice",
  bids: "Bids",
  schedule: "Schedule",
  leads: "Leads",
  supply: "Supply",
  compliance: "Compliance",
  followup: "Follow-ups",
  reminder: "Reminders",
};

function feedItemToBriefItem(f: FeedItem): BriefItem {
  const tierW = TIER_WEIGHT[f.tier] ?? 10;
  const financialScore = f.amount ? Math.min(Math.log10(f.amount + 1) * 10, 50) : 0;
  const slaRisk = SLA_RISK_QUEUES.has(f.queue);
  const customerImpact = CUSTOMER_IMPACT_QUEUES.has(f.queue);
  const urgency = tierW + financialScore + (slaRisk ? 15 : 0) + (customerImpact ? 10 : 0);
  const category = CATEGORY_MAP[f.queue] ?? f.queue;
  const action = f.actions?.[0];
  return {
    tier: (f.tier === "now" || f.tier === "today" || f.tier === "week") ? f.tier : "week",
    urgency,
    category,
    title: f.title,
    body: f.sub ?? "",
    entityType: f.entityType ?? null,
    entityId: f.entityId ?? null,
    entityLabel: null,
    actionLabel: action?.label ?? null,
    actionKey: action?.action ?? null,
    amount: f.amount ?? null,
    slaRisk,
    customerImpact,
  };
}

router.get("/today/briefing", async (_req, res): Promise<void> => {
  const { feed, queues: _queues } = await computeQueues();
  const [dismissals] = await Promise.all([db.select().from(feedDismissalsTable)]);
  const dismissed = new Set(dismissals.map((d) => d.itemId));
  const visible = feed.filter((f) => !dismissed.has(f.id));

  // Also include any due reminders as briefing items
  const now = new Date();
  const dueReminders = await db
    .select()
    .from(remindersTable)
    .where(
      and(
        isNull(remindersTable.dismissedAt),
        lte(remindersTable.remindAt, now),
        or(
          isNull(remindersTable.snoozedUntil),
          lte(remindersTable.snoozedUntil, now),
        ),
      ),
    );

  const items: BriefItem[] = visible.map(feedItemToBriefItem);

  for (const r of dueReminders) {
    items.push({
      tier: "now",
      urgency: 80,
      category: "Reminders",
      title: r.text,
      body: r.entityLabel ?? "",
      entityType: r.entityType ?? null,
      entityId: r.entityId ?? null,
      entityLabel: r.entityLabel ?? null,
      actionLabel: "Dismiss",
      actionKey: "dismissReminder",
      amount: null,
      slaRisk: false,
      customerImpact: false,
    });
  }

  items.sort((a, b) => b.urgency - a.urgency);

  res.json({ items, generatedAt: new Date().toISOString() });
});

router.get("/queues", async (_req, res): Promise<void> => {
  const { queues } = await visibleQueues();
  res.json(GetQueuesResponse.parse(queues));
});

router.post("/feed/dismiss", async (req, res): Promise<void> => {
  const { itemId } = DismissFeedItemBody.parse(req.body);
  await db
    .insert(feedDismissalsTable)
    .values({ itemId })
    .onConflictDoNothing();
  res.json(DismissFeedItemResponse.parse({ ok: true }));
});

router.post("/ask", async (req, res): Promise<void> => {
  const { question } = AskHaloBody.parse(req.body);
  const [props, jobs, invoices] = await Promise.all([
    db.select().from(propertiesTable),
    db.select().from(jobsTable),
    db.select().from(invoicesTable),
  ]);
  const { queues } = await computeQueues();
  const snapshot = {
    properties: props.map((p) => ({
      name: p.name,
      city: p.city,
      units: p.units,
      status: p.status,
    })),
    jobs: {
      total: jobs.length,
      open: jobs.filter(
        (j) => !["complete", "closed", "cancelled"].includes(j.status),
      ).length,
    },
    receivables: invoices
      .filter((i) => i.status === "sent" || i.status === "overdue")
      .reduce((s, i) => s + i.amount, 0),
    queues: queues.filter((q) => q.count > 0),
  };
  let answer: string;
  try {
    answer = await completeText(
      "You are HALO, a sharp operations assistant for a property-maintenance contractor. Answer the owner's question using ONLY the JSON business snapshot provided. Be concise and specific with numbers. If the snapshot lacks the data, say so plainly.",
      `Business snapshot:\n${JSON.stringify(snapshot, null, 2)}\n\nQuestion: ${question}`,
      1024,
    );
  } catch {
    answer =
      "I couldn't reach the assistant just now. Please try again in a moment.";
  }
  res.json(AskHaloResponse.parse({ answer }));
});

export default router;
