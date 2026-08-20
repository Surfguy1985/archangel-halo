/**
 * Crew links & approvals — the office side of the shared crew QR.
 *
 * Crews scan the one roster code in the field and tap their own name; every tap
 * lands here as a request. The office is rarely standing next to them, so this
 * page exists on the desktop app too — approving from a laptop in another city
 * is the normal case, not the exception.
 *
 * Below the approvals sits the same scannable board the phone app prints: one
 * card per foreman (their crew listed underneath in the foreman's colour), one
 * per Archangel staff member, one per independent. Each QR encodes that
 * person's permanent portal link — the tokens are never rotated.
 */

import { useEffect, useState } from "react";
import {
  useBuildCrewLinkBoard,
  useListCrewPortalClaims,
  useDecideCrewPortalClaim,
} from "@workspace/api-client-react";
import { CrewQrCode, normalizeCrewPortalLink } from "@workspace/board-ui";
import { Loader2, Printer, Link2, Check, X, BellRing } from "lucide-react";
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
  { kind: "staff", title: "Archangel", blurb: "Owners and employees. Gold pins on every map." },
  {
    kind: "team",
    title: "Foremen",
    blurb: "One link per foreman. Their crew shares the foreman's pin colour.",
  },
  { kind: "independent", title: "Subs & independents", blurb: "Everyone else with their own link." },
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

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast({ title: "Couldn't copy — select the link instead", variant: "destructive" });
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[var(--hairline)] px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-black/[0.04] print:hidden"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}

/**
 * Requests waiting on the office.
 *
 * Exported so the Crews page can carry it at the top: the shared code lets
 * anyone pick a name, and nothing behind the portal — pay, invoices, payment
 * details — opens until someone approves it here. It polls, because the office
 * is usually looking at another screen when a crew scans.
 */
