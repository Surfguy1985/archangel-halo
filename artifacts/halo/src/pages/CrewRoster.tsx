/**
 * One code for the whole crew.
 *
 * Everybody scans the same QR, lands here, and taps their own name. Because the
 * code itself proves nothing about who is holding the phone, the link that comes
 * back is dead until the office approves the request — behind that portal sit
 * the crew's pay, invoices and payment details, so the office's approval is what
 * ties a phone to a person. The page waits on that decision and then opens the
 * portal on its own.
 *
 * If a name isn't listed, the person adds themselves and picks the foreman they
 * report to, which is what gives them their team's pin colour. That, too, goes
 * to the office for approval.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  useGetCrewRoster,
  useGetCrewRosterClaim,
  useClaimCrewRosterSpot,
  useJoinCrewRoster,
} from "@workspace/api-client-react";
import { Loader2, ArrowRight, UserPlus, Plus, ArrowLeft, Clock, ShieldX, MapPin } from "lucide-react";
import { getPosition } from "@/hooks/useGpsTrail";

type Person = {
  id: string;
  name: string;
  color: string;
  trade?: string | null;
  isForeman?: boolean | null;
};
type Group = {
  key: string;
  title: string;
  subtitle?: string | null;
  color: string;
  leaderId?: string | null;
  people: Person[];
};
type Pending = { claimId: string; portalPath: string; name: string };

const APPROVED_KEY = "halo_roster_claim";
const PENDING_KEY = "halo_roster_pending";

function readStored<T>(key: string, valid: (v: unknown) => v is T): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return valid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

type Approved = { name: string; claimId?: string; portalPath?: string; openPath?: string };

const isApproved = (v: unknown): v is Approved => {
  if (typeof v !== "object" || v === null) return false;
  const r = v as { name?: unknown; openPath?: unknown; portalPath?: unknown };
  if (typeof r.name !== "string") return false;
  const paycard = typeof r.openPath === "string" && r.openPath.startsWith("/checkin/");
  // Written before this phone knew about paycards. Kept only so it can be
  // traded in for one below — it is never somewhere to send anybody.
  const legacy = typeof r.portalPath === "string" && r.portalPath.startsWith("/portal/");
  return paycard || legacy;
};

/**
 * The only place an approved phone is ever sent: that person's paycard —
 * unit, check in, before and after photos, check out. That is what they opened
 * their phone to do, and the published app has retired the wider crew portal
 * outright, so a remembered portal path is a dead end, not a fallback.
 */
const paycardOf = (v: Approved): string | null =>
  typeof v.openPath === "string" && v.openPath.startsWith("/checkin/") ? v.openPath : null;

const isPending = (v: unknown): v is Pending =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as { claimId?: unknown }).claimId === "string" &&
  typeof (v as { name?: unknown }).name === "string" &&
  typeof (v as { portalPath?: unknown }).portalPath === "string";

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode — the flow still works, it just won't be remembered */
  }
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
}

