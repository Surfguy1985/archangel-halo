/**
 * Client-board cortex — same ranking rules as the office ops cortex,
 * scoped to Pulse facts already on screen. No HALO / Work App jargon.
 */

import { formatUsdCents } from "./formatUsdCents";

export type PulseNeed = {
  kind: string;
  propertyName: string;
  unitNumber: string;
  days: number;
};

export type PulseFacts = {
  vacancyCostCents?: string;
  unitsInTurn?: number;
  medianTurnDays?: number | null;
  attentionCount: number;
  needs?: PulseNeed[];
  turns: Array<{ propertyName: string; unitNumber: string; days: number }>;
  crew: Array<{ crewName: string; propertyName: string; unitNumber: string | null }>;
};

export type PulseInsight = {
  severity: "now" | "today" | "watch";
  headline: string;
  why: string;
  next: string;
  open?: "attention" | "turns" | "crew" | "vacancy" | "photos" | "sites";
};

export type PulseCortex = {
  onFire: PulseInsight[];
  needsYou: PulseInsight[];
  onSite: string;
  predictions: PulseInsight[];
  nextMove: PulseInsight | null;
  brief: string;
  punch: string;
  followUps: string[];
};

const CLIENT_OWNED = new Set(["awaiting_approval", "variance_pending"]);
const FIRE = new Set(["stalled", "failed_qc", "blocked_invoices"]);
const KIND_RANK: Record<string, number> = {
  awaiting_approval: 0,
  variance_pending: 1,
  failed_qc: 2,
  stalled: 3,
  blocked_invoices: 4,
};

function shortName(name: string): string {
  return name.replace(/^caf\s+demo\s*[—–-]\s*/i, "").trim();
}

function unitAt(propertyName: string, unitNumber?: string | null): string {
  const site = shortName(propertyName);
  return unitNumber ? `${site} · ${unitNumber}` : site;
}

function daysPhrase(days: number): string {
  return days === 1 ? "1 day" : `${days} days`;
}

export function needLine(kind: string, days: number): string {
  const d = daysPhrase(days);
  if (kind === "awaiting_approval") return `waiting on you, ${d}`;
  if (kind === "variance_pending") return `waiting on a price exception, ${d}`;
  if (kind === "stalled") return `stalled, ${d}`;
  if (kind === "failed_qc") return `needs another look, ${d}`;
  if (kind === "blocked_invoices") return `invoice blocked, ${d}`;
  return `needs you, ${d}`;
}

function sortNeeds(needs: PulseNeed[]): PulseNeed[] {
  return [...needs].sort((a, b) => {
    const kr = (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9);
    if (kr !== 0) return kr;
    return b.days - a.days;
  });
}

