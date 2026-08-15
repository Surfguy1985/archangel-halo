/**
 * Close-out clocks for a unit turn.
 *
 * Vacancy *cost* still uses computeTurnMetrics (actualVacateAt → readyAt,
 * calendar days in the property TZ). Do not feed these stamps into that formula.
 *
 * The live timer the client asked for is operational: it starts on the move-out
 * date from the notice we uploaded, and it stops only when the unit is marked
 * complete *and* a PO is on file.
 */
import { inArray } from "drizzle-orm";
import {
  db,
  clientTurnInvoicesTable,
  clientEntrataPurchaseOrdersTable,
  clientTurnsTable,
  parseCivilDate,
  zonedCivilToUtc,
} from "@workspace/db";

export type TurnClockStamps = {
  timezone: string;
  vacantSince: string | null;
  requestReceivedAt: string | null;
  completedAt: string | null;
  poReceivedAt: string | null;
  poNumber: string | null;
  clockStopped: boolean;
  clockStoppedAt: string | null;
};

export type PoStamp = { poNumber: string; receivedAt: Date };

export function poIssuedAt(issuedOn: string | null | undefined, createdAt: Date, timezone: string): Date {
  if (issuedOn) {
    try {
      const civil = parseCivilDate(issuedOn);
      if (civil) return zonedCivilToUtc(timezone, civil.year, civil.month, civil.day, 8, 0, 0);
    } catch {
      /* fall through to createdAt */
    }
  }
  return createdAt;
}

export function shapeTurnClock(args: {
  timezone: string;
  noticeGivenAt: Date | null;
  scheduledVacateAt: Date | null;
  actualVacateAt: Date | null;
  createdAt: Date;
  readyAt: Date | null;
  po: PoStamp | null;
}): TurnClockStamps {
  const vacantAt = args.actualVacateAt ?? args.scheduledVacateAt ?? args.noticeGivenAt;
  const requestAt = args.noticeGivenAt ?? args.createdAt;
  const poReceivedAt = args.po?.receivedAt ?? null;
  const clockStopped = Boolean(args.readyAt && poReceivedAt);
  const clockStoppedAt =
    clockStopped && args.readyAt && poReceivedAt
      ? new Date(Math.max(args.readyAt.getTime(), poReceivedAt.getTime()))
      : null;
  return {
    timezone: args.timezone,
    vacantSince: vacantAt ? vacantAt.toISOString() : null,
    requestReceivedAt: requestAt.toISOString(),
    completedAt: args.readyAt ? args.readyAt.toISOString() : null,
    poReceivedAt: poReceivedAt ? poReceivedAt.toISOString() : null,
    poNumber: args.po?.poNumber ?? null,
    clockStopped,
    clockStoppedAt: clockStoppedAt ? clockStoppedAt.toISOString() : null,
  };
}

export async function loadPoByTurnIds(turnIds: string[], timezoneByTurn: Map<string, string>): Promise<Map<string, PoStamp>> {
  const out = new Map<string, PoStamp>();
  if (turnIds.length === 0) return out;

  const invoices = await db
    .select({
      id: clientTurnInvoicesTable.id,
      turnId: clientTurnInvoicesTable.turnId,
      poNumber: clientTurnInvoicesTable.poNumber,
      createdAt: clientTurnInvoicesTable.createdAt,
    })
    .from(clientTurnInvoicesTable)
    .where(inArray(clientTurnInvoicesTable.turnId, turnIds));

  const invoiceIds = invoices.map((i) => i.id);
  const posByInvoice = new Map<string, { poNumber: string; createdAt: Date; issuedOn: string | null }>();
  if (invoiceIds.length) {
    const linked = await db
      .select({
        invoiceId: clientEntrataPurchaseOrdersTable.invoiceId,
        poNumber: clientEntrataPurchaseOrdersTable.poNumber,
        createdAt: clientEntrataPurchaseOrdersTable.createdAt,
        issuedOn: clientEntrataPurchaseOrdersTable.issuedOn,
      })
      .from(clientEntrataPurchaseOrdersTable)
      .where(inArray(clientEntrataPurchaseOrdersTable.invoiceId, invoiceIds));
    for (const p of linked) {
      if (p.invoiceId) posByInvoice.set(p.invoiceId, p);
    }
  }

  for (const inv of invoices) {
    const tz = timezoneByTurn.get(inv.turnId) ?? "America/Chicago";
    const linked = posByInvoice.get(inv.id);
    if (linked) {
      out.set(inv.turnId, { poNumber: linked.poNumber, receivedAt: poIssuedAt(linked.issuedOn, linked.createdAt, tz) });
      continue;
    }
    if (inv.poNumber) {
      out.set(inv.turnId, { poNumber: inv.poNumber, receivedAt: inv.createdAt });
    }
  }

  const missing = turnIds.filter((id) => !out.has(id));
  if (missing.length === 0) return out;

  const turns = await db
    .select({ id: clientTurnsTable.id, unitId: clientTurnsTable.unitId })
    .from(clientTurnsTable)
    .where(inArray(clientTurnsTable.id, missing));
  const unitIds = [...new Set(turns.map((t) => t.unitId).filter(Boolean))];
  if (unitIds.length === 0) return out;

  const unitPos = await db
    .select({
      unitId: clientEntrataPurchaseOrdersTable.unitId,
      poNumber: clientEntrataPurchaseOrdersTable.poNumber,
      createdAt: clientEntrataPurchaseOrdersTable.createdAt,
      issuedOn: clientEntrataPurchaseOrdersTable.issuedOn,
    })
    .from(clientEntrataPurchaseOrdersTable)
    .where(inArray(clientEntrataPurchaseOrdersTable.unitId, unitIds));
  const byUnit = new Map<string, (typeof unitPos)[number]>();
  for (const p of unitPos) {
    if (p.unitId && !byUnit.has(p.unitId)) byUnit.set(p.unitId, p);
  }
  for (const t of turns) {
    const p = byUnit.get(t.unitId);
    if (!p) continue;
    const tz = timezoneByTurn.get(t.id) ?? "America/Chicago";
    out.set(t.id, { poNumber: p.poNumber, receivedAt: poIssuedAt(p.issuedOn, p.createdAt, tz) });
  }
  return out;
}