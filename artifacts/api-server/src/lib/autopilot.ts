import { and, eq, lt, isNull, inArray } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import {
  db,
  invoicesTable,
  jobBroadcastsTable,
  jobsTable,
  crewsTable,
  propertiesTable,
  notificationsTable,
  activitiesTable,
  autopilotActionsTable,
  type AutopilotAction,
} from "@workspace/db";
import { contactsTable } from "@workspace/db";
import { getBusinessSettings } from "./businessSettings";
import { sendInvoiceReminderEmail } from "./email";
import { logger } from "./logger";

/**
 * Pick the billing email for a property: prefer a contact whose role mentions
 * billing/AP/accounting, otherwise the first contact with any email.
 */
async function findBillingEmail(propertyId: string): Promise<string | null> {
  const contacts = await db
    .select()
    .from(contactsTable)
    .where(eq(contactsTable.propertyId, propertyId));
  const withEmail = contacts.filter((c) => (c.email ?? "").trim().length > 0);
  if (withEmail.length === 0) return null;
  const billing = withEmail.find((c) =>
    /bill|account|ap\b|payable/i.test(c.role ?? ""),
  );
  return (billing ?? withEmail[0]).email!.trim();
}

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
 * Propose an Autopilot action (one-shot per kind + entity — a dismissed or
 * executed action never re-fires for the same entity). Returns the created
 * row, or null when one already exists.
 */
async function propose(opts: {
  kind: string;
  entityType: string;
  entityId: string;
  title: string;
  body: string;
}): Promise<AutopilotAction | null> {
  // Unique index on (kind, entityId) makes this one-shot even under
  // concurrent runs — the loser of the race simply gets no row back.
  const [created] = await db
    .insert(autopilotActionsTable)
    .values({
      kind: opts.kind,
      entityType: opts.entityType,
      entityId: opts.entityId,
      title: opts.title,
      body: opts.body,
    })
    .onConflictDoNothing()
    .returning();
  return created ?? null;
}

async function markAction(
  id: string,
  status: "executed" | "failed" | "dismissed",
  result: string,
): Promise<void> {
  await db
    .update(autopilotActionsTable)
    .set({ status, result, executedAt: new Date() })
    .where(eq(autopilotActionsTable.id, id));
}

/** Send the overdue-invoice reminder email to the property billing contact. */
async function executeInvoiceReminder(action: AutopilotAction): Promise<string> {
  const [inv] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, action.entityId));
  if (!inv) throw new Error("Invoice no longer exists");
  if (inv.paidAt || inv.status === "paid") {
    return `Invoice ${inv.invoiceNo} was already paid — no reminder needed.`;
  }
  const [prop] = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.id, inv.propertyId));
  const to = await findBillingEmail(inv.propertyId);
  if (!to) {
    throw new Error(
      `No billing contact email on file for ${prop?.name ?? "this property"} — add a contact with an email on the property page, then approve again.`,
    );
  }
  const now = Date.now();
  const days = Math.max(
    1,
    Math.floor((now - (inv.dueAt?.getTime() ?? now)) / 86400000),
  );
  const sent = await sendInvoiceReminderEmail({
    to,
    billToName: inv.billToName ?? prop?.name ?? null,
    invoiceNo: inv.invoiceNo,
    amount: inv.amount,
    daysOverdue: days,
    propertyName: prop?.name ?? null,
  });
  if (!sent.ok) throw new Error(sent.error ?? "Email failed to send");
  await db.insert(activitiesTable).values({
    entityType: "invoice",
    entityId: inv.id,
    kind: "email_sent",
    body: `Autopilot emailed a payment reminder for invoice ${inv.invoiceNo} to ${to}.`,
  });
  return `Reminder email sent to ${to} for invoice ${inv.invoiceNo}.`;
}

/** Rebroadcast a ghosted job: refresh stale offers and widen to matching crews. */
async function executeRebroadcast(action: AutopilotAction): Promise<string> {
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, action.entityId));
  if (!job) throw new Error("Job no longer exists");
  if (job.status === "complete" || job.boardStatus === "completed") {
    return `Job ${job.jobNo} is already completed — nothing to rebroadcast.`;
  }
  if (job.boardStatus === "filled") {
    return `Job ${job.jobNo} was already accepted by a crew — nothing to rebroadcast.`;
  }

  const crews = await db.select().from(crewsTable).where(eq(crewsTable.active, true));
  const wanted = (job.category ?? "").trim().toLowerCase();
  const targets = wanted
    ? crews.filter((c) => (c.trade ?? "").trim().toLowerCase() === wanted)
    : crews;
  if (targets.length === 0) throw new Error("No matching active crews to rebroadcast to");

  const existing = await db
    .select()
    .from(jobBroadcastsTable)
    .where(eq(jobBroadcastsTable.jobId, job.id));
  const byCrew = new Map(existing.map((b) => [b.crewId, b]));

  const now = new Date();
  let refreshed = 0;
  let added = 0;
  for (const crew of targets) {
    if (!crew.portalToken) {
      const token = randomBytes(24).toString("base64url");
      await db
        .update(crewsTable)
        .set({ portalToken: token })
        .where(eq(crewsTable.id, crew.id));
    }
    const prior = byCrew.get(crew.id);
    if (!prior) {
      await db.insert(jobBroadcastsTable).values({
        jobId: job.id,
        crewId: crew.id,
        status: "pending",
        sentAt: now,
      });
      added += 1;
    } else if (prior.status === "pending") {
      // Refresh the stale offer so it counts as newly sent.
      await db
        .update(jobBroadcastsTable)
        .set({ sentAt: now })
        .where(eq(jobBroadcastsTable.id, prior.id));
      refreshed += 1;
    } else if (prior.status === "declined" || prior.status === "withdrawn") {
      await db
        .update(jobBroadcastsTable)
        .set({ status: "pending", sentAt: now, respondedAt: null })
        .where(eq(jobBroadcastsTable.id, prior.id));
      added += 1;
    }
  }
  await db.insert(activitiesTable).values({
    entityType: "job",
    entityId: job.id,
    kind: "autopilot",
    body: `Autopilot rebroadcast job ${job.jobNo}: ${added} new offer${added === 1 ? "" : "s"}, ${refreshed} refreshed.`,
  });
  return `Job ${job.jobNo} rebroadcast — ${added} new offer${added === 1 ? "" : "s"} sent, ${refreshed} refreshed.`;
}

