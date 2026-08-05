import { Router, type IRouter } from "express";
import { isNull, sql } from "drizzle-orm";
import {
  db,
  notificationsTable,
  invoicesTable,
  jobsTable,
  workRequestsTable,
  propertiesTable,
  feedDismissalsTable,
} from "@workspace/db";
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
async function briefContext() {
  const { feed, queues } = await visibleQueues();
  const needsYou = feed.filter((f) => f.tier === "now" || f.tier === "today").length;

  const [invoices, jobs, requests] = await Promise.all([
    db.select().from(invoicesTable),
    db.select().from(jobsTable),
    db.select().from(workRequestsTable),
  ]);

  const newRequests = requests.filter((r) => r.status === "pending").length;

  const now = Date.now();
  const staleInvoices = invoices.filter((i) => {
    if (i.status !== "sent" && i.status !== "overdue") return false;
    if (i.clientPaidReportedAt || i.paidAt) return false;
    const sent = i.sentAt ?? i.createdAt;
    return sent && now - new Date(sent).getTime() > 7 * 24 * 60 * 60 * 1000;
  });
  const staleInvoiceTotal = staleInvoices.reduce((s, i) => s + i.amount, 0);

  const liveJobs = jobs.filter(
    (j) =>
      !["complete", "paid", "cancelled"].includes(j.status) &&
      !j.clearedAt,
  );
  const unfilledJobs = liveJobs.filter(
    (j) =>
      !j.crewLeaderId &&
      (j.boardStatus === "active" || j.boardStatus === "reopened"),
  ).length;
  const manualChecks = liveJobs.filter((j) => j.boardStatus === "manual_check").length;

  return {
    feed,
    queues,
    needsYou,
    newRequests,
    staleInvoiceCount: staleInvoices.length,
    staleInvoiceTotal,
    unfilledJobs,
    manualChecks,
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
