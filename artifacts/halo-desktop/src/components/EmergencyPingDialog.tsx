import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetEmergencyCandidates,
  getGetEmergencyCandidatesQueryKey,
  useGetEmergencyPing,
  getGetEmergencyPingQueryKey,
  useSendEmergencyPing,
  useCancelEmergencyPing,
  getGetJobQueryKey,
  getListJobsQueryKey,
  getGetTodayQueryKey,
  getGetCalendarQueryKey,
  type EmergencyCandidate,
  type EmergencyPingTargetView,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  MapPin,
  MessageSquareOff,
  Siren,
  Check,
  Clock,
  X,
} from "lucide-react";

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const BONUS_PRESETS = [50, 100, 150, 200];

// Optional auto-expiry — an open ping cancels itself after this long.
const EXPIRY_PRESETS: Array<{ label: string; minutes: number | null }> = [
  { label: "No expiry", minutes: null },
  { label: "30 min", minutes: 30 },
  { label: "1 hr", minutes: 60 },
  { label: "2 hrs", minutes: 120 },
  { label: "4 hrs", minutes: 240 },
];

function expiryLabel(expiresAt: string | null | undefined): string | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "expiring…";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `expires in ${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `expires in ${hrs}h${rem > 0 ? ` ${rem}m` : ""}`;
}

/** "0.3 mi" / "1.2 km fine as miles" — prefer miles, fall back to meters. */
function distanceLabel(c: EmergencyCandidate): string | null {
  if (c.distanceMiles != null) return `${c.distanceMiles.toFixed(1)} mi`;
  if (c.distanceMeters != null) {
    const km = c.distanceMeters / 1000;
    return km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(c.distanceMeters)} m`;
  }
  return null;
}

/** "as of 20 min ago" — >60 -> "as of 3h ago"; null -> "no recent location". */
function stalenessLabel(minutesAgo?: number | null): string {
  if (minutesAgo == null) return "no recent location";
  if (minutesAgo < 1) return "as of just now";
  if (minutesAgo <= 60) return `as of ${Math.round(minutesAgo)} min ago`;
  const hrs = Math.round(minutesAgo / 60);
  return `as of ${hrs}h ago`;
}

function errText(err: unknown, fallback: string): string {
  const e = err as { data?: { error?: string } | null; message?: string };
  return e?.data?.error ?? e?.message ?? fallback;
}

