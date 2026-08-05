import {
  db,
  clientAccountsTable,
  clientBoardCardsTable,
  clientBoardNotificationsTable,
  type ClientBoardCard,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { emitBoardEvent } from "./boardEvents";

// ---------------------------------------------------------------------------
// Client board pipeline
//
// Whenever the office sends the client ANYTHING (invoice, pay link, recap,
// live tracker, photos, a manual note), call raiseClientCard(). It creates —
// or updates, on re-send — one Trello-style card on that property's client
// board, prepopulated with every link the client needs. If the client account
// has an outbound webhookUrl, the event is also POSTed there so the client
// can mirror cards into their own tools (Trello, Slack, Zapier...).
//
// Cards land in the "inbox" column (the Archangel Contractors lane). The
// client drags them through todo / in_progress / done; some cards complete
// themselves (e.g. an invoice card when the invoice is paid).
// ---------------------------------------------------------------------------

export type CardLink = { label: string; url: string; kind?: string | null };

// SSRF guard for client-supplied webhook URLs: https only, and the hostname
// must not be a loopback/private/link-local address — checked both by name
// and by DNS resolution at save time and again before every dispatch.
export async function webhookUrlProblem(raw: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Webhook must be a valid URL";
  }
  if (url.protocol !== "https:") return "Webhook must be an https:// URL";
  if (url.port && url.port !== "443") return "Webhook must use the standard https port";
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "" ||
    !host.includes(".")
  ) {
    return "Webhook must point at a public host";
  }
  const { lookup } = await import("node:dns/promises");
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    return "Webhook host could not be resolved";
  }
  const isPrivate = (ip: string) =>
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) ||
    ip === "::1" ||
    /^f[cd]/i.test(ip) || // fc00::/7 unique local
    /^fe[89ab]/i.test(ip); // fe80::/10 link-local
  if (addrs.length === 0 || addrs.some((a) => isPrivate(a.address))) {
    return "Webhook must point at a public host";
  }
  return null;
}

export type RaiseCardInput = {
  propertyId: string;
  kind: "invoice" | "payment_request" | "summary" | "tracker" | "photos" | "flag" | "manual";
  title: string;
  body?: string | null;
  actionLabel?: string | null;
  amount?: number | null;
  dueDate?: string | null; // YYYY-MM-DD
  links?: CardLink[];
  sourceType: string;
  sourceId: string;
  jobId?: string | null;
  // Kind-specific interactive module payload (invoice snapshot, tracker GPS,
  // flagged items...). Rendered on both boards; action state lives in it too.
  module?: Record<string, unknown> | null;
};

async function postWebhook(propertyId: string, event: string, card: ClientBoardCard) {
  const [account] = await db
    .select({ webhookUrl: clientAccountsTable.webhookUrl, status: clientAccountsTable.status })
    .from(clientAccountsTable)
    .where(eq(clientAccountsTable.propertyId, propertyId))
    .limit(1);
  const url = account?.webhookUrl;
  if (!url || account.status === "cancelled") return;
  // Re-validate at dispatch time — DNS can change after the URL was saved.
  if ((await webhookUrlProblem(url)) !== null) return;
  // Fire-and-forget with a hard timeout — a slow client endpoint must never
  // hold up an office send.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "archangel-contractors",
        event, // card.created | card.updated | card.completed
        card: {
          id: card.id,
          kind: card.kind,
          column: card.column,
          title: card.title,
          body: card.body,
          actionLabel: card.actionLabel,
          amount: card.amount,
          dueDate: card.dueDate,
          links: card.links,
          jobId: card.jobId,
          createdAt: card.createdAt.toISOString(),
          updatedAt: card.updatedAt.toISOString(),
        },
      }),
      signal: controller.signal,
    });
  } catch {
    // Webhook failures are the client's problem to notice; never break a send.
  } finally {
    clearTimeout(timer);
  }
}

