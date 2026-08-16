/**
 * Ops cortex — deterministic ranking + prediction for HALO chat.
 *
 * Claude narrates this brief. It does not invent the ranking.
 * Vacancy dollars are passed in already computed (Pulse window / MV).
 * Never derive a second days or cents formula here.
 */

import { formatUsd } from "@workspace/db";

export type OpsVoice = "office" | "client";

export type OpsNeedKind =
  | "awaiting_approval"
  | "variance_pending"
  | "stalled"
  | "failed_qc"
  | "blocked_invoices"
  | "overdue_job"
  | "uncrewed"
  | "overdue_invoice"
  | "over_budget";

export type OpsNeed = {
  kind: OpsNeedKind;
  propertyName: string;
  unitNumber?: string | null;
  days?: number | null;
  label?: string;
};

export type OpsCrew = {
  crewName: string;
  propertyName: string;
  unitNumber?: string | null;
};

export type OpsTurn = {
  propertyName: string;
  unitNumber: string;
  days: number;
  status?: string | null;
  predictedReadyOn?: string | null;
};

export type OpsStop = {
  propertyName: string;
  unitNumber?: string | null;
  crewName?: string | null;
};

export type OpsFacts = {
  date: string;
  voice: OpsVoice;
  vacancyCostCents?: string | null;
  unitsInTurn?: number;
  medianTurnDays?: number | null;
  communities?: number;
  needs: OpsNeed[];
  crewToday: OpsCrew[];
  turns: OpsTurn[];
  jobsOpen?: number;
  jobsOverdue?: number;
  jobsUncrewed?: number;
  invoicesOverdue?: number;
  scheduledTomorrow?: OpsStop[];
};

export type OpsInsight = {
  severity: "now" | "today" | "watch";
  headline: string;
  why: string;
  next: string;
  open?: "attention" | "turns" | "crew" | "vacancy" | "photos" | "sites" | "money";
};

export type OpsCortex = {
  onFire: OpsInsight[];
  needsYou: OpsInsight[];
  onSite: string;
  predictions: OpsInsight[];
  nextMove: OpsInsight | null;
  brief: string;
  followUps: string[];
};

const CLIENT_OWNED: OpsNeedKind[] = ["awaiting_approval", "variance_pending"];

const KIND_RANK: Record<OpsNeedKind, number> = {
  awaiting_approval: 0,
  variance_pending: 1,
  failed_qc: 2,
  stalled: 3,
  blocked_invoices: 4,
  overdue_job: 5,
  uncrewed: 6,
  overdue_invoice: 7,
  over_budget: 8,
};

function shortName(name: string): string {
  return name.replace(/^caf\s+demo\s*[—–-]\s*/i, "").trim();
}

function unitAt(need: { propertyName: string; unitNumber?: string | null }): string {
  const site = shortName(need.propertyName);
  return need.unitNumber ? `${site} · ${need.unitNumber}` : site;
}

function daysPhrase(days: number | null | undefined): string {
  if (days == null) return "";
  return days === 1 ? "1 day" : `${days} days`;
}

function needLine(kind: OpsNeedKind, days: number | null | undefined, voice: OpsVoice): string {
  const d = daysPhrase(days);
  if (kind === "awaiting_approval") return d ? `waiting on you, ${d}` : "waiting on you";
  if (kind === "variance_pending") return d ? `waiting on a price exception, ${d}` : "waiting on a price exception";
  if (kind === "stalled") return d ? `stalled, ${d}` : "stalled";
  if (kind === "failed_qc") return voice === "client" ? (d ? `needs another look, ${d}` : "needs another look") : (d ? `failed QC, ${d}` : "failed QC");
  if (kind === "blocked_invoices") return d ? `invoice blocked, ${d}` : "invoice blocked";
  if (kind === "overdue_job") return d ? `job overdue ${d}` : "job overdue";
  if (kind === "uncrewed") return "no crew assigned";
  if (kind === "overdue_invoice") return "invoice overdue";
  return "over budget";
}

function sortNeeds(needs: OpsNeed[]): OpsNeed[] {
  return [...needs].sort((a, b) => {
    const kr = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (kr !== 0) return kr;
    return (b.days ?? 0) - (a.days ?? 0);
  });
}

function vacancyLabel(cents: string | null | undefined): string | null {
  if (!cents) return null;
  try {
    return formatUsd(BigInt(cents));
  } catch {
    return null;
  }
}

function addCivilDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function buildOpsCortex(facts: OpsFacts): OpsCortex {
  const needs = sortNeeds(facts.needs);
  const yours = needs.filter((n) => CLIENT_OWNED.includes(n.kind));
  const fireKinds: OpsNeedKind[] = ["stalled", "failed_qc", "overdue_job", "blocked_invoices"];
  const fire = needs.filter((n) => fireKinds.includes(n.kind) || (n.days ?? 0) >= 10);

  const onFire: OpsInsight[] = fire.slice(0, 6).map((n) => ({
    severity: (n.days ?? 0) >= 10 || n.kind === "failed_qc" || n.kind === "overdue_job" ? "now" : "today",
    headline: unitAt(n),
    why: needLine(n.kind, n.days, facts.voice),
    next: CLIENT_OWNED.includes(n.kind) ? "Sign or send it back today." : "Unblock this unit before tomorrow.",
    open: n.kind === "overdue_invoice" || n.kind === "over_budget" ? "money" : "attention",
  }));

  const needsYou: OpsInsight[] = yours.slice(0, 6).map((n) => ({
    severity: "now",
    headline: unitAt(n),
    why: needLine(n.kind, n.days, facts.voice),
    next: n.kind === "variance_pending" ? "Approve or reject the price exception." : "Approve so the turn can move.",
    open: "attention",
  }));

  const onSite =
    facts.crewToday.length === 0
      ? facts.voice === "client"
        ? "No crews are scheduled on these communities today."
        : "No crews have checked in or are scheduled on site today."
      : facts.crewToday
          .slice(0, 6)
          .map((c) => `${c.crewName} · ${shortName(c.propertyName)}${c.unitNumber ? ` ${c.unitNumber}` : ""}`)
          .join("; ");

  const tomorrow = addCivilDays(facts.date, 1);
  const predictions: OpsInsight[] = [];

  for (const n of yours.slice(0, 3)) {
    predictions.push({
      severity: "today",
      headline: unitAt(n),
      why: `Still ${needLine(n.kind, (n.days ?? 0) + 1, facts.voice)} if nobody acts.`,
      next: "This is a client-owned wait — the vacant clock keeps running.",
      open: "attention",
    });
  }

  const longTurns = [...facts.turns].sort((a, b) => b.days - a.days).filter((t) => t.days >= 7);
  for (const t of longTurns.slice(0, 3)) {
    const already = predictions.some((p) => p.headline === `${shortName(t.propertyName)} · ${t.unitNumber}`);
    if (already) continue;
    const slip =
      t.predictedReadyOn && t.predictedReadyOn < tomorrow
        ? `Predicted ready ${t.predictedReadyOn} is already slipping.`
        : `${t.days} vacant days — still open tomorrow unless it closes today.`;
    predictions.push({
      severity: t.days >= 12 ? "now" : "watch",
      headline: `${shortName(t.propertyName)} · ${t.unitNumber}`,
      why: slip,
      next: "Open turns and clear the blocker.",
      open: "turns",
    });
  }

  for (const s of (facts.scheduledTomorrow ?? []).slice(0, 3)) {
    predictions.push({
      severity: "watch",
      headline: `${shortName(s.propertyName)}${s.unitNumber ? ` · ${s.unitNumber}` : ""}`,
      why: s.crewName ? `${s.crewName} is on the book tomorrow.` : "On the book tomorrow with no crew yet.",
      next: s.crewName ? "Confirm access and materials." : "Assign a crew before morning.",
      open: "crew",
    });
  }

  const topNeed = yours[0] ?? fire[0] ?? longTurns[0];
  const nextMove: OpsInsight | null = topNeed
    ? {
        severity: "now",
        headline: "unitNumber" in topNeed && topNeed.unitNumber
          ? unitAt(topNeed as OpsNeed)
          : `${shortName((topNeed as OpsTurn).propertyName)} · ${(topNeed as OpsTurn).unitNumber}`,
        why:
          "kind" in topNeed
            ? needLine((topNeed as OpsNeed).kind, (topNeed as OpsNeed).days, facts.voice)
            : `${(topNeed as OpsTurn).days} vacant days`,
        next:
          "kind" in topNeed && CLIENT_OWNED.includes((topNeed as OpsNeed).kind)
            ? "That's the one thing that needs you."
            : "That's the unit to unblock first.",
        open: "kind" in topNeed ? "attention" : "turns",
      }
    : null;

  const vac = vacancyLabel(facts.vacancyCostCents);
  const bits: string[] = [];
  if (yours.length) {
    const first = yours[0];
    bits.push(
      `${yours.length} item${yours.length === 1 ? "" : "s"} waiting on you — start with ${unitAt(first)} (${needLine(first.kind, first.days, facts.voice)}).`,
    );
  } else if (fire.length) {
    const first = fire[0];
    bits.push(`On fire: ${unitAt(first)} — ${needLine(first.kind, first.days, facts.voice)}.`);
  } else {
    bits.push("Nothing is waiting on you right now.");
  }
  bits.push(onSite.includes("No crew") ? onSite : `On site: ${onSite}.`);
  if (vac && facts.unitsInTurn != null) {
    bits.push(
      `${facts.unitsInTurn} unit${facts.unitsInTurn === 1 ? "" : "s"} in turn${facts.medianTurnDays != null ? `, median ${facts.medianTurnDays} days` : ""}; vacancy this window is ${vac}.`,
    );
  } else if (facts.unitsInTurn != null) {
    bits.push(`${facts.unitsInTurn} unit${facts.unitsInTurn === 1 ? "" : "s"} in turn.`);
  }
  if (nextMove) bits.push(`Next move: ${nextMove.headline}.`);

  const followUps: string[] = [];
  if (yours.length) followUps.push("What do you need from me?");
  if (facts.crewToday.length) followUps.push("Who's on site today?");
  if (fire.length || longTurns.length) followUps.push("What's going to be late?");
  if (vac) followUps.push("How much vacancy are we burning?");
  if (followUps.length < 3) followUps.push("What's on fire?");
  if (followUps.length < 3) followUps.push("Open the board");

  return {
    onFire,
    needsYou,
    onSite,
    predictions: predictions.slice(0, 6),
    nextMove,
    brief: bits.join(" "),
    followUps: followUps.slice(0, 3),
  };
}

