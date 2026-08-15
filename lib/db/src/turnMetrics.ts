/**
 * Pure turn-metrics formula. Dashboards read client_turn_metrics_mv; this is
 * the function that read model must match. Segment 2's TurnMetrics.compute
 * should call this rather than invent a second formula.
 *
 * Days vacant = calendar dates in the *property* timezone, not elapsed hours.
 * Client vs vendor hours come from stage_ownership, never from who the crew is.
 */

import { STAGE_OWNERSHIP_SEED, type StageOwner, type TurnStage } from "./clientBoardEnums";
import { vacancyCostCents } from "./moneyCents";
import {
  calendarDaysBetween,
  daysInMonthInZone,
} from "./propertyTime";

export type StageEventInput = {
  id: string;
  stage: TurnStage;
  event: "entered" | "exited";
  occurredAt: Date;
  actorId?: string | null;
};

/** One enter→exit (or enter→now) visit. Rework is a second visit of the same stage. */
export type StageVisit = {
  stage: TurnStage;
  enteredAt: Date;
  exitedAt: Date | null;
  durationMs: bigint;
  visitIndex: number;
  owner: StageOwner;
  actorId: string | null;
};

export type TurnMetricsInput = {
  timezone: string;
  targetTurnDays: number;
  marketRentCents: bigint;
  actualVacateAt: Date | null;
  readyAt: Date | null;
  now?: Date;
  events: StageEventInput[];
  ownership?: Readonly<Record<TurnStage, StageOwner>>;
};

export type TurnMetricsResult = {
  daysVacant: number;
  overTargetDays: number;
  vacancyCostCents: bigint;
  daysInMonth: number;
  stageDurationsMs: Record<string, number>;
  clientOwnedMs: bigint;
  vendorOwnedMs: bigint;
  sharedOwnedMs: bigint;
  clientOwnedHours: string;
  vendorOwnedHours: string;
  sharedOwnedHours: string;
};

const MS_PER_HOUR_HUNDREDTH = 36_000n;

/** ROUND(ms/3600000, 2) as Postgres numeric does (half away from zero). */
export function msToHours2(ms: bigint): string {
  const sign = ms < 0n ? "-" : "";
  const abs = ms < 0n ? -ms : ms;
  const hundredths = (abs + MS_PER_HOUR_HUNDREDTH / 2n) / MS_PER_HOUR_HUNDREDTH;
  const whole = hundredths / 100n;
  const frac = hundredths % 100n;
  return `${sign}${whole.toString()}.${frac.toString().padStart(2, "0")}`;
}

export function stageVisitsFromEvents(
  events: StageEventInput[],
  now: Date,
  ownership: Readonly<Record<TurnStage, StageOwner>> = STAGE_OWNERSHIP_SEED,
): StageVisit[] {
  const sorted = [...events].sort((a, b) => {
    const dt = a.occurredAt.getTime() - b.occurredAt.getTime();
    if (dt !== 0) return dt;
    return a.id.localeCompare(b.id);
  });

  const entered = new Map<TurnStage, StageEventInput[]>();
  const exited = new Map<TurnStage, StageEventInput[]>();
  for (const ev of sorted) {
    const bag = ev.event === "entered" ? entered : exited;
    const list = bag.get(ev.stage) ?? [];
    list.push(ev);
    bag.set(ev.stage, list);
  }

  const visits: StageVisit[] = [];
  for (const [stage, enters] of entered) {
    const exits = exited.get(stage) ?? [];
    for (let i = 0; i < enters.length; i++) {
      const start = enters[i]!.occurredAt;
      const end = exits[i]?.occurredAt ?? now;
      const ms = BigInt(Math.max(0, end.getTime() - start.getTime()));
      visits.push({
        stage,
        enteredAt: start,
        exitedAt: exits[i] ? end : null,
        durationMs: ms,
        visitIndex: i,
        owner: ownership[stage],
        actorId: enters[i]!.actorId ?? null,
      });
    }
  }
  visits.sort((a, b) => {
    const dt = a.enteredAt.getTime() - b.enteredAt.getTime();
    if (dt !== 0) return dt;
    return a.stage.localeCompare(b.stage);
  });
  return visits;
}

function pairDurationsMs(
  events: StageEventInput[],
  now: Date,
): { stage: TurnStage; ms: bigint }[] {
  return stageVisitsFromEvents(events, now).map((v) => ({ stage: v.stage, ms: v.durationMs }));
}

/** "4 days, 6 hours" — fact, not blame. */
export function formatStageClock(ms: bigint | number): string {
  const n = typeof ms === "bigint" ? Number(ms) : ms;
  if (!Number.isFinite(n) || n <= 0) return "0 minutes";
  const days = Math.floor(n / 86_400_000);
  const hours = Math.floor((n % 86_400_000) / 3_600_000);
  const minutes = Math.floor((n % 3_600_000) / 60_000);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (parts.length === 0) parts.push(`${Math.max(1, minutes)} minute${minutes === 1 ? "" : "s"}`);
  return parts.join(", ");
}

export function computeTurnMetrics(input: TurnMetricsInput): TurnMetricsResult {
  const asOf = input.readyAt ?? input.now ?? new Date();
  const ownership = input.ownership ?? STAGE_OWNERSHIP_SEED;

  let daysVacant = 0;
  if (input.actualVacateAt) {
    daysVacant = calendarDaysBetween(
      input.actualVacateAt,
      asOf,
      input.timezone,
    );
    if (daysVacant < 0) daysVacant = 0;
  }

  const overTargetDays = Math.max(0, daysVacant - input.targetTurnDays);
  const daysInMonthRaw = daysInMonthInZone(asOf, input.timezone);
  const daysInMonth = daysInMonthRaw < 28 ? 30 : daysInMonthRaw;
  const cost = vacancyCostCents({
    overTargetDays,
    marketRentCents: input.marketRentCents,
    daysInMonth,
  });

  const pairs = pairDurationsMs(input.events, asOf);
  const stageDurationsMs: Record<string, number> = {};
  let clientOwnedMs = 0n;
  let vendorOwnedMs = 0n;
  let sharedOwnedMs = 0n;
  for (const pair of pairs) {
    stageDurationsMs[pair.stage] =
      (stageDurationsMs[pair.stage] ?? 0) + Number(pair.ms);
    const owner = ownership[pair.stage];
    if (owner === "client") clientOwnedMs += pair.ms;
    else if (owner === "vendor") vendorOwnedMs += pair.ms;
    else sharedOwnedMs += pair.ms;
  }

  return {
    daysVacant,
    overTargetDays,
    vacancyCostCents: cost,
    daysInMonth,
    stageDurationsMs,
    clientOwnedMs,
    vendorOwnedMs,
    sharedOwnedMs,
    clientOwnedHours: msToHours2(clientOwnedMs),
    vendorOwnedHours: msToHours2(vendorOwnedMs),
    sharedOwnedHours: msToHours2(sharedOwnedMs),
  };
}
