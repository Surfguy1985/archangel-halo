/**
 * Portfolio Pulse read model (Segment 3).
 *
 * Reads `client_turn_metrics_mv`, `client_turns`, `client_units`, and
 * `properties`. Never scans `client_turn_stage_events` — that is the
 * acceptance bar for p95 against 17k units.
 */

import { and, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import {
  db,
  propertiesTable,
  clientOrgsTable,
  clientPortfoliosTable,
  clientPortfolioPropertiesTable,
  clientTurnsTable,
  clientTurnMetricsMvTable,
  clientUnitsTable,
  clientSavedViewsTable,
  datePartsInZone,
  zonedCivilToUtc,
  addCivilDaysInZone,
  startOfWeekMondayInZone,
  daysInMonthInZone,
  calendarDaysBetween,
  vacancyCostCents,
  type TurnStage,
  type WorkSourceFilter,
  clientScopeLinesTable,
  clientScopesTable,
  clientVarianceRequestsTable,
} from "@workspace/db";
import { isClientBoardSegmentEnabled } from "./clientBoardFlags";
import { complianceStats } from "./turnInvoice";
import { loadPoByTurnIds, shapeTurnClock } from "./turnCloseoutClock";
import { computePortfolioUnitPhotos, type PortfolioUnitPhotoPair } from "./portfolioUnitPhotos";
import { computePortfolioCrewToday, type PortfolioCrewToday } from "./portfolioCrewToday";

export const PULSE_VIEW_NAME = "pulse";

export type PulseRangePreset = "this_month" | "last_30" | "qtd" | "custom";
export type PulseTileSort = "vacancy_cost" | "turn_days" | "units_in_turn" | "name";
export type PulseTileStatus = "on_target" | "drifting" | "at_risk";

export type PulseQuery = {
  range?: PulseRangePreset;
  from?: string | null;
  to?: string | null;
  sort?: PulseTileSort;
  workSource?: WorkSourceFilter;
};

export type PulseWindow = {
  range: PulseRangePreset;
  fromCivil: string;
  toCivil: string;
  fromAt: Date;
  toExclusive: Date;
  priorFromAt: Date;
  priorToExclusive: Date;
  priorLabel: string;
  headlineLabel: string;
};

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function centsString(cents: bigint): string {
  return cents.toString();
}

export function parseCivilDate(value: string): { year: number; month: number; day: number } {
  const m = ISO_DAY.exec(value.trim());
  if (!m) throw new PulseRangeError("from/to must be YYYY-MM-DD");
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function civilKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function startOfDay(timeZone: string, year: number, month: number, day: number): Date {
  return zonedCivilToUtc(timeZone, year, month, day, 0, 0, 0);
}

function startOfMonth(at: Date, timeZone: string): Date {
  const p = datePartsInZone(at, timeZone);
  return startOfDay(timeZone, p.year, p.month, 1);
}

function startOfQuarter(at: Date, timeZone: string): Date {
  const p = datePartsInZone(at, timeZone);
  const month = Math.floor((p.month - 1) / 3) * 3 + 1;
  return startOfDay(timeZone, p.year, month, 1);
}

function startOfToday(at: Date, timeZone: string): Date {
  const p = datePartsInZone(at, timeZone);
  return startOfDay(timeZone, p.year, p.month, p.day);
}

function lastMonthSameDomWindow(at: Date, timeZone: string): { from: Date; toExclusive: Date } {
  const p = datePartsInZone(at, timeZone);
  let year = p.year;
  let month = p.month - 1;
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  const from = startOfDay(timeZone, year, month, 1);
  const dim = daysInMonthInZone(from, timeZone);
  const day = Math.min(p.day, dim);
  return { from, toExclusive: addCivilDaysInZone(startOfDay(timeZone, year, month, day), 1, timeZone) };
}

export function resolvePulseWindow(
  query: PulseQuery,
  timeZone: string,
  now = new Date(),
): PulseWindow {
  const range: PulseRangePreset = query.range ?? "this_month";
  const today = startOfToday(now, timeZone);
  const tomorrow = addCivilDaysInZone(today, 1, timeZone);
  const todayParts = datePartsInZone(now, timeZone);

  if (range === "custom") {
    if (!query.from || !query.to) {
      throw new PulseRangeError("custom range requires from and to");
    }
    const a = parseCivilDate(query.from);
    const b = parseCivilDate(query.to);
    const fromAt = startOfDay(timeZone, a.year, a.month, a.day);
    const toExclusive = addCivilDaysInZone(startOfDay(timeZone, b.year, b.month, b.day), 1, timeZone);
    if (!(fromAt < toExclusive)) throw new PulseRangeError("from must be on or before to");
    const spanDays = Math.round((toExclusive.getTime() - fromAt.getTime()) / 86_400_000);
    const priorToExclusive = fromAt;
    const priorFromAt = addCivilDaysInZone(fromAt, -spanDays, timeZone);
    return {
      range,
      fromCivil: civilKey(a.year, a.month, a.day),
      toCivil: civilKey(b.year, b.month, b.day),
      fromAt,
      toExclusive,
      priorFromAt,
      priorToExclusive,
      priorLabel: "prior period",
      headlineLabel: "rent lost to vacancy days this period",
    };
  }

  if (range === "last_30") {
    const fromAt = addCivilDaysInZone(today, -29, timeZone);
    const priorToExclusive = fromAt;
    const priorFromAt = addCivilDaysInZone(fromAt, -30, timeZone);
    const fromP = datePartsInZone(fromAt, timeZone);
    return {
      range,
      fromCivil: civilKey(fromP.year, fromP.month, fromP.day),
      toCivil: civilKey(todayParts.year, todayParts.month, todayParts.day),
      fromAt,
      toExclusive: tomorrow,
      priorFromAt,
      priorToExclusive,
      priorLabel: "previous 30 days",
      headlineLabel: "rent lost to vacancy days last 30 days",
    };
  }

  if (range === "qtd") {
    const fromAt = startOfQuarter(now, timeZone);
    const fromP = datePartsInZone(fromAt, timeZone);
    const priorQuarterMonth = fromP.month - 3;
    const priorYear = priorQuarterMonth < 1 ? fromP.year - 1 : fromP.year;
    const priorMonth = priorQuarterMonth < 1 ? priorQuarterMonth + 12 : priorQuarterMonth;
    const priorFromAt = startOfDay(timeZone, priorYear, priorMonth, 1);
    const offsetDays = Math.round((tomorrow.getTime() - fromAt.getTime()) / 86_400_000);
    const priorToExclusive = addCivilDaysInZone(priorFromAt, offsetDays, timeZone);
    return {
      range,
      fromCivil: civilKey(fromP.year, fromP.month, fromP.day),
      toCivil: civilKey(todayParts.year, todayParts.month, todayParts.day),
      fromAt,
      toExclusive: tomorrow,
      priorFromAt,
      priorToExclusive,
      priorLabel: "same days last quarter",
      headlineLabel: "rent lost to vacancy days this quarter",
    };
  }

  const fromAt = startOfMonth(now, timeZone);
  const fromP = datePartsInZone(fromAt, timeZone);
  const prior = lastMonthSameDomWindow(now, timeZone);
  return {
    range: "this_month",
    fromCivil: civilKey(fromP.year, fromP.month, fromP.day),
    toCivil: civilKey(todayParts.year, todayParts.month, todayParts.day),
    fromAt,
    toExclusive: tomorrow,
    priorFromAt: prior.from,
    priorToExclusive: prior.toExclusive,
    priorLabel: "last month, same day",
    headlineLabel: "rent lost to vacancy days this month",
  };
}

export function classifyTileStatus(args: {
  medianTurnDays: number | null;
  targetTurnDays: number;
  stalledCount: number;
}): { status: PulseTileStatus; statusLabel: string } {
  const { medianTurnDays, targetTurnDays, stalledCount } = args;
  if (stalledCount > 0 || (medianTurnDays != null && medianTurnDays >= targetTurnDays * 1.25)) {
    return { status: "at_risk", statusLabel: "At risk" };
  }
  if (medianTurnDays != null && medianTurnDays > targetTurnDays) {
    return { status: "drifting", statusLabel: "Drifting" };
  }
  return { status: "on_target", statusLabel: "On target" };
}

/** Units in the turn pipeline at a week window. Uses vacate/ready stamps, not events. */
export function countUnitsInTurn(
  turns: Array<{ actualVacateAt: Date | null; noticeGivenAt: Date | null; createdAt: Date; readyAt: Date | null }>,
  weekStart: Date,
  weekEnd: Date,
): number {
  let n = 0;
  for (const t of turns) {
    const entered = t.actualVacateAt ?? t.noticeGivenAt ?? t.createdAt;
    if (entered >= weekEnd) continue;
    if (t.readyAt && t.readyAt < weekStart) continue;
    n += 1;
  }
  return n;
}

export function turnOverlapsWindow(
  turn: { actualVacateAt: Date | null; noticeGivenAt: Date | null; createdAt: Date; readyAt: Date | null },
  fromAt: Date,
  toExclusive: Date,
): boolean {
  const entered = turn.actualVacateAt ?? turn.noticeGivenAt ?? turn.createdAt;
  if (entered >= toExclusive) return false;
  if (turn.readyAt && turn.readyAt < fromAt) return false;
  return true;
}

/** Match `computeTurnMetrics`: February bills 28; a 28-day floor of 30 only if the month is shorter. */
function billingDaysInMonth(at: Date, timeZone: string): number {
  const raw = daysInMonthInZone(at, timeZone);
  return raw < 28 ? 30 : raw;
}

/**
 * Over-target vacancy $ that falls inside `[windowFrom, windowToExclusive)`.
 * Splits the overlap by civil month in the *property* timezone and bills each
 * slice with `vacancyCostCents` — never the lifetime MV total.
 */
export function vacancyCostInWindow(args: {
  vacateAt: Date | null;
  readyAt: Date | null;
  targetTurnDays: number;
  targetReadyAt: Date | null;
  marketRentCents: bigint;
  avgDailyRentCents?: bigint | null;
  windowFrom: Date;
  windowToExclusive: Date;
  timezone: string;
  now: Date;
}): bigint {
  if (!args.vacateAt) return 0n;
  const asOf =
    args.readyAt && args.readyAt.getTime() < args.now.getTime() ? args.readyAt : args.now;
  const targetReady =
    args.targetReadyAt ?? addCivilDaysInZone(args.vacateAt, args.targetTurnDays, args.timezone);
  if (!(targetReady.getTime() < asOf.getTime())) return 0n;
  const start = targetReady.getTime() > args.windowFrom.getTime() ? targetReady : args.windowFrom;
  const end = asOf.getTime() < args.windowToExclusive.getTime() ? asOf : args.windowToExclusive;
  if (!(start.getTime() < end.getTime())) return 0n;

  let cost = 0n;
  let cursor = start;
  let guard = 0;
  while (cursor.getTime() < end.getTime() && guard++ < 36) {
    const parts = datePartsInZone(cursor, args.timezone);
    const monthStart = zonedCivilToUtc(args.timezone, parts.year, parts.month, 1);
    const dimRaw = daysInMonthInZone(monthStart, args.timezone);
    const dim = billingDaysInMonth(monthStart, args.timezone);
    const nextMonth = addCivilDaysInZone(monthStart, dimRaw, args.timezone);
    const sliceEnd = nextMonth.getTime() < end.getTime() ? nextMonth : end;
    const days = calendarDaysBetween(cursor, sliceEnd, args.timezone);
    const rent =
      args.marketRentCents > 0n
        ? args.marketRentCents
        : (args.avgDailyRentCents ?? 0n) * BigInt(dim);
    if (days > 0 && rent > 0n) {
      cost += vacancyCostCents({
        overTargetDays: days,
        marketRentCents: rent,
        daysInMonth: dim,
      });
    }
    cursor = sliceEnd;
  }
  return cost;
}

export class PulseRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PulseRangeError";
  }
}

