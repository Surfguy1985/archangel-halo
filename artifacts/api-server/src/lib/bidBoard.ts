/**
 * Segment 7 — vendor-neutral bid board.
 * Lines compare on price-item code (+ tier). Score weights are per-property
 * and shown on the comparison. Award assigns the vendor, moves the turn to
 * scheduled, notifies every bidder with their score, and emits a PO payload.
 */

import { and, eq, gte, inArray, lte } from "drizzle-orm";
import {
  db,
  propertiesTable,
  clientOrgsTable,
  clientTurnsTable,
  clientUnitsTable,
  clientScopesTable,
  clientScopeLinesTable,
  clientPriceListsTable,
  clientPriceListItemsTable,
  clientBidRequestsTable,
  clientBidInvitationsTable,
  clientVendorBidsTable,
  clientVendorBidLinesTable,
  clientVendorScorecardsTable,
  clientCapacityDeclarationsTable,
  clientAuditLogTable,
  clientOrgMembersTable,
  clientPortfolioNotificationsTable,
  mulCents,
  DEFAULT_BID_SCORE_WEIGHTS,
  type BidScoreWeights,
} from "@workspace/db";
import { IllegalTurnTransitionError } from "@workspace/db";
import { resolvePortfolioForProperty } from "./portfolioPulse";
import { emitPortfolioFrame } from "./clientPortfolioEvents";
import { transitionTurn } from "./turnEngine";

export const VENDOR_ORG_HEADER = "x-halo-vendor-org-id";

export class BidBoardError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "BidBoardError";
  }
}

function centsStr(n: bigint): string {
  return n.toString();
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function normalizeWeights(raw: BidScoreWeights | null | undefined): BidScoreWeights {
  const w = {
    priceVsSchedule: Number(raw?.priceVsSchedule ?? DEFAULT_BID_SCORE_WEIGHTS.priceVsSchedule),
    onTime: Number(raw?.onTime ?? DEFAULT_BID_SCORE_WEIGHTS.onTime),
    rework: Number(raw?.rework ?? DEFAULT_BID_SCORE_WEIGHTS.rework),
    capacity: Number(raw?.capacity ?? DEFAULT_BID_SCORE_WEIGHTS.capacity),
  };
  const sum = w.priceVsSchedule + w.onTime + w.rework + w.capacity;
  if (sum <= 0) return { ...DEFAULT_BID_SCORE_WEIGHTS };
  return w;
}

/** At schedule = 100. 2× schedule = 0. Under-schedule stays 100. */
export function priceVsScheduleScore(bidCents: bigint, scheduleCents: bigint): number {
  if (scheduleCents <= 0n) return 50;
  const ratio = Number(bidCents) / Number(scheduleCents);
  return clamp(Math.round(100 * (2 - ratio)), 0, 100);
}

export function reworkInvertedScore(reworkPct: number): number {
  return clamp(Math.round(100 - reworkPct), 0, 100);
}

export function capacityScore(unitsAvailable: number): number {
  return clamp(Math.round(unitsAvailable * 20), 0, 100);
}

export function compositeScore(
  components: { priceVsSchedule: number; onTime: number; rework: number; capacity: number },
  weights: BidScoreWeights,
): number {
  const w = normalizeWeights(weights);
  const sum = w.priceVsSchedule + w.onTime + w.rework + w.capacity;
  const raw =
    (components.priceVsSchedule * w.priceVsSchedule +
      components.onTime * w.onTime +
      components.rework * w.rework +
      components.capacity * w.capacity) /
    sum;
  return clamp(Math.round(raw), 0, 100);
}

function lineKey(code: string, tier: string | null | undefined): string {
  return `${code}::${tier ?? ""}`;
}

async function loadScopeContext(scopeId: string, orgId: string) {
  const [scope] = await db.select().from(clientScopesTable).where(eq(clientScopesTable.id, scopeId)).limit(1);
  if (!scope) throw new BidBoardError(404, "Scope not found");
  const [turn] = await db
    .select()
    .from(clientTurnsTable)
    .where(and(eq(clientTurnsTable.id, scope.turnId), eq(clientTurnsTable.orgId, orgId)))
    .limit(1);
  if (!turn) throw new BidBoardError(404, "Turn not found");
  const [property] = await db
    .select({
      id: propertiesTable.id,
      name: propertiesTable.name,
      timezone: propertiesTable.timezone,
      entrataPropertyId: propertiesTable.entrataPropertyId,
      bidScoreWeights: propertiesTable.bidScoreWeights,
      clientOrgId: propertiesTable.clientOrgId,
    })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, turn.propertyId))
    .limit(1);
  if (!property || property.clientOrgId !== orgId) throw new BidBoardError(404, "Property not found");
  const lines = await db.select().from(clientScopeLinesTable).where(eq(clientScopeLinesTable.scopeId, scopeId));
  const coded = lines.filter((l) => l.code && l.code.trim().length > 0);
  if (coded.length === 0) throw new BidBoardError(400, "Scope has no price-item codes to bid against");
  return { scope, turn, property, lines: coded };
}

