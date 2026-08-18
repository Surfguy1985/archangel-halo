/**
 * Ops cortex — deterministic ranking + prediction for HALO chat.
 *
 * Claude narrates this brief. It does not invent the ranking.
 * Vacancy dollars are passed in already computed (Pulse window / MV).
 * Never derive a second days or cents formula here.
 */

import { formatUsd } from "@workspace/db";
import {
  capStructured,
  structuredToPlainText,
  type StructuredAnswer,
} from "./answerFormat";

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
  /** Job / invoice UUID when this need maps to a row an executor can act on. */
  entityId?: string | null;
};

/**
 * A suggestion HALO can actually carry out on approval. Every kind here has an
 * executor in autopilot.ts — an insight without one is phrased as an
 * observation, never as an approvable decision.
 */
export type OpsProposalKind =
  | "prioritize_job"
  | "rebroadcast_job"
  | "send_invoice_reminder";

export type OpsProposal = {
  kind: OpsProposalKind;
  entityType: "job" | "invoice";
  entityId: string;
  title: string;
  body: string;
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
  /** HALO job this turn maps to, when one exists — enables the prioritise proposal. */
  jobId?: string | null;
  /** Job number for operator-facing copy. */
  jobNo?: string | null;
};

export type OpsStop = {
  propertyName: string;
  unitNumber?: string | null;
  crewName?: string | null;
  jobId?: string | null;
  jobNo?: string | null;
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
  /**
   * Rolling average length of a COMPLETED turn for this operation, in days.
   * Computed upstream from the same days source the board shows — never
   * recomputed here. Null when the operation has no completed history yet.
   */
  turnBaselineDays?: number | null;
  /** How many completed turns that average is drawn from. */
  turnBaselineSample?: number;
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
  /**
   * The insight phrased as a decision the operator can answer yes/no to.
   * Only set when `proposal` is set — HALO never asks for approval on
   * something it cannot then carry out.
   */
  decision?: string;
  /** The change approving this insight would make. */
  proposal?: OpsProposal;
};