export class PortfolioNotFoundError extends Error {
  constructor(message = "Portfolio not found") {
    super(message);
    this.name = "PortfolioNotFoundError";
  }
}

export type PulseHrefForProperty = (propertyId: string) => string;

type TurnRow = {
  id: string;
  propertyId: string;
  unitId: string;
  status: TurnStage;
  noticeGivenAt: Date | null;
  actualVacateAt: Date | null;
  readyAt: Date | null;
  targetReadyAt: Date | null;
  predictedReadyAt: Date | null;
  createdAt: Date;
  marketRentCents: bigint;
  daysVacant: number | null;
  isStalled: boolean | null;
};

type PropertyPulseMeta = {
  propertyId: string;
  name: string;
  units: number | null;
  targetTurnDays: number;
  timezone: string;
  avgDailyRentCents: bigint | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
};

function windowedVacancy(
  t: TurnRow,
  property: PropertyPulseMeta,
  fromAt: Date,
  toExclusive: Date,
  now: Date,
): bigint {
  return vacancyCostInWindow({
    vacateAt: t.actualVacateAt,
    readyAt: t.readyAt,
    targetTurnDays: property.targetTurnDays,
    targetReadyAt: t.targetReadyAt,
    marketRentCents: t.marketRentCents,
    avgDailyRentCents: property.avgDailyRentCents,
    windowFrom: fromAt,
    windowToExclusive: toExclusive,
    timezone: property.timezone,
    now,
  });
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

type SavedFilters = {
  range?: PulseRangePreset;
  from?: string | null;
  to?: string | null;
  sort?: PulseTileSort;
};

export async function loadSavedPulseQuery(
  userId: string,
  portfolioId: string,
): Promise<PulseQuery> {
  const [row] = await db
    .select()
    .from(clientSavedViewsTable)
    .where(
      and(
        eq(clientSavedViewsTable.userId, userId),
        eq(clientSavedViewsTable.name, PULSE_VIEW_NAME),
        eq(clientSavedViewsTable.isDefault, true),
      ),
    )
    .limit(1);
  const filters = (row?.filters ?? {}) as SavedFilters & { portfolioId?: string };
  if (filters.portfolioId && filters.portfolioId !== portfolioId) return {};
  return {
    range: filters.range,
    from: filters.from,
    to: filters.to,
    sort: filters.sort,
  };
}

export async function savePulseView(args: {
  userId: string;
  portfolioId: string;
  range: PulseRangePreset;
  from: string | null;
  to: string | null;
  sort: PulseTileSort;
}): Promise<{
  id: string;
  name: string;
  range: PulseRangePreset;
  from: string | null;
  to: string | null;
  sort: PulseTileSort;
  isDefault: boolean;
}> {
  const filters: SavedFilters & { portfolioId: string } = {
    portfolioId: args.portfolioId,
    range: args.range,
    from: args.from,
    to: args.to,
    sort: args.sort,
  };
  const [existing] = await db
    .select()
    .from(clientSavedViewsTable)
    .where(
      and(
        eq(clientSavedViewsTable.userId, args.userId),
        eq(clientSavedViewsTable.name, PULSE_VIEW_NAME),
      ),
    )
    .limit(1);
  const row = existing
    ? (
        await db
          .update(clientSavedViewsTable)
          .set({ filters, isDefault: true })
          .where(eq(clientSavedViewsTable.id, existing.id))
          .returning()
      )[0]
    : (
        await db
          .insert(clientSavedViewsTable)
          .values({
            userId: args.userId,
            name: PULSE_VIEW_NAME,
            filters,
            isDefault: true,
          })
          .returning()
      )[0];
  if (!row) throw new Error("failed to save pulse view");
  return {
    id: row.id,
    name: row.name,
    range: args.range,
    from: args.from,
    to: args.to,
    sort: args.sort,
    isDefault: true,
  };
}

export async function listPortfoliosForOffice(): Promise<
  Array<{ id: string; name: string; orgId: string; propertyCount: number }>
> {
  const rows = await db
    .select({
      id: clientPortfoliosTable.id,
      name: clientPortfoliosTable.name,
      orgId: clientPortfoliosTable.orgId,
      propertyCount: sql<number>`count(${clientPortfolioPropertiesTable.propertyId})::int`,
    })
    .from(clientPortfoliosTable)
    .leftJoin(
      clientPortfolioPropertiesTable,
      eq(clientPortfolioPropertiesTable.portfolioId, clientPortfoliosTable.id),
    )
    .groupBy(
      clientPortfoliosTable.id,
      clientPortfoliosTable.name,
      clientPortfoliosTable.orgId,
    )
    .orderBy(clientPortfoliosTable.name);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    orgId: r.orgId,
    propertyCount: Number(r.propertyCount),
  }));
}

