/**
 * PM partner loop — predict from the turn clock, queue HITL, learn prefs.
 * Cortex still ranks. Never writes money or closes a turn.
 */

import type { OpsCortex, OpsFacts } from "./opsCortex";
import { seriesForHolt, slipDays } from "./agentForecast";
import { daysHistoryForUnit, recallSimilar, rememberEpisode, type RetrievedMemory } from "./agentMemory";
import { factsForUnit } from "./agentGraph";
import { clearActsNotIn, pendingActs, type QueuedAct } from "./agentActs";
import { noteIntent, prefFollowUps, type AgentPrefs } from "./agentPrefs";
import type { EmbedderKind } from "./agentEmbed";

export type PartnerAct = {
  id: string;
  label: string;
  hitl: true;
  status: "propose" | "queued";
  unit?: string | null;
  open?: "attention" | "turns" | "crew";
};

export type PartnerForecast = {
  method: "holt" | "plus-one";
  headline: string;
  extraDays: number;
  unit?: string | null;
  source?: "unit" | "community" | "memory" | "none";
  series?: number[];
};

export type PartnerFork = {
  site: string;
  unit: string;
  daysNow: number;
  extraDays: number;
  daysIfWait: number;
  method: "holt" | "plus-one";
  source: "unit" | "community" | "memory" | "none";
  series: number[];
  wait: string;
  ifYouAct: string;
  ifYouWait: string;
};

export type PartnerConsult = {
  embedder: EmbedderKind;
  memories: RetrievedMemory[];
  forecast: PartnerForecast | null;
  fork: PartnerFork | null;
  acts: PartnerAct[];
  graph: string[];
  prefs: AgentPrefs;
  followUps: string[];
};

function shortSite(name: string): string {
  return name.replace(/^caf\s+demo\s*[—–-]\s*/i, "").trim();
}

function waitNoun(kind?: string | null): string {
  if (kind === "awaiting_approval") return "your signature";
  if (kind === "variance_pending") return "a price exception";
  return "this wait";
}

function buildFork(args: {
  unit: string;
  daysNow: number;
  extraDays: number;
  method: "holt" | "plus-one";
  source: PartnerFork["source"];
  series: number[];
  site: string;
  kind?: string | null;
}): PartnerFork {
  const wait = waitNoun(args.kind);
  const extra = Math.max(1, args.extraDays);
  const waitCap = wait.charAt(0).toUpperCase() + wait.slice(1);
  return {
    site: args.site,
    unit: args.unit,
    daysNow: args.daysNow,
    extraDays: extra,
    daysIfWait: args.daysNow + extra,
    method: args.method,
    source: args.source,
    series: args.series,
    wait,
    ifYouAct: `${waitCap} leaves the ranking. The vacant clock still runs until ready — you just stop owning it.`,
    ifYouWait:
      args.method === "holt"
        ? `Still yours tomorrow. Holt says +${extra} vacant day${extra === 1 ? "" : "s"}.`
        : `Still yours tomorrow — +${extra} vacant day${extra === 1 ? "" : "s"}.`,
  };
}

export async function consultPartner(args: {
  question: string;
  facts: OpsFacts;
  cortex: OpsCortex;
  focusUnit?: string | null;
  clockDays?: number[];
  clockSource?: "unit" | "community" | "none";
  intent?: string | null;
}): Promise<PartnerConsult> {
  const prefs = noteIntent(args.intent);
  const { memories, embedder } = await recallSimilar(args.question, 3);
  const unit =
    args.focusUnit ||
    args.cortex.needsYou[0]?.headline.match(/·\s*([A-Za-z0-9-]+)/)?.[1] ||
    args.cortex.nextMove?.headline.match(/·\s*([A-Za-z0-9-]+)/)?.[1] ||
    args.facts.needs[0]?.unitNumber ||
    args.facts.turns[0]?.unitNumber ||
    null;
  const currentDays = unit
    ? (args.facts.turns.find((t) => t.unitNumber === unit)?.days ??
      args.facts.needs.find((n) => n.unitNumber === unit)?.days ??
      null)
    : null;

  const liveUnits = new Set(
    [...args.facts.needs, ...args.facts.turns].map((t) => t.unitNumber).filter(Boolean) as string[],
  );
  clearActsNotIn(liveUnits);

  let forecast: PartnerForecast | null = null;
  let fork: PartnerFork | null = null;
  if (unit && currentDays != null) {
    const episodes = await daysHistoryForUnit(unit);
    const series = seriesForHolt(args.clockDays ?? [], episodes, currentDays);
    const slip = slipDays(series.slice(0, -1), currentDays);
    const n = series.length;
    const source = args.clockSource && args.clockSource !== "none" ? args.clockSource : episodes.length ? "memory" : "none";
    forecast = {
      method: slip.method,
      extraDays: slip.extraDays,
      unit,
      source,
      series,
      headline:
        slip.method === "holt"
          ? `${unit} — Holt says ~${slip.extraDays} more vacant day${slip.extraDays === 1 ? "" : "s"} if nobody acts (${n} ${source === "community" ? "community" : "clock"} observations).`
          : `${unit} — still vacant tomorrow if nobody acts.`,
    };
    const row =
      args.facts.needs.find((t) => t.unitNumber === unit) ??
      args.facts.turns.find((t) => t.unitNumber === unit);
    fork = buildFork({
      unit,
      daysNow: currentDays,
      extraDays: slip.extraDays,
      method: slip.method,
      source,
      series,
      site: shortSite(row?.propertyName ?? ""),
      kind: args.facts.needs.find((n) => n.unitNumber === unit)?.kind,
    });
  }

  const queued = pendingActs(unit);
  const acts: PartnerAct[] = [];
  if (queued[0]) {
    acts.push({
      id: queued[0].id,
      label: `Still queued: ${queued[0].label}`,
      hitl: true,
      status: "queued",
      unit: queued[0].unit,
      open: queued[0].open,
    });
  } else if (args.cortex.needsYou[0]) {
    acts.push({
      id: `nudge-sign-${unit ?? "next"}`,
      label: `Queue a sign-off reminder for ${args.cortex.needsYou[0].headline}`,
      hitl: true,
      status: "propose",
      unit,
      open: "attention",
    });
  } else if (args.cortex.nextMove) {
    acts.push({
      id: `open-next-${unit ?? "next"}`,
      label: `Open ${args.cortex.nextMove.headline}`,
      hitl: true,
      status: "propose",
      unit,
      open: args.cortex.nextMove.open === "crew" ? "crew" : "turns",
    });
  }

  return {
    embedder,
    memories,
    forecast,
    fork,
    acts,
    graph: unit ? factsForUnit(unit) : [],
    prefs,
    followUps: prefFollowUps(prefs, unit),
  };
}

export async function learnFromAsk(args: {
  question: string;
  answer: string;
  unit?: string | null;
  days?: number | null;
  nextMove?: string | null;
}): Promise<void> {
  await rememberEpisode({
    question: args.question,
    answer: args.answer.slice(0, 500),
    unit: args.unit ?? null,
    days: args.days ?? null,
    nextMove: args.nextMove ?? null,
  });
}

export type { QueuedAct };
