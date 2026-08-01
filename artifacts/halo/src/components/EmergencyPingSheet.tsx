import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
  getGetTodayQueryKey,
  getListJobsQueryKey,
  getGetCalendarQueryKey,
  type EmergencyCandidate,
  type EmergencyPingTargetView,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import {
  Siren,
  MapPin,
  AlertTriangle,
  Check,
  X,
  Clock,
  MessageSquare,
  MessageSquareOff,
} from "lucide-react";

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const BONUS_PRESETS = [50, 100, 150, 200];

const fieldCls =
  "w-full bg-card border border-[var(--hairline)] rounded-[16px] py-[12px] px-[14px] text-[15px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-[var(--ink)] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40 focus:border-[var(--gold)]";

function apiError(err: unknown, fallback: string) {
  const e = err as { data?: { error?: string }; message?: string } | null;
  return e?.data?.error ?? e?.message ?? fallback;
}

/** Distance label — prefers miles, falls back to km, else null. */
function distanceLabel(c: EmergencyCandidate): string | null {
  if (c.distanceMiles != null) return `${c.distanceMiles.toFixed(1)} mi`;
  if (c.distanceMeters != null) return `${(c.distanceMeters / 1000).toFixed(1)} km`;
  return null;
}

/** Staleness label from minutesAgo. */
function stalenessLabel(minutesAgo: number | null | undefined): string {
  if (minutesAgo == null) return "no recent location";
  if (minutesAgo < 1) return "as of just now";
  if (minutesAgo <= 60) return `as of ${minutesAgo} min ago`;
  const hours = Math.round(minutesAgo / 60);
  return `as of ${hours}h ago`;
}

function targetStatusStyle(status: string): { label: string; cls: string } {
  switch (status) {
    case "committed":
      return { label: "Committed", cls: "text-white bg-[var(--green)]" };
    case "declined":
      return { label: "Declined", cls: "text-muted-foreground bg-[rgba(19,34,58,0.06)]" };
    case "missed":
      return { label: "Missed", cls: "text-red-600 bg-red-50" };
    case "cancelled":
      return { label: "Cancelled", cls: "text-muted-foreground bg-[rgba(19,34,58,0.06)]" };
    default:
      return { label: "Pending", cls: "text-[var(--gold-dark)] bg-[var(--gold-tint)]" };
  }
}

