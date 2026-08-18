/**
 * Crew Links — the whole roster on one scannable board.
 *
 * One card per foreman (their crew listed underneath, all in the foreman's
 * colour), one gold card per Archangel owner or employee, one per independent.
 * Each card's QR encodes that person's permanent portal link, so a crew can
 * scan it once, add it to their home screen, and it keeps working forever —
 * the tokens are never rotated.
 *
 * The colours here are the same ones the map draws: what the office sees on a
 * card is what it sees on a pin.
 */

import { useEffect } from "react";
import { useBuildCrewLinkBoard } from "@workspace/api-client-react";
import { CrewQrCode, normalizeCrewPortalLink } from "@workspace/board-ui";
import { Loader2, Printer, Link2, Check, ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

type Member = { id: string; name: string; role?: string | null; trade?: string | null };
type Team = {
  id: string;
  name: string;
  kind: string;
  role?: string | null;
  trade?: string | null;
  phone?: string | null;
  pinColor: string;
  portalPath?: string | null;
  linkIssued?: boolean | null;
  members: Member[];
};

const SECTIONS: { kind: string; title: string; blurb: string }[] = [
  {
    kind: "staff",
    title: "Archangel",
    blurb: "Owners and employees. Gold pins on every map.",
  },
  {
    kind: "team",
    title: "Foremen",
    blurb: "One link per foreman. Their crew shares the foreman's pin colour.",
  },
  {
    kind: "independent",
    title: "Subs & independents",
    blurb: "Everyone else with their own link.",
  },
];

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
}

function TeamCard({ team }: { team: Team }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const url = normalizeCrewPortalLink(team.portalPath) ?? "";

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast({ title: "Couldn't copy — long-press the link instead", variant: "destructive" });
    }
  };

  return (
    <div
      className="rounded-2xl border bg-white p-4 print:break-inside-avoid"
      style={{ borderColor: `${team.pinColor}55`, boxShadow: `inset 0 3px 0 0 ${team.pinColor}` }}
    >
      <div className="flex items-start gap-3">
        <div
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[13px] font-bold text-white"
          style={{ background: team.pinColor }}
        >
          {initials(team.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-slate-900">{team.name}</div>
          <div className="text-[12px] text-slate-500">
            {[team.role, team.trade].filter(Boolean).join(" · ") ||
              (team.kind === "staff" ? "Archangel" : "Crew")}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-4">
        {url ? (
          <CrewQrCode url={url} size={132} dark="#0F1B2D" label={`Portal QR for ${team.name}`} />
        ) : (
          <div className="grid h-[132px] w-[132px] place-items-center rounded-xl bg-slate-100 p-3 text-center text-[11px] text-slate-500">
            {team.linkIssued
              ? "Link already issued and can't be shown again. Re-issue it from this crew's page — the old one stops working."
              : "No link yet — open this crew and generate one."}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[12px] leading-snug text-slate-600">
            Scan, then <strong>Add to Home Screen</strong>. This link never changes.
          </p>
          {url ? (
            <>
              <div className="mt-2 break-all rounded-lg bg-slate-50 p-2 font-mono text-[10px] text-slate-500">
                {url}
              </div>
              <button
                type="button"
                onClick={copy}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] font-medium text-slate-700 print:hidden"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy link"}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {team.members.length > 0 ? (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Crew ({team.members.length}) — same pin colour
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {team.members.map((m) => (
              <span
                key={m.id}
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium"
                style={{ background: `${team.pinColor}1A`, color: "#0F1B2D" }}
              >
                <i
                  className="h-2 w-2 rounded-full"
                  style={{ background: team.pinColor }}
                  aria-hidden
                />
                {m.name}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function CrewLinks() {
  const [, navigate] = useLocation();
  const board = useBuildCrewLinkBoard();
  const { mutate } = board;

  // The board mints portal tokens for anyone missing one, so it's a POST —
  // fired once on open rather than polled.
  useEffect(() => {
    mutate();
  }, [mutate]);

  const teams = (board.data?.teams ?? []) as Team[];

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur print:hidden">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/crews")}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
            aria-label="Back to crews"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-[17px] font-semibold text-slate-900">Crew links</h1>
            <p className="text-[12px] text-slate-500">
              Every crew's permanent link and pin colour. Hand out the QRs.
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-[13px] font-medium text-slate-700"
          >
            <Printer className="h-4 w-4" />
            Print
          </button>
        </div>
      </header>

      {board.isPending ? (
        <div className="flex items-center justify-center gap-2 py-20 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          Building the board…
        </div>
      ) : board.isError ? (
        <div className="mx-4 mt-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-[13px] text-rose-700">
          Couldn't load the roster.{" "}
          <button type="button" className="underline" onClick={() => mutate()}>
            Try again
          </button>
        </div>
      ) : (
        <div className="space-y-6 px-4 py-5">
          {SECTIONS.map((section) => {
            const rows = teams.filter((t) => t.kind === section.kind);
            if (!rows.length) return null;
            return (
              <section key={section.kind}>
                <h2 className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">
                  {section.title}
                </h2>
                <p className="mb-3 text-[12px] text-slate-400">{section.blurb}</p>
                <div className="grid gap-3 md:grid-cols-2">
                  {rows.map((team) => (
                    <TeamCard key={team.id} team={team} />
                  ))}
                </div>
              </section>
            );
          })}
          {teams.length === 0 ? (
            <p className="py-16 text-center text-[13px] text-slate-400">No active crews yet.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