export type OpsCortex = {
  onFire: OpsInsight[];
  needsYou: OpsInsight[];
  onSite: string;
  predictions: OpsInsight[];
  nextMove: OpsInsight | null;
  brief: string;
  followUps: string[];
  /** The turn-time yardstick every long-turn flag was measured against. */
  baseline: TurnBaseline;
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

/**
 * Days a turn is expected to take in THIS operation, plus the thresholds a
 * turn has to clear before HALO calls it slow.
 *
 * With no measured history the thresholds are the legacy fixed ones (7 / 12)
 * so behaviour is unchanged for a fresh operation; once at least three turns
 * have completed the flags move with the operation's own rolling average, so
 * the numbers HALO quotes match what the operator sees on the board.
 */
export const DEFAULT_TURN_BASELINE_DAYS = 7;
const MIN_BASELINE_SAMPLE = 3;

export type TurnBaseline = {
  /** Rolling average completed turn length, in days. */
  days: number;
  /** How many completed turns it averages. 0 when unmeasured. */
  sample: number;
  /** False when falling back to the fixed legacy thresholds. */
  measured: boolean;
  /** At or above this many days a turn is flagged as running long. */
  flagAt: number;
  /** At or above this many days the flag is urgent. */
  urgentAt: number;
};

export function turnBaseline(facts: Pick<OpsFacts, "turnBaselineDays" | "turnBaselineSample">): TurnBaseline {
  const sample = facts.turnBaselineSample ?? 0;
  const avg = facts.turnBaselineDays;
  if (avg == null || !Number.isFinite(avg) || avg <= 0 || sample < MIN_BASELINE_SAMPLE) {
    return { days: DEFAULT_TURN_BASELINE_DAYS, sample, measured: false, flagAt: 7, urgentAt: 12 };
  }
  const days = Math.round(avg * 10) / 10;
  const flagAt = Math.max(Math.ceil(days * 1.5), Math.ceil(days) + 2);
  const urgentAt = Math.max(Math.ceil(days * 2.5), flagAt + 3);
  return { days, sample, measured: true, flagAt, urgentAt };
}

export function buildOpsCortex(facts: OpsFacts): OpsCortex {
  const baseline = turnBaseline(facts);
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

  // Long turns are measured against the operation's OWN rolling average, not
  // a hardcoded day count, and each one is phrased as a decision the operator
  // can approve — but only when the turn maps to a job we can re-order.
  const longTurns = [...facts.turns]
    .sort((a, b) => b.days - a.days)
    .filter((t) => t.days >= baseline.flagAt);
  for (const t of longTurns.slice(0, 3)) {
    const unitLabel = `${shortName(t.propertyName)} · ${t.unitNumber}`;
    if (predictions.some((p) => p.headline === unitLabel)) continue;
    const versus = baseline.measured
      ? `${daysPhrase(t.days)} into a ${baseline.days}-day average turn`
      : `${daysPhrase(t.days)} vacant`;
    const slip =
      t.predictedReadyOn && t.predictedReadyOn < tomorrow
        ? `${versus}; predicted ready ${t.predictedReadyOn} is already slipping.`
        : `${versus} — still open tomorrow unless it closes today.`;
    predictions.push({
      severity: t.days >= baseline.urgentAt ? "now" : "watch",
      headline: unitLabel,
      why: slip,
      next: "Open turns and clear the blocker.",
      open: "turns",
      ...(t.jobId
        ? {
            decision: `Unit ${t.unitNumber} is ${versus} — move it to the top of the priority list?`,
            proposal: {
              kind: "prioritize_job" as const,
              entityType: "job" as const,
              entityId: t.jobId,
              title: `Move Unit ${t.unitNumber} to the top of the board`,
              body: `${unitLabel} is ${versus}. Approving puts ${t.jobNo ? `job ${t.jobNo}` : "this job"} at the top of the job board and today's list so it gets worked first.`,
            },
          }
        : {}),
    });
  }

  for (const s of (facts.scheduledTomorrow ?? []).slice(0, 3)) {
    const stopLabel = `${shortName(s.propertyName)}${s.unitNumber ? ` · ${s.unitNumber}` : ""}`;
    predictions.push({
      severity: "watch",
      headline: stopLabel,
      why: s.crewName ? `${s.crewName} is on the book tomorrow.` : "On the book tomorrow with no crew yet.",
      next: s.crewName ? "Confirm access and materials." : "Assign a crew before morning.",
      open: "crew",
      ...(!s.crewName && s.jobId
        ? {
            decision: `${stopLabel} has no crew for tomorrow — send the offer to every matching crew?`,
            proposal: {
              kind: "rebroadcast_job" as const,
              entityType: "job" as const,
              entityId: s.jobId,
              title: `Broadcast ${s.jobNo ? `job ${s.jobNo}` : stopLabel} to matching crews`,
              body: `${stopLabel} is on the book tomorrow with nobody assigned. Approving sends (or re-sends) the offer to every matching active crew.`,
            },
          }
        : {}),
    });
  }

  // Uncrewed open work and overdue invoices are the other two things HALO can
  // actually finish on approval — surface them as decisions too.
  for (const n of needs) {
    if (predictions.length >= 6) break;
    if (!n.entityId) continue;
    const label = unitAt(n);
    if (predictions.some((p) => p.headline === label)) continue;
    if (n.kind === "uncrewed") {
      predictions.push({
        severity: "today",
        headline: label,
        why: "No crew assigned — nothing moves until somebody takes it.",
        next: "Broadcast the offer to matching crews.",
        open: "crew",
        decision: `${label} still has no crew — send the offer to every matching crew?`,
        proposal: {
          kind: "rebroadcast_job",
          entityType: "job",
          entityId: n.entityId,
          title: `Broadcast ${n.label ? `job ${n.label}` : label} to matching crews`,
          body: `${label} has no crew assigned. Approving sends (or re-sends) the offer to every matching active crew.`,
        },
      });
    } else if (n.kind === "overdue_invoice") {
      predictions.push({
        severity: "today",
        headline: label,
        why: n.days ? `Invoice ${daysPhrase(n.days)} past due.` : "Invoice past due.",
        next: "Email the billing contact.",
        open: "money",
        decision: `${label} is ${n.days ? `${daysPhrase(n.days)} ` : ""}past due — email the payment reminder?`,
        proposal: {
          kind: "send_invoice_reminder",
          entityType: "invoice",
          entityId: n.entityId,
          title: `Email a payment reminder${n.label ? ` for invoice ${n.label}` : ""}`,
          body: `${label} is ${n.days ? `${daysPhrase(n.days)} ` : ""}past due. Approving emails a branded payment reminder to the billing contact on file.`,
        },
      });
    }
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
    baseline,
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
    ? cortex.predictions
        .map((i) => `• ${i.headline} — ${i.why}${i.decision ? ` → DECISION: ${i.decision}` : ""}`)
        .join("\n")
    : "• No slip predicted from current facts.";
  const baseline = cortex.baseline.measured
    ? `Average completed turn is ${cortex.baseline.days} days (from ${cortex.baseline.sample} finished turns). A turn is flagged long at ${cortex.baseline.flagAt} days and urgent at ${cortex.baseline.urgentAt}. Quote THIS average — never a made-up industry number.`
    : `No completed-turn history yet, so long turns fall back to the fixed ${cortex.baseline.flagAt}-day flag. Do not quote an average turn time.`;
  return `## Cortex brief (computed — do not contradict)
${cortex.brief}

### On fire
${fire}

### Needs the operator
${yours}

### On site
${cortex.onSite}

### Turn-time baseline
${baseline}

### Predictions
${pred}

### Single next move
${cortex.nextMove ? `${cortex.nextMove.headline} — ${cortex.nextMove.why}. ${cortex.nextMove.next}` : "Hold. Nothing is ranked."}`;
}

/**
 * Every executable suggestion the cortex found, most urgent first, deduped by
 * (kind, entity) so the same unit is only ever proposed once per answer.
 */
export function cortexProposals(cortex: OpsCortex): OpsProposal[] {
  const rank: Record<OpsInsight["severity"], number> = { now: 0, today: 1, watch: 2 };
  const seen = new Set<string>();
  const out: OpsProposal[] = [];
  const insights = [...cortex.predictions, ...cortex.onFire, ...cortex.needsYou].sort(
    (a, b) => rank[a.severity] - rank[b.severity],
  );
  for (const i of insights) {
    if (!i.proposal) continue;
    const key = `${i.proposal.kind}:${i.proposal.entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(i.proposal);
  }
  return out;
}

export type OpsAnswer = {
  answer: string;
  /** Headline + fragment bullets — what the screen renders. */
  structured: StructuredAnswer;
  open?: OpsInsight["open"];
  followUps: string[];
};

/** Wrap a locally-computed answer in the structured contract. */
function localAnswer(
  headline: string,
  bullets: Array<{ text: string; emphasis?: string }>,
  speech: string,
  open: OpsInsight["open"] | undefined,
  followUps: string[],
): OpsAnswer {
  const structured = capStructured({ headline, bullets, speech });
  return { answer: structuredToPlainText(structured), structured, open, followUps };
}

export function answerFromCortex(question: string, facts: OpsFacts, cortex: OpsCortex): OpsAnswer {
  const q = question.trim().toLowerCase();
  const followUps = cortex.followUps;
  const briefAnswer = (open: OpsInsight["open"] | undefined): OpsAnswer => {
    const [first, ...rest] = cortex.brief.split(/(?<=\.)\s+/).filter(Boolean);
    return localAnswer(
      first ?? cortex.brief,
      rest.map((s) => ({ text: s })),
      cortex.brief,
      open,
      followUps,
    );
  };

  if (/\b(on fire|happening|brief|stand|morning|today\??$|what's going|status|overview)\b/.test(q) || q === "what's happening today?") {
    return briefAnswer(cortex.nextMove?.open ?? "attention");
  }
  if (/\b(need(s)? (from )?me|waiting on|approv|sign|what do you need)\b/.test(q)) {
    if (!cortex.needsYou.length) {
      return localAnswer("Nothing is waiting on you right now.", [], "Nothing is waiting on you right now.", "attention", followUps);
    }
    return localAnswer(
      `${cortex.needsYou.length} item${cortex.needsYou.length === 1 ? "" : "s"} waiting on you.`,
      cortex.needsYou.slice(0, 4).map((i) => ({ text: `${i.headline} — ${i.why}`, emphasis: i.headline })),
      cortex.needsYou.slice(0, 3).map((i) => `${i.headline} — ${i.why}`).join(". "),
      "attention",
      followUps,
    );
  }
  if (/\b(crew|on site|who.?s on|where.?s the crew|dispatch)\b/.test(q)) {
    if (cortex.onSite.includes("No crew")) {
      return localAnswer(cortex.onSite, [], cortex.onSite, "crew", followUps);
    }
    const stops = cortex.onSite.split("; ").filter(Boolean);
    return localAnswer(
      `${stops.length} crew${stops.length === 1 ? "" : "s"} on site today.`,
      stops.map((s) => ({ text: s })),
      `On site today: ${cortex.onSite}.`,
      "crew",
      followUps,
    );
  }
  if (/\b(late|slip|tomorrow|predict|going to|will be|behind)\b/.test(q)) {
    if (!cortex.predictions.length) {
      const line = "Nothing in the current facts is predicted to slip tomorrow.";
      return localAnswer(line, [], line, undefined, followUps);
    }
    return localAnswer(
      `${cortex.predictions.length} thing${cortex.predictions.length === 1 ? "" : "s"} look${cortex.predictions.length === 1 ? "s" : ""} likely to slip.`,
      cortex.predictions.slice(0, 4).map((p) => ({ text: `${p.headline} — ${p.why}`, emphasis: p.headline })),
      cortex.predictions.slice(0, 2).map((p) => `${p.headline}: ${p.why}`).join(" "),
      cortex.predictions[0]?.open,
      followUps,
    );
  }
  if (/\b(vacanc|rent lost|dollar|money|cost|burn)\b/.test(q)) {
    const vac = vacancyLabel(facts.vacancyCostCents);
    const line = vac
      ? `Vacancy this window is ${vac}${facts.unitsInTurn != null ? ` across ${facts.unitsInTurn} units in turn` : ""}.`
      : "Vacancy for this window is the figure already on the board — I don't have a second number.";
    return localAnswer(line, [], line, "vacancy", followUps);
  }

  return briefAnswer(cortex.nextMove?.open);
}