export async function resolvePortfolioForProperty(propertyId: string): Promise<{
  portfolioId: string;
  orgId: string;
} | null> {
  const [property] = await db
    .select({
      id: propertiesTable.id,
      clientOrgId: propertiesTable.clientOrgId,
    })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, propertyId))
    .limit(1);
  if (!property?.clientOrgId) return null;
  const [link] = await db
    .select({
      portfolioId: clientPortfolioPropertiesTable.portfolioId,
      orgId: clientPortfoliosTable.orgId,
    })
    .from(clientPortfolioPropertiesTable)
    .innerJoin(
      clientPortfoliosTable,
      eq(clientPortfoliosTable.id, clientPortfolioPropertiesTable.portfolioId),
    )
    .where(
      and(
        eq(clientPortfolioPropertiesTable.propertyId, propertyId),
        eq(clientPortfoliosTable.orgId, property.clientOrgId),
      ),
    )
    .limit(1);
  if (!link) return null;
  return { portfolioId: link.portfolioId, orgId: link.orgId };
}

export async function loadPortfolio(portfolioId: string): Promise<{
  id: string;
  name: string;
  orgId: string;
  timezone: string;
}> {
  const [row] = await db
    .select({
      id: clientPortfoliosTable.id,
      name: clientPortfoliosTable.name,
      orgId: clientPortfoliosTable.orgId,
      timezone: clientOrgsTable.timezone,
    })
    .from(clientPortfoliosTable)
    .innerJoin(clientOrgsTable, eq(clientOrgsTable.id, clientPortfoliosTable.orgId))
    .where(eq(clientPortfoliosTable.id, portfolioId))
    .limit(1);
  if (!row) throw new PortfolioNotFoundError();
  return row;
}

