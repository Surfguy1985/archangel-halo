import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  useCheckArrival,
  useCreateJob,
  getListJobsQueryKey,
  getGetPropertyQueryKey,
  getGetTodayQueryKey,
  type ArrivalCheckResult,
  type ArrivalJobIdea,
} from "@workspace/api-client-react";
import { MapPin, Sparkles, ChevronRight, CheckCircle2 } from "lucide-react";

const OWNER_KEY = "halo-owner-name";
const ENABLED_KEY = "halo-onsite-enabled";
const SEEN_KEY = "halo-arrival-seen";
const COOLDOWN_MS = 4 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 3 * 60 * 1000;
const MIN_MOVE_METERS = 150;

const ONSITE_EVENT = "halo-onsite-changed";

export const onsiteStorage = {
  getOwner: () => localStorage.getItem(OWNER_KEY) ?? "",
  setOwner: (v: string) => {
    localStorage.setItem(OWNER_KEY, v);
    window.dispatchEvent(new Event(ONSITE_EVENT));
  },
  isEnabled: () => localStorage.getItem(ENABLED_KEY) === "1",
  setEnabled: (v: boolean) => {
    if (v) localStorage.setItem(ENABLED_KEY, "1");
    else localStorage.removeItem(ENABLED_KEY);
    window.dispatchEvent(new Event(ONSITE_EVENT));
  },
};

function seenRecently(propertyId: string): boolean {
  try {
    const seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}");
    return Date.now() - (seen[propertyId] ?? 0) < COOLDOWN_MS;
  } catch {
    return false;
  }
}

function markSeen(propertyId: string) {
  let seen: Record<string, number> = {};
  try {
    seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}");
  } catch {
    /* fresh */
  }
  seen[propertyId] = Date.now();
  localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
}

function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const fieldCls =
  "w-full bg-card border border-border rounded-[13px] py-[11px] px-[14px] text-[14.5px] shadow-[var(--shadow)] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]";

