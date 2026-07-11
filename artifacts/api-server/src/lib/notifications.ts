import {
  db,
  invoicesTable,
  paymentsTable,
  jobsTable,
  bidsTable,
  expensesTable,
} from "@workspace/db";
import { computeQueues, type FeedItem } from "./queues";
import { sendEmail } from "./email";
import { logger } from "./logger";

export const ADMIN_EMAIL = "admin@archangelcontractors.com";

const DAY = 1000 * 60 * 60 * 24;

type TierKey = "now" | "today" | "week";

const TIER_ORDER: TierKey[] = ["now", "today", "week"];

const TIER_STYLE: Record<
  TierKey,
  { label: string; accent: string; bg: string; chip: string }
> = {
  now: {
    label: "Urgent — needs you now",
    accent: "#be3c3c",
    bg: "#fbecec",
    chip: "#be3c3c",
  },
  today: {
    label: "Today",
    accent: "#8f6a1f",
    bg: "#faf3e2",
    chip: "#8f6a1f",
  },
  week: {
    label: "This week",
    accent: "#5b5e66",
    bg: "#f1f1f0",
    chip: "#5b5e66",
  },
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function tierOf(item: FeedItem): TierKey {
  return item.tier === "now" || item.tier === "today" ? item.tier : "week";
}

function renderItem(item: FeedItem, accent: string): string {
  const metaChips = (item.meta ?? [])
    .map((m) => {
      const c = m.warn ? "#be3c3c" : m.gold ? "#8f6a1f" : "#5b5e66";
      const bg = m.warn ? "#fbecec" : m.gold ? "#faf3e2" : "#eeeeed";
      return `<span style="display:inline-block;font-size:11px;font-weight:600;color:${c};background:${bg};border-radius:999px;padding:2px 9px;margin-right:6px;white-space:nowrap;">${esc(
        m.label,
      )}</span>`;
    })
    .join("");
  const amount =
    typeof item.amount === "number" && item.amount > 0
      ? `<td align="right" style="font-family:'Courier New',monospace;font-size:14px;font-weight:700;color:#8f6a1f;padding-left:12px;white-space:nowrap;vertical-align:top;">${money(
          item.amount,
        )}</td>`
      : "";
  return `
  <tr>
    <td style="padding:0 0 10px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;">
        <tr>
          <td style="background:#ffffff;border-left:4px solid ${accent};border-radius:10px;padding:12px 14px;box-shadow:0 1px 3px rgba(23,24,28,0.08);">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="vertical-align:top;">
                  <div style="font-size:15px;font-weight:700;color:#17181c;line-height:1.3;">${esc(
                    item.title,
                  )}</div>
                  ${
                    item.sub
                      ? `<div style="font-size:13px;color:#6b6e76;margin-top:3px;line-height:1.35;">${esc(
                          item.sub,
                        )}</div>`
                      : ""
                  }
                  ${metaChips ? `<div style="margin-top:8px;">${metaChips}</div>` : ""}
                </td>
                ${amount}
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

function renderSection(tier: TierKey, items: FeedItem[]): string {
  if (items.length === 0) return "";
  const s = TIER_STYLE[tier];
  const rows = items.map((it) => renderItem(it, s.accent)).join("");
  return `
  <tr><td style="padding:8px 0 6px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="vertical-align:middle;">
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${s.chip};margin-right:8px;"></span>
          <span style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${s.accent};">${esc(
            s.label,
          )}</span>
          <span style="font-size:12px;font-weight:600;color:#9a9da4;margin-left:8px;">${items.length}</span>
        </td>
      </tr>
    </table>
  </td></tr>
  <tr><td style="padding:2px 0 6px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
  </td></tr>`;
}

function shell(title: string, dateLabel: string, summary: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f2ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f2ee;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr><td style="padding:0 4px 16px 4px;">
          <div style="font-size:12px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#8f6a1f;">ArchAngel · HALO</div>
          <div style="font-size:22px;font-weight:800;color:#17181c;margin-top:4px;">${esc(
            title,
          )}</div>
          <div style="font-size:13px;color:#6b6e76;margin-top:2px;">${esc(dateLabel)}</div>
        </td></tr>
        <tr><td style="padding:0 4px 8px 4px;">
          <div style="font-size:14px;color:#3a3c42;line-height:1.5;background:#ffffff;border-radius:12px;padding:14px 16px;box-shadow:0 1px 3px rgba(23,24,28,0.08);">${summary}</div>
        </td></tr>
        <tr><td style="padding:6px 4px 0 4px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table>
        </td></tr>
        <tr><td style="padding:18px 4px 4px 4px;">
          <div style="font-size:12px;color:#9a9da4;line-height:1.5;border-top:1px solid #e2e1dc;padding-top:12px;">Sent by HALO for ArchAngel Contractors. Ordered by urgency.</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function dateLabel(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
}

function groupByTier(feed: FeedItem[]): Record<TierKey, FeedItem[]> {
  const groups: Record<TierKey, FeedItem[]> = { now: [], today: [], week: [] };
  for (const item of feed) groups[tierOf(item)].push(item);
  return groups;
}

export type EmailContent = { subject: string; html: string };

export function buildDailyDigest(feed: FeedItem[]): EmailContent {
  const groups = groupByTier(feed);
  const urgent = groups.now.length;
  const total = feed.length;
  const parts = TIER_ORDER.map((t) => `${groups[t].length} ${TIER_STYLE[t].label.split(" ")[0].toLowerCase()}`);
  const summary =
    total === 0
      ? `<strong>All clear.</strong> Nothing on the task list right now — enjoy the quiet.`
      : `<strong>${total} item${total === 1 ? "" : "s"} on your list</strong> — ${esc(
          parts.join(" · "),
        )}. Sorted with the most urgent first.`;
  const body = TIER_ORDER.map((t) => renderSection(t, groups[t])).join("");
  const subject =
    urgent > 0
      ? `HALO daily list — ${total} item${total === 1 ? "" : "s"}, ${urgent} urgent`
      : `HALO daily list — ${total} item${total === 1 ? "" : "s"}`;
  return { subject, html: shell("Daily task list", dateLabel(), summary, body) };
}

export function buildUrgentAlert(feed: FeedItem[]): EmailContent {
  const urgent = feed.filter((f) => tierOf(f) === "now");
  const count = urgent.length;
  const summary = `<strong style="color:#be3c3c;">${count} item${
    count === 1 ? "" : "s"
  } need you right now.</strong> These are time-sensitive — clear them first.`;
  const body = renderSection("now", urgent);
  const subject = `⚠ HALO urgent — ${count} item${count === 1 ? "" : "s"} need you now`;
  return { subject, html: shell("Urgent task list", dateLabel(), summary, body) };
}

export async function sendDailyDigest(
  feed?: FeedItem[],
): Promise<{ sent: boolean; count: number }> {
  const items = feed ?? (await computeQueues()).feed;
  const { subject, html } = buildDailyDigest(items);
  const sent = (await sendEmail({ to: ADMIN_EMAIL, subject, html })).ok;
  logger.info({ count: items.length, sent }, "Daily digest dispatch");
  return { sent, count: items.length };
}

export async function sendUrgentAlert(
  feed?: FeedItem[],
): Promise<{ sent: boolean; count: number }> {
  const items = feed ?? (await computeQueues()).feed;
  const urgent = items.filter((f) => tierOf(f) === "now");
  if (urgent.length === 0) {
    return { sent: false, count: 0 };
  }
  const { subject, html } = buildUrgentAlert(items);
  const sent = (await sendEmail({ to: ADMIN_EMAIL, subject, html })).ok;
  logger.info({ count: urgent.length, sent }, "Urgent alert dispatch");
  return { sent, count: urgent.length };
}

export function urgentSignature(feed: FeedItem[]): string {
  return feed
    .filter((f) => tierOf(f) === "now")
    .map((f) => f.id)
    .sort()
    .join("|");
}

// ============ Evening close ============

const CLOSE_SIGNOFF =
  "Desk is clear — the rest can wait until 6:45 tomorrow.";

export function buildEveningClose(feed: FeedItem[]): EmailContent {
  const groups = groupByTier(feed);
  const open = feed.length;
  const urgent = groups.now.length;
  const summary =
    open === 0
      ? `<strong>Everything's handled.</strong> Nothing carries into tomorrow. ${esc(
          CLOSE_SIGNOFF,
        )}`
      : `<strong>${open} open item${open === 1 ? "" : "s"} carry into tomorrow</strong>${
          urgent > 0
            ? ` — ${urgent} still urgent`
            : ""
        }. They'll lead your 6:45a brief. ${esc(CLOSE_SIGNOFF)}`;
  const body = TIER_ORDER.map((t) => renderSection(t, groups[t])).join("");
  const subject =
    open === 0
      ? "HALO evening close — desk is clear"
      : `HALO evening close — ${open} item${open === 1 ? "" : "s"} for tomorrow`;
  return { subject, html: shell("Evening close", dateLabel(), summary, body) };
}

