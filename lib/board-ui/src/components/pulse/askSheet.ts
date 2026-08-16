/**
 * Ask worksheet — 5th-grade layout for Pulse answers.
 * Short bullets. Underlined titles. Color by meaning.
 * A mini board when the kanban can show it faster than a paragraph.
 */

import { formatUsdCents } from "./formatUsdCents";
import type { AskIntent } from "./askReason";
import type { GuideAction, GuideContext, GuideNeed } from "./pulseGuideBrain";

export type SheetTone = "you" | "fire" | "clock" | "site" | "place" | "fact";

export type AskSheetSection = {
  id: string;
  title: string;
  tone: SheetTone;
  bullets: string[];
};

export type AskSheetChip = {
  id: string;
  label: string;
  hint: string;
  tone: SheetTone;
  action: GuideAction;
};

export type AskSheetLane = {
  id: string;
  title: string;
  tone: SheetTone;
  chips: AskSheetChip[];
};

export type AskSheet = {
  headline: string;
  kicker: string;
  place?: string;
  sections: AskSheetSection[];
  lanes: AskSheetLane[];
};

const YOU = new Set(["awaiting_approval", "variance_pending"]);
const FIRE = new Set(["stalled", "failed_qc", "blocked_invoices"]);

function shortName(name: string): string {
  return name.replace(/^caf\s+demo\s*[—–-]\s*/i, "").trim();
}

export function kidLine(raw: string, maxWords = 8): string {
  let t = raw
    .replace(/\b(HALO|Work App|Falkon|Base44)\b/gi, "")
    .replace(/\bawaiting[_\s-]?approval\b/gi, "needs your name")
    .replace(/\bwaiting on you\b/gi, "needs your name")
    .replace(/\bwaiting on a price exception\b/gi, "needs a price yes or no")
    .replace(/\bvariance[_\s-]?pending\b/gi, "needs a price yes or no")
    .replace(/\bblocked[_\s-]?invoices?\b/gi, "bill is stuck")
    .replace(/\bfailed[_\s-]?qc\b/gi, "needs another look")
    .replace(/\bstalled\b/gi, "stuck")
    .replace(/\bdays vacant\b/gi, "empty days")
    .replace(/\bvacant days?\b/gi, "empty days")
    .replace(/\bmedian\b/gi, "typical")
    .replace(/\bthis window\b/gi, "this month")
    .replace(/\bvacancy\b/gi, "empty-home rent")
    .replace(/\s+/g, " ")
    .trim();
  const words = t.split(" ").filter(Boolean);
  if (words.length > maxWords) t = words.slice(0, maxWords).join(" ");
  return t.replace(/[.,;:]+$/, "");
}

export function kidBullets(text: string, max = 4): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => kidLine(s))
    .filter((s) => s.length > 2)
    .slice(0, max);
}

function kidNeed(kind: string, days: number): string {
  const d = days === 1 ? "1 day" : `${days} days`;
  if (kind === "awaiting_approval") return `Needs your name · ${d}`;
  if (kind === "variance_pending") return `Price yes or no · ${d}`;
  if (kind === "stalled") return `Stuck · ${d}`;
  if (kind === "failed_qc") return `Needs another look · ${d}`;
  if (kind === "blocked_invoices") return `Bill is stuck · ${d}`;
  return `Needs you · ${d}`;
}

function toneForNeed(kind: string): SheetTone {
  if (YOU.has(kind)) return "you";
  if (FIRE.has(kind)) return "fire";
  return "fact";
}

function uniqueBullets(rows: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const k = row.toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  return out;
}

function addSection(sections: AskSheetSection[], id: string, title: string, tone: SheetTone, bullets: string[]) {
  const clean = uniqueBullets(bullets.map((b) => kidLine(b)).filter(Boolean)).slice(0, 4);
  if (!clean.length) return;
  sections.push({ id, title, tone, bullets: clean });
}