const TARGET_STYLES: Record<string, { label: string; cls: string }> = {
  pending: { label: "Awaiting", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  committed: { label: "Committed", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  declined: { label: "Declined", cls: "bg-muted text-muted-foreground border-border" },
  missed: { label: "Missed", cls: "bg-red-50 text-red-700 border-red-200" },
  cancelled: { label: "Cancelled", cls: "bg-muted text-muted-foreground border-border" },
  expired: { label: "Expired", cls: "bg-muted text-muted-foreground border-border" },
};

export function EmergencyPingDialog({
  jobId,
  open,
  onOpenChange,
}: {
  jobId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();

  const { data: candidatesData, isLoading: candidatesLoading } =
    useGetEmergencyCandidates(jobId, {
      query: { queryKey: getGetEmergencyCandidatesQueryKey(jobId), enabled: open && !!jobId },
    });
  const { data: pingData, isLoading: pingLoading } = useGetEmergencyPing(jobId, {
    query: { queryKey: getGetEmergencyPingQueryKey(jobId), enabled: open && !!jobId },
  });

  const send = useSendEmergencyPing();
  const cancel = useCancelEmergencyPing();

  const [selected, setSelected] = useState<string[]>([]);
  const [bonus, setBonus] = useState<number>(100);
  const [customBonus, setCustomBonus] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [expiresIn, setExpiresIn] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const ping = pingData?.ping ?? null;
  const activePing = ping && (ping.status === "open" || ping.status === "filled") ? ping : null;

  const candidates = candidatesData?.candidates ?? [];
  const jobPay = candidatesData?.jobPay ?? 0;
  const bonusAmount = customBonus.trim() ? Math.max(0, Number(customBonus) || 0) : bonus;
  const total = jobPay + bonusAmount;

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const toggleCrew = (crewId: string) => {
    setSelected((prev) =>
      prev.includes(crewId) ? prev.filter((c) => c !== crewId) : [...prev, crewId],
    );
  };

  const reset = () => {
    setSelected([]);
    setBonus(100);
    setCustomBonus("");
    setNeededBy("");
    setExpiresIn(null);
    setNote("");
    setErrorMsg(null);
    setConfirmCancel(false);
  };

  const close = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetEmergencyPingQueryKey(jobId) });
    queryClient.invalidateQueries({ queryKey: getGetEmergencyCandidatesQueryKey(jobId) });
    queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(jobId) });
    queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCalendarQueryKey() });
  };

  const submit = () => {
    if (!selected.length || bonusAmount <= 0 || send.isPending) return;
    setErrorMsg(null);
    send.mutate(
      {
        id: jobId,
        data: {
          crewIds: selected,
          bonusAmount,
          neededBy: neededBy.trim() || null,
          expiresInMinutes: expiresIn,
          note: note.trim() || null,
        },
      },
      {
        onSuccess: () => invalidate(),
        onError: (err) => {
          const e = err as { status?: number };
          setErrorMsg(
            e?.status === 409
              ? "A ping is already open for this job."
              : errText(err, "Couldn't send the ping. Try again."),
          );
          invalidate();
        },
      },
    );
  };

  const doCancel = () => {
    setConfirmCancel(false);
    setErrorMsg(null);
    cancel.mutate(
      { id: jobId },
      {
        onSuccess: () => invalidate(),
        onError: (err) => setErrorMsg(errText(err, "Couldn't cancel the ping.")),
      },
    );
  };

  const smsOff = candidatesData?.smsAvailable === false;
  const noPropertyLocation = candidatesData?.propertyHasLocation === false;
  const canSend = selected.length > 0 && bonusAmount > 0 && !send.isPending;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="border-none shadow-xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <span className="grid place-items-center w-7 h-7 rounded-full bg-red-100 text-red-600">
              <Siren className="w-4 h-4" />
            </span>
            Emergency ping
          </DialogTitle>
          <DialogDescription>
            {activePing
              ? "Track who's responding to this urgent ping."
              : "Ping the closest crews with a bonus to fill this job now."}
          </DialogDescription>
        </DialogHeader>

        {activePing ? (
          /* ---------- STATUS VIEW ---------- */
          <div className="flex flex-col gap-3 py-1" data-testid="emergency-ping-status">
            {activePing.status === "filled" ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5">
                <div className="flex items-center gap-2 text-sm font-bold text-emerald-800">
                  <Check className="w-4 h-4" />
                  {activePing.filledByCrewName ?? "A crew"} is on it
                </div>
                {activePing.hold && (
                  <div className="mt-1.5 text-xs text-emerald-700 font-semibold" data-testid="emergency-ping-hold">
                    {money(activePing.hold.amount)}
                    {activePing.hold.bonusAmount > 0
                      ? ` (incl. ${money(activePing.hold.bonusAmount)} bonus)`
                      : ""}{" "}
                    ON HOLD · {activePing.hold.status}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3.5">
                <div className="flex items-center gap-2 text-sm font-bold text-amber-800" data-testid="emergency-ping-awaiting">
                  <Clock className="w-4 h-4" />
                  {activePing.targets.length} pinged, awaiting commit
                </div>
                <div className="mt-1 text-xs text-amber-700">
                  {money(activePing.payAmount)} pay + {money(activePing.bonusAmount)} bonus ={" "}
                  <span className="font-bold">{money(activePing.payAmount + activePing.bonusAmount)}</span> on hold when filled
                </div>
                {activePing.neededBy && (
                  <div className="mt-0.5 text-xs text-amber-700">Needed by {activePing.neededBy}</div>
                )}
                {expiryLabel(activePing.expiresAt) && (
                  <div className="mt-0.5 text-xs text-amber-700" data-testid="emergency-expiry-countdown">
                    Offer {expiryLabel(activePing.expiresAt)} — cancels itself if no one commits
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              {activePing.targets.map((t: EmergencyPingTargetView) => {
                const s = TARGET_STYLES[t.status] ?? TARGET_STYLES.pending;
                return (
                  <div
                    key={t.id}
                    className="flex items-center justify-between bg-white border border-border rounded-xl p-3"
                    data-testid={`emergency-target-${t.crewId}`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{t.crewName}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {t.smsSent ? "SMS sent" : "Portal only"}
                        {t.sentAt ? ` · ${new Date(t.sentAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
                      </div>
                    </div>
                    <span className={`text-[10px] font-bold uppercase tracking-wide border rounded-full px-2 py-0.5 ${s.cls}`}>
                      {s.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {errorMsg && <div className="text-xs text-destructive text-center">{errorMsg}</div>}

            <button
              type="button"
              onClick={() => setConfirmCancel(true)}
              disabled={cancel.isPending}
              className="w-full flex items-center justify-center gap-2 rounded-full border border-red-200 text-red-600 py-2.5 font-bold text-sm hover:bg-red-50 transition-colors disabled:opacity-50"
              data-testid="button-cancel-emergency-ping"
            >
              <X className="w-4 h-4" />
              {cancel.isPending ? "Cancelling…" : "Cancel ping"}
            </button>

            <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel this emergency ping?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Crews will stop being notified.
                    {activePing.status === "filled"
                      ? " Any held pay for the assigned crew returns and the job is unstaffed."
                      : " No pay was held yet, so nothing is charged back."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-keep-emergency-ping">Keep ping</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={doCancel}
                    className="bg-red-600 hover:bg-red-700"
                    data-testid="button-confirm-cancel-emergency-ping"
                  >
                    Cancel ping
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : (
          /* ---------- FORM VIEW ---------- */
          <div className="flex flex-col gap-4 py-1">
            {noPropertyLocation && (
              <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                This property has no location on file — crews are ranked by their last GPS check-in only, so distances may be missing.
              </div>
            )}
            {smsOff && (
              <div className="flex items-center gap-2 rounded-2xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                <MessageSquareOff className="w-4 h-4 shrink-0" />
                SMS off — portal ping only
              </div>
            )}

            {/* Ranked crew list */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold text-[var(--gold-dark)]">
                Closest crews {selected.length > 0 ? `· ${selected.length} selected` : ""}
              </span>
              {pingLoading || candidatesLoading ? (
                <div className="text-sm text-muted-foreground p-2">Finding the closest crews…</div>
              ) : candidates.length === 0 ? (
                <div className="text-sm text-muted-foreground p-2">No available crews to ping.</div>
              ) : (
                <div className="flex flex-col gap-1.5 max-h-[260px] overflow-y-auto pr-0.5">
                  {candidates.map((c) => {
                    const dist = distanceLabel(c);
                    const isSel = selectedSet.has(c.crewId);
                    return (
                      <label
                        key={c.crewId}
                        className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
                          isSel ? "border-red-300 bg-red-50/60" : "border-border bg-white hover:border-[var(--gold-dark)]"
                        }`}
                        data-testid={`emergency-candidate-${c.crewId}`}
                      >
                        <Checkbox
                          checked={isSel}
                          onCheckedChange={() => toggleCrew(c.crewId)}
                          data-testid={`checkbox-emergency-${c.crewId}`}
                        />
                        {c.selfiePath ? (
                          <img
                            src={`/api/storage${c.selfiePath}`}
                            className="w-8 h-8 rounded-full object-cover"
                            alt=""
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-black/10 grid place-items-center text-xs font-bold">
                            {c.name.slice(0, 1)}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold truncate">
                            {c.name}
                            {c.trade ? <span className="text-muted-foreground font-normal"> · {c.trade}</span> : ""}
                          </div>
                          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <MapPin className="w-3 h-3 shrink-0" />
                            {dist ? <span className="font-semibold text-foreground">{dist}</span> : <span>no GPS</span>}
                            <span>· {c.checkinLabel ?? stalenessLabel(c.minutesAgo)}</span>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Bonus */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold text-[var(--gold-dark)]">Bonus on top of pay</span>
              <div className="flex flex-wrap gap-2">
                {BONUS_PRESETS.map((p) => {
                  const active = !customBonus.trim() && bonus === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        setBonus(p);
                        setCustomBonus("");
                      }}
                      className={`px-3.5 py-1.5 rounded-full border text-sm font-bold transition-colors ${
                        active ? "bg-[var(--gold-light)] border-transparent text-black" : "bg-white border-border hover:border-[var(--gold-dark)]"
                      }`}
                      data-testid={`bonus-preset-${p}`}
                    >
                      {money(p)}
                    </button>
                  );
                })}
                <input
                  type="number"
                  min={0}
                  placeholder="Custom"
                  value={customBonus}
                  onChange={(e) => setCustomBonus(e.target.value)}
                  className="w-24 bg-white border border-border rounded-full py-1.5 px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40"
                  data-testid="input-bonus-custom"
                />
              </div>
            </div>

            {/* Needed by */}
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold text-[var(--gold-dark)]">Needed by (optional)</span>
              <input
                className="w-full bg-white border border-border rounded-[11px] py-2.5 px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40"
                placeholder="e.g. 5:00 PM"
                value={neededBy}
                onChange={(e) => setNeededBy(e.target.value)}
                data-testid="input-needed-by"
              />
            </label>

            {/* Auto-expiry */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold text-[var(--gold-dark)]">Auto-expire the offer</span>
              <div className="flex flex-wrap gap-1.5">
                {EXPIRY_PRESETS.map((p) => {
                  const active = expiresIn === p.minutes;
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setExpiresIn(p.minutes)}
                      data-testid={`emergency-expiry-${p.minutes ?? "none"}`}
                      className={`px-3.5 py-1.5 rounded-full text-sm font-bold border transition-colors ${
                        active
                          ? "bg-[var(--gold-light)] border-[var(--gold)] text-black"
                          : "bg-white border-border text-foreground hover:bg-muted/50"
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
              {expiresIn != null && (
                <span className="text-[11px] text-muted-foreground">
                  If no one commits in {expiresIn >= 60 ? `${expiresIn / 60} hr${expiresIn > 60 ? "s" : ""}` : `${expiresIn} min`}, the ping cancels itself and crews are told it expired.
                </span>
              )}
            </div>

            {/* Note */}
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold text-[var(--gold-dark)]">Note to crews (optional)</span>
              <input
                className="w-full bg-white border border-border rounded-[11px] py-2.5 px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40"
                placeholder="What they need to know"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                data-testid="input-emergency-note"
              />
            </label>

            {/* Total */}
            <div className="flex items-center justify-between rounded-2xl border border-border bg-muted/30 px-3.5 py-3 text-sm">
              <span className="text-muted-foreground">
                Job pay {money(jobPay)} + bonus {money(bonusAmount)}
              </span>
              <span className="font-display font-bold tabular-nums" data-testid="emergency-total-hold">
                {money(total)} held
              </span>
            </div>

            {errorMsg && <div className="text-xs text-destructive text-center">{errorMsg}</div>}

            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              className="w-full flex items-center justify-center gap-2 bg-red-600 text-white px-4 py-2.5 rounded-full font-bold hover:bg-red-700 transition-colors shadow-sm disabled:opacity-50 disabled:pointer-events-none"
              data-testid="button-send-emergency-ping"
            >
              <Siren className="w-4 h-4" />
              {send.isPending
                ? "Sending…"
                : selected.length > 0
                  ? `Ping ${selected.length} crew${selected.length === 1 ? "" : "s"} · ${money(total)}`
                  : "Select crews to ping"}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
