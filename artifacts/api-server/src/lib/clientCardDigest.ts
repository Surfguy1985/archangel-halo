import { and, eq, isNull, inArray } from "drizzle-orm";
import {
  db,
  clientAccountsTable,
  clientBoardCardsTable,
  clientCardCommentsTable,
  clientUsersTable,
  propertiesTable,
  type ClientBoardCard,
} from "@workspace/db";
import { sendEmail } from "./email";
import { getBusinessSettings } from "./businessSettings";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Client board card notifications
//
// Cards are raised silently by raiseClientCard(). The scheduler calls
// sendClientCardDigests() hourly: for every client account with the
// notifyNewCards toggle on, it collects cards whose notifiedAt is NULL and
// sends ONE digest email (Resend) to the billing contact (falling back to the
// account's admin dashboard user) with a deep link to the board. Cards are
// atomically claimed (guarded update on notifiedAt IS NULL) BEFORE the send
// so overlapping sweeps can never double-email; if the send fails, the claim
// is released so the next sweep retries.
//
// SMS (Twilio) is intentionally not wired here yet — a Twilio helper does not
// exist in this server; once it lands, the digest can add a text channel.
// ---------------------------------------------------------------------------

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function publicBaseUrl(): string {
  const domain =
    process.env.REPLIT_DOMAINS?.split(",")[0] ?? process.env.REPLIT_DEV_DOMAIN;
  return domain ? `https://${domain}` : "";
}

function boardUrl(token: string): string {
  const base = publicBaseUrl();
  return base ? `${base}/board/${token}` : `/board/${token}`;
}

const KIND_LABEL: Record<string, string> = {
  invoice: "Invoice",
  payment_request: "Payment request",
  summary: "Job summary",
  tracker: "Live tracker",
  photos: "Photos",
  flag: "Heads-up",
  manual: "Note",
};

