/**
 * Cost-to-serve comparison — in-house vs third-party, by bedroom count.
 * Header copy: "How work gets done across the portfolio." Not a vendor scorecard.
 */

import { and, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import {
  db,
  propertiesTable,
  clientPortfolioPropertiesTable,
  clientTurnsTable,
  clientTurnMetricsMvTable,
  clientUnitsTable,
  clientTurnInvoicesTable,
  clientTurnStageEventsTable,
  type WorkSource,
  type WorkSourceFilter,
} from "@workspace/db";
import { loadPortfolio, PortfolioNotFoundError, resolvePulseWindow, type PulseQuery } from "./portfolioPulse";

export type CostToServeSide = {
  unitCount: number;
  costPerUnitCents: string;
  daysPerUnit: number | null;
  reworkRateBps: number;
};

export type CostToServeRow = {
  workType: string;
  bedrooms: number;
  inHouse: CostToServeSide;
  thirdParty: CostToServeSide;
};

function emptySide(): CostToServeSide {
  return { unitCount: 0, costPerUnitCents: "0", daysPerUnit: null, reworkRateBps: 0 };
}

function workTypeLabel(bedrooms: number): string {
  if (bedrooms <= 0) return "Studio make-ready";
  if (bedrooms === 1) return "1-bed make-ready";
  return `${bedrooms}-bed make-ready`;
}

function sideFrom(rows: Array<{
  workSource: WorkSource;
  unitCount: number;
  costCents: bigint;
  daysSum: number;
  reworkCount: number;
}>): CostToServeSide {
  const unitCount = rows.reduce((s, r) => s + r.unitCount, 0);
  if (unitCount === 0) return emptySide();
  const cost = rows.reduce((s, r) => s + r.costCents, 0n);
  const days = rows.reduce((s, r) => s + r.daysSum, 0);
  const rework = rows.reduce((s, r) => s + r.reworkCount, 0);
  return {
    unitCount,
    costPerUnitCents: (cost / BigInt(unitCount)).toString(),
    daysPerUnit: Math.round((days / unitCount) * 10) / 10,
    reworkRateBps: Math.round((rework * 10_000) / unitCount),
  };
}

export async function computeCostToServe(args: {
  portfolioId: string;
  orgId: string;
  query: PulseQuery & { workSource?: WorkSourceFilter };
  now?: Date;
}): Promise<{
  portfolioId: string;
  title: string;
  workSource: WorkSourceFilter;
  from: string;
  to: string;
  rows: CostToServeRow[];
}> {
  const portfolio = await loadPortfolio(args.portfolioId);
  if (portfolio.orgId !== args.orgId) throw new PortfolioNotFoundError();
  const now = args.now ?? new Date();
  const window = resolvePulseWindow(args.query, portfolio.timezone, now);
  const filter: WorkSourceFilter = args.query.workSource ?? "all";

  const linked = await db
    .select({ propertyId: clientPortfolioPropertiesTable.propertyId })
    .from(clientPortfolioPropertiesTable)
    .innerJoin(propertiesTable, eq(propertiesTable.id, clientPortfolioPropertiesTable.propertyId))
    .where(
      and(
        eq(clientPortfolioPropertiesTable.portfolioId, args.portfolioId),
        eq(propertiesTable.clientOrgId, args.orgId),
      ),
    );
  const propertyIds = linked.map((r) => r.propertyId);
  if (propertyIds.length === 0) {
    return {
      portfolioId: args.portfolioId,
      title: "How work gets done across the portfolio",
      workSource: filter,
      from: window.fromCivil,
      to: window.toCivil,
      rows: [],
    };
  }

  const conditions = [
    eq(clientTurnsTable.orgId, args.orgId),
    inArray(clientTurnsTable.propertyId, propertyIds),
    isNotNull(clientTurnsTable.readyAt),
    gte(clientTurnsTable.readyAt, window.fromAt),
    lt(clientTurnsTable.readyAt, window.toExclusive),
  ];
  if (filter !== "all") conditions.push(eq(clientTurnsTable.workSource, filter));

  const turns = await db
    .select({
      id: clientTurnsTable.id,
      workSource: clientTurnsTable.workSource,
      bedrooms: clientUnitsTable.bedrooms,
      daysVacant: clientTurnMetricsMvTable.daysVacant,
      vacancyCostCents: clientTurnMetricsMvTable.vacancyCostCents,
    })
    .from(clientTurnsTable)
    .innerJoin(clientUnitsTable, eq(clientUnitsTable.id, clientTurnsTable.unitId))
    .leftJoin(clientTurnMetricsMvTable, eq(clientTurnMetricsMvTable.turnId, clientTurnsTable.id))
    .where(and(...conditions));

  const turnIds = turns.map((t) => t.id);
  const invoiceByTurn = new Map<string, bigint>();
  const reworkTurns = new Set<string>();
  if (turnIds.length > 0) {
    const invoices = await db
      .select({
        turnId: clientTurnInvoicesTable.turnId,
        total: sql<string>`coalesce(sum(${clientTurnInvoicesTable.totalCents}), 0)::text`,
      })
      .from(clientTurnInvoicesTable)
      .where(inArray(clientTurnInvoicesTable.turnId, turnIds))
      .groupBy(clientTurnInvoicesTable.turnId);
    for (const inv of invoices) {
      invoiceByTurn.set(inv.turnId, BigInt(inv.total));
    }
    const rework = await db
      .select({ turnId: clientTurnStageEventsTable.turnId })
      .from(clientTurnStageEventsTable)
      .where(
        and(inArray(clientTurnStageEventsTable.turnId, turnIds), eq(clientTurnStageEventsTable.stage, "rework")),
      );
    for (const r of rework) reworkTurns.add(r.turnId);
  }

  const buckets = new Map<
    string,
    { bedrooms: number; workSource: WorkSource; unitCount: number; costCents: bigint; daysSum: number; reworkCount: number }
  >();
  for (const t of turns) {
    const key = `${t.bedrooms}:${t.workSource}`;
    const prev = buckets.get(key) ?? {
      bedrooms: t.bedrooms,
      workSource: t.workSource,
      unitCount: 0,
      costCents: 0n,
      daysSum: 0,
      reworkCount: 0,
    };
    prev.unitCount += 1;
    prev.costCents += (t.vacancyCostCents ?? 0n) + (invoiceByTurn.get(t.id) ?? 0n);
    prev.daysSum += t.daysVacant ?? 0;
    if (reworkTurns.has(t.id)) prev.reworkCount += 1;
    buckets.set(key, prev);
  }

  const byBed = new Map<number, Array<(typeof buckets extends Map<string, infer V> ? V : never)>>();
  for (const row of buckets.values()) {
    const list = byBed.get(row.bedrooms) ?? [];
    list.push(row);
    byBed.set(row.bedrooms, list);
  }

  const rows: CostToServeRow[] = [...byBed.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bedrooms, list]) => ({
      workType: workTypeLabel(bedrooms),
      bedrooms,
      inHouse: sideFrom(list.filter((r) => r.workSource === "in_house")),
      thirdParty: sideFrom(list.filter((r) => r.workSource === "third_party")),
    }));

  return {
    portfolioId: args.portfolioId,
    title: "How work gets done across the portfolio",
    workSource: filter,
    from: window.fromCivil,
    to: window.toCivil,
    rows,
  };
}