async function activePriceItems(propertyId: string, at: Date) {
  const lists = await db
    .select()
    .from(clientPriceListsTable)
    .where(eq(clientPriceListsTable.propertyId, propertyId));
  const list = lists.find((l) => l.effectiveFrom <= at && (l.effectiveTo == null || l.effectiveTo > at));
  if (!list) return { list: null, items: [] as (typeof clientPriceListItemsTable.$inferSelect)[] };
  const items = await db
    .select()
    .from(clientPriceListItemsTable)
    .where(eq(clientPriceListItemsTable.priceListId, list.id));
  return { list, items };
}

export async function createBidRequest(args: {
  scopeId: string;
  orgId: string;
  actorId: string;
  dueAt: Date;
}): Promise<{ id: string; turnId: string; propertyId: string; dueAt: string; status: string }> {
  const ctx = await loadScopeContext(args.scopeId, args.orgId);
  const [existing] = await db
    .select({ id: clientBidRequestsTable.id, status: clientBidRequestsTable.status })
    .from(clientBidRequestsTable)
    .where(eq(clientBidRequestsTable.scopeId, args.scopeId))
    .limit(1);
  if (existing && existing.status !== "cancelled") {
    throw new BidBoardError(409, "This scope already has an open bid request");
  }
  const weights = normalizeWeights(ctx.property.bidScoreWeights);
  const [row] = await db
    .insert(clientBidRequestsTable)
    .values({
      orgId: args.orgId,
      turnId: ctx.turn.id,
      scopeId: args.scopeId,
      propertyId: ctx.turn.propertyId,
      dueAt: args.dueAt,
      status: "open",
      scoreWeights: weights,
    })
    .returning();
  await db.insert(clientAuditLogTable).values({
    orgId: args.orgId,
    actorId: args.actorId,
    entityType: "bid_request",
    entityId: row!.id,
    action: "bid_request.published",
    after: { dueAt: args.dueAt.toISOString(), weights },
  });
  return {
    id: row!.id,
    turnId: ctx.turn.id,
    propertyId: ctx.turn.propertyId,
    dueAt: args.dueAt.toISOString(),
    status: "open",
  };
}

export async function inviteVendors(args: {
  bidRequestId: string;
  orgId: string;
  actorId: string;
  vendorOrgIds: string[];
}): Promise<{ invited: Array<{ vendorOrgId: string; vendorName: string }> }> {
  const req = await loadBidRequest(args.bidRequestId, args.orgId);
  if (req.status !== "open") throw new BidBoardError(409, "Bid request is not open");
  if (args.vendorOrgIds.length === 0) throw new BidBoardError(400, "Invite at least one vendor");
  const invited: Array<{ vendorOrgId: string; vendorName: string }> = [];
  for (const vendorOrgId of [...new Set(args.vendorOrgIds)]) {
    const [org] = await db.select().from(clientOrgsTable).where(eq(clientOrgsTable.id, vendorOrgId)).limit(1);
    if (!org || org.type !== "vendor") throw new BidBoardError(400, "Unknown vendor org");
    await db
      .insert(clientBidInvitationsTable)
      .values({ bidRequestId: args.bidRequestId, vendorOrgId, status: "invited" })
      .onConflictDoNothing();
    invited.push({ vendorOrgId, vendorName: org.name });
  }
  await notifyVendorOrgs({
    vendorOrgIds: invited.map((v) => v.vendorOrgId),
    kind: "bid.invited",
    payload: { bidRequestId: args.bidRequestId, invited },
  });
  await db.insert(clientAuditLogTable).values({
    orgId: args.orgId,
    actorId: args.actorId,
    entityType: "bid_request",
    entityId: args.bidRequestId,
    action: "bid_request.invited",
    after: { vendorOrgIds: invited.map((v) => v.vendorOrgId) },
  });
  return { invited };
}

