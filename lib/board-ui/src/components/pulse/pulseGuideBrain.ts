/**
 * Local Pulse guide — answers from the boards already on screen and
 * opens the matching module. No HALO black-screen chat.
 */

export type GuidePanelId =
  | "chat"
  | "vacancy"
  | "turns"
  | "photos"
  | "overview"
  | "sites"
  | "attention"
  | "crew"
  | "range"
  | "compliance"
  | "activity"
  | "tools";

export type GuideAction =
  | { type: "open"; panel: GuidePanelId }
  | { type: "select"; propertyId: string }
  | { type: "kanban" }
  | { type: "turns"; propertyId?: string };

export type GuideSite = {
  propertyId: string;
  name: string;
  city?: string | null;
  unitsInTurn: number;
  statusLabel: string;
  vacancyCostCents: string;
};

export type GuideTurn = {
  propertyId: string;
  propertyName: string;
  unitNumber: string;
  days: number;
};

export type GuideCrew = {
  propertyId: string;
  propertyName: string;
  unitNumber: string | null;
  crewName: string;
  status: string;
};

export type GuideContext = {
  title: string;
  vacancyLabel?: string;
  vacancyCostCents?: string;
  unitsInTurn?: number;
  medianTurnDays?: number | null;
  sites: GuideSite[];
  turns: GuideTurn[];
  photoCount: number;
  attentionCount: number;
  crew: GuideCrew[];
};

export type GuideReply = {
  answer: string;
  actions: GuideAction[];
};

const HELP =
  "Type a community, a unit, or what you need — vacancy, turns, photos, crew, or the board. I’ll open the right card and answer from today’s live numbers.";

export function interpretPulseQuestion(raw: string, ctx: GuideContext): GuideReply {
  const q = raw.trim().toLowerCase();
  if (!q) return { answer: HELP, actions: [{ type: "open", panel: "chat" }] };

  const site = matchSite(q, ctx.sites);
  const unit = matchUnit(q, ctx.turns);

  if (/\b(help|how (do|does|to)|what can|instructions?|guide)\b/.test(q)) {
    return { answer: HELP, actions: [{ type: "open", panel: "chat" }] };
  }
  if (/\b(kanban|board|full flow|workflow|lanes?)\b/.test(q)) {
    return {
      answer: "Opening the full board — same lanes as before, left to right.",
      actions: [{ type: "kanban" }],
    };
  }
  if (/\b(photo|before|after|picture|image)\b/.test(q)) {
    const actions: GuideAction[] = [{ type: "open", panel: "photos" }];
    if (site) actions.unshift({ type: "select", propertyId: site.propertyId });
    const n = ctx.photoCount;
    return {
      answer:
        n === 0
          ? "No before/after photos for these communities yet."
          : `${n} unit${n === 1 ? "" : "s"} have before/after photos.${site ? ` Showing ${site.name}.` : ""}`,
      actions,
    };
  }
  if (/\b(crew|gps|who.?s on|on site|where.?s the crew|dispatch)\b/.test(q)) {
    const actions: GuideAction[] = [{ type: "open", panel: "crew" }];
    if (site) actions.unshift({ type: "select", propertyId: site.propertyId });
    const rows = site ? ctx.crew.filter((c) => c.propertyId === site.propertyId) : ctx.crew;
    if (rows.length === 0) {
      return {
        answer: site
          ? `No crew is scheduled at ${site.name} today.`
          : "No crews are scheduled on these communities today.",
        actions,
      };
    }
    const line = rows
      .slice(0, 4)
      .map((c) => `${c.crewName} · ${c.propertyName}${c.unitNumber ? ` unit ${c.unitNumber}` : ""}`)
      .join("; ");
    return { answer: `On site today: ${line}.`, actions };
  }
  if (/\b(vacanc|rent lost|dollar|money|cost)\b/.test(q)) {
    return {
      answer: ctx.vacancyCostCents
        ? `Vacancy this window is ${ctx.vacancyLabel ?? "rent lost to vacant days"} — open the vacancy figure in the header.`
        : "Vacancy for this window is the figure in the header.",
      actions: [{ type: "open", panel: "vacancy" }, ...(site ? [{ type: "select" as const, propertyId: site.propertyId }] : [])],
    };
  }
  if (/\b(need(s)? you|stall|approv|waiting|late|rework|qc)\b/.test(q)) {
    return {
      answer:
        ctx.attentionCount === 0
          ? "Nothing is waiting on you right now."
          : `${ctx.attentionCount} item${ctx.attentionCount === 1 ? "" : "s"} need you — stalled turns, approvals, or blocked invoices.`,
      actions: [{ type: "open", panel: "attention" }],
    };
  }
  if (/\b(compliance|invoice|variance|price list)\b/.test(q)) {
    return {
      answer: "Invoice compliance is on its own card — matched lines versus anything off-schedule.",
      actions: [{ type: "open", panel: "compliance" }],
    };
  }
  if (/\b(overview|median|target|units in turn)\b/.test(q)) {
    return {
      answer:
        ctx.unitsInTurn != null
          ? `${ctx.unitsInTurn} units in turn${ctx.medianTurnDays != null ? `, median ${ctx.medianTurnDays} days` : ""}.`
          : "Overview has units in turn, median days, and the target.",
      actions: [{ type: "open", panel: "overview" }],
    };
  }
  if (unit) {
    return {
      answer: `Unit ${unit.unitNumber} at ${unit.propertyName} has been vacant ${unit.days} day${unit.days === 1 ? "" : "s"}. Opening turns.`,
      actions: [
        { type: "select", propertyId: unit.propertyId },
        { type: "open", panel: "turns" },
        { type: "turns", propertyId: unit.propertyId },
      ],
    };
  }
  if (/\b(turn|vacant|move-?out|ready|po)\b/.test(q) || site) {
    const actions: GuideAction[] = [{ type: "open", panel: site ? "sites" : "turns" }];
    if (site) {
      actions.unshift({ type: "select", propertyId: site.propertyId });
      actions.push({ type: "open", panel: "turns" });
      return {
        answer: `${site.name}${site.city ? ` · ${site.city}` : ""} — ${site.unitsInTurn} in turn, ${site.statusLabel}.`,
        actions,
      };
    }
    const n = ctx.turns.length;
    return {
      answer: n === 0 ? "No open turns in this window." : `${n} open turn${n === 1 ? "" : "s"} with live vacant clocks.`,
      actions: [{ type: "open", panel: "turns" }],
    };
  }

  return {
    answer: `${HELP} Right now: ${ctx.unitsInTurn ?? 0} units in turn across ${ctx.sites.length} communit${ctx.sites.length === 1 ? "y" : "ies"}.`,
    actions: [{ type: "open", panel: "chat" }],
  };
}

function matchSite(q: string, sites: GuideSite[]): GuideSite | undefined {
  return sites.find((s) => {
    const name = s.name.toLowerCase();
    const city = (s.city ?? "").toLowerCase();
    const short = name.replace(/^caf\s+demo\s*[—–-]\s*/, "");
    return (short.length > 2 && q.includes(short)) || (name.length > 3 && q.includes(name)) || (city.length > 3 && q.includes(city));
  });
}

function matchUnit(q: string, turns: GuideTurn[]): GuideTurn | undefined {
  const m = q.match(/\b(?:unit|#)\s*([a-z0-9-]+)\b/i) ?? q.match(/\b(\d{2,5}[a-z]?)\b/i);
  if (!m) return undefined;
  const key = m[1].toLowerCase();
  return turns.find((t) => t.unitNumber.toLowerCase() === key);
}