function digestHtml(opts: {
  company: string;
  propertyName: string;
  cards: ClientBoardCard[];
  boardLink: string;
  heading?: string;
}): string {
  const rows = opts.cards
    .map((c) => {
      const label = KIND_LABEL[c.kind] ?? "Update";
      const amount =
        c.amount != null
          ? ` · $${c.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
          : "";
      const due = c.dueDate ? ` · due ${escHtml(c.dueDate)}` : "";
      return `<tr><td style="padding:10px 14px;border-bottom:1px solid #eceae4;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#8f6a1f;">${escHtml(label)}${amount}${due}</div>
        <div style="font-size:15px;font-weight:700;color:#17181c;margin-top:2px;">${escHtml(c.title)}</div>
        ${c.body ? `<div style="font-size:13px;color:#5a5d64;line-height:1.5;margin-top:2px;">${escHtml(c.body)}</div>` : ""}
      </td></tr>`;
    })
    .join("");
  const n = opts.cards.length;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f2ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f2ee;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr><td style="background:#17181c;border-radius:14px 14px 0 0;padding:22px 26px;">
          <div style="font-size:12px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#c9a24b;">${escHtml(opts.company)}</div>
          <div style="font-size:22px;font-weight:800;color:#ffffff;margin-top:6px;">${opts.heading ? escHtml(opts.heading) : `${n === 1 ? "A new card is" : `${n} new cards are`} on your board`}</div>
        </td></tr>
        <tr><td style="background:#ffffff;padding:20px 26px 24px 26px;border-radius:0 0 14px 14px;box-shadow:0 1px 3px rgba(23,24,28,0.08);">
          <p style="font-size:15px;color:#3a3c42;line-height:1.6;margin:0 0 14px 0;">We just added ${n === 1 ? "an update" : "updates"} for <strong>${escHtml(opts.propertyName)}</strong> to your project board:</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f5f0;border-radius:10px;margin:0 0 18px 0;">${rows}</table>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="border-radius:10px;background:#17181c;">
            <a href="${escHtml(opts.boardLink)}" style="display:inline-block;padding:12px 26px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">Open your board</a>
          </td></tr></table>
          <p style="font-size:12px;color:#9a9da4;line-height:1.5;margin:16px 0 0 0;text-align:center;">You get one summary at most once an hour when new cards land. Your account admin can turn these off from the dashboard settings with our team.</p>
        </td></tr>
        <tr><td style="padding:16px 8px 4px 8px;">
          <div style="font-size:12px;color:#9a9da4;line-height:1.5;text-align:center;">${escHtml(opts.company)}</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export type PushNotifyResult = {
  notified: boolean;
  notifiedTo: string | null;
  skippedReason: "off" | "no_contact" | "send_failed" | null;
};

/**
 * Instant single-card notification for an office push ("Your vendor has sent
 * you a card"). Claims the card (notifiedAt) BEFORE sending so the hourly
 * digest never double-mails it; on send failure the claim is released so the
 * digest retries. Respects the account's notifyNewCards toggle.
 */
export async function notifyCardPush(
  propertyId: string,
  card: ClientBoardCard,
): Promise<PushNotifyResult> {
  const [account] = await db
    .select()
    .from(clientAccountsTable)
    .where(eq(clientAccountsTable.propertyId, propertyId))
    .limit(1);
  if (!account || account.status === "cancelled" || !account.notifyNewCards) {
    // Toggle off: claim so the digest doesn't email it later either.
    await claimCards([card.id]);
    return { notified: false, notifiedTo: null, skippedReason: "off" };
  }
  let to = account.billingContact?.email?.trim() || null;
  if (!to) {
    const admins = await db
      .select({ email: clientUsersTable.email })
      .from(clientUsersTable)
      .where(
        and(
          eq(clientUsersTable.propertyId, propertyId),
          eq(clientUsersTable.role, "admin"),
          eq(clientUsersTable.active, true),
        ),
      )
      .limit(1);
    to = admins[0]?.email ?? null;
  }
  if (!to) {
    // Leave unclaimed — the digest will retry once a contact exists.
    return { notified: false, notifiedTo: null, skippedReason: "no_contact" };
  }
  const claimed = await claimCards([card.id]);
  if (claimed.length === 0) {
    // A concurrent sweep already notified it.
    return { notified: true, notifiedTo: to, skippedReason: null };
  }
  const settings = await getBusinessSettings();
  const company = settings.companyName || "ArchAngel Contractors";
  const [property] = await db
    .select({ name: propertiesTable.name })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, propertyId))
    .limit(1);
  const propertyName = property?.name ?? "your property";
  const result = await sendEmail({
    to,
    subject: `Your vendor has sent you a card — ${card.title}`,
    html: digestHtml({
      company,
      propertyName,
      cards: [card],
      boardLink: boardUrl(account.dashboardToken),
      heading: "Your vendor has sent you a card",
    }),
  });
  if (!result.ok) {
    await db
      .update(clientBoardCardsTable)
      .set({ notifiedAt: null })
      .where(eq(clientBoardCardsTable.id, card.id));
    logger.warn(
      { propertyId, to, error: result.error },
      "Card push notification failed; digest will retry",
    );
    return { notified: false, notifiedTo: to, skippedReason: "send_failed" };
  }
  logger.info({ propertyId, to, cardId: card.id }, "Card push notification sent");
  return { notified: true, notifiedTo: to, skippedReason: null };
}

let running = false;

/** Hourly sweep: one digest email per account covering all un-notified cards. */
export async function sendClientCardDigests(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await sweep();
  } catch (err) {
    logger.warn({ err }, "Client card digest sweep failed");
  }
  try {
    await sweepMessages();
  } catch (err) {
    logger.warn({ err }, "Client message digest sweep failed");
  }
  running = false;
}

/**
 * Hourly message digest: office replies on card threads the client has not
 * seen in-app get one "you have N new messages" email per property. Same
 * claim-before-send pattern as cards (guarded update on notifiedAt IS NULL),
 * released on send failure so the next sweep retries. Messages the client
 * already read in-app are silently claimed — no email for old news.
 */
async function sweepMessages(): Promise<void> {
  const pending = await db
    .select()
    .from(clientCardCommentsTable)
    .where(
      and(
        eq(clientCardCommentsTable.authorType, "office"),
        isNull(clientCardCommentsTable.notifiedAt),
      ),
    );
  if (pending.length === 0) return;

  const claim = async (ids: string[]) =>
    ids.length
      ? db
          .update(clientCardCommentsTable)
          .set({ notifiedAt: new Date() })
          .where(
            and(
              inArray(clientCardCommentsTable.id, ids),
              isNull(clientCardCommentsTable.notifiedAt),
            ),
          )
          .returning()
      : [];

  // Already read in-app → claim quietly, never email.
  const alreadyRead = pending.filter((m) => m.readAt);
  if (alreadyRead.length) await claim(alreadyRead.map((m) => m.id));

  const unread = pending.filter((m) => !m.readAt);
  const byProperty = new Map<string, typeof unread>();
  for (const m of unread) {
    byProperty.set(m.propertyId, [...(byProperty.get(m.propertyId) ?? []), m]);
  }
  if (byProperty.size === 0) return;

  const settings = await getBusinessSettings();
  const company = settings.companyName || "ArchAngel Contractors";

  for (const [propertyId, msgs] of byProperty) {
    const [account] = await db
      .select()
      .from(clientAccountsTable)
      .where(eq(clientAccountsTable.propertyId, propertyId))
      .limit(1);
    if (!account || account.status === "cancelled" || !account.notifyNewCards) {
      await claim(msgs.map((m) => m.id));
      continue;
    }
    let to = account.billingContact?.email?.trim() || null;
    if (!to) {
      const admins = await db
        .select({ email: clientUsersTable.email })
        .from(clientUsersTable)
        .where(
          and(
            eq(clientUsersTable.propertyId, propertyId),
            eq(clientUsersTable.role, "admin"),
            eq(clientUsersTable.active, true),
          ),
        )
        .limit(1);
      to = admins[0]?.email ?? null;
    }
    if (!to) {
      // Retried once a contact exists; cap buildup at 7 days like cards.
      const stale = msgs.filter(
        (m) => Date.now() - m.createdAt.getTime() > 7 * 24 * 60 * 60 * 1000,
      );
      if (stale.length) await claim(stale.map((m) => m.id));
      continue;
    }

    // Claim only rows STILL unread at claim time — a message read in-app
    // between the snapshot and this claim must never be emailed as "new".
    const claimed = msgs.length
      ? await db
          .update(clientCardCommentsTable)
          .set({ notifiedAt: new Date() })
          .where(
            and(
              inArray(clientCardCommentsTable.id, msgs.map((m) => m.id)),
              isNull(clientCardCommentsTable.notifiedAt),
              isNull(clientCardCommentsTable.readAt),
            ),
          )
          .returning()
      : [];
    // Anything read in the meantime is claimed quietly (no email).
    const claimedIds = new Set(claimed.map((m) => m.id));
    const readMeanwhile = msgs.filter((m) => !claimedIds.has(m.id));
    if (readMeanwhile.length) await claim(readMeanwhile.map((m) => m.id));
    if (claimed.length === 0) continue;

    const [property] = await db
      .select({ name: propertiesTable.name })
      .from(propertiesTable)
      .where(eq(propertiesTable.id, propertyId))
      .limit(1);
    const propertyName = property?.name ?? "your property";
    const n = claimed.length;
    const preview = claimed
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, 5)
      .map(
        (m) =>
          `<tr><td style="padding:10px 14px;border-bottom:1px solid #eceae4;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#8f6a1f;">${escHtml(m.authorName)}</div>
        <div style="font-size:14px;color:#17181c;margin-top:2px;">${escHtml(m.body || (m.attachmentName ? `📎 ${m.attachmentName}` : "Photo"))}</div>
      </td></tr>`,
      )
      .join("");
    const link = boardUrl(account.dashboardToken);
    const result = await sendEmail({
      to,
      subject:
        n === 1
          ? `New message on your ${propertyName} board`
          : `${n} new messages on your ${propertyName} board`,
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f2ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f2ee;padding:24px 12px;"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td style="background:#17181c;border-radius:14px 14px 0 0;padding:22px 26px;">
        <div style="font-size:12px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#c9a24b;">${escHtml(company)}</div>
        <div style="font-size:22px;font-weight:800;color:#ffffff;margin-top:6px;">${n === 1 ? "You have a new message" : `You have ${n} new messages`}</div>
      </td></tr>
      <tr><td style="background:#ffffff;padding:20px 26px 24px 26px;border-radius:0 0 14px 14px;">
        <p style="font-size:15px;color:#3a3c42;line-height:1.6;margin:0 0 14px 0;">Our team replied on your <strong>${escHtml(propertyName)}</strong> board:</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f5f0;border-radius:10px;margin:0 0 18px 0;">${preview}</table>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="border-radius:10px;background:#17181c;">
          <a href="${escHtml(link)}" style="display:inline-block;padding:12px 26px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">Open the conversation</a>
        </td></tr></table>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`,
    });
    if (!result.ok) {
      await db
        .update(clientCardCommentsTable)
        .set({ notifiedAt: null })
        .where(inArray(clientCardCommentsTable.id, claimed.map((m) => m.id)));
      logger.warn(
        { propertyId, to, error: result.error },
        "Client message digest email failed; will retry next sweep",
      );
    } else {
      logger.info({ propertyId, to, messages: n }, "Client message digest email sent");
    }
  }
}