export function askLanes(ctx: GuideContext, focusUnit?: string | null): AskSheetLane[] {
  const used = new Set<string>();
  const chip = (
    id: string,
    label: string,
    hint: string,
    tone: SheetTone,
    action: GuideAction,
  ): AskSheetChip => ({ id, label, hint, tone, action });

  const you: AskSheetChip[] = [];
  for (const n of ctx.needs ?? []) {
    if (!YOU.has(n.kind)) continue;
    used.add(`${n.propertyId}:${n.unitNumber}`);
    you.push(
      chip(
        `you-${n.propertyId}-${n.unitNumber}`,
        n.unitNumber,
        kidNeed(n.kind, n.days),
        "you",
        { type: "open", panel: "attention" },
      ),
    );
  }

  const fire: AskSheetChip[] = [];
  for (const n of ctx.needs ?? []) {
    const key = `${n.propertyId}:${n.unitNumber}`;
    if (used.has(key) || (!FIRE.has(n.kind) && n.days < 10)) continue;
    used.add(key);
    fire.push(
      chip(
        `fire-${n.propertyId}-${n.unitNumber}`,
        n.unitNumber,
        kidNeed(n.kind, n.days),
        "fire",
        { type: "open", panel: "attention" },
      ),
    );
  }

  const work: AskSheetChip[] = [];
  for (const c of ctx.crew) {
    const key = `${c.propertyId}:${c.unitNumber ?? c.crewName}`;
    if (used.has(key) && c.unitNumber) {
      /* still show people even if the unit is in another lane */
    }
    work.push(
      chip(
        `work-${c.propertyId}-${c.unitNumber ?? c.crewName}`,
        c.unitNumber || c.crewName,
        `${c.crewName} is working`,
        "site",
        { type: "open", panel: "crew" },
      ),
    );
  }

  const clock: AskSheetChip[] = [];
  for (const t of [...ctx.turns].sort((a, b) => b.days - a.days)) {
    const key = `${t.propertyId}:${t.unitNumber}`;
    if (used.has(key)) continue;
    used.add(key);
    clock.push(
      chip(
        `clock-${t.propertyId}-${t.unitNumber}`,
        t.unitNumber,
        `${t.days} empty days`,
        "clock",
        { type: "open", panel: "turns" },
      ),
    );
  }

  const pin = (chips: AskSheetChip[]) => {
    if (!focusUnit) return chips.slice(0, 4);
    const hit = chips.filter((c) => c.label.toLowerCase() === focusUnit.toLowerCase());
    const rest = chips.filter((c) => c.label.toLowerCase() !== focusUnit.toLowerCase());
    return [...hit, ...rest].slice(0, 4);
  };

  const lanes: AskSheetLane[] = [];
  if (you.length) lanes.push({ id: "you", title: "Needs you", tone: "you", chips: pin(you) });
  if (fire.length) lanes.push({ id: "fire", title: "On fire", tone: "fire", chips: pin(fire) });
  if (work.length) lanes.push({ id: "work", title: "Working", tone: "site", chips: pin(work) });
  if (clock.length) lanes.push({ id: "clock", title: "Empty clock", tone: "clock", chips: pin(clock) });
  return lanes.slice(0, 4);
}

function showBoard(intent: AskIntent, lanes: AskSheetLane[]): boolean {
  if (intent === "photos" || intent === "help" || intent === "vacancy") return false;
  const chips = lanes.reduce((n, l) => n + l.chips.length, 0);
  if (intent === "board" || intent === "compare" || intent === "brief" || intent === "next") return chips >= 1;
  return chips >= 2;
}