/**
 * Execute a pending Autopilot action. Atomically claims the row first
 * (pending -> executing) so concurrent approvals can't double-fire the side
 * effects. Returns null if someone else already claimed/resolved the action.
 */
export async function executeAutopilotAction(
  action: AutopilotAction,
): Promise<AutopilotAction | null> {
  const [claimed] = await db
    .update(autopilotActionsTable)
    .set({ status: "executing" })
    .where(
      and(
        eq(autopilotActionsTable.id, action.id),
        eq(autopilotActionsTable.status, "pending"),
      ),
    )
    .returning();
  if (!claimed) return null;
  try {
    let result: string;
    if (action.kind === "send_invoice_reminder") {
      result = await executeInvoiceReminder(action);
    } else if (action.kind === "rebroadcast_job") {
      result = await executeRebroadcast(action);
    } else {
      throw new Error(`Unknown autopilot action kind: ${action.kind}`);
    }
    await markAction(action.id, "executed", result);
    return { ...action, status: "executed", result, executedAt: new Date() };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, actionId: action.id }, "Autopilot action failed");
    await markAction(action.id, "failed", msg);
    return { ...action, status: "failed", result: msg, executedAt: new Date() };
  }
}

/**
 * Autopilot background agent. Watches for problems the office would otherwise
 * catch manually. For each issue it raises a notification AND proposes a
 * concrete action (reminder email, rebroadcast). When auto-approve is on the
 * action executes immediately; otherwise it waits for one-tap approval.
 * Never throws.
 */
export async function runAutopilot(): Promise<string[]> {
  const actions: string[] = [];
  try {
    const settings = await getBusinessSettings();
    if (settings.autopilotEnabled === false) return actions;
    const autoApprove = settings.autopilotAutoApprove === true;
    const pendingToExecute: AutopilotAction[] = [];

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
    const overdueProps = overdue.length
      ? await db
          .select()
          .from(propertiesTable)
          .where(inArray(propertiesTable.id, [...new Set(overdue.map((i) => i.propertyId))]))
      : [];
    for (const inv of overdue) {
      const days = Math.max(
        1,
        Math.floor((now.getTime() - (inv.dueAt?.getTime() ?? now.getTime())) / 86400000),
      );
      const amount = `$${inv.amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
      if (!(await alreadyNotified("autopilot_overdue_invoice", inv.id))) {
        const body = `Invoice ${inv.invoiceNo} (${amount}) is ${days} day${days === 1 ? "" : "s"} past due — time to follow up.`;
        await raise({
          kind: "autopilot_overdue_invoice",
          entityType: "invoice",
          entityId: inv.id,
          title: `Invoice ${inv.invoiceNo} is overdue`,
          body,
        });
        actions.push(body);
      }
      const prop = overdueProps.find((p) => p.id === inv.propertyId);
      const proposed = await propose({
        kind: "send_invoice_reminder",
        entityType: "invoice",
        entityId: inv.id,
        title: `Email payment reminder for invoice ${inv.invoiceNo}`,
        body: `Send a branded payment reminder for invoice ${inv.invoiceNo} (${amount}, ${days} day${days === 1 ? "" : "s"} overdue)${prop?.name ? ` to the billing contact at ${prop.name}` : ""}.`,
      });
      if (proposed) pendingToExecute.push(proposed);
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
        if (!(await alreadyNotified("autopilot_stale_offer", offer.jobId))) {
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
        const proposed = await propose({
          kind: "rebroadcast_job",
          entityType: "job",
          entityId: offer.jobId,
          title: `Rebroadcast job ${jobNo(offer.jobId)}`,
          body: `${crewName(offer.crewId)} has ignored the offer for job ${jobNo(offer.jobId)} for over a day. Re-send the offer and widen it to all matching active crews.`,
        });
        if (proposed) pendingToExecute.push(proposed);
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

    // Auto-approve mode: execute freshly proposed actions immediately.
    if (autoApprove) {
      for (const action of pendingToExecute) {
        const done = await executeAutopilotAction(action);
        if (done?.result) actions.push(done.result);
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
