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

import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  useGetCrewRoster,
  useGetCrewRosterClaim,
  useClaimCrewRosterSpot,
  useJoinCrewRoster,
} from "@workspace/api-client-react";
import { Loader2, ArrowRight, UserPlus, ArrowLeft, Clock, ShieldX } from "lucide-react";

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

const isApproved = (v: unknown): v is { name: string; portalPath: string } =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as { portalPath?: unknown }).portalPath === "string" &&
  (v as { portalPath: string }).portalPath.startsWith("/portal/");

const isPending = (v: unknown): v is Pending =>
  isApproved(v) && typeof (v as { claimId?: unknown }).claimId === "string";

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
  const foremen = useMemo(
    () =>
      groups
        .filter((g) => g.leaderId)
        .map((g) => ({ id: g.leaderId as string, title: g.title })),
    [groups],
  );

  // A remembered, approved pick means this phone already belongs to someone —
  // send them straight in rather than making them find their name every morning.
  useEffect(() => {
    if (approved) navigate(approved.portalPath, { replace: true });
  }, [approved, navigate]);

  useEffect(() => {
    if (!pending || !status.data) return;
    if (status.data.status === "approved") {
      const done = { name: pending.name, portalPath: pending.portalPath };
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

  const pick = (person: Person) => {
    setError(null);
    claim.mutate(
      { code, data: { crewId: person.id } },
      {
        onSuccess: sent,
        onError: () => setError("Couldn't send that to the office. Try again."),
      },
    );
  };

  const submitNew = () => {
    setError(null);
    const name = newName.trim();
    if (name.length < 2) {
      setError("Type your full name");
      return;
    }
    join.mutate(
      { code, data: { name, leaderId: newLeader || null } },
      {
        onSuccess: sent,
        onError: () => setError("Couldn't send that to the office. Check the name and try again."),
      },
    );
  };

  if (approved) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 px-6 text-center">
        <div>
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
          <p className="mt-3 text-[14px] text-slate-600">Opening {approved.name}'s portal…</p>
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
            {foremen.map((f) => (
              <option key={f.id} value={f.id}>
                {f.title}
              </option>
            ))}
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

          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3.5 text-[14px] font-semibold text-slate-600"
          >
            <UserPlus className="h-4 w-4" />
            I'm not on this list
          </button>
        </div>
      )}
    </div>
  );
}