export function buildAskSheet(args: {
  ctx: GuideContext;
  intent: AskIntent;
  answer: string;
  why?: string[];
  unitNumber?: string | null;
  propertyId?: string | null;
  serverSections?: Array<{ title?: string; tone?: string; bullets?: string[] }>;
}): AskSheet {
  const { ctx, intent } = args;
  const need =
    ctx.needs?.find((n) => n.unitNumber === args.unitNumber) ??
    ctx.needs?.[0];
  const turn =
    ctx.turns.find((t) => t.unitNumber === args.unitNumber) ??
    ctx.turns[0];
  const site =
    ctx.sites.find((s) => s.propertyId === args.propertyId) ??
    ctx.sites.find((s) => s.propertyId === need?.propertyId || s.propertyId === turn?.propertyId) ??
    ctx.sites[0];
  const place = site ? shortName(site.name) : shortName(need?.propertyName || turn?.propertyName || ctx.title);
  const unit = args.unitNumber || need?.unitNumber || turn?.unitNumber;
  const lanes = askLanes(ctx, unit);

  const headline = unit
    ? `Start here: ${place} ${unit}`
    : intent === "help"
      ? "Ask a small question"
      : "Here is today";

  const kicker =
    intent === "photos"
      ? "Pictures"
      : intent === "on_site"
        ? "People"
        : intent === "vacancy"
          ? "Empty-home rent"
          : intent === "compare"
            ? "Two places"
            : intent === "board"
              ? "The board"
              : "Today";

  const sections: AskSheetSection[] = [];

  if (args.serverSections?.length) {
    for (const row of args.serverSections.slice(0, 4)) {
      const tone = (["you", "fire", "clock", "site", "place", "fact"] as const).includes(row.tone as SheetTone)
        ? (row.tone as SheetTone)
        : "fact";
      addSection(sections, `srv-${row.title ?? sections.length}`, kidLine(row.title || "Note", 3), tone, (row.bullets ?? []).map(String));
    }
    return {
      headline: kidLine(headline, 6),
      kicker,
      place,
      sections: sections.slice(0, 4),
      lanes: showBoard(intent, lanes) ? lanes : [],
    };
  }

  if (need) {
    addSection(sections, "you", "Needs you", toneForNeed(need.kind), [
      `${shortName(need.propertyName)} ${need.unitNumber}`,
      kidNeed(need.kind, need.days),
      YOU.has(need.kind) ? "Put your name on it" : "Unstick this unit",
    ]);
  }

  if (turn) {
    addSection(sections, "clock", "Empty clock", "clock", [
      `${shortName(turn.propertyName)} ${turn.unitNumber}`,
      `${turn.days} empty days`,
      "Rent stops when the unit is ready",
    ]);
  }

  const crew = args.propertyId
    ? ctx.crew.filter((c) => c.propertyId === args.propertyId)
    : ctx.crew;
  if (crew[0] && (intent === "on_site" || intent === "brief" || intent === "next" || !need)) {
    addSection(
      sections,
      "people",
      "People today",
      "site",
      crew.slice(0, 3).map((c) => `${c.crewName} at ${c.unitNumber || shortName(c.propertyName)}`),
    );
  }

  if (intent === "vacancy" || intent === "brief" || intent === "compare") {
    const cents = site?.vacancyCostCents || ctx.vacancyCostCents;
    const vac = cents ? formatUsdCents(cents) : null;
    const facts: string[] = [];
    if (vac && vac !== "$—") facts.push(`Empty-home rent ${vac}`);
    if (site) facts.push(`${site.unitsInTurn} units being fixed`);
    else if (ctx.unitsInTurn != null) facts.push(`${ctx.unitsInTurn} units being fixed`);
    if (ctx.medianTurnDays != null) facts.push(`Typical wait ${ctx.medianTurnDays} days`);
    addSection(sections, "rent", "This month", "place", facts);
  }

  if (intent === "photos") {
    addSection(sections, "pics", "Pictures", "fact", [
      ctx.photoCount === 0 ? "No before and after yet" : `${ctx.photoCount} units have pictures`,
      "These are real field photos",
    ]);
  }

  if (intent === "compare") {
    for (const s of ctx.sites.slice(0, 2)) {
      const n = (ctx.needs ?? []).find((x) => x.propertyId === s.propertyId);
      addSection(sections, `place-${s.propertyId}`, shortName(s.name), n ? toneForNeed(n.kind) : "place", [
        `${s.unitsInTurn} units being fixed`,
        n ? kidNeed(n.kind, n.days) : "No wait on you",
      ]);
    }
  }

  if (intent === "help") {
    addSection(sections, "help", "You can ask", "fact", [
      "What is on fire",
      "Who is working today",
      "What needs my name",
    ]);
  }

  if (!sections.length) {
    addSection(sections, "found", "What I found", "fact", [
      ...kidBullets(args.answer),
      ...(args.why ?? []).map((w) => kidLine(w)),
    ]);
  }

  return {
    headline: kidLine(headline, 6),
    kicker,
    place,
    sections: sections.slice(0, 5),
    lanes: showBoard(intent, lanes) ? lanes : [],
  };
}

export function needTone(need?: GuideNeed | null): SheetTone {
  return need ? toneForNeed(need.kind) : "fact";
}