export function ClaimsPanel({ compact = false }: { compact?: boolean }) {
  const claims = useListCrewPortalClaims({
    query: {
      queryKey: ["crew-portal-claims"],
      refetchInterval: 20000,
      refetchOnWindowFocus: true,
    },
  });
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

  // On the Crews page this is a banner, so it stays out of the way until
  // somebody is actually waiting.
  if (compact && !pending.length) return null;
  if (!pending.length && !recent.length) return null;

  return (
    <section
      className="rounded-2xl border border-amber-300 bg-amber-50 p-5 print:hidden"
      data-testid="crew-claims-panel"
    >
      <h2 className="flex items-center gap-2 font-display text-[17px] font-bold text-slate-900">
        {pending.length ? <BellRing className="h-4 w-4 text-amber-600" /> : null}
        Waiting on you{pending.length ? ` (${pending.length})` : ""}
      </h2>
      <p className="mt-0.5 text-[12px] text-amber-800">
        A crew scanned the shared code and picked a name. Nobody sees their pay until you approve
        them here.
      </p>

      {pending.length ? (
        <div className="mt-3 space-y-2">
          {pending.map((claim) => (
            <div
              key={claim.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-white p-3"
              data-testid={`crew-claim-${claim.id}`}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold text-slate-900">
                  {claim.crewName}
                </div>
                <div className="truncate text-[12px] text-slate-500">
                  {[
                    claim.requestedName && claim.requestedName !== claim.crewName
                      ? `Typed "${claim.requestedName}"`
                      : null,
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
                  data-testid={`deny-claim-${claim.id}`}
                >
                  <X className="h-3.5 w-3.5" />
                  Deny
                </button>
                <button
                  type="button"
                  disabled={decide.isPending}
                  onClick={() => act(claim, "approve")}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-60"
                  data-testid={`approve-claim-${claim.id}`}
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

      {!compact && recent.length ? (
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
 * The one code for everybody. Scanning it opens the pick-your-name page; the
 * approval panel above is the only gate, so the code itself carries no secret
 * beyond "you were handed this".
 *
 * The roster page is served by the root app, so the URL is origin + path —
 * never prefixed with this app's /desktop/ base.
 */
function RosterCard({ path }: { path: string | null }) {
  const url = path ? `${window.location.origin}${path}` : "";
  if (!url) return null;

  return (
    <section className="rounded-2xl border-2 border-[var(--ink)] bg-white p-5 print:break-inside-avoid">
      <h2 className="font-display text-[17px] font-bold text-[var(--ink)]">One code for everyone</h2>
      <p className="mt-0.5 text-[12px] text-muted-foreground">
        Print it once and hang it in the shop. Anyone scans it, taps their own name, and gets their
        own permanent link. Not on the list? They add themselves and pick their foreman.
      </p>
      <div className="mt-4 flex items-center gap-5">
        <CrewQrCode url={url} size={168} dark="#0F1B2D" label="Crew roster QR" />
        <div className="min-w-0 flex-1">
          <div className="break-all rounded-lg bg-black/[0.04] p-2 font-mono text-[11px] text-muted-foreground">
            {url}
          </div>
          <CopyLink url={url} />
          <p className="mt-2 text-[11px] leading-snug text-amber-700">
            No password on it — whoever holds this code can request a link as anyone on the roster.
            Your approval above is what ties a phone to a person.
          </p>
        </div>
      </div>
    </section>
  );
}

function TeamCard({ team }: { team: Team }) {
  const url = normalizeCrewPortalLink(team.portalPath) ?? "";

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
          <div className="truncate font-display text-[15px] font-bold text-[var(--ink)]">
            {team.name}
          </div>
          <div className="text-[12px] text-muted-foreground">
            {[team.role, team.trade].filter(Boolean).join(" · ") ||
              (team.kind === "staff" ? "Archangel" : "Crew")}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-4">
        {url ? (
          <CrewQrCode url={url} size={132} dark="#0F1B2D" label={`Portal QR for ${team.name}`} />
        ) : (
          <div className="grid h-[132px] w-[132px] place-items-center rounded-xl bg-black/[0.04] p-3 text-center text-[11px] text-muted-foreground">
            {team.linkIssued
              ? "Link already issued and can't be shown again. Re-issue it from this crew's page — the old one stops working."
              : "No link yet — open this crew and generate one."}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[12px] leading-snug text-muted-foreground">
            Scan, then <strong>Add to Home Screen</strong>. This link never changes.
          </p>
          {url ? (
            <>
              <div className="mt-2 break-all rounded-lg bg-black/[0.04] p-2 font-mono text-[10px] text-muted-foreground">
                {url}
              </div>
              <CopyLink url={url} />
            </>
          ) : null}
        </div>
      </div>

      {team.members.length > 0 ? (
        <div className="mt-3 border-t border-[var(--hairline)] pt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Crew ({team.members.length}) — same pin colour
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {team.members.map((m) => (
              <span
                key={m.id}
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium"
                style={{ background: `${team.pinColor}1A`, color: "#0F1B2D" }}
              >
                <i className="h-2 w-2 rounded-full" style={{ background: team.pinColor }} aria-hidden />
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
  const board = useBuildCrewLinkBoard();
  const { mutate } = board;

  // The board mints portal tokens for anyone missing one, so it's a POST —
  // fired once on open rather than polled.
  useEffect(() => {
    mutate();
  }, [mutate]);

  const teams = (board.data?.teams ?? []) as Team[];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-8 animate-in fade-in duration-500">
      <header className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="font-display text-[32px] font-bold tracking-[-0.02em] text-[var(--ink)]">
            Crew links
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Approve the phones that scanned, and hand out every crew's permanent QR.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-full border border-[var(--hairline)] px-5 py-2.5 text-sm font-bold text-[var(--ink)] hover:bg-black/[0.04]"
        >
          <Printer className="h-4 w-4" />
          Print
        </button>
      </header>

      <ClaimsPanel />

      {board.isPending ? (
        <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Building the board…
        </div>
      ) : board.isError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-[13px] text-rose-700">
          Couldn't load the roster.{" "}
          <button type="button" className="underline" onClick={() => mutate()}>
            Try again
          </button>
        </div>
      ) : (
        <>
          <RosterCard path={board.data?.rosterPath ?? null} />
          {SECTIONS.map((section) => {
            const rows = teams.filter((t) => t.kind === section.kind);
            if (!rows.length) return null;
            return (
              <section key={section.kind}>
                <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {section.title}
                </h2>
                <p className="mb-3 text-[12px] text-muted-foreground/70">{section.blurb}</p>
                <div className="grid gap-3 md:grid-cols-2">
                  {rows.map((team) => (
                    <TeamCard key={team.id} team={team} />
                  ))}
                </div>
              </section>
            );
          })}
          {teams.length === 0 ? (
            <p className="py-16 text-center text-[13px] text-muted-foreground">No active crews yet.</p>
          ) : null}
        </>
      )}
    </div>
  );
}
