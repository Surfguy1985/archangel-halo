import { and, eq, lt, isNull, inArray } from "drizzle-orm";
import {
  db,
  invoicesTable,
  jobBroadcastsTable,
  jobsTable,
  crewsTable,
  propertiesTable,
  notificationsTable,
  activitiesTable,
} from "@workspace/db";
import { getBusinessSettings } from "./businessSettings";
import { logger } from "./logger";

const STALE_OFFER_MS = 24 * 60 * 60 * 1000;
const AGING_JOB_MS = 3 * 24 * 60 * 60 * 1000;

async function alreadyNotified(kind: string, entityId: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(
      and(eq(notificationsTable.kind, kind), eq(notificationsTable.entityId, entityId)),
    )
    .limit(1);
  return Boolean(existing);
}

async function raise(opts: {
  kind: string;
  entityType: string;
  entityId: string;
  title: string;
  body: string;
}): Promise<void> {
  await db.insert(notificationsTable).values({
    kind: opts.kind,
    priority: "high",
    entityType: opts.entityType,
    entityId: opts.entityId,
    title: opts.title,
    body: opts.body,
  });
  await db.insert(activitiesTable).values({
    entityType: opts.entityType,
    entityId: opts.entityId,
    kind: "autopilot",
    body: `Autopilot: ${opts.body}`,
  });
}

/**
 * Autopilot background agent. Watches for problems the office would otherwise
 * catch manually and raises a notification + activity for each (deduped by
 * notification kind + entity id, so each issue fires exactly once).
 * Never throws.
 */
export async function runAutopilot(): Promise<string[]> {
  const actions: string[] = [];
  try {
    const settings = await getBusinessSettings();
    if (settings.autopilotEnabled === false) return actions;

    const now = new Date();

    // 1) Overdue invoices — sent, past due date, unpaid.
    const overdue = await db
      .select()
      .from(invoicesTable)
      .where(
        and(
          eq(invoicesTable.status, "sent"),
          isNull(invoicesTable.paidAt),
          lt(invoicesTable.dueAt, now),
        ),
      );
    for (const inv of overdue) {
      if (await alreadyNotified("autopilot_overdue_invoice", inv.id)) continue;
      const days = Math.max(
        1,
        Math.floor((now.getTime() - (inv.dueAt?.getTime() ?? now.getTime())) / 86400000),
      );
      const body = `Invoice ${inv.invoiceNo} ($${inv.amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}) is ${days} day${days === 1 ? "" : "s"} past due — time to follow up.`;
      await raise({
        kind: "autopilot_overdue_invoice",
        entityType: "invoice",
        entityId: inv.id,
        title: `Invoice ${inv.invoiceNo} is overdue`,
        body,
      });
      actions.push(body);
    }

    // 2) Stale job offers — crews sitting on a pending offer for 24h+.
    const staleCutoff = new Date(now.getTime() - STALE_OFFER_MS);
    const staleOffers = await db
      .select()
      .from(jobBroadcastsTable)
      .where(
        and(
          eq(jobBroadcastsTable.status, "pending"),
          lt(jobBroadcastsTable.sentAt, staleCutoff),
        ),
      );
    if (staleOffers.length) {
      const crewIds = [...new Set(staleOffers.map((o) => o.crewId))];
      const jobIds = [...new Set(staleOffers.map((o) => o.jobId))];
      const crews = crewIds.length
        ? await db.select().from(crewsTable).where(inArray(crewsTable.id, crewIds))
        : [];
      const jobs = jobIds.length
        ? await db.select().from(jobsTable).where(inArray(jobsTable.id, jobIds))
        : [];
      const crewName = (id: string) => crews.find((c) => c.id === id)?.name ?? "A crew";
      const jobNo = (id: string) => jobs.find((j) => j.id === id)?.jobNo ?? "a job";
      const seenJobs = new Set<string>();
      for (const offer of staleOffers) {
        // Dedupe per job (matches the entityId stored on the notification).
        if (seenJobs.has(offer.jobId)) continue;
        seenJobs.add(offer.jobId);
        if (await alreadyNotified("autopilot_stale_offer", offer.jobId)) continue;
        const body = `${crewName(offer.crewId)} hasn't responded to the offer for job ${jobNo(offer.jobId)} in over a day — consider rebroadcasting or calling.`;
        await raise({
          kind: "autopilot_stale_offer",
          entityType: "job",
          entityId: offer.jobId,
          title: `No response on job ${jobNo(offer.jobId)}`,
          body,
        });
        actions.push(body);
      }
    }

    // 3) Aging open jobs — created 3+ days ago, still unscheduled.
    const agingCutoff = new Date(now.getTime() - AGING_JOB_MS);
    const agingJobs = await db
      .select()
      .from(jobsTable)
      .where(
        and(
          eq(jobsTable.status, "open"),
          isNull(jobsTable.scheduledOn),
          lt(jobsTable.createdAt, agingCutoff),
        ),
      );
    if (agingJobs.length) {
      const propIds = [...new Set(agingJobs.map((j) => j.propertyId))];
      const props = propIds.length
        ? await db
            .select()
            .from(propertiesTable)
            .where(inArray(propertiesTable.id, propIds))
        : [];
      const propName = (id: string) =>
        props.find((p) => p.id === id)?.name ?? "a property";
      for (const job of agingJobs) {
        if (await alreadyNotified("autopilot_aging_job", job.id)) continue;
        const days = Math.floor((now.getTime() - job.createdAt.getTime()) / 86400000);
        const body = `Job ${job.jobNo} at ${propName(job.propertyId)} has been waiting ${days} days without a schedule — get it on the calendar.`;
        await raise({
          kind: "autopilot_aging_job",
          entityType: "job",
          entityId: job.id,
          title: `Job ${job.jobNo} still unscheduled`,
          body,
        });
        actions.push(body);
      }
    }

    if (actions.length) {
      logger.info({ count: actions.length }, "Autopilot raised alerts");
    }
  } catch (err) {
    logger.warn({ err }, "Autopilot run failed");
  }
  return actions;
}