export default function CrewRoster({ code }: { code: string }) {
  const [, navigate] = useLocation();
  const [approved, setApproved] = useState(() => readStored(APPROVED_KEY, isApproved));
  const [pending, setPending] = useState(() => readStored(PENDING_KEY, isPending));
  const [denied, setDenied] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newLeader, setNewLeader] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<{
    kind: "pick" | "join";
    person?: Person;
    label: string;
    leaderId: string | null;
  } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationOff, setLocationOff] = useState(false);
  // Refs, not state: these decide things inside an async handler, where a
  // re-render is always one beat behind the second tap.
  const inFlight = useRef(false);
  const attempt = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const idle = !approved && !pending;
  const roster = useGetCrewRoster(code, {
    query: { queryKey: ["roster", code], enabled: idle },
  });
  const claim = useClaimCrewRosterSpot();
  const join = useJoinCrewRoster();

  // While the office decides, keep asking. Five seconds is fast enough that a
  // crew standing at the truck sees the portal open right after the tap.
  const status = useGetCrewRosterClaim(code, pending?.claimId ?? "", {
    query: {
      queryKey: ["roster-claim", code, pending?.claimId ?? ""],
      enabled: !!pending,
      refetchInterval: 5000,
    },
  });

  const groups = useMemo(() => (roster.data?.groups ?? []) as Group[], [roster.data]);

  // Every name on the roster is offered as "who do you report to", not just the
  // people already flagged as foremen — a new hire knows the name of the person
  // who runs their day, not how that person is filed in HALO. Foremen sit at the
  // top because that is the usual answer; the office fixes the rest on approval.
  const reportsTo = useMemo(() => {
    const seen = new Set<string>();
    const all: Person[] = [];
    for (const g of groups) {
      for (const p of g.people) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        all.push(p);
      }
    }
    const byName = (a: Person, b: Person) => a.name.localeCompare(b.name);
    return {
      foremen: all.filter((p) => p.isForeman).sort(byName),
      others: all.filter((p) => !p.isForeman).sort(byName),
    };
  }, [groups]);

  const paycard = approved ? paycardOf(approved) : null;

  // An approved phone that only remembers the retired portal — approved before
  // paycards, or mid-rollout. The office already said yes, so ask that same
  // claim where this person's paycard is rather than making them queue again.
  const stranded = approved && !paycard ? approved : null;
  const recovery = useGetCrewRosterClaim(code, stranded?.claimId ?? "", {
    query: {
      queryKey: ["roster-claim-recover", code, stranded?.claimId ?? ""],
      enabled: !!stranded?.claimId,
      refetchInterval: 5000,
    },
  });

  // A remembered, approved pick means this phone already belongs to someone —
  // send them straight in rather than making them find their name every morning.
  useEffect(() => {
    if (paycard) navigate(paycard, { replace: true });
  }, [paycard, navigate]);

  useEffect(() => {
    if (!stranded) return;
    // Nothing left to trade in: forget it and let them tap their name again.
    if (!stranded.claimId) {
      localStorage.removeItem(APPROVED_KEY);
      setApproved(null);
      return;
    }
    const found = recovery.data?.paycardPath;
    if (found) {
      const next = { ...stranded, openPath: found };
      write(APPROVED_KEY, next);
      setApproved(next);
      return;
    }
    if (recovery.isError) {
      localStorage.removeItem(APPROVED_KEY);
      setApproved(null);
    }
  }, [stranded, recovery.data, recovery.isError]);

  useEffect(() => {
    if (!pending || !status.data) return;
    if (status.data.status === "approved") {
      // Approved but no paycard yet means the link is still being cut. Keep
      // waiting: a phone parked on "the office is looking" recovers by itself,
      // a phone dropped on the retired portal just reads as a broken link.
      if (!status.data.paycardPath) return;
      const done = {
        name: pending.name,
        claimId: pending.claimId,
        portalPath: pending.portalPath,
        openPath: status.data.paycardPath,
      };
      write(APPROVED_KEY, done);
      localStorage.removeItem(PENDING_KEY);
      setPending(null);
      setApproved(done);
    } else if (status.data.status === "denied") {
      localStorage.removeItem(PENDING_KEY);
      setPending(null);
      setDenied(true);
    }
  }, [pending, status.data]);

  const startOver = () => {
    localStorage.removeItem(PENDING_KEY);
    localStorage.removeItem(APPROVED_KEY);
    setPending(null);
    setApproved(null);
    setDenied(false);
  };

  const sent = (res: { claimId: string; name: string; portalPath: string }) => {
    const next = { claimId: res.claimId, name: res.name, portalPath: res.portalPath };
    write(PENDING_KEY, next);
    setPending(next);
  };

  /**
   * Tapping a name doesn't send anything yet — it asks about location first.
   *
   * The phone will only show its permission dialog inside a tap, and burying
   * that behind a later screen means half the crew ends up invisible on the
   * office map without ever knowing they were asked. So the choice is made
   * here, in plain words, while the person is looking at their own name.
   */
  const pick = (person: Person) => {
    setError(null);
    setAsking({ kind: "pick", person, label: person.name, leaderId: null });
  };

  const submitNew = () => {
    setError(null);
    const name = newName.trim();
    if (name.length < 2) {
      setError("Type your full name");
      return;
    }
    // Snapshot the whole answer now. What gets sent must be what the person
    // was looking at when they tapped, not whatever the form holds a slow
    // location lookup later.
    setAsking({ kind: "join", label: name, leaderId: newLeader || null });
  };

  /** Abandon whatever the sheet is doing; any lookup still running is orphaned. */
  const cancelAsk = () => {
    attempt.current += 1;
    inFlight.current = false;
    setLocating(false);
    setAsking(null);
  };

  /**
   * Location is asked for, never required: a crew standing in a basement with
   * GPS off still has to be able to reach their pay. Whatever they choose, the
   * request goes to the office either way.
   */
  const send = async (allowLocation: boolean) => {
    // A tap that lands twice must not become two people waiting on the office.
    // React's disabled prop only takes effect on the next render, which is far
    // too late for a double-tap, so the guard is a ref set synchronously here.
    if (inFlight.current) return;
    const target = asking;
    if (!target) return;
    inFlight.current = true;
    const mine = ++attempt.current;

    setLocating(true);
    let granted = false;
    if (allowLocation) {
      const pos = await getPosition();
      granted = Boolean(pos);
    }
    // Backing out during the wait — or leaving the page — cancels the send.
    // Geolocation can sit for fifteen seconds, and nobody should have a
    // request appear in the office after they chose to go back.
    if (attempt.current !== mine || !alive.current) {
      inFlight.current = false;
      return;
    }
    setLocating(false);
    setLocationOff(!granted);
    setAsking(null);

    const settled = () => {
      inFlight.current = false;
    };
    if (target.kind === "pick" && target.person) {
      claim.mutate(
        { code, data: { crewId: target.person.id } },
        {
          onSuccess: sent,
          onError: () => setError("Couldn't send that to the office. Try again."),
          onSettled: settled,
        },
      );
      return;
    }
    join.mutate(
      { code, data: { name: target.label, leaderId: target.leaderId } },
      {
        onSuccess: sent,
        onError: () => setError("Couldn't send that to the office. Check the name and try again."),
        onSettled: settled,
      },
    );
  };

  if (approved) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 px-6 text-center">
        <div>
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
          <p className="mt-3 text-[14px] text-slate-600">Opening {approved.name}'s paycard…</p>
          <button
            type="button"
            className="mt-4 text-[13px] font-medium text-slate-500 underline"
            onClick={startOver}
          >
            Not you?
          </button>
        </div>
      </div>
    );
  }

  if (pending) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 px-6 text-center">
        <div className="max-w-xs">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-amber-100">
            <Clock className="h-6 w-6 text-amber-600" />
          </div>
          <h1 className="mt-4 text-[18px] font-semibold text-slate-900">Sent to the office</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-slate-500">
            The office is confirming you're {pending.name}. Keep this page open — your portal opens
            by itself the second they approve it.
          </p>
          <Loader2 className="mx-auto mt-4 h-5 w-5 animate-spin text-slate-300" />
          {locationOff ? (
            <p className="mt-4 rounded-xl bg-amber-50 p-3 text-left text-[12px] leading-relaxed text-amber-800">
              Location is off, so you won't show up on the office map. Turn it on for this site in
              your phone's settings whenever you're ready — your link still works either way.
            </p>
          ) : null}
          <button
            type="button"
            className="mt-5 text-[13px] font-medium text-slate-500 underline"
            onClick={startOver}
          >
            Picked the wrong name?
          </button>
        </div>
      </div>
    );
  }

  if (denied) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 px-6 text-center">
        <div className="max-w-xs">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-rose-100">
            <ShieldX className="h-6 w-6 text-rose-600" />
          </div>
          <h1 className="mt-4 text-[18px] font-semibold text-slate-900">The office said no</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-slate-500">
            That request wasn't approved. Check with the office, then try again.
          </p>
          <button
            type="button"
            className="mt-5 rounded-xl bg-slate-900 px-4 py-2.5 text-[14px] font-semibold text-white"
            onClick={startOver}
          >
            Back to the list
          </button>
        </div>
      </div>
    );
  }

  if (roster.isPending) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (roster.isError) {
    // Only a 404 means the code itself is dead, and codes are never retired on
    // their own — everything else (offline in a stairwell, the server waking up,
    // a limiter tripping while the whole crew scans at once) is temporary, and
    // telling a crew their card is invalid over a dropped packet sends them
    // hunting for a new QR that doesn't exist.
    const status = (roster.error as { status?: number } | null)?.status;
    if (status === 404) {
      return (
        <div className="grid min-h-screen place-items-center bg-slate-50 px-6 text-center">
          <div className="max-w-xs">
            <h1 className="text-[17px] font-semibold text-slate-900">This code isn't active</h1>
            <p className="mt-2 text-[13px] text-slate-500">
              Ask the office for the current crew code and scan it again.
            </p>
          </div>
        </div>
      );
    }
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 px-6 text-center">
        <div className="max-w-xs">
          <h1 className="text-[17px] font-semibold text-slate-900">Can't reach HALO right now</h1>
          <p className="mt-2 text-[13px] text-slate-500">
            Your code is fine — this phone just can't get through. Check your signal and try again.
          </p>
          <button
            type="button"
            className="mt-5 rounded-xl bg-slate-900 px-4 py-2.5 text-[14px] font-semibold text-white"
            onClick={() => void roster.refetch()}
            disabled={roster.isFetching}
          >
            {roster.isFetching ? "Trying…" : "Try again"}
          </button>
        </div>
      </div>
    );
  }

  const busy = claim.isPending || join.isPending;

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <header className="border-b border-slate-200 bg-white px-5 py-5">
        <h1 className="text-[20px] font-semibold text-slate-900">Who are you?</h1>
        <p className="mt-1 text-[13px] text-slate-500">
          Tap your name. The office approves it, then your own link opens — add it to your home
          screen and it stays yours.
        </p>
      </header>

      {error ? (
        <div className="mx-5 mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700">
          {error}
        </div>
      ) : null}

      {adding ? (
        <div className="mx-5 mt-5 rounded-2xl border border-slate-200 bg-white p-4">
          <button
            type="button"
            className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500"
            onClick={() => setAdding(false)}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to the list
          </button>
          <label className="block text-[12px] font-semibold uppercase tracking-wide text-slate-400">
            Your full name
          </label>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="First and last name"
            autoComplete="name"
            className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-[15px] outline-none focus:border-slate-400"
          />
          <label className="mt-4 block text-[12px] font-semibold uppercase tracking-wide text-slate-400">
            Who do you report to?
          </label>
          <select
            value={newLeader}
            onChange={(e) => setNewLeader(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[15px] outline-none focus:border-slate-400"
          >
            <option value="">Nobody — I work on my own</option>
            {reportsTo.foremen.length ? (
              <optgroup label="Foremen">
                {reportsTo.foremen.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                    {f.trade ? ` · ${f.trade}` : ""}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {reportsTo.others.length ? (
              <optgroup label="Everyone else">
                {reportsTo.others.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.trade ? ` · ${p.trade}` : ""}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
          <p className="mt-2 text-[12px] text-slate-400">
            Your map pin takes your foreman's colour so the office can see the whole team at a
            glance.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={submitNew}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-[15px] font-semibold text-white disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Send to the office
          </button>
        </div>
      ) : (
        <div className="space-y-6 px-5 py-5">
          {/* Top of the list, not the bottom: someone who isn't on the roster
              shouldn't have to scroll past every other name to find that out. */}
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white p-3 text-left"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-900 text-white">
              <Plus className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold text-slate-900">
                Add your name if it's not listed
              </span>
              <span className="block text-[12px] text-slate-500">
                Then pick the foreman you report to
              </span>
            </span>
          </button>

          {groups.map((group) => (
            <section key={group.key}>
              <div className="flex items-center gap-2">
                <i
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: group.color }}
                  aria-hidden
                />
                <h2 className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">
                  {group.title}
                </h2>
              </div>
              {group.subtitle ? (
                <p className="mb-2 ml-4.5 text-[12px] text-slate-400">{group.subtitle}</p>
              ) : null}
              <div className="mt-2 space-y-2">
                {group.people.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    disabled={busy}
                    onClick={() => pick(person)}
                    className="flex w-full items-center gap-3 rounded-2xl border bg-white p-3 text-left disabled:opacity-60"
                    style={{ borderColor: `${person.color}55` }}
                  >
                    <span
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[12px] font-bold text-white"
                      style={{ background: person.color }}
                    >
                      {initials(person.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-slate-900">
                        {person.name}
                      </span>
                      <span className="block truncate text-[12px] text-slate-500">
                        {[person.isForeman ? "Foreman" : null, person.trade]
                          .filter(Boolean)
                          .join(" · ") || "Crew"}
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-slate-300" />
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Asked here, over the list, because the phone only offers its location
          dialog inside a tap — and because the person should read why before
          they answer, not discover it from a system pop-up with no context. */}
      {asking ? (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 px-4 pb-4">
          <div className="w-full rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-900">
                <MapPin className="h-5 w-5 text-white" />
              </span>
              <div className="min-w-0">
                <h2 className="text-[16px] font-semibold text-slate-900">
                  Share your location, {asking.label.split(" ")[0]}?
                </h2>
                <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
                  HALO puts your pin on the office map while you're on the clock, so the office can
                  see your crew arrive and nobody has to call you for an update. It stops when you
                  check out.
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={locating}
              onClick={() => void send(true)}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-[15px] font-semibold text-white disabled:opacity-60"
            >
              {locating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MapPin className="h-4 w-4" />
              )}
              {locating ? "Waiting on your phone…" : "Allow location"}
            </button>
            <button
              type="button"
              disabled={locating}
              onClick={() => void send(false)}
              className="mt-2 w-full rounded-xl px-4 py-2.5 text-[14px] font-medium text-slate-500 disabled:opacity-60"
            >
              Not now — send my request anyway
            </button>
            <button
              type="button"
              onClick={cancelAsk}
              className="mt-1 w-full text-[13px] text-slate-400 underline"
            >
              Back to the list
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