// Client action state keys that must survive a module refresh on re-send.
export const ACTION_STATE_KEYS = [
  "approvedAt",
  "approvedBy",
  "requestedAt",
  "requestId",
  "acknowledgedAt",
  "referredAt",
  "payMethod",
  "payMethodAt",
  "payMethodBy",
  "disputedAt",
  "disputeNote",
  "disputedBy",
  "disputeResolvedAt",
  "disputeResponse",
  "clientPaidAt",
  "clientPaidBy",
] as const;

function pickActionState(m: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!m) return {};
  const out: Record<string, unknown> = {};
  for (const k of ACTION_STATE_KEYS) if (m[k] !== undefined) out[k] = m[k];
  return out;
}

/** Create (or refresh, on re-send) the board card for something we sent. */
export async function raiseClientCard(input: RaiseCardInput): Promise<ClientBoardCard | null> {
  try {
    const [existing] = await db
      .select()
      .from(clientBoardCardsTable)
      .where(
        and(
          eq(clientBoardCardsTable.propertyId, input.propertyId),
          eq(clientBoardCardsTable.sourceType, input.sourceType),
          eq(clientBoardCardsTable.sourceId, input.sourceId),
        ),
      )
      .limit(1);
    let card: ClientBoardCard;
    if (existing) {
      // Re-send: refresh content/links; if it was done, reopen it in inbox.
      const [u] = await db
        .update(clientBoardCardsTable)
        .set({
          title: input.title,
          body: input.body ?? existing.body,
          actionLabel: input.actionLabel ?? existing.actionLabel,
          amount: input.amount ?? existing.amount,
          dueDate: input.dueDate ?? existing.dueDate,
          links: input.links ?? existing.links,
          jobId: input.jobId ?? existing.jobId,
          // Refresh module data but keep client action state (approvedAt,
          // requestedAt...) already recorded on the card.
          module: input.module
            ? { ...input.module, ...pickActionState(existing.module) }
            : existing.module,
          column: existing.column === "done" ? "inbox" : existing.column,
          completedAt: existing.column === "done" ? null : existing.completedAt,
          updatedAt: new Date(),
        })
        .where(eq(clientBoardCardsTable.id, existing.id))
        .returning();
      card = u!;
      void postWebhook(input.propertyId, "card.updated", card);
    } else {
      const [c] = await db
        .insert(clientBoardCardsTable)
        .values({
          propertyId: input.propertyId,
          kind: input.kind,
          title: input.title,
          body: input.body ?? null,
          actionLabel: input.actionLabel ?? null,
          amount: input.amount ?? null,
          dueDate: input.dueDate ?? null,
          links: input.links ?? [],
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          jobId: input.jobId ?? null,
          module: input.module ?? null,
        })
        .returning();
      card = c!;
      void postWebhook(input.propertyId, "card.created", card);
    }
    // Live bell on the client board — must never break the send.
    try {
      await db.insert(clientBoardNotificationsTable).values({
        propertyId: input.propertyId,
        audience: "client",
        type: existing ? "card_updated" : "card_pushed",
        title: existing
          ? `Card updated: ${input.title}`
          : `New card from Archangel: ${input.title}`,
        body: input.body ?? null,
        cardKey: `push:${card.id}`,
      });
    } catch (err) {
      console.error("client board notification failed:", err);
    }
    emitBoardEvent(input.propertyId);
    return card;
  } catch (err) {
    // The board is a mirror of sends — a card failure must never fail the send.
    console.error("raiseClientCard failed:", err);
    return null;
  }
}

/** Auto-complete a card when its underlying thing resolves (e.g. paid). */
export async function completeClientCard(
  sourceType: string,
  sourceId: string,
  note?: string,
): Promise<void> {
  try {
    const rows = await db
      .update(clientBoardCardsTable)
      .set({
        column: "done",
        completedAt: new Date(),
        updatedAt: new Date(),
        ...(note ? { actionLabel: note } : {}),
      })
      .where(
        and(
          eq(clientBoardCardsTable.sourceType, sourceType),
          eq(clientBoardCardsTable.sourceId, sourceId),
        ),
      )
      .returning();
    for (const card of rows) {
      void postWebhook(card.propertyId, "card.completed", card);
      emitBoardEvent(card.propertyId);
    }
  } catch (err) {
    console.error("completeClientCard failed:", err);
  }
}