async function sweep(): Promise<void> {
  const pending = await db
    .select()
    .from(clientBoardCardsTable)
    .where(isNull(clientBoardCardsTable.notifiedAt));
  if (pending.length === 0) return;

  const byProperty = new Map<string, ClientBoardCard[]>();
  for (const card of pending) {
    const list = byProperty.get(card.propertyId) ?? [];
    list.push(card);
    byProperty.set(card.propertyId, list);
  }

  const settings = await getBusinessSettings();
  const company = settings.companyName || "ArchAngel Contractors";

  for (const [propertyId, cards] of byProperty) {
    const [account] = await db
      .select()
      .from(clientAccountsTable)
      .where(eq(clientAccountsTable.propertyId, propertyId))
      .limit(1);
    if (!account || account.status === "cancelled" || !account.notifyNewCards) {
      // No account / cancelled / toggle off: mark handled so cards don't pile
      // up forever waiting for a send that will never happen.
      await claimCards(cards.map((c) => c.id));
      continue;
    }
    let to = account.billingContact?.email?.trim() || null;
    if (!to) {
      const admins = await db
        .select({ email: clientUsersTable.email })
        .from(clientUsersTable)
        .where(
          and(
            eq(clientUsersTable.propertyId, propertyId),
            eq(clientUsersTable.role, "admin"),
            eq(clientUsersTable.active, true),
          ),
        )
        .limit(1);
      to = admins[0]?.email ?? null;
    }
    if (!to) {
      logger.info(
        { propertyId, cards: cards.length },
        "Client card digest skipped: no billing contact or admin user email",
      );
      // Leave un-notified: retried once a contact exists. To avoid indefinite
      // buildup, cap by claiming cards older than 7 days.
      const stale = cards.filter(
        (c) => Date.now() - c.createdAt.getTime() > 7 * 24 * 60 * 60 * 1000,
      );
      if (stale.length) await claimCards(stale.map((c) => c.id));
      continue;
    }

    // Atomically claim before sending — a concurrent sweep gets zero rows.
    const claimed = await claimCards(cards.map((c) => c.id));
    if (claimed.length === 0) continue;

    const [property] = await db
      .select({ name: propertiesTable.name })
      .from(propertiesTable)
      .where(eq(propertiesTable.id, propertyId))
      .limit(1);
    const propertyName = property?.name ?? "your property";
    const ordered = claimed
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const n = ordered.length;
    const result = await sendEmail({
      to,
      subject:
        n === 1
          ? `New card on your ${propertyName} board — ${ordered[0].title}`
          : `${n} new cards on your ${propertyName} board`,
      html: digestHtml({
        company,
        propertyName,
        cards: ordered,
        boardLink: boardUrl(account.dashboardToken),
      }),
    });
    if (!result.ok) {
      // Release the claim so the next sweep retries.
      await db
        .update(clientBoardCardsTable)
        .set({ notifiedAt: null })
        .where(inArray(clientBoardCardsTable.id, claimed.map((c) => c.id)));
      logger.warn(
        { propertyId, to, error: result.error },
        "Client card digest email failed; will retry next sweep",
      );
    } else {
      logger.info(
        { propertyId, to, cards: n },
        "Client card digest email sent",
      );
    }
  }
}

async function claimCards(ids: string[]): Promise<ClientBoardCard[]> {
  if (ids.length === 0) return [];
  return db
    .update(clientBoardCardsTable)
    .set({ notifiedAt: new Date() })
    .where(
      and(
        inArray(clientBoardCardsTable.id, ids),
        isNull(clientBoardCardsTable.notifiedAt),
      ),
    )
    .returning();
}
