import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListProperties,
  useGetProperty,
  useQuickCreateJob,
  useUpdateJob,
  usePullCrewToJob,
  useBroadcastJob,
  useGetStaffingContext,
  getListJobsQueryKey,
  getGetPropertyQueryKey,
  getGetTodayQueryKey,
  getGetCalendarQueryKey,
  getListJobBoardQueryKey,
  getGetStaffingContextQueryKey,
  type Job,
} from "@workspace/api-client-react";
import { MapPin, Zap, Plus, Radio, UserCheck, UserMinus, Check, Siren } from "lucide-react";
import { EmergencyPingSheet } from "@/components/EmergencyPingSheet";

const fieldCls =
  "w-full bg-card border border-[var(--hairline)] rounded-[18px] py-[14px] px-[16px] text-[15px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-[var(--ink)] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40 focus:border-[var(--gold)]";

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function QuickJobSheet({
  open,
  onOpenChange,
  propertyId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Preselect this property (property detail entry point) — skips GPS pick. */
  propertyId?: string;
}) {
  const queryClient = useQueryClient();
  const { data: properties } = useListProperties();
  const [selectedProp, setSelectedProp] = useState(propertyId ?? "");
  const [gpsPicked, setGpsPicked] = useState(false);
  const { data: propertyDetail } = useGetProperty(selectedProp, {
    query: { queryKey: getGetPropertyQueryKey(selectedProp), enabled: !!selectedProp },
  });
  const { data: staffing } = useGetStaffingContext({
    query: { queryKey: getGetStaffingContextQueryKey(), enabled: open },
  });

  const [description, setDescription] = useState("");
  const [unitNo, setUnitNo] = useState("");
  const [price, setPrice] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [pillIds, setPillIds] = useState<string[]>([]);
  const [createdJob, setCreatedJob] = useState<Job | null>(null);
  const [staffMode, setStaffMode] = useState<"assign" | "pull" | null>(null);
  const [staffedNote, setStaffedNote] = useState<string | null>(null);
  const [broadcastCount, setBroadcastCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [emergencyOpen, setEmergencyOpen] = useState(false);

  const create = useQuickCreateJob();
  const assign = useUpdateJob();
  const pull = usePullCrewToJob();
  const broadcast = useBroadcastJob();

  // GPS-proximity preselect: nearest property with coordinates, only when the
  // sheet opens without an explicit property.
  useEffect(() => {
    if (!open || propertyId || selectedProp || !properties?.length) return;
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const withCoords = properties.filter(
          (p) => p.latitude != null && p.longitude != null,
        );
        if (withCoords.length === 0) return;
        let best = withCoords[0];
        let bestD = Infinity;
        for (const p of withCoords) {
          const d = haversineKm(
            pos.coords.latitude,
            pos.coords.longitude,
            p.latitude!,
            p.longitude!,
          );
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
        // Only auto-pick when plausibly on/near the site (within ~2 km).
        if (bestD <= 2) {
          setSelectedProp((cur) => {
            if (cur) return cur;
            setGpsPicked(true);
            return best.id;
          });
        }
      },
      () => {},
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 60_000 },
    );
  }, [open, propertyId, properties, selectedProp]);

  useEffect(() => {
    if (open && propertyId) setSelectedProp(propertyId);
  }, [open, propertyId]);

  const priceItems = propertyDetail?.priceItems ?? [];
  const pillCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const id of pillIds) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [pillIds]);
  const pillTotal = pillIds.reduce((s, id) => {
    const pi = priceItems.find((p) => p.id === id);
    return s + (pi?.rate ?? 0);
  }, 0);

  const reset = () => {
    setSelectedProp(propertyId ?? "");
    setGpsPicked(false);
    setDescription("");
    setUnitNo("");
    setPrice("");
    setDueOn("");
    setPillIds([]);
    setCreatedJob(null);
    setStaffMode(null);
    setStaffedNote(null);
    setBroadcastCount(0);
    setErrorMsg(null);
    setEmergencyOpen(false);
  };

  const close = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const invalidateAll = (propId: string) => {
    queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propId) });
    queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCalendarQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListJobBoardQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetStaffingContextQueryKey() });
  };

  const canCreate =
    !!selectedProp &&
    (description.trim().length > 0 || pillIds.length > 0) &&
    !create.isPending;

  const submitCreate = () => {
    if (!canCreate) return;
    setErrorMsg(null);
    const pillNames = [...pillCount.entries()]
      .map(([id, qty]) => {
        const pi = priceItems.find((p) => p.id === id);
        return pi ? `${pi.service}${qty > 1 ? ` ×${qty}` : ""}` : null;
      })
      .filter(Boolean)
      .join(", ");
    create.mutate(
      {
        data: {
          propertyId: selectedProp,
          description: description.trim() || pillNames,
          unitNo: unitNo.trim() || undefined,
          dueOn: dueOn || undefined,
          price: price && Number(price) > 0 ? Number(price) : undefined,
          priceItemIds: pillIds.length > 0 ? pillIds : undefined,
        },
      },
      {
        onSuccess: (job) => {
          setCreatedJob(job);
          invalidateAll(selectedProp);
        },
        onError: () => setErrorMsg("Couldn't create the job. Try again."),
      },
    );
  };

  const doAssign = (crewId: string, crewName: string) => {
    if (!createdJob) return;
    setErrorMsg(null);
    assign.mutate(
      { id: createdJob.id, data: { crewLeaderId: crewId } },
      {
        onSuccess: () => {
          setStaffedNote(`${crewName} is on it.`);
          invalidateAll(createdJob.propertyId ?? selectedProp);
        },
        onError: () => setErrorMsg("Couldn't assign that crew. Try again."),
      },
    );
  };

  const doPull = (crewId: string, crewName: string, fromJobId: string) => {
    if (!createdJob) return;
    setErrorMsg(null);
    pull.mutate(
      { id: createdJob.id, data: { crewId, fromJobId } },
      {
        onSuccess: (r) => {
          setStaffedNote(
            `${crewName} pulled onto this job. Job ${r.vacatedJob.jobNo} is flagged in Today until it's restaffed.`,
          );
          invalidateAll(createdJob.propertyId ?? selectedProp);
        },
        onError: () =>
          setErrorMsg("Couldn't pull that crew — they may have just moved. Refresh and retry."),
      },
    );
  };

  const doBroadcast = () => {
    if (!createdJob) return;
    setErrorMsg(null);
    broadcast.mutate(
      { id: createdJob.id, data: { mode: "all" } },
      {
        onSuccess: (r) => {
          setBroadcastCount((c) => c + 1);
          setStaffedNote(
            r.sent > 0
              ? `Broadcast to ${r.sent} crew${r.sent === 1 ? "" : "s"} — first to accept wins.`
              : "All crews already have this offer — rebroadcast refreshed it.",
          );
          invalidateAll(createdJob.propertyId ?? selectedProp);
        },
        onError: () => setErrorMsg("Broadcast failed. Try again."),
      },
    );
  };

  const staffed = !!staffedNote;

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent
        side="bottom"
        className="rounded-t-[26px] bg-[var(--paper)] p-0 flex flex-col max-h-[90vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]"
      >
        <div className="w-[40px] h-[4.5px] rounded-[3px] bg-[rgba(23,24,28,0.16)] mx-auto mt-[10px] mb-[4px] shrink-0" />
        <div className="p-[8px_20px_26px] overflow-y-auto">
          {!createdJob ? (
            <>
              <SheetHeader className="text-left mb-[14px]">
                <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">
                  Quick job
                </SheetTitle>
                <div className="text-[13px] text-muted-foreground">
                  Build it on-site, staff it in the next tap.
                </div>
              </SheetHeader>
              <div className="flex flex-col gap-[10px]">
                <div>
                  <select
                    className={fieldCls}
                    value={selectedProp}
                    onChange={(e) => {
                      setSelectedProp(e.target.value);
                      setGpsPicked(false);
                      setPillIds([]);
                    }}
                    data-testid="select-quickjob-property"
                  >
                    <option value="">Pick a property…</option>
                    {properties?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {gpsPicked && (
                    <div className="flex items-center gap-[5px] text-[11.5px] text-[var(--gold-dark,#7a8a1e)] font-semibold mt-[5px] ml-[4px]">
                      <MapPin className="w-[12px] h-[12px]" /> Picked from your location
                    </div>
                  )}
                </div>
                <div className="flex gap-[10px]">
                  <input
                    className={fieldCls}
                    placeholder="Unit #"
                    value={unitNo}
                    onChange={(e) => setUnitNo(e.target.value)}
                    data-testid="input-quickjob-unit"
                  />
                  <input
                    type="date"
                    className={fieldCls}
                    value={dueOn}
                    onChange={(e) => setDueOn(e.target.value)}
                    data-testid="input-quickjob-due"
                  />
                </div>
                <input
                  className={fieldCls}
                  placeholder="Work description (or tap services below)"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  data-testid="input-quickjob-description"
                />
                {selectedProp && priceItems.length > 0 && (
                  <div>
                    <div className="text-[12px] font-display font-bold text-muted-foreground mb-[6px] ml-[2px]">
                      <Zap className="w-[11px] h-[11px] inline mr-[3px] -mt-[1px]" />
                      Tap to add — price book
                    </div>
                    <div className="flex flex-wrap gap-[7px]">
                      {priceItems.map((pi) => {
                        const n = pillCount.get(pi.id) ?? 0;
                        return (
                          <button
                            key={pi.id}
                            type="button"
                            onClick={() => setPillIds((ids) => [...ids, pi.id])}
                            className={`inline-flex items-center gap-[6px] pl-[12px] pr-[10px] py-[8px] rounded-full border shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-[13px] font-semibold active:scale-[0.94] transition-transform ${
                              n > 0
                                ? "bg-[var(--primary)] border-transparent text-[var(--ink)]"
                                : "bg-card border-[var(--hairline)] text-[var(--ink)]"
                            }`}
                            data-testid={`pill-quickjob-${pi.id}`}
                          >
                            {pi.service}
                            <span className="text-[12px] font-bold tabular-nums">
                              {money(pi.rate)}
                            </span>
                            {n > 0 ? (
                              <span className="text-[11px] font-bold">×{n}</span>
                            ) : (
                              <Plus className="w-[11px] h-[11px]" strokeWidth={3} />
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {pillIds.length > 0 && (
                      <div className="flex items-center justify-between mt-[8px] px-[4px]">
                        <button
                          type="button"
                          className="text-[12px] font-semibold text-muted-foreground underline"
                          onClick={() => setPillIds([])}
                        >
                          Clear services
                        </button>
                        <span className="text-[13px] font-display font-bold tabular-nums">
                          {money(pillTotal)}
                        </span>
                      </div>
                    )}
                  </div>
                )}
                <input
                  type="number"
                  min={0}
                  className={fieldCls}
                  placeholder={pillIds.length > 0 ? "Extra price (optional)" : "Price ($, optional)"}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  data-testid="input-quickjob-price"
                />
              </div>
              <button
                className="w-full mt-[16px] rounded-full py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_4px_14px_rgba(180,255,68,0.35)] disabled:opacity-50 transition-transform active:scale-[0.98]"
                onClick={submitCreate}
                disabled={!canCreate}
                data-testid="button-quickjob-create"
              >
                {create.isPending ? "Creating…" : "Create job"}
              </button>
              {errorMsg && (
                <div className="text-[12.5px] text-destructive text-center mt-[10px]">{errorMsg}</div>
              )}
            </>
          ) : (
            <>
              <SheetHeader className="text-left mb-[14px]">
                <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">
                  Job {createdJob.jobNo} created
                </SheetTitle>
                <div className="text-[13px] text-muted-foreground">
                  {createdJob.propertyName ?? ""} — staff it now, no navigation.
                </div>
              </SheetHeader>

              {staffedNote && (
                <div className="flex items-start gap-[8px] bg-[var(--primary)]/25 border border-[var(--primary)] rounded-[16px] p-[12px] mb-[12px]">
                  <Check className="w-[16px] h-[16px] mt-[1px] shrink-0" />
                  <div className="text-[13.5px] font-semibold" data-testid="text-quickjob-staffed">
                    {staffedNote}
                  </div>
                </div>
              )}

              {!staffed && (
                <div className="flex flex-col gap-[8px] mb-[12px]">
                  <button
                    type="button"
                    onClick={() => setStaffMode(staffMode === "assign" ? null : "assign")}
                    className={`w-full flex items-center gap-[10px] rounded-[18px] p-[14px] border text-left font-display font-bold text-[14.5px] active:scale-[0.98] transition-transform ${staffMode === "assign" ? "bg-[var(--primary)] border-transparent" : "bg-card border-[var(--hairline)]"}`}
                    data-testid="button-quickjob-mode-assign"
                  >
                    <UserCheck className="w-[18px] h-[18px]" /> Assign a crew
                  </button>
                  {staffMode === "assign" && (
                    <div className="flex flex-col gap-[6px] pl-[6px]">
                      {(staffing ?? []).map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          disabled={assign.isPending}
                          onClick={() => doAssign(c.id, c.name)}
                          className="flex items-center justify-between bg-card border border-[var(--hairline)] rounded-[16px] p-[12px] text-left active:scale-[0.98] transition-transform disabled:opacity-60"
                          data-testid={`button-quickjob-assign-${c.id}`}
                        >
                          <div className="flex items-center gap-[10px]">
                            {c.selfiePath ? (
                              <img
                                src={`/api/storage${c.selfiePath}`}
                                className="w-[30px] h-[30px] rounded-full object-cover"
                                alt=""
                              />
                            ) : (
                              <div className="w-[30px] h-[30px] rounded-full bg-[var(--ink)]/10 grid place-items-center text-[12px] font-bold">
                                {c.name.slice(0, 1)}
                              </div>
                            )}
                            <div>
                              <div className="text-[14px] font-semibold">{c.name}</div>
                              <div className="text-[11.5px] text-muted-foreground">
                                {c.currentJob
                                  ? `On ${c.currentJob.jobNo} — ${c.currentJob.propertyName ?? ""}`
                                  : "Free right now"}
                              </div>
                            </div>
                          </div>
                          <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                            {c.todayStatus}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setStaffMode(staffMode === "pull" ? null : "pull")}
                    className={`w-full flex items-center gap-[10px] rounded-[18px] p-[14px] border text-left font-display font-bold text-[14.5px] active:scale-[0.98] transition-transform ${staffMode === "pull" ? "bg-[var(--primary)] border-transparent" : "bg-card border-[var(--hairline)]"}`}
                    data-testid="button-quickjob-mode-pull"
                  >
                    <UserMinus className="w-[18px] h-[18px]" /> Pull from another job
                  </button>
                  {staffMode === "pull" && (
                    <div className="flex flex-col gap-[6px] pl-[6px]">
                      {(staffing ?? []).filter((c) => c.currentJob).length === 0 && (
                        <div className="text-[13px] text-muted-foreground p-[8px]">
                          No crews are on active jobs right now.
                        </div>
                      )}
                      {(staffing ?? [])
                        .filter((c) => c.currentJob && c.currentJob.id !== createdJob.id)
                        .map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            disabled={pull.isPending}
                            onClick={() => doPull(c.id, c.name, c.currentJob!.id)}
                            className="flex flex-col bg-card border border-[var(--hairline)] rounded-[16px] p-[12px] text-left active:scale-[0.98] transition-transform disabled:opacity-60"
                            data-testid={`button-quickjob-pull-${c.id}`}
                          >
                            <div className="text-[14px] font-semibold">{c.name}</div>
                            <div className="text-[11.5px] text-muted-foreground">
                              Now on {c.currentJob!.jobNo} — {c.currentJob!.propertyName ?? ""}
                              {c.currentJob!.scheduledOn ? ` · ${c.currentJob!.scheduledOn}` : ""}
                            </div>
                            <div className="text-[11px] text-[var(--gold-dark,#7a8a1e)] font-semibold mt-[3px]">
                              Pulling them flags {c.currentJob!.jobNo} in Today until restaffed
                            </div>
                          </button>
                        ))}
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={broadcast.isPending}
                    onClick={doBroadcast}
                    className="w-full flex items-center gap-[10px] rounded-[18px] p-[14px] border border-[var(--hairline)] bg-card text-left font-display font-bold text-[14.5px] active:scale-[0.98] transition-transform disabled:opacity-60"
                    data-testid="button-quickjob-broadcast"
                  >
                    <Radio className="w-[18px] h-[18px]" />
                    {broadcast.isPending
                      ? "Broadcasting…"
                      : broadcastCount > 0
                        ? "Rebroadcast to the job board"
                        : "Broadcast to the job board"}
                  </button>
                </div>
              )}

              {staffed && (
                <button
                  type="button"
                  onClick={doBroadcast}
                  disabled={broadcast.isPending}
                  className="w-full flex items-center justify-center gap-[8px] rounded-[18px] p-[12px] border border-[var(--hairline)] bg-card font-display font-bold text-[13.5px] mb-[10px] active:scale-[0.98] transition-transform disabled:opacity-60"
                >
                  <Radio className="w-[15px] h-[15px]" />
                  {broadcastCount > 0 ? "Rebroadcast for more help" : "Also broadcast for more help"}
                </button>
              )}

              {errorMsg && (
                <div className="text-[12.5px] text-destructive text-center mb-[8px]">{errorMsg}</div>
              )}

              <button
                type="button"
                onClick={() => setEmergencyOpen(true)}
                data-testid="button-quickjob-emergency"
                className="w-full flex items-center justify-center gap-[8px] rounded-[18px] p-[12px] border border-red-200 bg-card font-display font-bold text-[13.5px] text-red-600 mb-[10px] active:scale-[0.98] transition-transform"
              >
                <Siren className="w-[15px] h-[15px]" /> Emergency ping — need someone now?
              </button>

              <button
                className="w-full rounded-full py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_4px_14px_rgba(180,255,68,0.35)] transition-transform active:scale-[0.98]"
                onClick={() => close(false)}
                data-testid="button-quickjob-done"
              >
                Done
              </button>
            </>
          )}
        </div>
      </SheetContent>
      {createdJob && (
        <EmergencyPingSheet
          jobId={createdJob.id}
          open={emergencyOpen}
          onOpenChange={setEmergencyOpen}
        />
      )}
    </Sheet>
  );
}
