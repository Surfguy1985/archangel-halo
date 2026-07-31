/**
 * waybill.ts — derives a card's network waybill (the six green dots) from the
 * card row itself, on read.
 *
 * Deliberately DERIVED, not stored: the dots must always agree with the
 * card's real column and module state, no matter which code path moved it
 * (client drag, office drag, pay-hub auto-complete, module action). Deriving
 * on read makes "out of sync" structurally impossible, and the existing
 * board SSE event → refetch pipeline delivers the update to both boards.
 *
 * Stage mapping (cumulative — reaching a column lights everything before it):
 *   sealed     card exists (createdAt)
 *   routed     digest/notification sent (notifiedAt), or card left the inbox
 *   delivered  card left the inbox column (todo / in_progress / done)
 *   opened     module acknowledged, or card reached In Progress
 *   in_review  module approved (approvedAt), or card reached In Progress
 *   settled    card reached Done (completedAt), or invoice module paid
 */
import { createHash } from "node:crypto";
import type { clientBoardCardsTable } from "@workspace/db";

type CardRow = typeof clientBoardCardsTable.$inferSelect;

const STAGES = ["sealed", "routed", "delivered", "opened", "in_review", "settled"] as const;
type Stage = (typeof STAGES)[number];

const COL_RANK: Record<string, number> = { inbox: 0, todo: 1, in_progress: 2, done: 3 };

// Crockford base32 — no I, L, O, U. FLK-XXXXX is deterministic per card id,
// so the same card shows the same code on every board and across restarts.
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function waybillCodeFor(cardId: string): string {
  const digest = createHash("sha256").update(cardId).digest();
  let out = "";
  for (let i = 0; i < 5; i++) out += CROCKFORD[digest[i]! % 32];
  return `FLK-${out}`;
}

export function deriveWaybill(card: CardRow): {
  stages: Array<{ stage: Stage; at: string; byLabel: string | null }>;
  holder: "sender" | "network" | "recipient" | "done";
  live: boolean;
} {
  const rank = COL_RANK[card.column] ?? 0;
  const mod = (card.module ?? {}) as Record<string, unknown>;
  const iso = (d: Date | string | null | undefined) =>
    d ? new Date(d).toISOString() : null;

  const moved = iso(card.updatedAt) ?? iso(card.createdAt)!;
  const paid = String(mod.status ?? "").toLowerCase() === "paid";

  const at: Partial<Record<Stage, string>> = {
    sealed: iso(card.createdAt)!,
  };
  if (card.notifiedAt) at.routed = iso(card.notifiedAt)!;
  else if (rank >= 1) at.routed = moved;
  if (rank >= 1) at.delivered = moved;
  if (typeof mod.acknowledgedAt === "string") at.opened = mod.acknowledgedAt;
  else if (rank >= 2) at.opened = moved;
  if (typeof mod.approvedAt === "string") {
    at.opened = at.opened ?? mod.approvedAt;
    at.in_review = mod.approvedAt;
  } else if (rank >= 2) at.in_review = moved;
  if (rank >= 3) at.settled = iso(card.completedAt) ?? moved;
  else if (paid) at.settled = moved;

  // Cumulative: a lit stage implies everything before it is lit too.
  let highest = -1;
  STAGES.forEach((s, i) => { if (at[s]) highest = i; });
  for (let i = 0; i <= highest; i++) {
    const s = STAGES[i]!;
    if (!at[s]) at[s] = at[STAGES[highest]!]!;
  }

  const byLabel: Partial<Record<Stage, string>> = {};
  if (typeof mod.approvedBy === "string" && mod.approvedBy) byLabel.in_review = mod.approvedBy;
  if (typeof mod.payMethodBy === "string" && mod.payMethodBy) byLabel.settled = mod.payMethodBy;

  const stages = STAGES.filter((s) => at[s]).map((s) => ({
    stage: s,
    at: at[s]!,
    byLabel: byLabel[s] ?? null,
  }));

  const holder =
    at.settled ? ("done" as const)
    : at.in_review ? ("network" as const)
    : ("recipient" as const);

  return { stages, holder, live: true };
}

// ---------------------------------------------------------------------------
// Lane-based derivation for the computed client board (clientBoard.ts).
// The board there is projected on read from jobs/invoices/custom cards, so
// the waybill derives from the card's LANE — a drag lights dots by
// construction, on both boards, through the normal SSE→refetch pipeline.
// ---------------------------------------------------------------------------
const LANE_RANK: Record<string, number> = {
  // vendor board            // pm board
  requested: 0, planning: 0,
  scheduled: 1, todo: 1,
  in_progress: 2, doing: 2, billing: 2,
  done: 3,
};

export function deriveLaneWaybill(
  lane: string,
  card: { updatedAt?: unknown; scheduledOn?: unknown; completedAt?: unknown; status?: unknown },
): {
  stages: Array<{ stage: Stage; at: string; byLabel: string | null }>;
  holder: "sender" | "network" | "recipient" | "done";
  live: boolean;
} {
  const rank = LANE_RANK[lane] ?? 0;
  const moved = typeof card.updatedAt === "string" ? card.updatedAt : new Date().toISOString();
  const paid = String(card.status ?? "").toLowerCase() === "paid";

  const at: Partial<Record<Stage, string>> = { sealed: moved, routed: moved };
  if (rank >= 1) at.delivered = typeof card.scheduledOn === "string" ? card.scheduledOn : moved;
  if (rank >= 2) { at.opened = moved; at.in_review = moved; }
  if (rank >= 3 || paid) {
    at.opened = at.opened ?? moved;
    at.in_review = at.in_review ?? moved;
    at.settled = typeof card.completedAt === "string" ? card.completedAt : moved;
  }

  const stages = STAGES.filter((s) => at[s]).map((s) => ({
    stage: s,
    at: at[s]!,
    byLabel: null,
  }));
  const holder =
    at.settled ? ("done" as const) : at.in_review ? ("network" as const) : ("recipient" as const);
  return { stages, holder, live: true };
}