export async function submitVendorBid(args: {
  bidRequestId: string;
  orgId: string;
  vendorOrgId: string;
  actorId: string;
  earliestStartAt: Date | null;
  promisedDays: number | null;
  lines: Array<{ code: string; tier?: string | null; unitPriceCents: bigint }>;
}): Promise<{ bidId: string; totalCents: string; score: number }> {
  const req = await loadBidRequest(args.bidRequestId, args.orgId);
  if (req.status !== "open") throw new BidBoardError(409, "Bid request is not open");
  if (req.dueAt.getTime() < Date.now()) throw new BidBoardError(409, "Bid due time has passed");
  const [invite] = await db
    .select()
    .from(clientBidInvitationsTable)
    .where(
      and(
        eq(clientBidInvitationsTable.bidRequestId, args.bidRequestId),
        eq(clientBidInvitationsTable.vendorOrgId, args.vendorOrgId),
      ),
    )
    .limit(1);
  if (!invite) throw new BidBoardError(403, "Vendor is not invited to this bid");

  const ctx = await loadScopeContext(req.scopeId, args.orgId);
  const { items } = await activePriceItems(ctx.turn.propertyId, req.createdAt);
  const byKey = new Map(items.map((i) => [lineKey(i.code, i.tier), i]));
  const scopeKeys = [...new Set(ctx.lines.map((l) => lineKey(l.code!, l.tier)))];
  const bidKeys = new Set(args.lines.map((l) => lineKey(l.code, l.tier)));
  for (const key of scopeKeys) {
    if (!bidKeys.has(key)) {
      throw new BidBoardError(400, `Bid is missing price-item ${key.replace("::", " ")}`.trim());
    }
  }
  for (const line of args.lines) {
    if (!byKey.has(lineKey(line.code, line.tier))) {
      throw new BidBoardError(400, `Unknown price-item code ${line.code}`);
    }
  }

  const qtyByKey = new Map<string, number>();
  const descByKey = new Map<string, string>();
  for (const l of ctx.lines) {
    const key = lineKey(l.code!, l.tier);
    qtyByKey.set(key, (qtyByKey.get(key) ?? 0) + l.qty);
    descByKey.set(key, l.description);
  }

  let total = 0n;
  const prepared = args.lines.map((line) => {
    const key = lineKey(line.code, line.tier);
    const qty = qtyByKey.get(key) ?? 1;
    const extended = mulCents(line.unitPriceCents, qty);
    total += extended;
    const item = byKey.get(key);
    return {
      priceItemCode: line.code,
      tier: line.tier ?? null,
      description: item?.description ?? descByKey.get(key) ?? line.code,
      qty,
      unitPriceCents: line.unitPriceCents,
      extendedCents: extended,
    };
  });

  const [existing] = await db
    .select({ id: clientVendorBidsTable.id })
    .from(clientVendorBidsTable)
    .where(
      and(
        eq(clientVendorBidsTable.bidRequestId, args.bidRequestId),
        eq(clientVendorBidsTable.vendorOrgId, args.vendorOrgId),
      ),
    )
    .limit(1);
  if (existing) throw new BidBoardError(409, "This vendor already submitted a bid");

  const [bid] = await db
    .insert(clientVendorBidsTable)
    .values({
      bidRequestId: args.bidRequestId,
      vendorOrgId: args.vendorOrgId,
      totalCents: total,
      earliestStartAt: args.earliestStartAt,
      promisedDays: args.promisedDays,
      score: 0,
    })
    .returning();
  await db.insert(clientVendorBidLinesTable).values(prepared.map((p) => ({ ...p, bidId: bid!.id })));

  const scored = await computeComparison({ bidRequestId: args.bidRequestId, orgId: args.orgId });
  const mine = scored.vendors.find((v) => v.vendorOrgId === args.vendorOrgId);
  const score = mine?.score ?? 0;
  await db.update(clientVendorBidsTable).set({ score }).where(eq(clientVendorBidsTable.id, bid!.id));
  await db
    .update(clientBidInvitationsTable)
    .set({ status: "submitted", viewedAt: new Date() })
    .where(eq(clientBidInvitationsTable.id, invite.id));
  await db.insert(clientAuditLogTable).values({
    orgId: args.orgId,
    actorId: args.actorId,
    entityType: "vendor_bid",
    entityId: bid!.id,
    action: "bid.submitted",
    after: { vendorOrgId: args.vendorOrgId, totalCents: total.toString(), score },
  });
  return { bidId: bid!.id, totalCents: centsStr(total), score };
}

