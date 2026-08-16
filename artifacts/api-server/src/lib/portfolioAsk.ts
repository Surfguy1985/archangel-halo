/**
 * Scoped Pulse ask — cortex ranks this portfolio, Claude narrates.
 * Never the office-wide /ask snapshot. Civil language. No HALO / Work App jargon.
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, base44EvidenceTable } from "@workspace/db";
import { completeJson, COMPLEX_MODEL } from "./ai";
import { computePortfolioCrewToday } from "./portfolioCrewToday";
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

export type PortfolioAskResult = {
  answer: string;
  why: string[];
  citations: PortfolioAskCitation[];
  followUps: string[];
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
}): Promise<PortfolioAskResult> {
  const history = (args.history ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }))
    .slice(-8);
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

  try {
    const narrated = await completeJson<{
      answer?: string;
      why?: string[];
      citations?: Array<{ id?: string; label?: string; detail?: string }>;
      followUps?: string[];
    }>(
      `You are the board guide for a multifamily turn portfolio. Claude-grade reasoning partner, civil language.
${renderCortexBlock(cortex)}

Rules:
- Answer ONLY from the cortex + JSON snapshot. Never invent a unit, crew, dollar, or photo.
- No vendor slang (do not say HALO, Work App, Falkon, Base44).
- The local reasoner already chose the focus. Narrate why that rank is true. Do not pick a different unit.
- 2–4 sentences in "answer". "why" is 2–4 short bullets the PM can argue with (dates, who owns the wait, the clock).
- Citations must defend vacancy $ or vacant days — one formula, property timezone, dollars stop at ready.
- The UI already shows photos and maps. Do not describe pictures.
- If the snapshot lacks it, say so.
- Return JSON: { "answer": string, "why": string[], "citations": [{ "id", "label", "detail" }], "followUps": string[] }`,
      `${historyNote}${focusNote}Snapshot:\n${JSON.stringify(snapshot)}\n\nQuestion: ${args.question}`,
      900,
      COMPLEX_MODEL,
    );
    const answer = String(narrated.answer ?? "").trim();
    const claimed = [
      ...(answer.match(/\b(?:unit|#)\s*([a-z0-9-]{1,8})\b/gi) ?? []),
      ...(answer.match(/·\s*([a-z0-9-]{1,8})\b/gi) ?? []),
    ].map((s) => s.replace(/^(?:unit|#|·)\s*/i, "").toLowerCase());
    const invented = claimed.some((u) => !allowedUnits.has(u));
    if (answer && !invented) {
      return {
        answer,
        why: (narrated.why ?? localWhy).map(String).filter(Boolean).slice(0, 4),
        citations: (narrated.citations?.length ? narrated.citations : localCitations)
          .filter((c) => c.label && c.detail)
          .slice(0, 4)
          .map((c, i) => ({
            id: String(c.id ?? `c${i}`),
            label: String(c.label),
            detail: String(c.detail),
          })),
        followUps: (narrated.followUps?.length ? narrated.followUps : cortex.followUps).map(String).slice(0, 3),
      };
    }
  } catch {
    /* fall through */
  }

  return {
    answer: fallback.answer,
    why: localWhy,
    citations: localCitations,
    followUps: fallback.followUps,
  };
}