export async function computePortfolioPulse(args: {
  portfolioId: string;
  orgId: string;
  query: PulseQuery;
  hrefForProperty: PulseHrefForProperty;
  now?: Date;
  allowedPropertyIds?: string[] | null;
  viewKind?: "regional" | "property";
  viewLabel?: string;
  canAddProperties?: boolean;
}): Promise<
  ReturnType<typeof shapePulse> & {
    // Added after shapePulse() below — keep them on the declared return type or
    // callers (e.g. the portfolio ask handler's title) silently lose them.
    viewKind: "regional" | "property";
    viewLabel: string;
    canAddProperties: boolean;
    compliance?: Awaited<ReturnType<typeof complianceStats>>;
  }
> {
  const portfolio = await loadPortfolio(args.portfolioId);
  if (portfolio.orgId !== args.orgId) throw new PortfolioNotFoundError();
  const now = args.now ?? new Date();
  const window = resolvePulseWindow(args.query, portfolio.timezone, now);
  const sort: PulseTileSort = args.query.sort ?? "vacancy_cost";

  const linked: PropertyPulseMeta[] = await db
    .select({
      propertyId: clientPortfolioPropertiesTable.propertyId,
      name: propertiesTable.name,
      units: propertiesTable.units,
      targetTurnDays: propertiesTable.targetTurnDays,
      timezone: propertiesTable.timezone,
      avgDailyRentCents: propertiesTable.avgDailyRentCents,
      city: propertiesTable.city,
      latitude: propertiesTable.latitude,
      longitude: propertiesTable.longitude,
    })
    .from(clientPortfolioPropertiesTable)
    .innerJoin(
      propertiesTable,
      eq(propertiesTable.id, clientPortfolioPropertiesTable.propertyId),
    )
    .where(eq(clientPortfolioPropertiesTable.portfolioId, args.portfolioId));

  const linkedFiltered =
    args.allowedPropertyIds && args.allowedPropertyIds.length > 0
      ? linked.filter((p) => args.allowedPropertyIds!.includes(p.propertyId))
      : args.allowedPropertyIds
        ? []
        : linked;
  const propertyIds = linkedFiltered.map((p) => p.propertyId);
  const propertyById = new Map(linkedFiltered.map((p) => [p.propertyId, p]));
  const empty = shapePulse({
    portfolio,
    window,
    sort,
    supporting: {
      unitsInTurn: 0,
      medianTurnDays: null,
      targetTurnDays: linkedFiltered[0]?.targetTurnDays ?? 7,
      predictedLateThisWeek: 0,
    },
    headlineCents: 0n,
    priorCents: 0n,
    tiles: [],
  });
  if (propertyIds.length === 0) {
    return {
      ...empty,
      viewKind: args.viewKind ?? (args.allowedPropertyIds?.length === 1 ? "property" : "regional"),
      viewLabel: args.viewLabel ?? portfolio.name,
      canAddProperties: args.canAddProperties ?? !args.allowedPropertyIds,
    };
  }

  const weekStart = startOfWeekMondayInZone(now, portfolio.timezone);
  const weekEnd = addCivilDaysInZone(weekStart, 7, portfolio.timezone);
  const sparkStarts: Date[] = [];
  for (let i = 11; i >= 0; i--) {
    sparkStarts.push(addCivilDaysInZone(weekStart, -7 * i, portfolio.timezone));
  }
  const sparkEnds = sparkStarts.map((start) => addCivilDaysInZone(start, 7, portfolio.timezone));
  const cutoff = new Date(
    Math.min(window.priorFromAt.getTime(), window.fromAt.getTime(), sparkStarts[0]!.getTime()),
  );
  const propertyIdList = sql.join(
    propertyIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const sparkSql = sql.join(
    sparkStarts.map(
      (_, i) => sql`count(*) FILTER (
        WHERE COALESCE(f.actual_vacate_at, f.notice_given_at, f.created_at) < ${sparkEnds[i]}
          AND (f.ready_at IS NULL OR f.ready_at >= ${sparkStarts[i]})
      )::int AS ${sql.raw(`s${i}`)}`,
    ),
    sql`, `,
  );

  const workSourceSql =
    args.query.workSource && args.query.workSource !== "all"
      ? sql`AND t.work_source = ${args.query.workSource}`
      : sql``;

  const [aggResult, overTarget] = await Promise.all([
    db.execute(sql`
      WITH filtered AS (
        SELECT
          t.property_id,
          t.ready_at,
          t.actual_vacate_at,
          t.notice_given_at,
          t.created_at,
          t.predicted_ready_at,
          t.target_ready_at,
          m.days_vacant,
          m.is_stalled
        FROM client_turns t
        LEFT JOIN client_turn_metrics_mv m ON m.turn_id = t.id
        WHERE t.org_id = ${args.orgId}::uuid
          AND t.property_id IN (${propertyIdList})
          AND (t.ready_at IS NULL OR t.ready_at >= ${cutoff})
          ${workSourceSql}
      )
      SELECT
        property_id AS "propertyId",
        count(*) FILTER (WHERE ready_at IS NULL)::int AS "unitsInTurn",
        count(*) FILTER (WHERE ready_at IS NULL AND COALESCE(is_stalled, false))::int AS "stalledCount",
        count(*) FILTER (
          WHERE ready_at IS NULL
            AND predicted_ready_at >= ${weekStart}
            AND predicted_ready_at < ${weekEnd}
            AND target_ready_at IS NOT NULL
            AND predicted_ready_at > target_ready_at
        )::int AS "predictedLate",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY days_vacant)
          FILTER (WHERE ready_at IS NOT NULL AND ready_at >= ${window.fromAt} AND ready_at < ${window.toExclusive})
          AS "medianCompleted",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY days_vacant)
          FILTER (WHERE ready_at IS NULL)
          AS "medianOpen",
        ${sparkSql}
      FROM filtered f
      GROUP BY GROUPING SETS ((property_id), ())
    `),
    db
      .select({
        id: clientTurnsTable.id,
        propertyId: clientTurnsTable.propertyId,
        unitId: clientTurnsTable.unitId,
        status: clientTurnsTable.status,
        noticeGivenAt: clientTurnsTable.noticeGivenAt,
        actualVacateAt: clientTurnsTable.actualVacateAt,
        readyAt: clientTurnsTable.readyAt,
        targetReadyAt: clientTurnsTable.targetReadyAt,
        predictedReadyAt: clientTurnsTable.predictedReadyAt,
        createdAt: clientTurnsTable.createdAt,
        marketRentCents: clientUnitsTable.marketRentCents,
        daysVacant: clientTurnMetricsMvTable.daysVacant,
        isStalled: clientTurnMetricsMvTable.isStalled,
      })
      .from(clientTurnsTable)
      .innerJoin(clientUnitsTable, eq(clientUnitsTable.id, clientTurnsTable.unitId))
      .leftJoin(
        clientTurnMetricsMvTable,
        eq(clientTurnMetricsMvTable.turnId, clientTurnsTable.id),
      )
      .where(
        and(
          eq(clientTurnsTable.orgId, args.orgId),
          inArray(clientTurnsTable.propertyId, propertyIds),
          or(isNull(clientTurnsTable.readyAt), gte(clientTurnsTable.readyAt, cutoff)),
          or(
            and(isNotNull(clientTurnsTable.targetReadyAt), lt(clientTurnsTable.targetReadyAt, now)),
            and(isNull(clientTurnsTable.targetReadyAt), isNotNull(clientTurnsTable.actualVacateAt), lt(clientTurnsTable.actualVacateAt, now)),
          ),
          args.query.workSource && args.query.workSource !== "all"
            ? eq(clientTurnsTable.workSource, args.query.workSource)
            : undefined,
        ),
      ),
  ]);

  const aggRows = (aggResult.rows ?? []) as Array<Record<string, unknown>>;
  const portRow = aggRows.find((r) => r.propertyId == null);
  const tileAgg = new Map<string, Record<string, unknown>>();
  for (const row of aggRows) {
    if (typeof row.propertyId === "string") tileAgg.set(row.propertyId, row);
  }

  const vacancyByProperty = new Map<string, bigint>();
  let headlineCents = 0n;
  let priorCents = 0n;
  for (const t of overTarget as TurnRow[]) {
    const property = propertyById.get(t.propertyId);
    if (!property) continue;
    const current = windowedVacancy(t, property, window.fromAt, window.toExclusive, now);
    headlineCents += current;
    priorCents += windowedVacancy(t, property, window.priorFromAt, window.priorToExclusive, now);
    vacancyByProperty.set(t.propertyId, (vacancyByProperty.get(t.propertyId) ?? 0n) + current);
  }

  const medianCompleted = portRow?.medianCompleted == null ? null : Number(portRow.medianCompleted);
  const medianOpen = portRow?.medianOpen == null ? null : Number(portRow.medianOpen);
  const medianTurnDays = medianCompleted ?? medianOpen;
  const predictedLateThisWeek = Number(portRow?.predictedLate ?? 0);
  const unitsInTurn = Number(portRow?.unitsInTurn ?? 0);

  const targetTurnDays =
    linkedFiltered.length === 0
      ? 7
      : Math.round(
          linkedFiltered.reduce((s, p) => s + p.targetTurnDays, 0) / linkedFiltered.length,
        );

  const tiles = linkedFiltered.map((p) => {
    const agg = tileAgg.get(p.propertyId);
    const completed = agg?.medianCompleted == null ? null : Number(agg.medianCompleted);
    const openMed = agg?.medianOpen == null ? null : Number(agg.medianOpen);
    const tileMedian = completed ?? openMed;
    const stalledCount = Number(agg?.stalledCount ?? 0);
    const { status, statusLabel } = classifyTileStatus({
      medianTurnDays: tileMedian,
      targetTurnDays: p.targetTurnDays,
      stalledCount,
    });
    const sparkline = Array.from({ length: 12 }, (_, i) => Number(agg?.[`s${i}`] ?? 0));
    return {
      propertyId: p.propertyId,
      name: p.name,
      unitCount: p.units ?? 0,
      sparkline,
      medianTurnDays: tileMedian,
      vacancyCostCents: vacancyByProperty.get(p.propertyId) ?? 0n,
      unitsInTurn: Number(agg?.unitsInTurn ?? 0),
      status,
      statusLabel,
      href: args.hrefForProperty(p.propertyId),
      city: p.city ?? null,
      latitude: p.latitude ?? null,
      longitude: p.longitude ?? null,
    };
  });

  tiles.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "units_in_turn") return b.unitsInTurn - a.unitsInTurn;
    if (sort === "turn_days") return (b.medianTurnDays ?? -1) - (a.medianTurnDays ?? -1);
    if (a.vacancyCostCents === b.vacancyCostCents) return a.name.localeCompare(b.name);
    return a.vacancyCostCents > b.vacancyCostCents ? -1 : 1;
  });

  const pulse = {
    ...shapePulse({
    portfolio,
    window,
    sort,
    supporting: {
      unitsInTurn,
      medianTurnDays,
      targetTurnDays,
      predictedLateThisWeek,
    },
    headlineCents,
    priorCents,
    tiles,
    }),
    viewKind: args.viewKind ?? (args.allowedPropertyIds?.length === 1 ? "property" : "regional"),
    viewLabel: args.viewLabel ?? portfolio.name,
    canAddProperties: args.canAddProperties ?? !args.allowedPropertyIds,
  };
  if (await isClientBoardSegmentEnabled("invoiceCompliance")) {
    return {
      ...pulse,
      compliance: await complianceStats({ orgId: args.orgId, propertyIds }),
    };
  }
  return pulse;
}

