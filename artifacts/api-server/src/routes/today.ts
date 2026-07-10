import { Router, type IRouter } from "express";
import { isNull, sql } from "drizzle-orm";
import {
  db,
  notificationsTable,
  invoicesTable,
  jobsTable,
  propertiesTable,
} from "@workspace/db";
import {
  GetTodayResponse,
  RefreshBriefResponse,
  GetQueuesResponse,
  AskHaloBody,
  AskHaloResponse,
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

async function briefContext() {
  const { feed, queues } = await computeQueues();
  const needsYou = feed.filter((f) => f.tier === "now" || f.tier === "today").length;
  const invoices = await db.select().from(invoicesTable);
  const atRisk = invoices
    .filter((i) => i.status === "sent" || i.status === "overdue")
    .reduce((s, i) => s + i.amount, 0);
  const openJobs = (await db.select().from(jobsTable)).filter(
    (j) => !["complete", "closed", "cancelled"].includes(j.status),
  ).length;
  return { feed, queues, needsYou, atRisk, openJobs };
}

function deterministicBrief(ctx: {
  needsYou: number;
  atRisk: number;
  openJobs: number;
  queues: { label: string; count: number }[];
}): string {
  const top = ctx.queues
    .filter((q) => q.count > 0)
    .slice(0, 3)
    .map((q) => `${q.count} ${q.label.toLowerCase()}`)
    .join(", ");
  const money =
    ctx.atRisk > 0
      ? ` You have $${ctx.atRisk.toLocaleString()} in receivables outstanding.`
      : "";
  return `${ctx.needsYou} item${ctx.needsYou === 1 ? "" : "s"} need you today${
    top ? `: ${top}` : ""
  }.${money} ${ctx.openJobs} job${ctx.openJobs === 1 ? "" : "s"} in flight.`;
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
      "You are HALO, chief of staff for a property-maintenance contractor. Write a warm, sharp morning brief in 2-3 short sentences. Lead with what needs the owner today, then money, then a note of momentum. Plain-spoken, confident, no headings or bullets.",
      `Live snapshot:\n${JSON.stringify(
        {
          needsYou: ctx.needsYou,
          atRisk: ctx.atRisk,
          openJobs: ctx.openJobs,
          queues: ctx.queues.filter((q) => q.count > 0),
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
  const { queues } = await computeQueues();
  res.json(GetQueuesResponse.parse(queues));
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