export function ArrivalDetection() {
  const [result, setResult] = useState<ArrivalCheckResult | null>(null);
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(onsiteStorage.isEnabled);
  const check = useCheckArrival();
  const lastCheckedAt = useRef(0);
  const lastCheckedPos = useRef<{ lat: number; lng: number } | null>(null);
  const busy = useRef(false);

  // Track the Settings toggle live — start/stop the watcher immediately.
  useEffect(() => {
    const sync = () => setEnabled(onsiteStorage.isEnabled());
    window.addEventListener(ONSITE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(ONSITE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  useEffect(() => {
    if (!enabled || !("geolocation" in navigator)) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const now = Date.now();
        if (busy.current) return;
        if (now - lastCheckedAt.current < CHECK_INTERVAL_MS) return;
        if (
          lastCheckedPos.current &&
          metersBetween(lastCheckedPos.current, here) < MIN_MOVE_METERS &&
          lastCheckedAt.current > 0
        )
          return;
        busy.current = true;
        lastCheckedAt.current = now;
        lastCheckedPos.current = here;
        const owner = onsiteStorage.getOwner();
        check.mutate(
          { data: { lat: here.lat, lng: here.lng, owner: owner || undefined } },
          {
            onSuccess: (r) => {
              busy.current = false;
              if (r.match && r.propertyId && !seenRecently(r.propertyId)) {
                markSeen(r.propertyId);
                setResult(r);
                setOpen(true);
                if ("vibrate" in navigator) navigator.vibrate?.(200);
              }
            },
            onError: () => {
              busy.current = false;
            },
          },
        );
      },
      () => {
        /* permission denied or unavailable — stay quiet */
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return <ArrivalSheet open={open} onOpenChange={setOpen} result={result} />;
}

export function ArrivalSheet({
  open,
  onOpenChange,
  result,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: ArrivalCheckResult | null;
}) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [step, setStep] = useState<"prompt" | "form" | "done">("prompt");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [unitNo, setUnitNo] = useState("");
  const [createdJobId, setCreatedJobId] = useState<string | null>(null);
  const create = useCreateJob();

  useEffect(() => {
    if (open) {
      setStep("prompt");
      setDescription("");
      setCategory("");
      setUnitNo("");
      setCreatedJobId(null);
    }
  }, [open]);

  if (!result?.match || !result.propertyId) return null;
  const suggestion = result.suggestion ?? null;

  const pickIdea = (idea: ArrivalJobIdea) => {
    setDescription(idea.description);
    setCategory(idea.category);
    setUnitNo(idea.unitNo ?? "");
    setStep("form");
  };

  const submit = () => {
    if (!description.trim()) return;
    create.mutate(
      {
        data: {
          propertyId: result.propertyId!,
          description: description.trim(),
          category: category.trim() || undefined,
          unitNo: unitNo.trim() || undefined,
        },
      },
      {
        onSuccess: (job) => {
          queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(result.propertyId!) });
          queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
          setCreatedJobId(job.id);
          setStep("done");
        },
      },
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[26px] bg-[var(--paper)] p-0 flex flex-col max-h-[86vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]"
      >
        <div className="w-[40px] h-[4.5px] rounded-[3px] bg-[rgba(23,24,28,0.16)] mx-auto mt-[10px] mb-[4px] shrink-0" />
        <div className="p-[8px_20px_26px] overflow-y-auto">
          {step === "prompt" && (
            <>
              <SheetHeader className="text-left mb-[12px]">
                <div className="flex items-center gap-[8px] text-[var(--gold-dark)] text-[12px] font-display font-bold tracking-[0.12em] uppercase">
                  <MapPin className="w-[14px] h-[14px]" /> On site · {result.propertyName}
                </div>
                <SheetTitle className="font-display font-bold text-[20px] m-[6px_0_2px]">
                  {suggestion?.headline ?? `You're at ${result.propertyName}`}
                </SheetTitle>
                <div className="text-[13.5px] text-muted-foreground leading-[1.5]">
                  {suggestion?.message ?? "Want to start a job while you're here?"}
                </div>
              </SheetHeader>

              {suggestion && suggestion.openJobs.length > 0 && (
                <div className="mb-[14px]">
                  <div className="text-[11.5px] font-display font-bold tracking-[0.1em] uppercase text-muted-foreground mb-[7px]">
                    Open jobs here
                  </div>
                  <div className="flex flex-col gap-[8px]">
                    {suggestion.openJobs.slice(0, 3).map((j) => (
                      <button
                        key={j.id}
                        className="flex items-center gap-[10px] bg-card border border-border rounded-[13px] p-[11px_13px] shadow-[var(--shadow)] text-left transition-transform active:scale-[0.98]"
                        onClick={() => {
                          onOpenChange(false);
                          navigate(`/jobs/${j.id}`);
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-[13.5px] font-semibold truncate">{j.description}</div>
                          <div className="text-[11.5px] text-muted-foreground">
                            {j.jobNo}
                            {j.unitNo ? ` · Unit ${j.unitNo}` : ""} · {j.status}
                          </div>
                        </div>
                        <ChevronRight className="w-[16px] h-[16px] text-muted-foreground shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {suggestion && suggestion.jobIdeas.length > 0 && (
                <div className="mb-[16px]">
                  <div className="flex items-center gap-[6px] text-[11.5px] font-display font-bold tracking-[0.1em] uppercase text-muted-foreground mb-[7px]">
                    <Sparkles className="w-[13px] h-[13px] text-[var(--gold-dark)]" /> HALO suggests
                  </div>
                  <div className="flex flex-col gap-[8px]">
                    {suggestion.jobIdeas.map((idea, i) => (
                      <button
                        key={i}
                        className="flex items-center gap-[10px] bg-card border border-[var(--gold)]/40 rounded-[13px] p-[11px_13px] shadow-[var(--shadow)] text-left transition-transform active:scale-[0.98]"
                        onClick={() => pickIdea(idea)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-[13.5px] font-semibold truncate">{idea.description}</div>
                          <div className="text-[11.5px] text-[var(--gold-dark)] font-display font-bold">
                            {idea.category}
                            {idea.unitNo ? ` · Unit ${idea.unitNo}` : ""}
                          </div>
                        </div>
                        <ChevronRight className="w-[16px] h-[16px] text-muted-foreground shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button
                className="w-full rounded-[13px] py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_6px_20px_rgba(180,255,68,0.35)] transition-transform active:scale-[0.98]"
                onClick={() => setStep("form")}
              >
                Start a job here
              </button>
              <button
                className="w-full mt-[10px] rounded-[13px] py-[12px] font-display font-bold text-[14px] bg-card border border-border text-muted-foreground shadow-[var(--shadow)] transition-transform active:scale-[0.98]"
                onClick={() => onOpenChange(false)}
              >
                Not now
              </button>
            </>
          )}

          {step === "form" && (
            <>
              <SheetHeader className="text-left mb-[14px]">
                <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">
                  New job at {result.propertyName}
                </SheetTitle>
                <div className="text-[13px] text-muted-foreground">
                  Confirm the details and it goes straight on the board.
                </div>
              </SheetHeader>
              <div className="flex flex-col gap-[10px]">
                <input
                  className={fieldCls}
                  placeholder="Description (e.g. Full turn — paint, clean)"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
                <div className="flex gap-[10px]">
                  <input
                    className={fieldCls}
                    placeholder="Category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  />
                  <input
                    className={fieldCls}
                    placeholder="Unit #"
                    value={unitNo}
                    onChange={(e) => setUnitNo(e.target.value)}
                  />
                </div>
              </div>
              <button
                className="w-full mt-[16px] rounded-[13px] py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_6px_20px_rgba(180,255,68,0.35)] disabled:opacity-50 transition-transform active:scale-[0.98]"
                onClick={submit}
                disabled={!description.trim() || create.isPending}
              >
                {create.isPending ? "Creating…" : "Create job"}
              </button>
              <button
                className="w-full mt-[10px] rounded-[13px] py-[12px] font-display font-bold text-[14px] bg-card border border-border text-muted-foreground shadow-[var(--shadow)] transition-transform active:scale-[0.98]"
                onClick={() => setStep("prompt")}
              >
                Back
              </button>
              {create.isError && (
                <div className="text-[12.5px] text-destructive text-center mt-[10px]">
                  Couldn't save. Try again.
                </div>
              )}
            </>
          )}

          {step === "done" && (
            <div className="text-center py-[14px]">
              <CheckCircle2 className="w-[46px] h-[46px] text-[var(--gold-dark)] mx-auto mb-[10px]" strokeWidth={1.6} />
              <div className="font-display font-bold text-[19px]">Job created</div>
              <div className="text-[13.5px] text-muted-foreground mt-[4px]">
                It's on the board at {result.propertyName}.
              </div>
              <button
                className="w-full mt-[18px] rounded-[13px] py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_6px_20px_rgba(180,255,68,0.35)] transition-transform active:scale-[0.98]"
                onClick={() => {
                  onOpenChange(false);
                  if (createdJobId) navigate(`/jobs/${createdJobId}`);
                }}
              >
                Open the job
              </button>
              <button
                className="w-full mt-[10px] rounded-[13px] py-[12px] font-display font-bold text-[14px] bg-card border border-border text-muted-foreground shadow-[var(--shadow)] transition-transform active:scale-[0.98]"
                onClick={() => onOpenChange(false)}
              >
                Done
              </button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