function shapePulse(args: {
  portfolio: { id: string; name: string };
  window: PulseWindow;
  sort: PulseTileSort;
  supporting: {
    unitsInTurn: number;
    medianTurnDays: number | null;
    targetTurnDays: number;
    predictedLateThisWeek: number;
  };
  headlineCents: bigint;
  priorCents: bigint;
  tiles: Array<{
    propertyId: string;
    name: string;
    unitCount: number;
    sparkline: number[];
    medianTurnDays: number | null;
    vacancyCostCents: bigint;
    unitsInTurn: number;
    status: PulseTileStatus;
    statusLabel: string;
    href: string;
    city?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  }>;
}) {
  return {
    portfolioId: args.portfolio.id,
    portfolioName: args.portfolio.name,
    range: args.window.range,
    from: args.window.fromCivil,
    to: args.window.toCivil,
    sort: args.sort,
    headline: {
      vacancyCostCents: centsString(args.headlineCents),
      priorVacancyCostCents: centsString(args.priorCents),
      vacancyCostDeltaCents: centsString(args.headlineCents - args.priorCents),
      label: args.window.headlineLabel,
      priorLabel: args.window.priorLabel,
    },
    supporting: {
      unitsInTurn: args.supporting.unitsInTurn,
      medianTurnDays:
        args.supporting.medianTurnDays == null
          ? null
          : round1(args.supporting.medianTurnDays),
      targetTurnDays: args.supporting.targetTurnDays,
      predictedLateThisWeek: args.supporting.predictedLateThisWeek,
    },
    tiles: args.tiles.map((t) => ({
      ...t,
      medianTurnDays: t.medianTurnDays == null ? null : round1(t.medianTurnDays),
      vacancyCostCents: centsString(t.vacancyCostCents),
    })),
  };
}

