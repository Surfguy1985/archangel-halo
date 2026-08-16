/**
 * Morning fork — the Ask decision packet.
 * Two paths in vacant DAYS (sign vs wait). Proof is Base44 already on the board.
 * Never mints a second vacancy dollar.
 */

import { reasonAsk } from "./askReason";
import type { GuideContext } from "./pulseGuideBrain";

export type AskFork = {
  site: string;
  unit: string;
  daysNow: number;
  extraDays: number;
  daysIfWait: number;
  method: "holt" | "plus-one";
  source: string;
  series: number[];
  wait: string;
  ifYouAct: string;
  ifYouWait: string;
  queued?: boolean;
  proof?: { title: string; before?: string; after?: string; src?: string };
};

function shortName(name: string): string {
  return name.replace(/^caf\s+demo\s*[—–-]\s*/i, "").trim();
}

function waitNoun(kind?: string | null): string {
  if (kind === "awaiting_approval") return "your signature";
  if (kind === "variance_pending") return "a price exception";
  return "this wait";
}

function proofFor(ctx: GuideContext, unit: string): AskFork["proof"] {
  const photo = (ctx.photos ?? []).find((p) => p.unitNumber.toLowerCase() === unit.toLowerCase());
  if (!photo || (!photo.beforeUrl && !photo.afterUrl)) return undefined;
  return {
    title: `${shortName(photo.propertyName)} · ${photo.unitNumber}`,
    before: photo.beforeUrl,
    after: photo.afterUrl,
    src: photo.afterUrl ?? photo.beforeUrl,
  };
}

export function askForkFromContext(
  ctx: GuideContext,
  unitNumber?: string | null,
  server?: Partial<AskFork> | null,
): AskFork | null {
  const unit =
    unitNumber ||
    server?.unit ||
    ctx.needs?.[0]?.unitNumber ||
    ctx.turns[0]?.unitNumber ||
    null;
  if (!unit) return null;
  const need = ctx.needs?.find((n) => n.unitNumber === unit);
  const turn = ctx.turns.find((t) => t.unitNumber === unit);
  const daysNow = server?.daysNow ?? turn?.days ?? need?.days;
  if (daysNow == null) return null;
  const extraDays = Math.max(1, server?.extraDays ?? 1);
  const wait = server?.wait ?? waitNoun(need?.kind);
  const waitCap = wait.charAt(0).toUpperCase() + wait.slice(1);
  const method = server?.method === "holt" ? "holt" : "plus-one";
  const series = (server?.series?.length ? server.series : [daysNow]).filter((n) => Number.isFinite(n));
  return {
    site: server?.site || shortName(need?.propertyName || turn?.propertyName || ctx.sites[0]?.name || ctx.title),
    unit,
    daysNow,
    extraDays,
    daysIfWait: server?.daysIfWait ?? daysNow + extraDays,
    method,
    source: server?.source || "none",
    series,
    wait,
    ifYouAct:
      server?.ifYouAct ||
      `${waitCap} leaves the ranking. The vacant clock still runs until ready — you just stop owning it.`,
    ifYouWait:
      server?.ifYouWait ||
      (method === "holt"
        ? `Still yours tomorrow. Holt says +${extraDays} vacant day${extraDays === 1 ? "" : "s"}.`
        : `Still yours tomorrow — +${extraDays} vacant day${extraDays === 1 ? "" : "s"}.`),
    queued: server?.queued,
    proof: server?.proof ?? proofFor(ctx, unit),
  };
}

export function askGhost(input: string, ctx: GuideContext): string | null {
  const q = input.trim();
  if (!q) {
    const need = ctx.needs?.[0];
    const turn = ctx.turns[0];
    if (need) {
      return `${shortName(need.propertyName)} · ${need.unitNumber} is waiting on you`;
    }
    if (turn) return `${shortName(turn.propertyName)} · ${turn.unitNumber} · day ${turn.days}`;
    return null;
  }
  const packet = reasonAsk(q, ctx, {});
  if (packet.focus.unitNumber) {
    const site =
      ctx.sites.find((s) => s.propertyId === packet.focus.propertyId)?.name ??
      ctx.turns.find((t) => t.unitNumber === packet.focus.unitNumber)?.propertyName ??
      "";
    return site
      ? `${shortName(site)} · ${packet.focus.unitNumber}`
      : `Unit ${packet.focus.unitNumber}`;
  }
  const line = packet.answer.replace(/\s+/g, " ").trim();
  return line ? line.slice(0, 72) : null;
}

export function sparkPoints(series: number[], width = 120, height = 36, pad = 4): string {
  const y = series.filter((n) => Number.isFinite(n));
  if (y.length < 2) return "";
  const min = Math.min(...y);
  const max = Math.max(...y);
  const span = Math.max(1, max - min);
  return y
    .map((n, i) => {
      const x = pad + (i / (y.length - 1)) * (width - pad * 2);
      const py = height - pad - ((n - min) / span) * (height - pad * 2);
      return `${x.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(" ");
}