export function buildPulseCortex(ctx: PulseFacts): PulseCortex {
  const needs = sortNeeds(ctx.needs ?? []);
  const yours = needs.filter((n) => CLIENT_OWNED.has(n.kind));
  const fire = needs.filter((n) => FIRE.has(n.kind) || n.days >= 10);

  const onFire: PulseInsight[] = fire.slice(0, 6).map((n) => ({
    severity: n.days >= 10 || n.kind === "failed_qc" ? "now" : "today",
    headline: unitAt(n.propertyName, n.unitNumber),
    why: needLine(n.kind, n.days),
    next: CLIENT_OWNED.has(n.kind) ? "Sign or send it back today." : "Unblock this unit before tomorrow.",
    open: "attention",
  }));

  const needsYou: PulseInsight[] = yours.slice(0, 6).map((n) => ({
    severity: "now" as const,
    headline: unitAt(n.propertyName, n.unitNumber),
    why: needLine(n.kind, n.days),
    next: n.kind === "variance_pending" ? "Approve or reject the price exception." : "Approve so the turn can move.",
    open: "attention" as const,
  }));

  const onSite =
    ctx.crew.length === 0
      ? "No crews are scheduled on these communities today."
      : ctx.crew
          .slice(0, 6)
          .map((c) => `${c.crewName} · ${shortName(c.propertyName)}${c.unitNumber ? ` ${c.unitNumber}` : ""}`)
          .join("; ");

  const predictions: PulseInsight[] = [];
  for (const n of yours.slice(0, 3)) {
    predictions.push({
      severity: "today",
      headline: unitAt(n.propertyName, n.unitNumber),
      why: `Still ${needLine(n.kind, n.days + 1)} if nobody acts.`,
      next: "This wait is yours — the vacant clock keeps running.",
      open: "attention",
    });
  }
  const longTurns = [...ctx.turns].sort((a, b) => b.days - a.days).filter((t) => t.days >= 7);
  for (const t of longTurns.slice(0, 3)) {
    const key = unitAt(t.propertyName, t.unitNumber);
    if (predictions.some((p) => p.headline === key)) continue;
    predictions.push({
      severity: t.days >= 12 ? "now" : "watch",
      headline: key,
      why: `${t.days} vacant days — still open tomorrow unless it closes today.`,
      next: "Open turns and clear the blocker.",
      open: "turns",
    });
  }

  const topNeed = yours[0] ?? fire[0];
  const topTurn = longTurns[0];
  const nextMove: PulseInsight | null = topNeed
    ? {
        severity: "now",
        headline: unitAt(topNeed.propertyName, topNeed.unitNumber),
        why: needLine(topNeed.kind, topNeed.days),
        next: CLIENT_OWNED.has(topNeed.kind) ? "That's the one thing that needs you." : "That's the unit to unblock first.",
        open: "attention",
      }
    : topTurn
      ? {
          severity: "now",
          headline: unitAt(topTurn.propertyName, topTurn.unitNumber),
          why: `${topTurn.days} vacant days`,
          next: "That's the unit to unblock first.",
          open: "turns",
        }
      : null;

  let vac: string | null = null;
  if (ctx.vacancyCostCents) {
    const label = formatUsdCents(ctx.vacancyCostCents);
    vac = label === "$—" ? null : label;
  }

  const bits: string[] = [];
  if (yours.length) {
    bits.push(
      `${yours.length} item${yours.length === 1 ? "" : "s"} waiting on you — start with ${unitAt(yours[0].propertyName, yours[0].unitNumber)} (${needLine(yours[0].kind, yours[0].days)}).`,
    );
  } else if (fire.length) {
    bits.push(`On fire: ${unitAt(fire[0].propertyName, fire[0].unitNumber)} — ${needLine(fire[0].kind, fire[0].days)}.`);
  } else if (ctx.attentionCount > 0) {
    bits.push(`${ctx.attentionCount} item${ctx.attentionCount === 1 ? "" : "s"} need you.`);
  } else {
    bits.push("Nothing is waiting on you right now.");
  }
  bits.push(onSite.includes("No crew") ? onSite : `On site: ${onSite}.`);
  if (vac && ctx.unitsInTurn != null) {
    bits.push(
      `${ctx.unitsInTurn} unit${ctx.unitsInTurn === 1 ? "" : "s"} in turn${ctx.medianTurnDays != null ? `, median ${ctx.medianTurnDays} days` : ""}; vacancy this window is ${vac}.`,
    );
  } else if (ctx.unitsInTurn != null) {
    bits.push(`${ctx.unitsInTurn} unit${ctx.unitsInTurn === 1 ? "" : "s"} in turn.`);
  }
  if (nextMove) bits.push(`Next move: ${nextMove.headline}.`);

  const followUps: string[] = [];
  if (yours.length || ctx.attentionCount) followUps.push("What do you need from me?");
  if (ctx.crew.length) followUps.push("Who's on site today?");
  if (fire.length || longTurns.length) followUps.push("What's going to be late?");
  if (vac) followUps.push("How much vacancy are we burning?");
  if (followUps.length < 3) followUps.push("What's on fire?");
  if (followUps.length < 3) followUps.push("Open the board");

  const punch = nextMove
    ? `${nextMove.headline} — ${nextMove.why}.`
    : yours.length
      ? `${unitAt(yours[0].propertyName, yours[0].unitNumber)} — ${needLine(yours[0].kind, yours[0].days)}.`
      : "Nothing is waiting on you right now.";

  return {
    onFire,
    needsYou,
    onSite,
    predictions: predictions.slice(0, 6),
    nextMove,
    brief: bits.join(" "),
    punch,
    followUps: followUps.slice(0, 3),
  };
}

export function pulseStarters(ctx: PulseFacts): string[] {
  return buildPulseCortex(ctx).followUps;
}