export async function computePortfolioAttention(args: {
  portfolioId: string;
  orgId: string;
  hrefForProperty: PulseHrefForProperty;
  workSource?: WorkSourceFilter;
  allowedPropertyIds?: string[] | null;
}): Promise<{
  portfolioId: string;
  groups: Array<{
    kind: "stalled" | "awaiting_approval" | "failed_qc" | "blocked_invoices" | "variance_pending";
    title: string;
    summary: string;
    items: Array<{
      turnId: string;
      propertyId: string;
      propertyName: string;
      unitNumber: string;
      days: number;
      href: string;
      timezone?: string;
      vacantSince?: string | null;
      requestReceivedAt?: string | null;
      completedAt?: string | null;
      poReceivedAt?: string | null;
      poNumber?: string | null;
      clockStopped?: boolean;
      clockStoppedAt?: string | null;
    }>;
  }>;
  turns: Array<{
    turnId: string;
    propertyId: string;
    propertyName: string;
    unitNumber: string;
    days: number;
    href: string;
    timezone?: string;
    vacantSince?: string | null;
    requestReceivedAt?: string | null;
    completedAt?: string | null;
    poReceivedAt?: string | null;
    poNumber?: string | null;
    clockStopped?: boolean;
    clockStoppedAt?: string | null;
  }>;
  photoUnits: PortfolioUnitPhotoPair[];
  crewToday: PortfolioCrewToday[];
}> {
  const portfolio = await loadPortfolio(args.portfolioId);
  if (portfolio.orgId !== args.orgId) throw new PortfolioNotFoundError();

  const linked = await db
    .select({
      propertyId: clientPortfolioPropertiesTable.propertyId,
      name: propertiesTable.name,
      timezone: propertiesTable.timezone,
    })
    .from(clientPortfolioPropertiesTable)
    .innerJoin(
      propertiesTable,
      eq(propertiesTable.id, clientPortfolioPropertiesTable.propertyId),
    )
    .where(eq(clientPortfolioPropertiesTable.portfolioId, args.portfolioId));

  const linkedFiltered =
    args.allowedPropertyIds && args.allowedPropertyIds.length > 0
      ? linked.filter((p) => args.allowedPropertyIds!.includes(p.propertyId))
      : args.allowedPropertyIds
        ? []
        : linked;
  const propertyIds = linkedFiltered.map((p) => p.propertyId);
  const names = new Map(linkedFiltered.map((p) => [p.propertyId, p.name]));
  if (propertyIds.length === 0) {
    return { portfolioId: args.portfolioId, groups: [], turns: [], photoUnits: [], crewToday: [] };
  }

  const open = await db
    .select({
      id: clientTurnsTable.id,
      propertyId: clientTurnsTable.propertyId,
      unitId: clientTurnsTable.unitId,
      status: clientTurnsTable.status,
      readyAt: clientTurnsTable.readyAt,
      workSource: clientTurnsTable.workSource,
      noticeGivenAt: clientTurnsTable.noticeGivenAt,
      scheduledVacateAt: clientTurnsTable.scheduledVacateAt,
      actualVacateAt: clientTurnsTable.actualVacateAt,
      createdAt: clientTurnsTable.createdAt,
      timezone: propertiesTable.timezone,
    })
    .from(clientTurnsTable)
    .innerJoin(propertiesTable, eq(propertiesTable.id, clientTurnsTable.propertyId))
    .where(
      and(
        eq(clientTurnsTable.orgId, args.orgId),
        inArray(clientTurnsTable.propertyId, propertyIds),
        or(
          isNull(clientTurnsTable.readyAt),
          gte(clientTurnsTable.readyAt, new Date(Date.now() - 90 * 86_400_000)),
        ),
        args.workSource && args.workSource !== "all" ? eq(clientTurnsTable.workSource, args.workSource) : undefined,
      ),
    );
  const metrics = open.length
    ? await db
        .select({
          turnId: clientTurnMetricsMvTable.turnId,
          daysVacant: clientTurnMetricsMvTable.daysVacant,
          isStalled: clientTurnMetricsMvTable.isStalled,
          currentStage: clientTurnMetricsMvTable.currentStage,
        })
        .from(clientTurnMetricsMvTable)
        .where(
          inArray(
            clientTurnMetricsMvTable.turnId,
            open.map((t) => t.id),
          ),
        )
    : [];
  const metricsByTurn = new Map(metrics.map((m) => [m.turnId, m]));

  const units = open.length
    ? await db
        .select({
          id: clientUnitsTable.id,
          unitNumber: clientUnitsTable.unitNumber,
        })
        .from(clientUnitsTable)
        .where(
          inArray(
            clientUnitsTable.id,
            [...new Set(open.map((t) => t.unitId))],
          ),
        )
    : [];
  const unitNo = new Map(units.map((u) => [u.id, u.unitNumber]));
  const tzByTurn = new Map(open.map((t) => [t.id, t.timezone]));
  const pos = await loadPoByTurnIds(open.map((t) => t.id), tzByTurn);

  const toItem = (t: (typeof open)[number]) => ({
    turnId: t.id,
    propertyId: t.propertyId,
    propertyName: names.get(t.propertyId) ?? "Property",
    unitNumber: unitNo.get(t.unitId) ?? "",
    days: round1(metricsByTurn.get(t.id)?.daysVacant ?? 0),
    href: args.hrefForProperty(t.propertyId),
    ...shapeTurnClock({
      timezone: t.timezone,
      noticeGivenAt: t.noticeGivenAt,
      scheduledVacateAt: t.scheduledVacateAt,
      actualVacateAt: t.actualVacateAt,
      createdAt: t.createdAt,
      readyAt: t.readyAt,
      po: pos.get(t.id) ?? null,
    }),
  });

  const stalled = open.filter((t) => !t.readyAt && metricsByTurn.get(t.id)?.isStalled).map(toItem);
  const awaiting = open.filter((t) => !t.readyAt && t.status === "pending_approval").map(toItem);
  const failedQc = open.filter((t) => !t.readyAt && t.status === "rework").map(toItem);

  const groups: Array<{
    kind: "stalled" | "awaiting_approval" | "failed_qc" | "blocked_invoices" | "variance_pending";
    title: string;
    summary: string;
    items: ReturnType<typeof toItem>[];
  }> = [];

  if (stalled.length) {
    groups.push({
      kind: "stalled",
      title: "Stalled turns",
      summary: `${stalled.length} unit${stalled.length === 1 ? "" : "s"} past the stage p75`,
      items: stalled,
    });
  }
  if (awaiting.length) {
    const avg =
      awaiting.reduce((s, i) => s + i.days, 0) / Math.max(1, awaiting.length);
    groups.push({
      kind: "awaiting_approval",
      title: "Waiting on you",
      summary: `waiting on you, ${awaiting.length} unit${awaiting.length === 1 ? "" : "s"}, ${round1(avg)} days`,
      items: awaiting,
    });
  }
  if (failedQc.length) {
    groups.push({
      kind: "failed_qc",
      title: "Failed QC",
      summary: `${failedQc.length} unit${failedQc.length === 1 ? "" : "s"} in rework`,
      items: failedQc,
    });
  }

  if (await isClientBoardSegmentEnabled("invoiceCompliance") && open.length) {
    const blockedRows = await db
      .select({
        turnId: clientTurnsTable.id,
        propertyId: clientTurnsTable.propertyId,
        unitId: clientTurnsTable.unitId,
      })
      .from(clientScopeLinesTable)
      .innerJoin(clientScopesTable, eq(clientScopesTable.id, clientScopeLinesTable.scopeId))
      .innerJoin(clientTurnsTable, eq(clientTurnsTable.id, clientScopesTable.turnId))
      .where(
        and(
          inArray(clientTurnsTable.id, open.map((t) => t.id)),
          inArray(clientScopeLinesTable.compliance, ["off_schedule", "variance_pending"]),
        ),
      );
    const seen = new Set<string>();
    const blockedItems = blockedRows
      .filter((r) => {
        if (seen.has(r.turnId)) return false;
        seen.add(r.turnId);
        return true;
      })
      .map((r) => {
        const t = open.find((o) => o.id === r.turnId);
        return t ? toItem(t) : null;
      })
      .filter((x): x is ReturnType<typeof toItem> => Boolean(x));
    if (blockedItems.length) {
      groups.push({
        kind: "blocked_invoices",
        title: "Blocked invoices",
        summary: `${blockedItems.length} scope${blockedItems.length === 1 ? "" : "s"} cannot bill until variance is resolved`,
        items: blockedItems,
      });
    }
    const pending = await db
      .select({ turnId: clientVarianceRequestsTable.turnId })
      .from(clientVarianceRequestsTable)
      .where(
        and(
          eq(clientVarianceRequestsTable.orgId, args.orgId),
          eq(clientVarianceRequestsTable.status, "pending"),
          inArray(clientVarianceRequestsTable.turnId, open.map((t) => t.id)),
        ),
      );
    const vSeen = new Set<string>();
    const vItems = pending
      .filter((r) => {
        if (vSeen.has(r.turnId)) return false;
        vSeen.add(r.turnId);
        return true;
      })
      .map((r) => {
        const t = open.find((o) => o.id === r.turnId);
        return t ? toItem(t) : null;
      })
      .filter((x): x is ReturnType<typeof toItem> => Boolean(x));
    if (vItems.length) {
      groups.push({
        kind: "variance_pending",
        title: "Variance waiting on you",
        summary: `${vItems.length} pre-approval request${vItems.length === 1 ? "" : "s"}`,
        items: vItems,
      });
    }
  }

  const photoUnits = await computePortfolioUnitPhotos({
    properties: linkedFiltered.map((p) => ({ id: p.propertyId, name: p.name })),
  });
  const crewToday = await computePortfolioCrewToday({
    properties: linkedFiltered.map((p) => ({
      id: p.propertyId,
      name: p.name,
      timezone: p.timezone,
    })),
  });

  return {
    portfolioId: args.portfolioId,
    groups,
    turns: open.filter((t) => !t.readyAt || !pos.get(t.id)).map(toItem),
    photoUnits,
    crewToday,
  };
}