export function renderCortexBlock(cortex: OpsCortex): string {
  const fire = cortex.onFire.length
    ? cortex.onFire.map((i) => `• [${i.severity}] ${i.headline} — ${i.why} → ${i.next}`).join("\n")
    : "• None ranked.";
  const yours = cortex.needsYou.length
    ? cortex.needsYou.map((i) => `• ${i.headline} — ${i.why}`).join("\n")
    : "• Nothing waiting on the operator.";
  const pred = cortex.predictions.length
    ? cortex.predictions.map((i) => `• ${i.headline} — ${i.why}`).join("\n")
    : "• No slip predicted from current facts.";
  return `## Cortex brief (computed — do not contradict)
${cortex.brief}

### On fire
${fire}

### Needs the operator
${yours}

### On site
${cortex.onSite}

### Predictions
${pred}

### Single next move
${cortex.nextMove ? `${cortex.nextMove.headline} — ${cortex.nextMove.why}. ${cortex.nextMove.next}` : "Hold. Nothing is ranked."}`;
}

export type OpsAnswer = {
  answer: string;
  open?: OpsInsight["open"];
  followUps: string[];
};

export function answerFromCortex(question: string, facts: OpsFacts, cortex: OpsCortex): OpsAnswer {
  const q = question.trim().toLowerCase();
  const followUps = cortex.followUps;

  if (/\b(on fire|happening|brief|stand|morning|today\??$|what's going|status|overview)\b/.test(q) || q === "what's happening today?") {
    return { answer: cortex.brief, open: cortex.nextMove?.open ?? "attention", followUps };
  }
  if (/\b(need(s)? (from )?me|waiting on|approv|sign|what do you need)\b/.test(q)) {
    if (!cortex.needsYou.length) {
      return { answer: "Nothing is waiting on you right now.", open: "attention", followUps };
    }
    const lines = cortex.needsYou.slice(0, 4).map((i) => `${i.headline} — ${i.why}.`);
    return { answer: lines.join(" "), open: "attention", followUps };
  }
  if (/\b(crew|on site|who.?s on|where.?s the crew|dispatch)\b/.test(q)) {
    return { answer: cortex.onSite.includes("No crew") ? cortex.onSite : `On site today: ${cortex.onSite}.`, open: "crew", followUps };
  }
  if (/\b(late|slip|tomorrow|predict|going to|will be|behind)\b/.test(q)) {
    if (!cortex.predictions.length) {
      return { answer: "Nothing in the current facts is predicted to slip tomorrow.", followUps };
    }
    return {
      answer: cortex.predictions.slice(0, 3).map((p) => `${p.headline} — ${p.why}`).join(" "),
      open: cortex.predictions[0]?.open,
      followUps,
    };
  }
  if (/\b(vacanc|rent lost|dollar|money|cost|burn)\b/.test(q)) {
    const vac = vacancyLabel(facts.vacancyCostCents);
    return {
      answer: vac
        ? `Vacancy this window is ${vac}${facts.unitsInTurn != null ? ` across ${facts.unitsInTurn} units in turn` : ""}.`
        : "Vacancy for this window is the figure already on the board — I don't have a second number.",
      open: "vacancy",
      followUps,
    };
  }

  return { answer: cortex.brief, open: cortex.nextMove?.open, followUps };
}
