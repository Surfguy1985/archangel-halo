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
import {
  useBuildCrewLinkBoard,
  useListCrewPortalClaims,
  useDecideCrewPortalClaim,
} from "@workspace/api-client-react";
import { CrewQrCode, normalizeCrewPortalLink } from "@workspace/board-ui";
import { Loader2, Printer, Link2, Check, ArrowLeft, X } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

type Claim = {
  id: string;
  crewId: string;
  crewName: string;
  requestedName?: string | null;
  trade?: string | null;
  foremanName?: string | null;
  status: string;
  createdAt: string;
  decidedAt?: string | null;
};
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

/**
 * Requests waiting on the office.
 *
 * The shared code lets anyone pick a name, so the office decides who actually
 * gets in. Nothing behind the portal — pay, invoices, payment details — opens
 * until a request here is approved.
 */
function ClaimsPanel() {
  const claims = useListCrewPortalClaims();
  const decide = useDecideCrewPortalClaim();
  const { toast } = useToast();

  const rows = (claims.data ?? []) as Claim[];
  const pending = rows.filter((c) => c.status === "pending");
  const recent = rows.filter((c) => c.status !== "pending").slice(0, 5);

  const act = (claim: Claim, decision: "approve" | "deny") => {
    decide.mutate(
      { id: claim.id, data: { decision } },
      {
        onSuccess: () => {
          claims.refetch();
          toast({
            title:
              decision === "approve"
                ? `${claim.crewName}'s phone is in`
                : `Turned down ${claim.crewName}'s request`,
          });
        },
        onError: () => toast({ title: "That request was already decided", variant: "destructive" }),
      },
    );
  };

  if (!pending.length && !recent.length) return null;

  return (
    <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 print:hidden">
      <h2 className="text-[15px] font-semibold text-slate-900">
        Waiting on you{pending.length ? ` (${pending.length})` : ""}
      </h2>
      <p className="text-[12px] text-amber-800">
        Anyone with the code can pick a name — nobody sees their pay until you approve them here.
      </p>

      {pending.length ? (
        <div className="mt-3 space-y-2">
          {pending.map((claim) => (
            <div
              key={claim.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-white p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold text-slate-900">
                  {claim.crewName}
                </div>
                <div className="truncate text-[12px] text-slate-500">
                  {[
                    claim.foremanName ? `Reports to ${claim.foremanName}` : null,
                    claim.trade,
                    new Date(claim.createdAt).toLocaleString(),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={decide.isPending}
                  onClick={() => act(claim, "deny")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-[13px] font-medium text-slate-600 disabled:opacity-60"
                >
                  <X className="h-3.5 w-3.5" />
                  Deny
                </button>
                <button
                  type="button"
                  disabled={decide.isPending}
                  onClick={() => act(claim, "approve")}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-60"
                >
                  <Check className="h-3.5 w-3.5" />
                  Approve
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-slate-600">Nothing waiting right now.</p>
      )}

      {recent.length ? (
        <div className="mt-3 border-t border-amber-200 pt-2 text-[12px] text-amber-900">
          {recent.map((c) => (
            <div key={c.id} className="truncate">
              {c.status === "approved" ? "Approved" : "Denied"} · {c.crewName} ·{" "}
              {new Date(c.decidedAt ?? c.createdAt).toLocaleDateString()}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/**
 * The one code for everybody. Scanning it opens a pick-your-name page; whoever
 * taps a name asks the office for that person's portal link. There is no
 * passcode on the code itself — the approval step above is the gate.
 */
function RosterCard({ path }: { path: string | null }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const url = path ? `${window.location.origin}${path}` : "";

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

  if (!url) return null;

  return (
    <section className="rounded-2xl border-2 border-slate-900 bg-white p-4 print:break-inside-avoid">
      <h2 className="text-[15px] font-semibold text-slate-900">One code for everyone</h2>
      <p className="text-[12px] text-slate-500">
        Print this once. Anyone scans it, taps their own name, and gets their own permanent link.
        Not on the list? They add themselves and pick their foreman.
      </p>
      <div className="mt-3 flex items-center gap-4">
        <CrewQrCode url={url} size={150} dark="#0F1B2D" label="Crew roster QR" />
        <div className="min-w-0 flex-1">
          <div className="break-all rounded-lg bg-slate-50 p-2 font-mono text-[10px] text-slate-500">
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
          <p className="mt-2 text-[11px] leading-snug text-amber-700">
            No password on it — whoever holds this code can open any crew member's portal.
          </p>
        </div>
      </div>
    </section>
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
          <ClaimsPanel />
          <RosterCard path={board.data?.rosterPath ?? null} />
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
