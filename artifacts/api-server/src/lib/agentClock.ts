/**
 * Vacant-day history from the metrics view — already computed.
 * Never a second days or cents formula.
 *
 * Holt needs a series. One open turn only has today's snapshot, so history
 * is closed-turn terminal daysVacant (frozen at ready). Community closed
 * turns are the prior when this unit has none. Open-turn cross-section is
 * last resort — not a time series.
 */

import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import {
  db,
  clientTurnMetricsMvTable,
  clientTurnsTable,
  clientUnitsTable,
} from "@workspace/db";
import { propertyIdsForClock } from "./agentIds";

export type ClockSeries = {
  days: number[];
  source: "unit" | "community" | "none";
};

export { propertyIdsForClock };

async function daysForUnits(
  propertyIds: string[],
  opts: { unitNumber?: string; closed?: boolean },
): Promise<number[]> {
  if (!propertyIds.length) return [];
  const cond = [inArray(clientTurnsTable.propertyId, propertyIds)];
  if (opts.unitNumber) cond.push(eq(clientUnitsTable.unitNumber, opts.unitNumber));
  if (opts.closed) cond.push(isNotNull(clientTurnsTable.readyAt));
  const rows = await db
    .select({
      days: clientTurnMetricsMvTable.daysVacant,
      vacate: clientTurnsTable.actualVacateAt,
    })
    .from(clientTurnsTable)
    .innerJoin(clientUnitsTable, eq(clientUnitsTable.id, clientTurnsTable.unitId))
    .innerJoin(clientTurnMetricsMvTable, eq(clientTurnMetricsMvTable.turnId, clientTurnsTable.id))
    .where(and(...cond))
    .orderBy(asc(clientTurnsTable.actualVacateAt))
    .limit(24);
  return rows.map((r) => r.days).filter((d) => Number.isFinite(d) && d >= 0);
}

export async function clockDaysForForecast(propertyIds: string[], unitNumber: string | null): Promise<ClockSeries> {
  const ids = propertyIdsForClock(propertyIds);
  if (!ids.length) return { days: [], source: "none" };
  try {
    const closedOwn = unitNumber ? await daysForUnits(ids, { unitNumber, closed: true }) : [];
    if (closedOwn.length >= 1) return { days: closedOwn.slice(-12), source: "unit" };
    const closedCommunity = await daysForUnits(ids, { closed: true });
    if (closedCommunity.length >= 1) return { days: closedCommunity.slice(-8), source: "community" };
    const openCommunity = await daysForUnits(ids, {});
    if (openCommunity.length >= 2) return { days: openCommunity.slice(-8), source: "community" };
    return { days: closedOwn, source: closedOwn.length ? "unit" : "none" };
  } catch {
    return { days: [], source: "none" };
  }
}
