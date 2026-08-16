/**
 * Pulse Ask reasoner — ChatGPT-grade partner on live board facts.
 *
 * Cortex ranks. This module decides what the question is about, what to
 * cite, and which proof tiles match. The model may narrate; it may not
 * change the ranking, invent a unit, or mint a second vacancy formula.
 */

import { pickAskCards, type AskCard } from "./askMedia";
import { formatUsdCents } from "./formatUsdCents";
import { buildPulseCortex, needLine } from "./pulseCortex";
import type {
  GuideAction,
  GuideContext,
  GuideCrew,
  GuideNeed,
  GuideReply,
  GuideSite,
  GuideTurn,
} from "./pulseGuideBrain";

export type AskIntent =
  | "brief"
  | "needs_you"
  | "on_site"
  | "slip"
  | "vacancy"
  | "photos"
  | "board"
  | "unit"
  | "site"
  | "compare"
  | "why"
  | "next"
  | "help";

export type AskMemory = {
  lastIntent?: AskIntent;
  lastPropertyId?: string;
  lastUnitNumber?: string;
  lastNeedKind?: string;
};

export type AskCitation = {
  id: string;
  label: string;
  detail: string;
};

export type AskStep = {
  id: string;
  label: string;
};

export type AskPacket = GuideReply & {
  intent: AskIntent;
  steps: AskStep[];
  why: string[];
  citations: AskCitation[];
  memory: AskMemory;
  focus: { propertyId?: string; unitNumber?: string; intent: AskIntent };
};

const HELP =
  "Ask what's on fire, who's on site, or what you need to sign. I’ll rank today’s live numbers and show the proof.";