async function loadBidRequest(id: string, orgId: string) {
  const [row] = await db.select().from(clientBidRequestsTable).where(eq(clientBidRequestsTable.id, id)).limit(1);
  if (!row) throw new BidBoardError(404, "Bid request not found");
  const [turn] = await db
    .select({ orgId: clientTurnsTable.orgId })
    .from(clientTurnsTable)
    .where(eq(clientTurnsTable.id, row.turnId))
    .limit(1);
  if (!turn || turn.orgId !== orgId) throw new BidBoardError(404, "Bid request not found");
  return row;
}

export async function computeComparison(args: { bidRequestId: string; orgId: string }) {
  const req = await loadBidRequest(args.bidRequestId, args.orgId);
  const ctx = await loadScopeContext(req.scopeId, args.orgId);
  const weights = normalizeWeights(req.scoreWeights);
  const { items } = await activePriceItems(ctx.turn.propertyId, req.createdAt);
  const scheduleByKey = new Map(items.map((i) => [lineKey(i.code, i.tier), i]));

  type ScopeRow = {
    key: string;
    code: string;
    tier: string | null;
    description: string;
    qty: number;
    uom: string;
    scheduleUnitPriceCents: bigint;
  };
  const rows = new Map<string, ScopeRow>();
  for (const line of ctx.lines) {
    const key = lineKey(line.code!, line.tier);
    const prev = rows.get(key);
    const schedule = scheduleByKey.get(key);
    if (prev) {
      prev.qty += line.qty;
    } else {
      rows.set(key, {
        key,
        code: line.code!,
        tier: line.tier,
        description: schedule?.description ?? line.description,
        qty: line.qty,
        uom: line.uom,
        scheduleUnitPriceCents: schedule?.unitPriceCents ?? line.unitPriceCents,
      });
    }
  }
  const scopeRows = [...rows.values()];
  const scheduleTotal = scopeRows.reduce((s, r) => s + mulCents(r.scheduleUnitPriceCents, r.qty), 0n);

  const invitations = await db
    .select()
    .from(clientBidInvitationsTable)
    .where(eq(clientBidInvitationsTable.bidRequestId, args.bidRequestId));
  const bids = await db
    .select()
    .from(clientVendorBidsTable)
    .where(eq(clientVendorBidsTable.bidRequestId, args.bidRequestId));
  const bidIds = bids.map((b) => b.id);
  const lineMap = new Map<string, (typeof clientVendorBidLinesTable.$inferSelect)[]>();
  if (bidIds.length > 0) {
    const fetched = await db
      .select()
      .from(clientVendorBidLinesTable)
      .where(inArray(clientVendorBidLinesTable.bidId, bidIds));
    for (const line of fetched) {
      const list = lineMap.get(line.bidId) ?? [];
      list.push(line);
      lineMap.set(line.bidId, list);
    }
  }

  const orgs = await db.select().from(clientOrgsTable);
  const orgName = (id: string) => orgs.find((o) => o.id === id)?.name ?? "Vendor";

  type VendorCol = {
    vendorOrgId: string;
    vendorName: string;
    invited: boolean;
    submitted: boolean;
    totalCents: string;
    earliestStartAt: string | null;
    promisedDays: number | null;
    score: number;
    components: { priceVsSchedule: number; onTime: number; rework: number; capacity: number };
    awarded: boolean;
    bidId: string | null;
  };
  const vendors: VendorCol[] = [];
  for (const inv of invitations) {
    const bid = bids.find((b) => b.vendorOrgId === inv.vendorOrgId);
    const scorecard = await latestScorecard(inv.vendorOrgId, ctx.turn.propertyId);
    const cap = await capacityInWindow(inv.vendorOrgId, req.dueAt);
    const components = {
      priceVsSchedule: bid ? priceVsScheduleScore(bid.totalCents, scheduleTotal) : 0,
      onTime: scorecard?.onTimePct ?? 0,
      rework: reworkInvertedScore(scorecard?.reworkRate ?? 0),
      capacity: capacityScore(cap > 0 ? cap : (scorecard?.capacityUnitsPerWeek ?? 0)),
    };
    const score = bid ? compositeScore(components, weights) : 0;
    if (bid && bid.score !== score) {
      await db.update(clientVendorBidsTable).set({ score }).where(eq(clientVendorBidsTable.id, bid.id));
    }
    vendors.push({
      vendorOrgId: inv.vendorOrgId,
      vendorName: orgName(inv.vendorOrgId),
      invited: true,
      submitted: Boolean(bid),
      totalCents: bid ? centsStr(bid.totalCents) : "0",
      earliestStartAt: bid?.earliestStartAt?.toISOString() ?? null,
      promisedDays: bid?.promisedDays ?? null,
      score,
      components,
      awarded: req.awardedVendorOrgId === inv.vendorOrgId,
      bidId: bid?.id ?? null,
    });
  }

  const lines = scopeRows.map((row) => ({
    code: row.code,
    tier: row.tier,
    description: row.description,
    qty: row.qty,
    uom: row.uom,
    scheduleUnitPriceCents: centsStr(row.scheduleUnitPriceCents),
    cells: vendors.map((v) => {
      const bid = bids.find((b) => b.vendorOrgId === v.vendorOrgId);
      const bl = bid ? (lineMap.get(bid.id) ?? []).find((l) => lineKey(l.priceItemCode, l.tier) === row.key) : null;
      const unit = bl?.unitPriceCents ?? null;
      const extended = bl?.extendedCents ?? (unit != null ? mulCents(unit, row.qty) : null);
      const delta = unit != null ? unit - row.scheduleUnitPriceCents : null;
      return {
        vendorOrgId: v.vendorOrgId,
        unitPriceCents: unit != null ? centsStr(unit) : null,
        extendedCents: extended != null ? centsStr(extended) : null,
        deltaCents: delta != null ? centsStr(delta) : null,
      };
    }),
  }));

  const invitedIds = new Set(invitations.map((i) => i.vendorOrgId));
  const eligibleVendors = orgs
    .filter((o) => o.type === "vendor" && !invitedIds.has(o.id))
    .map((o) => ({ vendorOrgId: o.id, vendorName: o.name }))
    .sort((a, b) => a.vendorName.localeCompare(b.vendorName));

  return {
    bidRequestId: req.id,
    turnId: req.turnId,
    propertyId: req.propertyId,
    scopeId: req.scopeId,
    dueAt: req.dueAt.toISOString(),
    timezone: ctx.property.timezone || "UTC",
    status: req.status,
    title: "Bid comparison",
    weights,
    scheduleTotalCents: centsStr(scheduleTotal),
    lines,
    vendors,
    awardedVendorOrgId: req.awardedVendorOrgId,
    poPayload: (req.poPayload as Record<string, unknown> | null) ?? null,
    eligibleVendors,
  };
}