export async function sendEveningClose(
  feed?: FeedItem[],
): Promise<{ sent: boolean; count: number }> {
  const items = feed ?? (await computeQueues()).feed;
  const { subject, html } = buildEveningClose(items);
  const sent = (await sendEmail({ to: ADMIN_EMAIL, subject, html })).ok;
  logger.info({ count: items.length, sent }, "Evening close dispatch");
  return { sent, count: items.length };
}

// ============ Weekly scorecard ============

export type WeeklyStats = {
  revenueLanded: number;
  paymentsCount: number;
  jobsCompleted: number;
  avgMarginPct: number | null;
  invoicesSent: number;
  invoicesSentValue: number;
  bidsWon: number;
  bidsWonValue: number;
  expensesLogged: number;
  openReceivable: number;
};

export async function weeklyStats(): Promise<WeeklyStats> {
  const since = Date.now() - 7 * DAY;
  const [payments, jobs, invoices, bids, expenses] = await Promise.all([
    db.select().from(paymentsTable),
    db.select().from(jobsTable),
    db.select().from(invoicesTable),
    db.select().from(bidsTable),
    db.select().from(expensesTable),
  ]);

  const recentPayments = payments.filter(
    (p) => p.receivedAt && p.receivedAt.getTime() >= since,
  );
  const revenueLanded = recentPayments.reduce((s, p) => s + (p.amount ?? 0), 0);

  const completed = jobs.filter(
    (j) => j.completedAt && j.completedAt.getTime() >= since,
  );
  const withMargin = completed.filter((j) => j.marginPct != null);
  const avgMarginPct =
    withMargin.length > 0
      ? (withMargin.reduce((s, j) => s + (j.marginPct ?? 0), 0) /
          withMargin.length) *
        100
      : null;

  const sentInvoices = invoices.filter(
    (i) => i.sentAt && i.sentAt.getTime() >= since,
  );
  const invoicesSentValue = sentInvoices.reduce(
    (s, i) => s + (i.amount ?? 0),
    0,
  );

  const wonBids = bids.filter(
    (b) =>
      b.status === "approved" &&
      b.decidedAt &&
      b.decidedAt.getTime() >= since,
  );
  const bidsWonValue = wonBids.reduce((s, b) => s + (b.amount ?? 0), 0);

  const recentExpenses = expenses.filter(
    (e) => e.spentOn && new Date(e.spentOn).getTime() >= since,
  );

  const openReceivable = invoices
    .filter((i) => i.sentAt && !i.paidAt)
    .reduce((s, i) => s + (i.amount ?? 0), 0);

  return {
    revenueLanded,
    paymentsCount: recentPayments.length,
    jobsCompleted: completed.length,
    avgMarginPct,
    invoicesSent: sentInvoices.length,
    invoicesSentValue,
    bidsWon: wonBids.length,
    bidsWonValue,
    expensesLogged: recentExpenses.reduce((s, e) => s + (e.amount ?? 0), 0),
    openReceivable,
  };
}