export function EmergencyPingSheet({
  jobId,
  open,
  onOpenChange,
}: {
  jobId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: candData, isLoading: candLoading } = useGetEmergencyCandidates(jobId, {
    query: { queryKey: getGetEmergencyCandidatesQueryKey(jobId), enabled: open && !!jobId },
  });
  const { data: pingData } = useGetEmergencyPing(jobId, {
    query: { queryKey: getGetEmergencyPingQueryKey(jobId), enabled: open && !!jobId },
  });

  const send = useSendEmergencyPing();
  const cancel = useCancelEmergencyPing();

  const [selected, setSelected] = useState<string[]>([]);
  const [bonus, setBonus] = useState<number>(100);
  const [customBonus, setCustomBonus] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [note, setNote] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);

  const ping = pingData?.ping ?? null;
  const activePing = ping && (ping.status === "open" || ping.status === "filled") ? ping : null;

  const candidates = candData?.candidates ?? [];
  const jobPay = candData?.jobPay ?? 0;
  const effectiveBonus = customBonus ? Number(customBonus) || 0 : bonus;
  const total = jobPay + effectiveBonus;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetEmergencyPingQueryKey(jobId) });
    queryClient.invalidateQueries({ queryKey: getGetEmergencyCandidatesQueryKey(jobId) });
    queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(jobId) });
    queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCalendarQueryKey() });
  };

  const toggle = (crewId: string) =>
    setSelected((cur) =>
      cur.includes(crewId) ? cur.filter((c) => c !== crewId) : [...cur, crewId],
    );

  const canSend = selected.length > 0 && effectiveBonus > 0 && !send.isPending;

  const submit = () => {
    if (!canSend) return;
    send.mutate(
      {
        id: jobId,
        data: {
          crewIds: selected,
          bonusAmount: effectiveBonus,
          neededBy: neededBy.trim() || null,
          note: note.trim() || null,
        },
      },
      {
        onSuccess: () => {
          invalidate();
          toast({
            title: "Emergency ping sent",
            description: `${selected.length} crew${selected.length === 1 ? "" : "s"} pinged — awaiting commit.`,
          });
        },
        onError: (e) => {
          toast({
            title: "Couldn't send the ping",
            description: apiError(e, "Try again."),
            variant: "destructive",
          });
        },
      },
    );
  };

  const doCancel = () => {
    cancel.mutate(
      { id: jobId },
      {
        onSuccess: () => {
          invalidate();
          setConfirmCancel(false);
          toast({
            title: "Emergency ping cancelled",
            description: "Any held pay has been returned.",
          });
        },
        onError: (e) => {
          toast({
            title: "Couldn't cancel",
            description: apiError(e, "Try again."),
            variant: "destructive",
          });
        },
      },
    );
  };

  const committedCount = useMemo(
    () => (activePing?.targets ?? []).filter((t) => t.status === "committed").length,
    [activePing],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[26px] bg-[var(--paper)] p-0 flex flex-col max-h-[92vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]"
      >
        <div className="w-[40px] h-[4.5px] rounded-[3px] bg-[rgba(23,24,28,0.16)] mx-auto mt-[10px] mb-[4px] shrink-0" />
        <div className="p-[8px_20px_26px] overflow-y-auto">
          <SheetHeader className="text-left mb-[14px]">
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px] flex items-center gap-[8px]">
              <span className="grid place-items-center w-[30px] h-[30px] rounded-full bg-red-600 text-white shrink-0">
                <Siren className="w-[16px] h-[16px]" />
              </span>
              Emergency ping
            </SheetTitle>
            <div className="text-[13px] text-muted-foreground">
              {activePing
                ? "A ping is live for this job."
                : "Reach the closest crews fast with a cash bonus on hold."}
            </div>
          </SheetHeader>

          {activePing ? (
            /* ── STATUS VIEW ── */
            <div className="flex flex-col gap-[12px]">
              {activePing.status === "filled" ? (
                <div
                  className="rounded-[18px] border border-[var(--green)] bg-[var(--green)]/10 p-[14px]"
                  data-testid="emergency-status-filled"
                >
                  <div className="flex items-center gap-[8px] mb-[6px]">
                    <Check className="w-[16px] h-[16px] text-[var(--green)]" />
                    <span className="font-display font-bold text-[15px] text-[var(--ink)]">
                      Filled — {activePing.filledByCrewName ?? "crew"} accepted
                    </span>
                  </div>
                  {activePing.hold && (
                    <div className="text-[13px] text-[var(--ink)]/85 leading-relaxed">
                      <span className="font-semibold">{money(activePing.hold.amount)}</span> on hold
                      {activePing.hold.bonusAmount > 0 && (
                        <> (incl. {money(activePing.hold.bonusAmount)} bonus)</>
                      )}{" "}
                      · status{" "}
                      <span className="font-semibold uppercase tracking-wide text-[11px]">
                        {activePing.hold.status}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div
                  className="rounded-[18px] border border-[var(--gold)]/40 bg-[var(--gold-tint)] p-[14px]"
                  data-testid="emergency-status-open"
                >
                  <div className="flex items-center gap-[8px]">
                    <Clock className="w-[16px] h-[16px] text-[var(--gold-dark)]" />
                    <span className="font-display font-bold text-[14.5px] text-[var(--ink)]">
                      {activePing.targets.length} pinged
                      {committedCount > 0 ? ` · ${committedCount} committed` : ", awaiting commit"}
                    </span>
                  </div>
                  <div className="text-[12.5px] text-muted-foreground mt-[4px]">
                    {money(activePing.payAmount)} pay + {money(activePing.bonusAmount)} bonus ={" "}
                    <span className="font-semibold text-[var(--ink)]">
                      {money(activePing.payAmount + activePing.bonusAmount)}
                    </span>{" "}
                    on hold
                    {activePing.neededBy ? ` · needed by ${activePing.neededBy}` : ""}
                  </div>
                </div>
              )}

              {activePing.note && (
                <div className="text-[13px] text-[var(--ink)]/85 bg-card border border-[var(--hairline)] rounded-[14px] p-[12px]">
                  {activePing.note}
                </div>
              )}

              <div className="flex flex-col gap-[6px]">
                {activePing.targets.map((t: EmergencyPingTargetView) => {
                  const s = targetStatusStyle(t.status);
                  return (
                    <div
                      key={t.id}
                      className="flex items-center justify-between bg-card border border-[var(--hairline)] rounded-[16px] p-[12px_14px]"
                      data-testid={`emergency-target-${t.crewId}`}
                    >
                      <div className="min-w-0">
                        <div className="text-[14px] font-semibold text-[var(--ink)] truncate">
                          {t.crewName}
                        </div>
                        <div className="flex items-center gap-[6px] text-[11.5px] text-muted-foreground mt-[2px]">
                          {t.smsSent ? (
                            <>
                              <MessageSquare className="w-[12px] h-[12px]" /> SMS sent
                            </>
                          ) : (
                            <>
                              <MessageSquareOff className="w-[12px] h-[12px]" /> portal only
                            </>
                          )}
                          {t.distanceMeters != null && (
                            <span>· {(t.distanceMeters / 1609.34).toFixed(1)} mi</span>
                          )}
                        </div>
                      </div>
                      <span
                        className={`text-[11px] font-display font-bold uppercase tracking-[0.06em] rounded-full px-[10px] py-[4px] shrink-0 ${s.cls}`}
                      >
                        {s.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              {activePing.status !== "cancelled" && (
                <>
                  {!confirmCancel ? (
                    <button
                      type="button"
                      onClick={() => setConfirmCancel(true)}
                      data-testid="button-emergency-cancel"
                      className="w-full flex items-center justify-center gap-[7px] rounded-[16px] py-[12px] font-display font-bold text-[14px] bg-card border border-red-200 text-red-600 active:scale-[0.98] transition-transform"
                    >
                      <X className="w-[15px] h-[15px]" /> Cancel ping
                    </button>
                  ) : (
                    <div className="rounded-[16px] border border-red-200 bg-red-50 p-[12px] flex flex-col gap-[8px]">
                      <div className="text-[13px] text-[var(--ink)]/85">
                        Cancel this emergency ping? Any held pay
                        {activePing.hold ? ` (${money(activePing.hold.amount)})` : ""} is returned and
                        pinged crews are notified.
                      </div>
                      <div className="flex gap-[8px]">
                        <button
                          type="button"
                          onClick={() => setConfirmCancel(false)}
                          className="flex-1 rounded-[14px] py-[10px] font-semibold text-[13.5px] text-muted-foreground bg-card border border-[var(--hairline)]"
                        >
                          Keep it
                        </button>
                        <button
                          type="button"
                          disabled={cancel.isPending}
                          onClick={doCancel}
                          data-testid="button-emergency-cancel-confirm"
                          className="flex-1 rounded-[14px] py-[10px] font-display font-bold text-[13.5px] text-white bg-red-600 active:scale-[0.98] transition-transform disabled:opacity-50"
                        >
                          {cancel.isPending ? "Cancelling…" : "Cancel ping"}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            /* ── FORM VIEW ── */
            <div className="flex flex-col gap-[14px]">
              {candData && !candData.propertyHasLocation && (
                <div className="flex items-start gap-[8px] rounded-[14px] border border-amber-300 bg-amber-50 p-[11px] text-[12.5px] text-amber-900">
                  <AlertTriangle className="w-[15px] h-[15px] mt-[1px] shrink-0" />
                  This property has no location set — crew distances can't be ranked.
                </div>
              )}
              {candData && !candData.smsAvailable && (
                <div className="flex items-center gap-[7px] rounded-[14px] border border-[var(--hairline)] bg-card p-[11px] text-[12.5px] text-muted-foreground">
                  <MessageSquareOff className="w-[14px] h-[14px] shrink-0" />
                  SMS off — portal ping only.
                </div>
              )}

              <div>
                <div className="text-[11px] font-display font-bold uppercase tracking-[0.1em] text-muted-foreground mb-[8px] ml-[2px]">
                  Closest crews
                </div>
                {candLoading ? (
                  <div className="space-y-[8px]">
                    <div className="h-[58px] bg-card rounded-[16px] animate-pulse" />
                    <div className="h-[58px] bg-card rounded-[16px] animate-pulse" />
                  </div>
                ) : candidates.length === 0 ? (
                  <div className="text-[13px] text-muted-foreground bg-card border border-[var(--hairline)] rounded-[16px] p-[14px]">
                    No crews available to ping.
                  </div>
                ) : (
                  <div className="flex flex-col gap-[6px]">
                    {candidates.map((c) => {
                      const isSel = selected.includes(c.crewId);
                      const dist = distanceLabel(c);
                      return (
                        <button
                          key={c.crewId}
                          type="button"
                          onClick={() => toggle(c.crewId)}
                          data-testid={`emergency-candidate-${c.crewId}`}
                          className={`flex items-center gap-[10px] rounded-[16px] p-[11px_12px] border text-left active:scale-[0.98] transition-transform ${
                            isSel
                              ? "bg-[var(--gold-tint)] border-[var(--gold)]"
                              : "bg-card border-[var(--hairline)]"
                          }`}
                        >
                          <span
                            className={`w-[22px] h-[22px] rounded-[7px] grid place-items-center shrink-0 border ${
                              isSel
                                ? "bg-[var(--gold-light)] border-[var(--gold)] text-black"
                                : "bg-[var(--paper)] border-[var(--hairline)]"
                            }`}
                          >
                            {isSel && <Check className="w-[14px] h-[14px]" strokeWidth={3} />}
                          </span>
                          {c.selfiePath ? (
                            <img
                              src={`/api/storage${c.selfiePath}`}
                              className="w-[34px] h-[34px] rounded-full object-cover shrink-0"
                              alt=""
                            />
                          ) : (
                            <div className="w-[34px] h-[34px] rounded-full bg-[var(--ink)]/10 grid place-items-center text-[13px] font-bold shrink-0">
                              {c.name.slice(0, 1)}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-[14px] font-semibold text-[var(--ink)] truncate">
                              {c.name}
                              {c.trade ? (
                                <span className="text-[11.5px] font-normal text-muted-foreground">
                                  {" "}
                                  · {c.trade}
                                </span>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-[5px] text-[11.5px] text-muted-foreground mt-[2px]">
                              <MapPin className="w-[11px] h-[11px] shrink-0" />
                              {dist ? (
                                <span className="font-semibold text-[var(--ink)]">{dist}</span>
                              ) : (
                                <span>no GPS</span>
                              )}
                              <span>· {stalenessLabel(c.minutesAgo)}</span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <div className="text-[11px] font-display font-bold uppercase tracking-[0.1em] text-muted-foreground mb-[8px] ml-[2px]">
                  Bonus on top of pay
                </div>
                <div className="flex flex-wrap gap-[7px]">
                  {BONUS_PRESETS.map((p) => {
                    const active = !customBonus && bonus === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => {
                          setBonus(p);
                          setCustomBonus("");
                        }}
                        data-testid={`emergency-bonus-${p}`}
                        className={`px-[16px] py-[9px] rounded-full text-[14px] font-display font-bold border active:scale-[0.95] transition-transform ${
                          active
                            ? "bg-[var(--gold-light)] border-[var(--gold)] text-black"
                            : "bg-card border-[var(--hairline)] text-[var(--ink)]"
                        }`}
                      >
                        {money(p)}
                      </button>
                    );
                  })}
                </div>
                <input
                  type="number"
                  min={0}
                  className={`${fieldCls} mt-[8px]`}
                  placeholder="Custom bonus ($)"
                  value={customBonus}
                  onChange={(e) => setCustomBonus(e.target.value)}
                  data-testid="input-emergency-custom-bonus"
                />
              </div>

              <input
                className={fieldCls}
                placeholder="Needed by (e.g. 5:00 PM) — optional"
                value={neededBy}
                onChange={(e) => setNeededBy(e.target.value)}
                data-testid="input-emergency-needed-by"
              />
              <textarea
                className={`${fieldCls} resize-y`}
                rows={2}
                placeholder="Note to crews (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                data-testid="input-emergency-note"
              />

              <div className="flex items-center justify-between rounded-[16px] bg-card border border-[var(--hairline)] p-[12px_14px]">
                <div className="text-[12.5px] text-muted-foreground">
                  {money(jobPay)} pay + {money(effectiveBonus)} bonus
                </div>
                <div className="text-[15px] font-display font-bold tabular-nums text-[var(--ink)]">
                  {money(total)} on hold
                </div>
              </div>

              <button
                type="button"
                onClick={submit}
                disabled={!canSend}
                data-testid="button-emergency-send"
                className="w-full flex items-center justify-center gap-[8px] rounded-full py-[13px] font-display font-bold text-[15px] text-white bg-red-600 shadow-[0_4px_14px_rgba(220,38,38,0.35)] disabled:opacity-50 active:scale-[0.98] transition-transform"
              >
                <Siren className="w-[16px] h-[16px]" />
                {send.isPending
                  ? "Sending…"
                  : `Send ping${selected.length > 0 ? ` to ${selected.length}` : ""}`}
              </button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
