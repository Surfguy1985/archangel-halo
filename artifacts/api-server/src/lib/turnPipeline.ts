/**
 * Segment 8 — 13-week turn pipeline and capacity forecast.
 * No ML. Method is published on the document. Money is bigint cents.
 * Day boundaries use the portfolio IANA timezone.
 */

import { and, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import {
  db,
  propertiesTable,
  clientUnitsTable,
  clientTurnsTable,
  clientTurnMetricsMvTable,
  clientTurnInvoicesTable,
  clientScopesTable,
  clientScopeLinesTable,
  clientPriceListItemsTable,
  clientCapacityDeclarationsTable,
  clientCapacityHoldsTable,
  clientTurnForecastsTable,
  clientAuditLogTable,
  clientOrgsTable,
  clientPortfolioPropertiesTable,
  PIPELINE_TRADES,
  PIPELINE_WEEKS,
  DEFAULT_CAPACITY_HOLD_HOURS,
  FORECAST_METHOD,
  noticeConversionRate,
  seasonalIndex,
  applySeasonalDays,
  crunchRatio,
  isCrunch,
  spendBand,
  mean,
  tradeFromCategory,
  startOfWeekMondayInZone,
  addCivilDaysInZone,
  datePartsInZone,
  calendarDaysBetween,
  type PipelineTrade,
} from "@workspace/db";
import { loadPortfolio, PortfolioNotFoundError } from "./portfolioPulse";
import { createTurn, OpenTurnExistsError } from "./turnEngine";

export class PipelineError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PipelineError";
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function civilYmd(at: Date, timeZone: string): string {
  const p = datePartsInZone(at, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

function weekStarts(now: Date, timeZone: string): Date[] {
  const monday = startOfWeekMondayInZone(now, timeZone);
  return Array.from({ length: PIPELINE_WEEKS }, (_, i) => addCivilDaysInZone(monday, i * 7, timeZone));
}

function weekIndexFor(at: Date, weeks: Date[], timeZone: string): number {
  const civil = datePartsInZone(at, timeZone);
  const dayUtc = Date.UTC(civil.year, civil.month - 1, civil.day);
  for (let i = 0; i < weeks.length; i++) {
    const start = datePartsInZone(weeks[i]!, timeZone);
    const startUtc = Date.UTC(start.year, start.month - 1, start.day);
    if (dayUtc >= startUtc && dayUtc < startUtc + 7 * 86_400_000) return i;
  }
  return -1;
}

function sameCivilDay(a: Date, b: Date, timeZone: string): boolean {
  return civilYmd(a, timeZone) === civilYmd(b, timeZone);
}

export type PipelineUnit = {
  turnId: string;
  unitId: string;
  unitNumber: string;
  propertyId: string;
  bedrooms: number;
  kind: "scheduled" | "notice";
  vacateCivil: string;
  confidence: "high" | "medium" | "low";
  predictedReadyCivil: string | null;
  holdStatus: "none" | "held" | "confirmed" | "expired";
  holdBundleId: string | null;
  holdExpiresAt: string | null;
  scopeId: string | null;
};

export type PipelineCell = {
  propertyId: string;
  weekStart: string;
  units: number;
  crunch: boolean;
  ratio: number;
};

export type HeatmapCell = {
  trade: PipelineTrade;
  weekStart: string;
  demandUnits: number;
  capacityUnits: number;
  ratio: number;
  crunch: boolean;
};

export type SpendHorizon = {
  days: number;
  lowCents: string;
  midCents: string;
  highCents: string;
};

export async function expireStaleHolds(now = new Date()): Promise<number> {
  const result = await db
    .update(clientCapacityHoldsTable)
    .set({ status: "expired" })
    .where(and(eq(clientCapacityHoldsTable.status, "held"), lte(clientCapacityHoldsTable.expiresAt, now)));
  return Number((result as { rowCount?: number }).rowCount ?? 0);
}

export async function computePipeline(args: {
  portfolioId: string;
  orgId: string;
  now?: Date;
}): Promise<{
  portfolioId: string;
  title: string;
  timezone: string;
  method: string;
  conversionRate: number;
  weekStarts: string[];
  properties: Array<{ propertyId: string; name: string }>;
  cells: PipelineCell[];
  heatmap: HeatmapCell[];
  spend: { propertyId: string | null; label: string; horizons: SpendHorizon[] }[];
  units: PipelineUnit[];
}> {
  const now = args.now ?? new Date();
  await expireStaleHolds(now);
  const portfolio = await loadPortfolio(args.portfolioId);
  if (portfolio.orgId !== args.orgId) throw new PortfolioNotFoundError();
  const tz = portfolio.timezone || "America/Chicago";
  const weeks = weekStarts(now, tz);
  const weekCivils = weeks.map((w) => civilYmd(w, tz));

  const props = await db
    .select({
      propertyId: propertiesTable.id,
      name: propertiesTable.name,
    })
    .from(clientPortfolioPropertiesTable)
    .innerJoin(propertiesTable, eq(propertiesTable.id, clientPortfolioPropertiesTable.propertyId))
    .where(
      and(
        eq(clientPortfolioPropertiesTable.portfolioId, args.portfolioId),
        eq(propertiesTable.clientOrgId, args.orgId),
      ),
    );
  const propertyIds = props.map((p) => p.propertyId);
  const propertyName = new Map(props.map((p) => [p.propertyId, p.name]));

  if (propertyIds.length === 0) {
    return emptyDoc(args.portfolioId, tz, weekCivils);
  }

  const turns = await db
    .select({
      id: clientTurnsTable.id,
      unitId: clientTurnsTable.unitId,
      propertyId: clientTurnsTable.propertyId,
      noticeGivenAt: clientTurnsTable.noticeGivenAt,
      scheduledVacateAt: clientTurnsTable.scheduledVacateAt,
      actualVacateAt: clientTurnsTable.actualVacateAt,
      readyAt: clientTurnsTable.readyAt,
      assignedVendorOrgId: clientTurnsTable.assignedVendorOrgId,
      unitNumber: clientUnitsTable.unitNumber,
      bedrooms: clientUnitsTable.bedrooms,
      vacancyCostCents: clientTurnMetricsMvTable.vacancyCostCents,
    })
    .from(clientTurnsTable)
    .innerJoin(clientUnitsTable, eq(clientUnitsTable.id, clientTurnsTable.unitId))
    .leftJoin(clientTurnMetricsMvTable, eq(clientTurnMetricsMvTable.turnId, clientTurnsTable.id))
    .where(and(eq(clientTurnsTable.orgId, args.orgId), inArray(clientTurnsTable.propertyId, propertyIds)));

  const ready = turns.filter((t) => t.readyAt && t.actualVacateAt);
  const vacatedNotices = ready.filter((t) => t.noticeGivenAt && t.scheduledVacateAt);
  const onSchedule = vacatedNotices.filter((t) => sameCivilDay(t.scheduledVacateAt!, t.actualVacateAt!, tz));
  const conversion = noticeConversionRate(onSchedule.length, vacatedNotices.length);

  const durationByKey = new Map<string, number[]>();
  const durationByMonth: number[][] = Array.from({ length: 12 }, () => []);
  const allDurations: number[] = [];
  const noticeSpans: number[] = [];
  for (const t of ready) {
    const days = calendarDaysBetween(t.actualVacateAt!, t.readyAt!, tz);
    const key = `${t.propertyId}:${t.bedrooms}`;
    const list = durationByKey.get(key) ?? [];
    list.push(days);
    durationByKey.set(key, list);
    allDurations.push(days);
    durationByMonth[datePartsInZone(t.actualVacateAt!, tz).month - 1]!.push(days);
    if (t.noticeGivenAt) noticeSpans.push(calendarDaysBetween(t.noticeGivenAt, t.actualVacateAt!, tz));
  }
  const overallMean = mean(allDurations) || 7;
  const noticeMean = mean(noticeSpans) || 14;

  const readyIds = ready.map((t) => t.id);
  const invoiceByTurn = new Map<string, bigint>();
  if (readyIds.length > 0) {
    const invoices = await db
      .select({
        turnId: clientTurnInvoicesTable.turnId,
        total: sql<string>`coalesce(sum(${clientTurnInvoicesTable.totalCents}), 0)::text`,
      })
      .from(clientTurnInvoicesTable)
      .where(inArray(clientTurnInvoicesTable.turnId, readyIds))
      .groupBy(clientTurnInvoicesTable.turnId);
    for (const row of invoices) invoiceByTurn.set(row.turnId, BigInt(row.total));
  }
  const costByBed = new Map<number, { sum: bigint; n: number }>();
  for (const t of ready) {
    const cost = (invoiceByTurn.get(t.id) ?? 0n) + (t.vacancyCostCents ?? 0n);
    const slot = costByBed.get(t.bedrooms) ?? { sum: 0n, n: 0 };
    slot.sum += cost;
    slot.n += 1;
    costByBed.set(t.bedrooms, slot);
  }
  const avgCost = (bedrooms: number): bigint => {
    const slot = costByBed.get(bedrooms);
    if (!slot || slot.n === 0) return 0n;
    return slot.sum / BigInt(slot.n);
  };

  const lastReadyByUnit = new Map<string, string>();
  for (const t of ready) lastReadyByUnit.set(t.unitId, t.id);
  const lastReadyIds = [...new Set(lastReadyByUnit.values())];
  const tradesByTurn = new Map<string, Set<PipelineTrade>>();
  if (lastReadyIds.length > 0) {
    const lines = await db
      .select({
        turnId: clientScopesTable.turnId,
        category: clientPriceListItemsTable.category,
      })
      .from(clientScopeLinesTable)
      .innerJoin(clientScopesTable, eq(clientScopesTable.id, clientScopeLinesTable.scopeId))
      .leftJoin(
        clientPriceListItemsTable,
        and(
          eq(clientPriceListItemsTable.code, clientScopeLinesTable.code),
          sql`(${clientPriceListItemsTable.tier} IS NOT DISTINCT FROM ${clientScopeLinesTable.tier})`,
        ),
      )
      .where(inArray(clientScopesTable.turnId, lastReadyIds));
    for (const line of lines) {
      const trade = tradeFromCategory(line.category);
      if (!trade) continue;
      const set = tradesByTurn.get(line.turnId) ?? new Set();
      set.add(trade);
      tradesByTurn.set(line.turnId, set);
    }
  }

  const liveHolds = await db
    .select()
    .from(clientCapacityHoldsTable)
    .where(
      and(
        eq(clientCapacityHoldsTable.orgId, args.orgId),
        inArray(clientCapacityHoldsTable.status, ["held", "confirmed"]),
      ),
    );
  const holdByTurn = new Map<string, (typeof liveHolds)[number]>();
  for (const h of liveHolds) {
    if (!holdByTurn.has(h.turnId)) holdByTurn.set(h.turnId, h);
  }

  const openScopes = await db
    .select({ turnId: clientScopesTable.turnId, id: clientScopesTable.id })
    .from(clientScopesTable)
    .where(
      inArray(
        clientScopesTable.turnId,
        turns.filter((t) => !t.readyAt).map((t) => t.id).concat(["00000000-0000-0000-0000-000000000000"]),
      ),
    );
  const scopeByTurn = new Map(openScopes.map((s) => [s.turnId, s.id]));

  type Pending = {
    turn: (typeof turns)[number];
    kind: "scheduled" | "notice";
    vacateAt: Date;
    week: number;
    confidence: PipelineUnit["confidence"];
  };
  const pending: Pending[] = [];
  for (const t of turns) {
    if (t.readyAt) continue;
    if (t.actualVacateAt && t.actualVacateAt.getTime() < now.getTime()) continue;
    let vacateAt: Date | null = null;
    let kind: "scheduled" | "notice" = "scheduled";
    if (t.scheduledVacateAt) {
      vacateAt = t.scheduledVacateAt;
      kind = "scheduled";
    } else if (t.noticeGivenAt) {
      const month = datePartsInZone(addCivilDaysInZone(t.noticeGivenAt, noticeMean, tz), tz).month;
      const idx = seasonalIndex(mean(durationByMonth[month - 1] ?? []), overallMean);
      vacateAt = addCivilDaysInZone(t.noticeGivenAt, applySeasonalDays(noticeMean, idx), tz);
      kind = "notice";
    }
    if (!vacateAt) continue;
    const week = weekIndexFor(vacateAt, weeks, tz);
    if (week < 0) continue;
    const confidence: PipelineUnit["confidence"] =
      kind === "scheduled" ? "high" : conversion >= 0.7 ? "medium" : "low";
    pending.push({ turn: t, kind, vacateAt, week, confidence });
  }

  const units: PipelineUnit[] = pending.map((p) => {
    const hold = holdByTurn.get(p.turn.id);
    const durKey = `${p.turn.propertyId}:${p.turn.bedrooms}`;
    const baseDays = mean(durationByKey.get(durKey) ?? []) || overallMean;
    const month = datePartsInZone(p.vacateAt, tz).month;
    const idx = seasonalIndex(mean(durationByMonth[month - 1] ?? []), overallMean);
    const readyAt = addCivilDaysInZone(p.vacateAt, applySeasonalDays(baseDays, idx), tz);
    return {
      turnId: p.turn.id,
      unitId: p.turn.unitId,
      unitNumber: p.turn.unitNumber,
      propertyId: p.turn.propertyId,
      bedrooms: p.turn.bedrooms,
      kind: p.kind,
      vacateCivil: civilYmd(p.vacateAt, tz),
      confidence: p.confidence,
      predictedReadyCivil: civilYmd(readyAt, tz),
      holdStatus:
        hold?.status === "held" || hold?.status === "confirmed" || hold?.status === "expired"
          ? hold.status
          : "none",
      holdBundleId: hold?.bundleId ?? null,
      holdExpiresAt: hold?.expiresAt.toISOString() ?? null,
      scopeId: scopeByTurn.get(p.turn.id) ?? null,
    };
  });

  const declarations = await db.select().from(clientCapacityDeclarationsTable);
  const capByWeekTrade: number[][] = weeks.map(() => PIPELINE_TRADES.map(() => 0));
  for (const row of declarations) {
    const wi = weekIndexFor(row.weekStart, weeks, tz);
    const ti = PIPELINE_TRADES.indexOf(row.trade as PipelineTrade);
    if (wi < 0 || ti < 0) continue;
    capByWeekTrade[wi]![ti]! += row.unitsCapacity;
  }
  for (const h of liveHolds) {
    const wi = weekIndexFor(h.weekStart, weeks, tz);
    const ti = PIPELINE_TRADES.indexOf(h.trade as PipelineTrade);
    if (wi < 0 || ti < 0) continue;
    capByWeekTrade[wi]![ti]! = Math.max(0, capByWeekTrade[wi]![ti]! - h.units);
  }

  const demandByWeekTrade: number[][] = weeks.map(() => PIPELINE_TRADES.map(() => 0));
  const demandByPropWeek = new Map<string, number[]>();
  for (const p of props) demandByPropWeek.set(p.propertyId, weeks.map(() => 0));
  for (const p of pending) {
    const weight = p.kind === "scheduled" ? 1 : conversion;
    const counts = demandByPropWeek.get(p.turn.propertyId);
    if (counts) counts[p.week] = (counts[p.week] ?? 0) + weight;
    const lastId = lastReadyByUnit.get(p.turn.unitId);
    const trades = (lastId && tradesByTurn.get(lastId)) || new Set(PIPELINE_TRADES);
    for (const trade of trades) {
      const ti = PIPELINE_TRADES.indexOf(trade);
      demandByWeekTrade[p.week]![ti]! += weight;
    }
  }

  const weekCrunch = weeks.map((_, wi) => {
    const demand = demandByWeekTrade[wi]!.reduce((s, n) => s + n, 0);
    const cap = capByWeekTrade[wi]!.reduce((s, n) => s + n, 0);
    const ratio = crunchRatio(demand, cap);
    return { ratio, crunch: isCrunch(ratio) };
  });

  const cells: PipelineCell[] = [];
  const forecastRows: Array<{
    propertyId: string;
    weekStart: Date;
    projectedUnits: number;
    projectedSpendCents: bigint;
    confidence: string;
  }> = [];
  for (const p of props) {
    const counts = demandByPropWeek.get(p.propertyId) ?? weeks.map(() => 0);
    for (let wi = 0; wi < weeks.length; wi++) {
      const unitsCount = Math.round(counts[wi] ?? 0);
      cells.push({
        propertyId: p.propertyId,
        weekStart: weekCivils[wi]!,
        units: unitsCount,
        crunch: weekCrunch[wi]!.crunch,
        ratio: Math.round(weekCrunch[wi]!.ratio * 100) / 100,
      });
      const spendForWeek = pending
        .filter((x) => x.turn.propertyId === p.propertyId && x.week === wi)
        .reduce((s, x) => s + avgCost(x.turn.bedrooms), 0n);
      forecastRows.push({
        propertyId: p.propertyId,
        weekStart: weeks[wi]!,
        projectedUnits: unitsCount,
        projectedSpendCents: spendForWeek,
        confidence: weekCrunch[wi]!.crunch ? "low" : "medium",
      });
    }
  }

  const heatmap: HeatmapCell[] = [];
  for (let wi = 0; wi < weeks.length; wi++) {
    for (let ti = 0; ti < PIPELINE_TRADES.length; ti++) {
      const demand = demandByWeekTrade[wi]![ti]!;
      const cap = capByWeekTrade[wi]![ti]!;
      const ratio = crunchRatio(demand, cap);
      heatmap.push({
        trade: PIPELINE_TRADES[ti]!,
        weekStart: weekCivils[wi]!,
        demandUnits: Math.round(demand * 10) / 10,
        capacityUnits: cap,
        ratio: Math.round(ratio * 100) / 100,
        crunch: isCrunch(ratio),
      });
    }
  }

  const horizons = [30, 60, 90];
  const spendFor = (propertyId: string | null): SpendHorizon[] => {
    return horizons.map((days) => {
      const until = addCivilDaysInZone(now, days, tz);
      let scheduled = 0n;
      let notice = 0n;
      for (const p of pending) {
        if (propertyId && p.turn.propertyId !== propertyId) continue;
        if (p.vacateAt.getTime() > until.getTime()) continue;
        const cost = avgCost(p.turn.bedrooms);
        if (p.kind === "scheduled") scheduled += cost;
        else notice += cost;
      }
      const band = spendBand({ scheduledCostCents: scheduled, noticeCostCents: notice, conversionRate: conversion });
      return { days, ...band };
    });
  };

  const spend = [
    { propertyId: null, label: "Portfolio", horizons: spendFor(null) },
    ...props.map((p) => ({
      propertyId: p.propertyId,
      label: propertyName.get(p.propertyId) ?? "Property",
      horizons: spendFor(p.propertyId),
    })),
  ];

  if (forecastRows.length > 0) {
    await db
      .insert(clientTurnForecastsTable)
      .values(
        forecastRows.map((r) => ({
          propertyId: r.propertyId,
          weekStart: r.weekStart,
          projectedUnits: r.projectedUnits,
          projectedSpendCents: r.projectedSpendCents,
          confidence: r.confidence,
          generatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [clientTurnForecastsTable.propertyId, clientTurnForecastsTable.weekStart],
        set: {
          projectedUnits: sql`excluded.projected_units`,
          projectedSpendCents: sql`excluded.projected_spend_cents`,
          confidence: sql`excluded.confidence`,
          generatedAt: sql`excluded.generated_at`,
        },
      });
  }

  return {
    portfolioId: args.portfolioId,
    title: "Turn pipeline",
    timezone: tz,
    method: FORECAST_METHOD,
    conversionRate: Math.round(conversion * 1000) / 1000,
    weekStarts: weekCivils,
    properties: props.map((p) => ({ propertyId: p.propertyId, name: p.name })),
    cells,
    heatmap,
    spend,
    units,
  };
}

function emptyDoc(portfolioId: string, timezone: string, weekCivils: string[]) {
  return {
    portfolioId,
    title: "Turn pipeline",
    timezone,
    method: FORECAST_METHOD,
    conversionRate: 0,
    weekStarts: weekCivils,
    properties: [] as Array<{ propertyId: string; name: string }>,
    cells: [] as PipelineCell[],
    heatmap: [] as HeatmapCell[],
    spend: [] as { propertyId: string | null; label: string; horizons: SpendHorizon[] }[],
    units: [] as PipelineUnit[],
  };
}

export async function holdCrewCapacity(args: {
  turnId: string;
  orgId: string;
  actorId: string;
  now?: Date;
}): Promise<{ bundleId: string; expiresAt: string; status: "held" }> {
  const now = args.now ?? new Date();
  await expireStaleHolds(now);
  const [turn] = await db
    .select()
    .from(clientTurnsTable)
    .where(and(eq(clientTurnsTable.id, args.turnId), eq(clientTurnsTable.orgId, args.orgId)))
    .limit(1);
  if (!turn) throw new PipelineError(404, "Turn not found");
  if (turn.readyAt) throw new PipelineError(409, "That turn is already ready");
  const [property] = await db
    .select({
      timezone: propertiesTable.timezone,
      capacityHoldHours: propertiesTable.capacityHoldHours,
      name: propertiesTable.name,
    })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, turn.propertyId))
    .limit(1);
  const tz = property?.timezone || "America/Chicago";
  const hours = property?.capacityHoldHours ?? DEFAULT_CAPACITY_HOLD_HOURS;
  const vacateAt = turn.scheduledVacateAt ?? turn.noticeGivenAt ?? now;
  const weekStart = startOfWeekMondayInZone(vacateAt, tz);
  const vendorOrgId = turn.assignedVendorOrgId ?? (await defaultVendorOrgId());
  if (!vendorOrgId) throw new PipelineError(400, "No vendor org to hold against");

  const [existing] = await db
    .select({ bundleId: clientCapacityHoldsTable.bundleId })
    .from(clientCapacityHoldsTable)
    .where(
      and(
        eq(clientCapacityHoldsTable.turnId, args.turnId),
        inArray(clientCapacityHoldsTable.status, ["held", "confirmed"]),
      ),
    )
    .limit(1);
  if (existing) throw new PipelineError(409, "Capacity is already held for this turn");

  await maybeDraftScope(turn.id, turn.unitId, args.orgId);

  const bundleId = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + hours * 3_600_000);
  await db.insert(clientCapacityHoldsTable).values(
    PIPELINE_TRADES.map((trade) => ({
      bundleId,
      orgId: args.orgId,
      propertyId: turn.propertyId,
      unitId: turn.unitId,
      turnId: turn.id,
      vendorOrgId,
      trade,
      weekStart,
      units: 1,
      status: "held" as const,
      expiresAt,
    })),
  );
  await db.insert(clientAuditLogTable).values({
    orgId: args.orgId,
    actorId: args.actorId,
    entityType: "capacity_hold",
    entityId: bundleId,
    action: "capacity.held",
    after: { turnId: args.turnId, weekStart: weekStart.toISOString(), expiresAt: expiresAt.toISOString() },
  });
  return { bundleId, expiresAt: expiresAt.toISOString(), status: "held" };
}

export async function confirmCapacityHold(args: {
  bundleId: string;
  orgId: string;
  actorId: string;
}): Promise<{ bundleId: string; status: "confirmed" }> {
  await expireStaleHolds();
  const rows = await db
    .select()
    .from(clientCapacityHoldsTable)
    .where(
      and(eq(clientCapacityHoldsTable.bundleId, args.bundleId), eq(clientCapacityHoldsTable.orgId, args.orgId)),
    );
  if (rows.length === 0) throw new PipelineError(404, "Hold not found");
  if (rows.some((r) => r.status === "expired")) throw new PipelineError(409, "That hold expired");
  if (rows.every((r) => r.status === "confirmed")) {
    return { bundleId: args.bundleId, status: "confirmed" };
  }
  await db
    .update(clientCapacityHoldsTable)
    .set({ status: "confirmed", confirmedAt: new Date() })
    .where(
      and(eq(clientCapacityHoldsTable.bundleId, args.bundleId), eq(clientCapacityHoldsTable.status, "held")),
    );
  await db.insert(clientAuditLogTable).values({
    orgId: args.orgId,
    actorId: args.actorId,
    entityType: "capacity_hold",
    entityId: args.bundleId,
    action: "capacity.confirmed",
  });
  return { bundleId: args.bundleId, status: "confirmed" };
}

export async function scheduleVacateNotice(args: {
  unitId: string;
  orgId: string;
  actorId: string;
  scheduledVacate: Date;
  noticeGivenAt?: Date;
}): Promise<{ turnId: string }> {
  const [unit] = await db
    .select({
      id: clientUnitsTable.id,
      propertyId: clientUnitsTable.propertyId,
      clientOrgId: propertiesTable.clientOrgId,
    })
    .from(clientUnitsTable)
    .innerJoin(propertiesTable, eq(propertiesTable.id, clientUnitsTable.propertyId))
    .where(eq(clientUnitsTable.id, args.unitId))
    .limit(1);
  if (!unit || unit.clientOrgId !== args.orgId) throw new PipelineError(404, "Unit not found");
  const noticeGivenAt = args.noticeGivenAt ?? new Date();
  try {
    const created = await createTurn({
      orgId: args.orgId,
      propertyId: unit.propertyId,
      unitId: args.unitId,
      source: "app",
      actorId: args.actorId,
      noticeGivenAt,
      scheduledVacateAt: args.scheduledVacate,
      idempotencyKey: `vacate-notice:${args.unitId}:${civilYmd(args.scheduledVacate, "UTC")}`,
    });
    return { turnId: created.turnId };
  } catch (err) {
    if (!(err instanceof OpenTurnExistsError)) throw err;
    const [open] = await db
      .select({ id: clientTurnsTable.id })
      .from(clientTurnsTable)
      .where(and(eq(clientTurnsTable.unitId, args.unitId), isNull(clientTurnsTable.readyAt)))
      .limit(1);
    if (!open) throw new PipelineError(409, "This unit already has an open turn");
    await db
      .update(clientTurnsTable)
      .set({
        noticeGivenAt,
        scheduledVacateAt: args.scheduledVacate,
        updatedAt: new Date(),
      })
      .where(eq(clientTurnsTable.id, open.id));
    await db.insert(clientAuditLogTable).values({
      orgId: args.orgId,
      actorId: args.actorId,
      entityType: "turn",
      entityId: open.id,
      action: "vacate.scheduled",
      after: { scheduledVacateAt: args.scheduledVacate.toISOString() },
    });
    return { turnId: open.id };
  }
}

async function defaultVendorOrgId(): Promise<string | null> {
  const [row] = await db
    .select({ id: clientOrgsTable.id })
    .from(clientOrgsTable)
    .where(eq(clientOrgsTable.type, "vendor"))
    .limit(1);
  return row?.id ?? null;
}

async function maybeDraftScope(turnId: string, unitId: string, orgId: string): Promise<string | null> {
  const [existing] = await db
    .select({ id: clientScopesTable.id })
    .from(clientScopesTable)
    .where(eq(clientScopesTable.turnId, turnId))
    .limit(1);
  if (existing) return existing.id;
  const [prior] = await db
    .select({ id: clientTurnsTable.id })
    .from(clientTurnsTable)
    .where(and(eq(clientTurnsTable.unitId, unitId), isNotNull(clientTurnsTable.readyAt)))
    .limit(1);
  if (!prior) return null;
  const [priorScope] = await db
    .select()
    .from(clientScopesTable)
    .where(eq(clientScopesTable.turnId, prior.id))
    .limit(1);
  if (!priorScope) return null;
  const lines = await db.select().from(clientScopeLinesTable).where(eq(clientScopeLinesTable.scopeId, priorScope.id));
  const [scope] = await db
    .insert(clientScopesTable)
    .values({ turnId, status: "draft", createdBy: `pipeline:${orgId}` })
    .returning();
  if (lines.length > 0) {
    await db.insert(clientScopeLinesTable).values(
      lines.map((l) => ({
        scopeId: scope!.id,
        description: l.description,
        code: l.code,
        tier: l.tier,
        qty: l.qty,
        uom: l.uom,
        unitPriceCents: l.unitPriceCents,
        extendedCents: l.extendedCents,
        compliance: l.compliance,
      })),
    );
  }
  return scope!.id;
}

export async function propertyIdOfTurn(turnId: string): Promise<string | null> {
  const [row] = await db
    .select({ propertyId: clientTurnsTable.propertyId })
    .from(clientTurnsTable)
    .where(eq(clientTurnsTable.id, turnId))
    .limit(1);
  return row?.propertyId ?? null;
}

export async function propertyIdOfHoldBundle(bundleId: string): Promise<string | null> {
  const [row] = await db
    .select({ propertyId: clientCapacityHoldsTable.propertyId })
    .from(clientCapacityHoldsTable)
    .where(eq(clientCapacityHoldsTable.bundleId, bundleId))
    .limit(1);
  return row?.propertyId ?? null;
}

export async function propertyIdOfUnit(unitId: string): Promise<string | null> {
  const [row] = await db
    .select({ propertyId: clientUnitsTable.propertyId })
    .from(clientUnitsTable)
    .where(eq(clientUnitsTable.id, unitId))
    .limit(1);
  return row?.propertyId ?? null;
}