function statCard(label: string, value: string, sub?: string): string {
  return `
  <td width="50%" style="padding:6px;">
    <div style="background:#ffffff;border-radius:12px;padding:14px 16px;box-shadow:0 1px 3px rgba(23,24,28,0.08);">
      <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#8f6a1f;">${esc(
        label,
      )}</div>
      <div style="font-size:24px;font-weight:800;color:#17181c;margin-top:6px;font-family:'Courier New',monospace;">${esc(
        value,
      )}</div>
      ${
        sub
          ? `<div style="font-size:12px;color:#6b6e76;margin-top:2px;">${esc(sub)}</div>`
          : ""
      }
    </div>
  </td>`;
}

export function buildWeeklyScorecard(stats: WeeklyStats): EmailContent {
  const margin =
    stats.avgMarginPct != null ? `${Math.round(stats.avgMarginPct)}%` : "—";
  const marginSub =
    stats.avgMarginPct != null && stats.avgMarginPct < 25
      ? "below 25% floor"
      : "on target";
  const rows = [
    [
      statCard("Cash landed", money(stats.revenueLanded), `${stats.paymentsCount} payment${stats.paymentsCount === 1 ? "" : "s"}`),
      statCard("Jobs completed", String(stats.jobsCompleted), "this week"),
    ],
    [
      statCard("Avg margin", margin, marginSub),
      statCard("Invoices sent", money(stats.invoicesSentValue), `${stats.invoicesSent} invoice${stats.invoicesSent === 1 ? "" : "s"}`),
    ],
    [
      statCard("Bids won", money(stats.bidsWonValue), `${stats.bidsWon} approved`),
      statCard("Open receivable", money(stats.openReceivable), "awaiting payment"),
    ],
  ]
    .map(
      (pair) =>
        `<tr>${pair.join("")}</tr>`,
    )
    .join("");
  const body = `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>`;
  const summary = `<strong>Week in review.</strong> ${money(
    stats.revenueLanded,
  )} landed across ${stats.paymentsCount} payment${
    stats.paymentsCount === 1 ? "" : "s"
  }, ${stats.jobsCompleted} job${
    stats.jobsCompleted === 1 ? "" : "s"
  } completed at ${margin} average margin.`;
  return {
    subject: `HALO weekly scorecard — ${money(stats.revenueLanded)} landed`,
    html: shell("Weekly scorecard", dateLabel(), summary, body),
  };
}

export async function sendWeeklyScorecard(): Promise<{
  sent: boolean;
  stats: WeeklyStats;
}> {
  const stats = await weeklyStats();
  const { subject, html } = buildWeeklyScorecard(stats);
  const sent = (await sendEmail({ to: ADMIN_EMAIL, subject, html })).ok;
  logger.info({ stats, sent }, "Weekly scorecard dispatch");
  return { sent, stats };
}
