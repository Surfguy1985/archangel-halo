import { computeQueues, type FeedItem } from "./queues";
import { sendEmail } from "./email";
import { logger } from "./logger";

export const ADMIN_EMAIL = "admin@archangelcontractors.com";

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
  const sent = await sendEmail({ to: ADMIN_EMAIL, subject, html });
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
  const sent = await sendEmail({ to: ADMIN_EMAIL, subject, html });
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