async function latestScorecard(vendorOrgId: string, propertyId: string) {
  const rows = await db
    .select()
    .from(clientVendorScorecardsTable)
    .where(
      and(
        eq(clientVendorScorecardsTable.vendorOrgId, vendorOrgId),
        eq(clientVendorScorecardsTable.propertyId, propertyId),
      ),
    );
  return rows.sort((a, b) => b.windowEnd.getTime() - a.windowEnd.getTime())[0] ?? null;
}

async function capacityInWindow(vendorOrgId: string, dueAt: Date): Promise<number> {
  const from = new Date(Date.now() - 7 * 86_400_000);
  const to = new Date(dueAt.getTime() + 14 * 86_400_000);
  const rows = await db
    .select()
    .from(clientCapacityDeclarationsTable)
    .where(
      and(
        eq(clientCapacityDeclarationsTable.vendorOrgId, vendorOrgId),
        gte(clientCapacityDeclarationsTable.weekStart, from),
        lte(clientCapacityDeclarationsTable.weekStart, to),
      ),
    );
  return rows.reduce((s, r) => s + r.unitsCapacity, 0);
}

export async function awardBid(args: {
  bidRequestId: string;
  orgId: string;
  actorId: string;
  vendorOrgId: string;
  idempotencyKey: string;
}): Promise<{
  bidRequestId: string;
  turnId: string;
  vendorOrgId: string;
  from: string;
  to: string;
  poPayload: Record<string, unknown>;
  scores: Array<{ vendorOrgId: string; vendorName: string; score: number; awarded: boolean }>;
}> {
  const req = await loadBidRequest(args.bidRequestId, args.orgId);
  if (req.status === "awarded") throw new BidBoardError(409, "Already awarded");
  if (req.status !== "open") throw new BidBoardError(409, "Bid request is not open");
  const comparison = await computeComparison({ bidRequestId: args.bidRequestId, orgId: args.orgId });
  const submittedCount = comparison.vendors.filter((v) => v.submitted).length;
  if (submittedCount < 2) {
    throw new BidBoardError(
      409,
      "A single-vendor board is not a product. Wait for at least two submitted bids.",
    );
  }
  const winner = comparison.vendors.find((v) => v.vendorOrgId === args.vendorOrgId);
  if (!winner?.submitted) throw new BidBoardError(400, "That vendor has not submitted a bid");

  const [turn] = await db
    .select()
    .from(clientTurnsTable)
    .where(eq(clientTurnsTable.id, req.turnId))
    .limit(1);
  if (!turn) throw new BidBoardError(404, "Turn not found");
  const [unit] = await db.select().from(clientUnitsTable).where(eq(clientUnitsTable.id, turn.unitId)).limit(1);
  const [property] = await db
    .select({ name: propertiesTable.name, code: propertiesTable.entrataPropertyId })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, turn.propertyId))
    .limit(1);

  const bid = (
    await db
      .select()
      .from(clientVendorBidsTable)
      .where(
        and(
          eq(clientVendorBidsTable.bidRequestId, args.bidRequestId),
          eq(clientVendorBidsTable.vendorOrgId, args.vendorOrgId),
        ),
      )
      .limit(1)
  )[0];
  const bidLines = bid
    ? await db.select().from(clientVendorBidLinesTable).where(eq(clientVendorBidLinesTable.bidId, bid.id))
    : [];

  const poPayload = {
    adapter: "csv",
    kind: "purchase_order",
    propertyCode: property?.code ?? property?.name ?? "",
    propertyName: property?.name ?? "",
    unitNumber: unit?.unitNumber ?? "",
    vendorOrgId: args.vendorOrgId,
    vendorName: winner.vendorName,
    bidRequestId: args.bidRequestId,
    totalCents: winner.totalCents,
    lines: bidLines.map((l) => ({
      code: l.priceItemCode,
      description: l.description,
      qty: l.qty,
      unitPriceCents: l.unitPriceCents.toString(),
    })),
    requestedAt: new Date().toISOString(),
  };

  await db
    .update(clientBidRequestsTable)
    .set({
      status: "awarded",
      awardedVendorOrgId: args.vendorOrgId,
      awardedAt: new Date(),
      poPayload,
    })
    .where(eq(clientBidRequestsTable.id, args.bidRequestId));

  await db
    .update(clientTurnsTable)
    .set({ assignedVendorOrgId: args.vendorOrgId })
    .where(eq(clientTurnsTable.id, req.turnId));

  let from = turn.status;
  try {
    if (turn.status === "pending_approval") {
      const step = await transitionTurn({
        orgId: args.orgId,
        turnId: req.turnId,
        to: "approved",
        source: "app",
        actorId: args.actorId,
        idempotencyKey: `${args.idempotencyKey}:approved`,
      });
      from = step.from;
    }
    const [fresh] = await db
      .select({ status: clientTurnsTable.status })
      .from(clientTurnsTable)
      .where(eq(clientTurnsTable.id, req.turnId))
      .limit(1);
    if (fresh?.status === "approved") {
      await transitionTurn({
        orgId: args.orgId,
        turnId: req.turnId,
        to: "scheduled",
        source: "app",
        actorId: args.actorId,
        idempotencyKey: `${args.idempotencyKey}:scheduled`,
      });
    } else if (fresh?.status !== "scheduled") {
      throw new BidBoardError(409, `Cannot schedule a turn in ${fresh?.status ?? turn.status}`);
    }
  } catch (err) {
    if (err instanceof IllegalTurnTransitionError) {
      throw new BidBoardError(409, err.message);
    }
    throw err;
  }

  const scores = comparison.vendors.map((v) => ({
    vendorOrgId: v.vendorOrgId,
    vendorName: v.vendorName,
    score: v.score,
    awarded: v.vendorOrgId === args.vendorOrgId,
  }));

  await notifyBidders({
    pmOrgId: args.orgId,
    bidRequestId: args.bidRequestId,
    winnerOrgId: args.vendorOrgId,
    scores,
  });

  await db.insert(clientAuditLogTable).values({
    orgId: args.orgId,
    actorId: args.actorId,
    entityType: "bid_request",
    entityId: args.bidRequestId,
    action: "bid.awarded",
    after: { winner: args.vendorOrgId, scores, poPayload },
  });

  const port = await resolvePortfolioForProperty(turn.propertyId);
  if (port) {
    emitPortfolioFrame(port.portfolioId, {
      type: "bid.awarded",
      bidRequestId: args.bidRequestId,
      turnId: req.turnId,
      propertyId: turn.propertyId,
      vendorOrgId: args.vendorOrgId,
      occurredAt: new Date().toISOString(),
      scores,
    });
  }

  return {
    bidRequestId: args.bidRequestId,
    turnId: req.turnId,
    vendorOrgId: args.vendorOrgId,
    from,
    to: "scheduled",
    poPayload,
    scores,
  };
}

