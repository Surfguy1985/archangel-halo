/**
 * Scoped Pulse ask — cortex ranks this portfolio, Claude narrates.
 * Never the office-wide /ask snapshot. Civil language. No HALO / Work App jargon.
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, base44EvidenceTable } from "@workspace/db";
import { completeJson, COMPLEX_MODEL } from "./ai";
import { computePortfolioCrewToday } from "./portfolioCrewToday";
import { consultPartner, learnFromAsk } from "./agentPartner";
import { clockDaysForForecast } from "./agentClock";
import { dismissAct, queueAct } from "./agentActs";
import {
  answerFromCortex,
  buildOpsCortex,
  renderCortexBlock,
  type OpsFacts,
  type OpsNeed,
  type OpsNeedKind,
} from "./opsCortex";

const KIND_MAP: Record<string, OpsNeedKind> = {
  awaiting_approval: "awaiting_approval",
  variance_pending: "variance_pending",
  stalled: "stalled",
  failed_qc: "failed_qc",
  blocked_invoices: "blocked_invoices",
};

export type PortfolioAskHistory = Array<{ role: "user" | "assistant"; content: string }>;

export type PortfolioAskFocus = {
  intent?: string;
  propertyId?: string;
  unitNumber?: string;
};

export type PortfolioAskCitation = { id: string; label: string; detail: string };

export type PortfolioAskSection = {
  title: string;
  tone: "you" | "fire" | "clock" | "site" | "place" | "fact";
  bullets: string[];
};

export type PortfolioAskResult = {
  answer: string;
  why: string[];
  citations: PortfolioAskCitation[];
  followUps: string[];
  sections?: PortfolioAskSection[];
  partner?: {
    embedder: string;
    memories: Array<{ question: string; answer: string; score: number; unit?: string | null }>;
    forecast: {
      method: string;
      headline: string;
      extraDays: number;
      unit?: string | null;
      series?: number[];
    } | null;
    fork?: {
      site: string;
      unit: string;
      daysNow: number;
      extraDays: number;
      daysIfWait: number;
      method: string;
      source: string;
      series: number[];
      wait: string;
      ifYouAct: string;
      ifYouWait: string;
    } | null;
    acts: Array<{
      id: string;
      label: string;
      hitl: true;
      status?: "propose" | "queued";
      unit?: string | null;
      open?: "attention" | "turns" | "crew";
    }>;
    graph?: string[];
  };
};

export async function answerPortfolioAsk(args: {
  question: string;
  title: string;
  properties: Array<{ id: string; name: string; timezone?: string | null }>;
  pulse: {
    vacancyCostCents?: string;
    unitsInTurn?: number;
    medianTurnDays?: number | null;
    tiles: Array<{ name: string; unitsInTurn: number; statusLabel: string; city?: string | null }>;
  };
  turns: Array<{ propertyName: string; unitNumber: string; days: number }>;
  photoCount: number;
  attentionCount: number;
  attentionGroups?: Array<{
    kind: string;
    items: Array<{ propertyName: string; unitNumber: string; days: number }>;
  }>;
  history?: PortfolioAskHistory;
  focus?: PortfolioAskFocus;
  queueAct?: { id: string; label: string; unit?: string | null; open?: "attention" | "turns" | "crew" };
  dismissAct?: string;
}): Promise<PortfolioAskResult> {
  const history = (args.history ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }))
    .slice(-16);
  const crew = await computePortfolioCrewToday({ properties: args.properties });
  const evidence = args.properties.length
    ? await db
        .select({
          kind: base44EvidenceTable.kind,
          propertyName: base44EvidenceTable.propertyName,
          unitLabel: base44EvidenceTable.unitLabel,
          title: base44EvidenceTable.title,
        })
        .from(base44EvidenceTable)
        .where(
          and(
            eq(base44EvidenceTable.stale, false),
            inArray(base44EvidenceTable.kind, ["before", "after", "crew_job", "summary"]),
            isNotNull(base44EvidenceTable.propertyName),
          ),
        )
        .limit(80)
    : [];

  const needs: OpsNeed[] = [];
  for (const group of args.attentionGroups ?? []) {
    const kind = KIND_MAP[group.kind];
    if (!kind) continue;
    for (const item of group.items) {
      needs.push({
        kind,
        propertyName: item.propertyName,
        unitNumber: item.unitNumber,
        days: item.days,
      });
    }
  }

  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const facts: OpsFacts = {
    date: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`,
    voice: "client",
    vacancyCostCents: args.pulse.vacancyCostCents ?? null,
    unitsInTurn: args.pulse.unitsInTurn ?? 0,
    medianTurnDays: args.pulse.medianTurnDays ?? null,
    communities: args.pulse.tiles.length,
    needs,
    crewToday: crew.map((c) => ({
      crewName: c.crewName,
      propertyName: c.propertyName,
      unitNumber: c.unitNumber,
    })),
    turns: args.turns.slice(0, 40).map((t) => ({
      propertyName: t.propertyName,
      unitNumber: t.unitNumber,
      days: t.days,
    })),
  };
  const cortex = buildOpsCortex(facts);
  const fallback = answerFromCortex(args.question, facts, cortex);
  if (args.queueAct?.id) queueAct(args.queueAct);
  if (args.dismissAct) dismissAct(args.dismissAct);
  const clock = await clockDaysForForecast(
    args.properties.map((p) => p.id),
    args.focus?.unitNumber ?? facts.needs[0]?.unitNumber ?? facts.turns[0]?.unitNumber ?? null,
  );
  const partner = await consultPartner({
    question: args.question,
    facts,
    cortex,
    focusUnit: args.focus?.unitNumber ?? null,
    clockDays: clock.days,
    clockSource: clock.source,
    intent: args.focus?.intent ?? null,
  });

  const snapshot = {
    view: args.title,
    vacancyCostCents: args.pulse.vacancyCostCents ?? null,
    unitsInTurn: args.pulse.unitsInTurn ?? 0,
    medianTurnDays: args.pulse.medianTurnDays ?? null,
    communities: args.pulse.tiles.map((t) => ({
      name: t.name,
      city: t.city ?? null,
      unitsInTurn: t.unitsInTurn,
      status: t.statusLabel,
    })),
    openTurns: args.turns.slice(0, 40).map((t) => ({
      property: t.propertyName,
      unit: t.unitNumber,
      daysVacant: t.days,
    })),
    photoUnits: args.photoCount,
    needsYou: needs.slice(0, 20).map((n) => ({
      kind: n.kind,
      property: n.propertyName,
      unit: n.unitNumber,
      days: n.days,
    })),
    crewToday: crew.map((c) => ({
      property: c.propertyName,
      unit: c.unitNumber,
      crew: c.crewName,
      job: c.jobNo,
      status: c.status,
    })),
    fieldNotes: evidence
      .filter((e) =>
        args.properties.some((p) =>
          (e.propertyName ?? "").toLowerCase().includes(p.name.toLowerCase().replace(/^caf demo\s*[—–-]\s*/, "")),
        ),
      )
      .slice(0, 24)
      .map((e) => ({
        kind: e.kind,
        property: e.propertyName,
        unit: e.unitLabel,
        title: e.title,
      })),
  };

  const historyNote =
    history.length
      ? `\nPrior turns:\n${history.map((m) => `${m.role}: ${m.content}`).join("\n")}\n`
      : "";
  const memoryNote = partner.memories.length
    ? `\nSimilar mornings (retrieved, ${partner.embedder}):\n${partner.memories.map((m) => `- (${m.score.toFixed(2)}) ${m.question} → ${m.answer}`).join("\n")}\n`
    : "";
  const graphNote = partner.graph.length
    ? `\nTemporal graph:\n${partner.graph.map((f) => `- ${f}`).join("\n")}\n`
    : "";
  const forecastNote = partner.forecast
    ? `\nSlip forecast (${partner.forecast.method}): ${partner.forecast.headline}\nThis is vacant DAYS, not a second dollar figure.\n`
    : "";
  const forkNote = partner.fork
    ? `\nMorning fork for ${partner.fork.site} · ${partner.fork.unit}: day ${partner.fork.daysNow} now. If they wait: day ${partner.fork.daysIfWait} (${partner.fork.ifYouWait}) If they act: ${partner.fork.ifYouAct}\n`
    : "";
  const focusNote = args.focus
    ? `\nLocal reasoner already focused on intent=${args.focus.intent ?? "brief"} property=${args.focus.propertyId ?? "none"} unit=${args.focus.unitNumber ?? "none"}. Narrate that ranking. Do not change the unit.\n`
    : "";

  const allowedUnits = new Set(
    [...args.turns, ...needs].map((t) => String("unitNumber" in t ? t.unitNumber : "").toLowerCase()).filter(Boolean),
  );

  const localWhy = [
    cortex.nextMove ? `${cortex.nextMove.headline} ranks first — ${cortex.nextMove.why}.` : "Nothing is ranked.",
    "Vacancy dollars use one formula: vacate → ready in the property timezone. Ready stops the dollars.",
  ];
  const localCitations: PortfolioAskCitation[] = [
    {
      id: "rank",
      label: "Rank",
      detail: "Approval and price exceptions rank first — those waits are yours, and the vacant clock keeps running.",
    },
    {
      id: "vacancy",
      label: "Vacancy clock",
      detail: "Pulse window. Vacant days run vacate → ready in the property timezone. Dollars stop at ready. There is no second formula.",
    },
  ];
  if (partner.forecast) {
    localWhy.push(partner.forecast.headline);
    localCitations.push({
      id: "holt",
      label: `Slip · ${partner.forecast.method}`,
      detail: `${partner.forecast.headline} Vacant days only — not a second vacancy dollar.`,
    });
  }
  if (partner.fork) {
    localWhy.push(
      `${partner.fork.site} · ${partner.fork.unit}: day ${partner.fork.daysNow} now. Wait and it’s day ${partner.fork.daysIfWait}.`,
    );
    localCitations.push({
      id: "fork",
      label: "Morning fork",
      detail: `${partner.fork.ifYouAct} ${partner.fork.ifYouWait} Vacant days only.`,
    });
  }
  if (partner.memories[0]) {
    localCitations.push({
      id: "memory",
      label: "Learned",
      detail: `Similar morning: “${partner.memories[0].question}”`,
    });
  }
  if (partner.graph[0]) {
    localCitations.push({
      id: "graph",
      label: "Graph",
      detail: partner.graph[0],
    });
  }

  const pack = (
    answer: string,
    why: string[],
    citations: PortfolioAskCitation[],
    followUps: string[],
    skipLearn = false,
    sections?: PortfolioAskSection[],
  ): PortfolioAskResult => {
    if (!skipLearn) {
      void learnFromAsk({
        question: args.question,
        answer,
        unit: args.focus?.unitNumber ?? partner.forecast?.unit ?? null,
        days: args.turns.find((t) => t.unitNumber === (args.focus?.unitNumber ?? partner.forecast?.unit))?.days ?? null,
        nextMove: cortex.nextMove?.headline ?? null,
      }).catch(() => {});
    }
    return {
      answer,
      why,
      citations,
      sections,
      followUps: [...partner.followUps, ...followUps].filter((v, i, a) => a.indexOf(v) === i).slice(0, 3),
      partner: {
        embedder: partner.embedder,
        memories: partner.memories.map((m) => ({
          question: m.question,
          answer: m.answer,
          score: m.score,
          unit: m.unit,
        })),
        forecast: partner.forecast,
        fork: partner.fork,
        acts: partner.acts,
        graph: partner.graph,
      },
    };
  };

  // Queue pings must not burn a narration call or invent a unit — the HITL
  // row is already durable. Next real Ask still says "Still queued".
  if (args.queueAct?.id) {
    const unit = partner.fork?.unit ?? partner.forecast?.unit ?? args.focus?.unitNumber ?? "that unit";
    return pack(
      `Queued. I’ll wait for you on ${unit}.`,
      localWhy,
      localCitations,
      fallback.followUps,
      true,
    );
  }

  try {
    const narrated = await completeJson<{
      answer?: string;
      why?: string[];
      citations?: Array<{ id?: string; label?: string; detail?: string }>;
      followUps?: string[];
      sections?: Array<{ title?: string; tone?: string; bullets?: string[] }>;
    }>(
      `You are the board guide for a multifamily turn portfolio. Write like a clear 5th grader.
${renderCortexBlock(cortex)}

Rules:
- Answer ONLY from the cortex + JSON snapshot. Never invent a unit, crew, dollar, or photo.
- No vendor slang (do not say HALO, Work App, Falkon, Base44).
- The local reasoner already chose the focus. Do not pick a different unit.
- "answer" is one short headline (6 words or fewer).
- "why" is 2–4 bullets, 8 words or fewer each. Dates, who waits, the clock.
- "sections" is 2–4 groups: { title (1–3 words), tone (you|fire|clock|site|place|fact), bullets (8 words or fewer) }.
- Use kid words: needs your name, stuck, empty days, empty-home rent, people working.
- Citations must defend vacancy $ or vacant days — one formula, property timezone, dollars stop at ready.
- The UI already shows photos, maps, and a mini board. Do not describe pictures.
- If the snapshot lacks it, say so.
- If a slip forecast is present, you may cite extra vacant DAYS. Never mint a vacancy dollar from it.
- If a morning fork is present, name the two paths in DAYS (sign vs wait). Do not invent a dollar from the fork.
- Return JSON: { "answer": string, "why": string[], "sections": [{ "title", "tone", "bullets" }], "citations": [{ "id", "label", "detail" }], "followUps": string[] }`,
      `${historyNote}${memoryNote}${graphNote}${forecastNote}${forkNote}${focusNote}Snapshot:\n${JSON.stringify(snapshot)}\n\nQuestion: ${args.question}`,
      900,
      COMPLEX_MODEL,
    );
    const answer = String(narrated.answer ?? "").trim();
    const sectionText = (narrated.sections ?? [])
      .flatMap((s) => [s.title, ...(s.bullets ?? [])])
      .filter(Boolean)
      .join(" ");
    const claimed = [
      ...(answer.match(/\b(?:unit|#)\s*([a-z0-9-]{1,8})\b/gi) ?? []),
      ...(answer.match(/·\s*([a-z0-9-]{1,8})\b/gi) ?? []),
      ...(sectionText.match(/\b(?:unit|#)\s*([a-z0-9-]{1,8})\b/gi) ?? []),
    ].map((s) => s.replace(/^(?:unit|#|·)\s*/i, "").toLowerCase());
    const invented = claimed.some((u) => !allowedUnits.has(u));
    const tones = new Set(["you", "fire", "clock", "site", "place", "fact"]);
    const sections = (narrated.sections ?? [])
      .filter((s) => s.title && Array.isArray(s.bullets) && s.bullets.length)
      .slice(0, 4)
      .map((s) => ({
        title: String(s.title).slice(0, 32),
        tone: (tones.has(String(s.tone)) ? s.tone : "fact") as PortfolioAskSection["tone"],
        bullets: s.bullets!.map(String).slice(0, 4),
      }));
    if (answer && !invented) {
      return pack(
        answer,
        (narrated.why ?? localWhy).map(String).filter(Boolean).slice(0, 4),
        (narrated.citations?.length ? narrated.citations : localCitations)
          .filter((c) => c.label && c.detail)
          .slice(0, 4)
          .map((c, i) => ({
            id: String(c.id ?? `c${i}`),
            label: String(c.label),
            detail: String(c.detail),
          })),
        (narrated.followUps?.length ? narrated.followUps : cortex.followUps).map(String).slice(0, 3),
        false,
        sections.length ? sections : undefined,
      );
    }
  } catch {
    /* fall through */
  }

  return pack(fallback.answer, localWhy, localCitations, fallback.followUps);
}