const SIGNALS: Array<{ intent: AskIntent; re: RegExp; w: number }> = [
  { intent: "board", re: /\b(kanban|board|full flow|workflow|lanes?)\b/i, w: 8 },
  { intent: "photos", re: /\b(photo|before|after|picture|image|proof)\b/i, w: 7 },
  { intent: "on_site", re: /\b(crew|gps|who.?s on|on site|where.?s the crew|dispatch)\b/i, w: 7 },
  { intent: "needs_you", re: /\b(need(s)? (from )?me|need(s)? you|stall|approv|waiting|sign|what do you need)\b/i, w: 7 },
  { intent: "brief", re: /\b(on fire|happening|brief|stand|morning|what's going|status)\b/i, w: 6 },
  { intent: "slip", re: /\b(late|slip|tomorrow|predict|going to|will be|behind)\b/i, w: 6 },
  { intent: "vacancy", re: /\b(vacanc|rent lost|dollar|money|cost|burn)\b/i, w: 6 },
  { intent: "compare", re: /\b(vs\.?|versus|compare|between|difference|against)\b/i, w: 8 },
  { intent: "why", re: /\bwhy\b|\bhow (did|does|do) (we|you|that|this)\b|\bexplain\b/i, w: 8 },
  { intent: "next", re: /\bnext (move|step)|what should i\b|\bdo first\b/i, w: 6 },
  { intent: "help", re: /\b(help|how (do|does|to)|what can|instructions?|guide)\b/i, w: 4 },
];

function shortName(name: string): string {
  return name.replace(/^caf\s+demo\s*[—–-]\s*/i, "").trim();
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/^caf\s+demo\s*[—–-]\s*/, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenScore(query: string, candidate: string): number {
  const q = norm(query);
  const c = norm(candidate);
  if (!c || c.length < 3) return 0;
  if (q.includes(c)) return 80 + Math.min(c.length, 20);
  let score = 0;
  for (const w of c.split(" ").filter((t) => t.length > 2)) {
    if (q.includes(w)) score += 12 + w.length;
  }
  return score;
}

function anaphora(q: string): boolean {
  return /\b(that|this|it|those|the same|that one|this one|there)\b/i.test(q);
}

export function resolveSites(q: string, sites: GuideSite[]): GuideSite[] {
  return sites
    .map((s) => ({
      s,
      score: Math.max(tokenScore(q, s.name), tokenScore(q, s.city ?? "")),
    }))
    .filter((x) => x.score >= 16)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.s);
}

export function resolveUnit(q: string, turns: GuideTurn[], memory?: AskMemory): GuideTurn | undefined {
  const m = q.match(/\b(?:unit|#)\s*([a-z0-9-]{1,8})\b/i) ?? q.match(/\b(\d{2,5}[a-z]?)\b/i);
  if (m) {
    const key = m[1].toLowerCase();
    return turns.find((t) => t.unitNumber.toLowerCase() === key);
  }
  if (anaphora(q) && memory?.lastUnitNumber) {
    return turns.find((t) => t.unitNumber.toLowerCase() === memory.lastUnitNumber!.toLowerCase());
  }
  return undefined;
}

function scoreIntent(q: string): Map<AskIntent, number> {
  const scores = new Map<AskIntent, number>();
  for (const s of SIGNALS) {
    if (s.re.test(q)) scores.set(s.intent, (scores.get(s.intent) ?? 0) + s.w);
  }
  return scores;
}

function pickIntent(
  q: string,
  sites: GuideSite[],
  unit: GuideTurn | undefined,
  memory?: AskMemory,
): AskIntent {
  const scores = scoreIntent(q);
  if (sites.length >= 2) scores.set("compare", (scores.get("compare") ?? 0) + 5);
  if (unit) scores.set("unit", (scores.get("unit") ?? 0) + 4);
  if (sites.length === 1 && !unit) scores.set("site", (scores.get("site") ?? 0) + 8);
  if ((anaphora(q) || scores.get("why")) && memory?.lastIntent === "why") {
    scores.set("why", (scores.get("why") ?? 0) + 3);
  }
  if (scores.get("why") && (memory?.lastUnitNumber || memory?.lastPropertyId || unit || sites[0])) {
    scores.set("why", (scores.get("why") ?? 0) + 4);
  }
  let best: AskIntent = "brief";
  let n = 0;
  for (const [intent, w] of scores) {
    if (w > n) {
      best = intent;
      n = w;
    }
  }
  if (n === 0) {
    if (unit) return "unit";
    if (sites.length >= 2) return "compare";
    if (sites.length === 1) return "site";
    if (anaphora(q) && memory?.lastIntent) return memory.lastIntent;
    return "brief";
  }
  return best;
}

function vacLabel(cents?: string): string | null {
  if (!cents) return null;
  const label = formatUsdCents(cents);
  return label === "$—" ? null : label;
}

function siteOf(ctx: GuideContext, propertyId?: string): GuideSite | undefined {
  if (!propertyId) return undefined;
  return ctx.sites.find((s) => s.propertyId === propertyId);
}

function needOf(ctx: GuideContext, propertyId?: string, unitNumber?: string): GuideNeed | undefined {
  const needs = ctx.needs ?? [];
  if (unitNumber && propertyId) {
    return needs.find(
      (n) => n.propertyId === propertyId && n.unitNumber.toLowerCase() === unitNumber.toLowerCase(),
    );
  }
  if (propertyId) return needs.find((n) => n.propertyId === propertyId);
  return needs[0];
}

function crewOf(ctx: GuideContext, propertyId?: string, unitNumber?: string): GuideCrew | undefined {
  return (
    ctx.crew.find(
      (c) =>
        (!propertyId || c.propertyId === propertyId) &&
        (!unitNumber || (c.unitNumber ?? "").toLowerCase() === unitNumber.toLowerCase()),
    ) ?? ctx.crew.find((c) => !propertyId || c.propertyId === propertyId)
  );
}

function vacancyCite(ctx: GuideContext): AskCitation {
  const vac = vacLabel(ctx.vacancyCostCents);
  return {
    id: "vacancy",
    label: vac ? `Vacancy ${vac}` : "Vacancy clock",
    detail:
      "Pulse window. Vacant days run vacate → ready in the property timezone. Dollars stop at ready. There is no second formula.",
  };
}

function daysCite(unit: GuideTurn, need?: GuideNeed): AskCitation {
  return {
    id: `days-${unit.propertyId}-${unit.unitNumber}`,
    label: `${unit.unitNumber} · ${unit.days} days`,
    detail: need
      ? `Turn clock: ${unit.days} vacant days. ${needLine(need.kind, need.days)}.`
      : `Turn clock: ${unit.days} vacant days in the property timezone.`,
  };
}

function crewCite(): AskCitation {
  return {
    id: "crew",
    label: "On site",
    detail: "Scheduled work today on these communities — not a live GPS ping.",
  };
}

function rankCite(): AskCitation {
  return {
    id: "rank",
    label: "Rank",
    detail: "Approval and price exceptions rank first — those waits are yours, and the vacant clock keeps running.",
  };
}

function packet(
  intent: AskIntent,
  ctx: GuideContext,
  args: {
    answer: string;
    why: string[];
    citations: AskCitation[];
    actions: GuideAction[];
    steps: AskStep[];
    site?: GuideSite;
    unit?: GuideTurn;
    need?: GuideNeed;
    wantPhotos?: boolean;
    wantMap?: boolean;
    followUps?: string[];
    memory: AskMemory;
  },
): AskPacket {
  const cortex = buildPulseCortex({
    vacancyCostCents: ctx.vacancyCostCents,
    unitsInTurn: ctx.unitsInTurn,
    medianTurnDays: ctx.medianTurnDays,
    attentionCount: ctx.attentionCount,
    needs: ctx.needs ?? [],
    turns: ctx.turns,
    crew: ctx.crew,
  });
  const cards: AskCard[] = pickAskCards({
    photos: ctx.photos,
    sites: ctx.sites,
    site: args.site,
    unit: args.unit,
    need: args.need,
    wantPhotos: args.wantPhotos,
    wantMap: args.wantMap,
  });
  return {
    intent,
    answer: args.answer,
    why: args.why,
    citations: args.citations,
    steps: args.steps,
    actions: args.actions,
    cards,
    followUps: args.followUps ?? cortex.followUps,
    memory: args.memory,
    focus: {
      intent,
      propertyId: args.site?.propertyId ?? args.unit?.propertyId ?? args.need?.propertyId,
      unitNumber: args.unit?.unitNumber ?? args.need?.unitNumber,
    },
  };
}

function remember(
  intent: AskIntent,
  site?: GuideSite,
  unit?: GuideTurn,
  need?: GuideNeed,
  prior?: AskMemory,
): AskMemory {
  return {
    lastIntent: intent,
    lastPropertyId: site?.propertyId ?? unit?.propertyId ?? need?.propertyId ?? prior?.lastPropertyId,
    lastUnitNumber: unit?.unitNumber ?? need?.unitNumber ?? prior?.lastUnitNumber,
    lastNeedKind: need?.kind ?? prior?.lastNeedKind,
  };
}

export function reasonAsk(raw: string, ctx: GuideContext, memory: AskMemory = {}): AskPacket {
  const q = raw.trim();
  const ql = q.toLowerCase();
  const named = resolveSites(ql, ctx.sites);
  const selected = ctx.selectedPropertyId ? siteOf(ctx, ctx.selectedPropertyId) : undefined;
  const focusedSites = named.length ? named : [];
  const unit = resolveUnit(ql, ctx.turns, memory);
  const intent = pickIntent(ql, focusedSites, unit, memory);

  const cortex = buildPulseCortex({
    vacancyCostCents: ctx.vacancyCostCents,
    unitsInTurn: ctx.unitsInTurn,
    medianTurnDays: ctx.medianTurnDays,
    attentionCount: ctx.attentionCount,
    needs: ctx.needs ?? [],
    turns: ctx.turns,
    crew: ctx.crew,
  });
  const vac = vacLabel(ctx.vacancyCostCents);
  const topNeed = (ctx.needs ?? [])[0];
  const site = focusedSites[0] ?? (unit ? siteOf(ctx, unit.propertyId) : undefined) ?? selected;
  const need = needOf(ctx, unit?.propertyId ?? site?.propertyId ?? memory.lastPropertyId, unit?.unitNumber ?? memory.lastUnitNumber);
  const focusUnit =
    unit ??
    (need
      ? ctx.turns.find((t) => t.propertyId === need.propertyId && t.unitNumber === need.unitNumber)
      : undefined) ??
    (memory.lastUnitNumber
      ? ctx.turns.find((t) => t.unitNumber.toLowerCase() === memory.lastUnitNumber!.toLowerCase())
      : undefined);
  const focusSite = site ?? (focusUnit ? siteOf(ctx, focusUnit.propertyId) : undefined) ?? (need ? siteOf(ctx, need.propertyId) : undefined);

  const stepsFor = (labels: string[]): AskStep[] =>
    labels.map((label, i) => ({ id: `s${i}`, label }));

  if (intent === "help") {
    return packet("help", ctx, {
      answer: HELP,
      why: ["I only answer from today’s ranked board — vacancy, waits, crews, and proof already on screen."],
      citations: [rankCite(), vacancyCite(ctx)],
      actions: [{ type: "open", panel: "chat" }],
      steps: stepsFor(["Read the question", "Stay on live board facts"]),
      memory: remember("help", undefined, undefined, undefined, memory),
    });
  }

  if (intent === "board") {
    return packet("board", ctx, {
      answer: "Opening the board.",
      why: ["The board is the full work flow — not a second set of numbers."],
      citations: [rankCite()],
      actions: [{ type: "kanban" }],
      steps: stepsFor(["Heard board", "Open the work flow"]),
      memory: remember("board", focusSite, focusUnit, need, memory),
    });
  }

  if (intent === "photos") {
    const n = ctx.photoCount;
    const actions: GuideAction[] = [{ type: "open", panel: "photos" }];
    if (focusSite) actions.unshift({ type: "select", propertyId: focusSite.propertyId });
    return packet("photos", ctx, {
      answer: n === 0 ? "No before/after photos yet." : `${n} unit${n === 1 ? "" : "s"} with before/after.`,
      why: ["Photos are field evidence already on the board. I don’t invent pictures."],
      citations: [
        {
          id: "photos",
          label: n ? `${n} photo units` : "No photos",
          detail: "Before/after from the evidence already attached to these turns.",
        },
      ],
      actions,
      steps: stepsFor(["Look for field proof", n ? "Attach the matching unit" : "None on the board"]),
      site: focusSite,
      unit: focusUnit,
      need,
      wantPhotos: true,
      wantMap: Boolean(focusSite),
      memory: remember("photos", focusSite, focusUnit, need, memory),
    });
  }

  if (intent === "on_site") {
    const rows = focusSite ? ctx.crew.filter((c) => c.propertyId === focusSite.propertyId) : ctx.crew;
    const first = rows[0];
    const actions: GuideAction[] = [{ type: "open", panel: "crew" }];
    if (focusSite) actions.unshift({ type: "select", propertyId: focusSite.propertyId });
    const answer = first
      ? `${first.crewName} · ${shortName(first.propertyName)}${first.unitNumber ? ` ${first.unitNumber}` : ""}.`
      : focusSite
        ? `No crew at ${shortName(focusSite.name)} today.`
        : "No crews scheduled today.";
    return packet("on_site", ctx, {
      answer,
      why: [
        first
          ? `${first.crewName} is on the book for scheduled work today — presence here is the job, not a ping.`
          : "Nobody is scheduled on these communities today.",
      ],
      citations: [crewCite()],
      actions,
      steps: stepsFor(["Check today’s schedule", first ? `Found ${first.crewName}` : "No scheduled crew"]),
      site: focusSite ?? siteOf(ctx, first?.propertyId),
      unit: focusUnit,
      wantMap: true,
      memory: remember("on_site", focusSite ?? siteOf(ctx, first?.propertyId), focusUnit, need, memory),
    });
  }

  if (intent === "compare" && focusedSites.length >= 2) {
    const a = focusedSites[0];
    const b = focusedSites[1];
    const aNeed = needOf(ctx, a.propertyId);
    const bNeed = needOf(ctx, b.propertyId);
    const aVac = vacLabel(a.vacancyCostCents);
    const bVac = vacLabel(b.vacancyCostCents);
    const left = `${shortName(a.name)} has ${a.unitsInTurn} in turn${aNeed ? ` — ${aNeed.unitNumber} ${needLine(aNeed.kind, aNeed.days)}` : ""}${aVac ? `, vacancy ${aVac}` : ""}.`;
    const right = `${shortName(b.name)} has ${b.unitsInTurn} in turn${bNeed ? ` — ${bNeed.unitNumber} ${needLine(bNeed.kind, bNeed.days)}` : ""}${bVac ? `, vacancy ${bVac}` : ""}.`;
    return packet("compare", ctx, {
      answer: `${left} ${right}`,
      why: [
        "Same clock on both sides: vacant days and vacancy dollars stop at ready.",
        "The hotter site is the one with a wait you own, then the longer vacant clock.",
      ],
      citations: [vacancyCite(ctx), rankCite()],
      actions: [{ type: "select", propertyId: a.propertyId }, { type: "open", panel: "sites" }],
      steps: stepsFor(["Resolve both communities", "Compare waits and vacancy", "Keep one clock"]),
      site: a,
      need: aNeed,
      wantMap: true,
      wantPhotos: true,
      memory: remember("compare", a, undefined, aNeed, memory),
    });
  }

  if (intent === "vacancy") {
    const actions: GuideAction[] = [{ type: "open", panel: "vacancy" }];
    if (focusSite) actions.push({ type: "select", propertyId: focusSite.propertyId });
    const siteVac = focusSite ? vacLabel(focusSite.vacancyCostCents) : null;
    const answer = focusSite && siteVac
      ? `${shortName(focusSite.name)} is ${siteVac} this window${focusSite.unitsInTurn ? ` across ${focusSite.unitsInTurn} in turn` : ""}.`
      : vac
        ? `Vacancy this window is ${vac}${ctx.unitsInTurn != null ? ` across ${ctx.unitsInTurn} units in turn` : ""}${ctx.medianTurnDays != null ? `, median ${ctx.medianTurnDays} days` : ""}.`
        : "Vacancy is the figure in the header — I don’t have a second number.";
    return packet("vacancy", ctx, {
      answer,
      why: [
        "That dollar is the Pulse window, not a guess.",
        "The clock is vacate → ready in the property timezone. Ready stops the dollars.",
      ],
      citations: [vacancyCite(ctx)],
      actions,
      steps: stepsFor(["Read the Pulse window", "Refuse a second formula"]),
      site: focusSite,
      wantMap: Boolean(focusSite),
      memory: remember("vacancy", focusSite, focusUnit, need, memory),
    });
  }

  if (intent === "needs_you") {
    const row = cortex.needsYou[0];
    return packet("needs_you", ctx, {
      answer: row ? `${row.headline} — ${row.why}.` : "Nothing waiting on you.",
      why: row
        ? [
            "Approval and price exceptions sit first because you own those stages.",
            "Until you act, the vacant clock keeps running.",
          ]
        : ["Nothing in today’s ranking is a client-owned wait."],
      citations: [rankCite(), ...(focusUnit ? [daysCite(focusUnit, need)] : [])],
      actions: [{ type: "open", panel: "attention" }],
      steps: stepsFor(["Rank waits you own", row ? `Lead with ${row.headline}` : "None waiting"]),
      site: focusSite ?? siteOf(ctx, topNeed?.propertyId),
      unit: focusUnit,
      need: need ?? topNeed,
      wantPhotos: true,
      wantMap: true,
      memory: remember("needs_you", focusSite ?? siteOf(ctx, topNeed?.propertyId), focusUnit, need ?? topNeed, memory),
    });
  }

  if (intent === "slip") {
    const pred = cortex.predictions[0];
    return packet("slip", ctx, {
      answer: pred ? `${pred.headline} — ${pred.why}` : "Nothing slipping tomorrow.",
      why: pred
        ? [pred.next, "Slip is extra vacant days from today’s waits plus Holt on the turn clock — never a second vacancy dollar."]
        : ["No approval wait or long vacant clock is set to sit another day."],
      citations: [rankCite(), vacancyCite(ctx)],
      actions: [{ type: "open", panel: pred?.open ?? "turns" }],
      steps: stepsFor(["Project tomorrow from today’s waits", pred ? pred.headline : "Clear"]),
      site: focusSite,
      unit: focusUnit,
      need: need ?? topNeed,
      wantMap: true,
      memory: remember("slip", focusSite, focusUnit, need ?? topNeed, memory),
    });
  }

  if (intent === "why") {
    const u = focusUnit;
    const n = need ?? (u ? needOf(ctx, u.propertyId, u.unitNumber) : topNeed);
    const s = focusSite ?? (u ? siteOf(ctx, u.propertyId) : undefined);
    if (u || n) {
      const headline = u
        ? `Unit ${u.unitNumber}`
        : n
          ? `${shortName(n.propertyName)} · ${n.unitNumber}`
          : "This wait";
      const whyNeed = n ? needLine(n.kind, n.days) : u ? `vacant ${u.days} days` : "ranked first";
      return packet("why", ctx, {
        answer: `${headline} is first because ${whyNeed}${u ? `, and the vacant clock is already ${u.days} days` : ""}. Until that wait clears, vacancy dollars keep accruing until ready.`,
        why: [
          "Client-owned waits outrank crew work — you hold the clock.",
          "Vacancy dollars use one formula: vacate → ready in the property timezone.",
        ],
        citations: [rankCite(), ...(u ? [daysCite(u, n)] : []), vacancyCite(ctx)],
        actions: [
          ...(s ? [{ type: "select" as const, propertyId: s.propertyId }] : []),
          { type: "open", panel: "turns" },
        ],
        steps: stepsFor(["Resolve what “that” refers to", "Explain the rank", "Cite the clock"]),
        site: s,
        unit: u,
        need: n,
        wantPhotos: true,
        wantMap: true,
        memory: remember("why", s, u, n, memory),
      });
    }
    return packet("why", ctx, {
      answer: cortex.punch,
      why: ["That’s the next move from today’s ranking — nothing more specific was named."],
      citations: [rankCite(), vacancyCite(ctx)],
      actions: [{ type: "open", panel: "attention" }],
      steps: stepsFor(["No unit in the question", "Fall back to the ranked next move"]),
      need: topNeed,
      wantPhotos: true,
      wantMap: true,
      memory: remember("why", undefined, undefined, topNeed, memory),
    });
  }

  if (intent === "next") {
    const move = cortex.nextMove;
    return packet("next", ctx, {
      answer: move ? `${move.headline} — ${move.why}. ${move.next}` : "Hold. Nothing is ranked.",
      why: ["One next move. The rank is approval first, then the longest vacant clock."],
      citations: [rankCite(), vacancyCite(ctx)],
      actions: [{ type: "open", panel: move?.open ?? "attention" }],
      steps: stepsFor(["Rank the board", move ? `Next: ${move.headline}` : "Hold"]),
      site: focusSite,
      unit: focusUnit,
      need: need ?? topNeed,
      wantPhotos: true,
      wantMap: true,
      memory: remember("next", focusSite, focusUnit, need ?? topNeed, memory),
    });
  }

  if (intent === "unit" && focusUnit) {
    const n = needOf(ctx, focusUnit.propertyId, focusUnit.unitNumber);
    const crew = crewOf(ctx, focusUnit.propertyId, focusUnit.unitNumber);
    const bits = [
      `Unit ${focusUnit.unitNumber} — ${n ? needLine(n.kind, n.days) : `vacant ${focusUnit.days} days`}.`,
    ];
    if (crew) bits.push(`${crew.crewName} is scheduled there today.`);
    return packet("unit", ctx, {
      answer: bits.join(" "),
      why: [
        n
          ? `${needLine(n.kind, n.days)} is why this unit is in the thread.`
          : `${focusUnit.days} vacant days on the turn clock.`,
        "Proof tiles are the evidence already attached to this unit.",
      ],
      citations: [daysCite(focusUnit, n), ...(crew ? [crewCite()] : [])],
      actions: [
        { type: "select", propertyId: focusUnit.propertyId },
        { type: "open", panel: "turns" },
        { type: "turns", propertyId: focusUnit.propertyId },
      ],
      steps: stepsFor([`Resolve unit ${focusUnit.unitNumber}`, "Read the clock", "Attach proof"]),
      site: siteOf(ctx, focusUnit.propertyId),
      unit: focusUnit,
      need: n,
      wantPhotos: true,
      wantMap: true,
      memory: remember("unit", siteOf(ctx, focusUnit.propertyId), focusUnit, n, memory),
    });
  }

  if (intent === "site" && focusSite) {
    const siteNeeds = (ctx.needs ?? []).filter((n) => n.propertyId === focusSite.propertyId);
    const top = siteNeeds[0];
    const actions: GuideAction[] = [
      { type: "select", propertyId: focusSite.propertyId },
      { type: "open", panel: "sites" },
      { type: "open", panel: "turns" },
    ];
    const siteVac = vacLabel(focusSite.vacancyCostCents);
    return packet("site", ctx, {
      answer: top
        ? `${shortName(focusSite.name)} · ${top.unitNumber} — ${needLine(top.kind, top.days)}.`
        : `${shortName(focusSite.name)} — ${focusSite.unitsInTurn} in turn${siteVac ? `, vacancy ${siteVac}` : ""}.`,
      why: [
        top
          ? `${top.unitNumber} is the wait to clear at this community.`
          : "No client-owned wait here — the figure is units in turn.",
      ],
      citations: [vacancyCite(ctx), rankCite()],
      actions,
      steps: stepsFor([`Resolve ${shortName(focusSite.name)}`, top ? `Lead with ${top.unitNumber}` : "No wait"]),
      site: focusSite,
      need: top,
      wantPhotos: true,
      wantMap: true,
      memory: remember("site", focusSite, undefined, top, memory),
    });
  }

  if (intent === "brief") {
    const punch = cortex.punch;
    const extra: string[] = [];
    if (cortex.onSite && !cortex.onSite.includes("No crew")) extra.push(`On site: ${cortex.onSite.split(";")[0]}.`);
    if (vac) extra.push(`Vacancy this window is ${vac}.`);
    return packet("brief", ctx, {
      answer: extra.length ? `${punch} ${extra[0]}` : punch,
      why: [
        cortex.nextMove ? `${cortex.nextMove.headline} ranks first — ${cortex.nextMove.why}.` : "Nothing is ranked.",
        "I will not invent a hotter unit than the cortex already ranked.",
      ],
      citations: [rankCite(), vacancyCite(ctx), crewCite()],
      actions: [{ type: "open", panel: cortex.nextMove?.open === "turns" ? "turns" : "attention" }],
      steps: stepsFor(["Rank what’s on fire", "Name who is on site", "Cite vacancy once"]),
      site: focusSite ?? siteOf(ctx, topNeed?.propertyId),
      unit: focusUnit,
      need: need ?? topNeed,
      wantPhotos: true,
      wantMap: true,
      memory: remember("brief", focusSite ?? siteOf(ctx, topNeed?.propertyId), focusUnit, need ?? topNeed, memory),
    });
  }

  return packet("brief", ctx, {
    answer: cortex.punch,
    why: ["That’s the ranked next move from today’s board."],
    citations: [rankCite(), vacancyCite(ctx)],
    actions: [{ type: "open", panel: "chat" }],
    steps: stepsFor(["No sharper intent", "Answer with the next move"]),
    site: focusSite,
    unit: focusUnit,
    need: need ?? topNeed,
    wantPhotos: true,
    wantMap: true,
    memory: remember("brief", focusSite, focusUnit, need ?? topNeed, memory),
  });
}

export function inventGuard(answer: string, ctx: GuideContext): boolean {
  const allowed = new Set<string>();
  for (const t of ctx.turns) allowed.add(t.unitNumber.toLowerCase());
  for (const n of ctx.needs ?? []) allowed.add(n.unitNumber.toLowerCase());
  for (const c of ctx.crew) if (c.unitNumber) allowed.add(c.unitNumber.toLowerCase());
  const claimed = [
    ...(answer.match(/\b(?:unit|#)\s*([a-z0-9-]{1,8})\b/gi) ?? []),
    ...(answer.match(/·\s*([a-z0-9-]{1,8})\b/gi) ?? []),
  ].map((s) => s.replace(/^(?:unit|#|·)\s*/i, "").toLowerCase());
  return claimed.every((k) => allowed.has(k));
}