async function notifyVendorOrgs(args: {
  vendorOrgIds: string[];
  kind: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const ids = [...new Set(args.vendorOrgIds)];
  if (ids.length === 0) return;
  const members = await db.select().from(clientOrgMembersTable).where(inArray(clientOrgMembersTable.orgId, ids));
  const rows: Array<{ userId: string; kind: string; payload: Record<string, unknown> }> = [];
  for (const vendorOrgId of ids) {
    const theirs = members.filter((m) => m.orgId === vendorOrgId);
    if (theirs.length === 0) {
      rows.push({ userId: `vendor-org:${vendorOrgId}`, kind: args.kind, payload: { ...args.payload, vendorOrgId } });
    } else {
      for (const m of theirs) {
        rows.push({ userId: m.userId, kind: args.kind, payload: { ...args.payload, vendorOrgId } });
      }
    }
  }
  if (rows.length > 0) await db.insert(clientPortfolioNotificationsTable).values(rows);
}

async function notifyBidders(args: {
  pmOrgId: string;
  bidRequestId: string;
  winnerOrgId: string;
  scores: Array<{ vendorOrgId: string; vendorName: string; score: number; awarded: boolean }>;
}): Promise<void> {
  const vendorIds = args.scores.map((s) => s.vendorOrgId);
  const orgIds = [...new Set([args.pmOrgId, ...vendorIds])];
  const members =
    orgIds.length === 0
      ? []
      : await db.select().from(clientOrgMembersTable).where(inArray(clientOrgMembersTable.orgId, orgIds));
  const rows: Array<{ userId: string; kind: string; payload: Record<string, unknown> }> = [];
  for (const score of args.scores) {
    const payload = {
      bidRequestId: args.bidRequestId,
      vendorOrgId: score.vendorOrgId,
      vendorName: score.vendorName,
      score: score.score,
      awarded: score.awarded,
      winnerOrgId: args.winnerOrgId,
      scores: args.scores,
    };
    const theirs = members.filter((m) => m.orgId === score.vendorOrgId);
    if (theirs.length === 0) {
      rows.push({ userId: `vendor-org:${score.vendorOrgId}`, kind: "bid.awarded", payload });
    } else {
      for (const m of theirs) rows.push({ userId: m.userId, kind: "bid.awarded", payload });
    }
  }
  for (const m of members.filter((row) => row.orgId === args.pmOrgId)) {
    rows.push({
      userId: m.userId,
      kind: "bid.awarded",
      payload: {
        bidRequestId: args.bidRequestId,
        winnerOrgId: args.winnerOrgId,
        scores: args.scores,
      },
    });
  }
  if (rows.length > 0) await db.insert(clientPortfolioNotificationsTable).values(rows);
}

export async function bidRequestIdForTurn(turnId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: clientBidRequestsTable.id })
    .from(clientBidRequestsTable)
    .where(eq(clientBidRequestsTable.turnId, turnId))
    .limit(1);
  return row?.id ?? null;
}

export async function propertyIdOfBidRequest(id: string): Promise<string | null> {
  const [row] = await db
    .select({ propertyId: clientBidRequestsTable.propertyId })
    .from(clientBidRequestsTable)
    .where(eq(clientBidRequestsTable.id, id))
    .limit(1);
  return row?.propertyId ?? null;
}
