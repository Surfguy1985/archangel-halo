/**
 * Scoped Pulse ask — answers from this portfolio's HALO + Base44
 * projection only. Never the office-wide /ask snapshot.
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, base44EvidenceTable } from "@workspace/db";
import { completeText } from "./ai";
import { computePortfolioCrewToday } from "./portfolioCrewToday";

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
}): Promise<{ answer: string }> {
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
    workAppPhotoUnits: args.photoCount,
    needsYou: args.attentionCount,
    crewToday: crew.map((c) => ({
      property: c.propertyName,
      unit: c.unitNumber,
      crew: c.crewName,
      job: c.jobNo,
      status: c.status,
    })),
    workAppNotes: evidence
      .filter((e) => args.properties.some((p) => (e.propertyName ?? "").toLowerCase().includes(p.name.toLowerCase().replace(/^caf demo\s*[—–-]\s*/, ""))))
      .slice(0, 24)
      .map((e) => ({
        kind: e.kind,
        property: e.propertyName,
        unit: e.unitLabel,
        title: e.title,
      })),
  };

  try {
    const answer = await completeText(
      "You are a concise client-board guide for a multifamily turn portfolio. Answer ONLY from the JSON snapshot (HALO jobs + Base44 Work App projection). No raw JSON in the reply. If the snapshot lacks it, say so. Two to five short sentences. Suggest which card to open: Vacancy, Turns, Photos, Crew, Needs you, or the full board.",
      `Snapshot:\n${JSON.stringify(snapshot)}\n\nQuestion: ${args.question}`,
      512,
    );
    if (answer.trim()) return { answer: answer.trim() };
  } catch {
    /* fall through */
  }

  const bits = [
    `${snapshot.unitsInTurn} units in turn across ${snapshot.communities.length} communities.`,
    snapshot.crewToday.length
      ? `${snapshot.crewToday.length} crew job${snapshot.crewToday.length === 1 ? "" : "s"} on the book today.`
      : "No crews scheduled today.",
    snapshot.workAppPhotoUnits
      ? `${snapshot.workAppPhotoUnits} units have Work App before/after photos.`
      : "No Work App photos yet.",
  ];
  return { answer: bits.join(" ") };
}
