import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListProperties,
  useGetProperty,
  useQuickCreateJob,
  useUpdateJob,
  useUpdateJobLineItem,
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
  type JobLineItem,
  type StaffingCrew,
} from "@workspace/api-client-react";

/** Mirror of the server's specialty matcher: token containment either way. */
function serviceTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/\d\s*br\b/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}
function crewCoversService(crew: StaffingCrew, service: string): boolean {
  const want = serviceTokens(service);
  if (want.length === 0) return false;
  const profiles = [...(crew.services ?? []), ...(crew.trade ? [crew.trade] : [])];
  return profiles.some((p) => {
    const have = serviceTokens(p);
    if (have.length === 0) return false;
    return want.every((t) => have.includes(t)) || have.every((t) => want.includes(t));
  });
}
import { MapPin, Zap, Plus, Radio, UserCheck, UserMinus, Check } from "lucide-react";

const fieldCls =
  "w-full bg-white border border-border rounded-[11px] py-2.5 px-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40";

const labelCls = "text-[10px] font-bold text-[var(--gold-dark)]";

const primaryBtn =
  "w-full flex items-center justify-center gap-2 bg-[var(--gold-light)] text-black px-4 py-2.5 rounded-full font-bold hover:bg-[var(--gold-dark)] transition-colors shadow-sm disabled:opacity-50 disabled:pointer-events-none";

const errorCls = "text-xs text-destructive text-center mt-2";

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

export function QuickJobDialog({
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
  // Per-service staffing: the created job's line items with local edits
  // (crew picks + staggered start times) layered on top.
  const [items, setItems] = useState<JobLineItem[]>([]);
  const [staffMode, setStaffMode] = useState<"assign" | "pull" | null>(null);
  const [staffedNote, setStaffedNote] = useState<string | null>(null);
  const [broadcastCount, setBroadcastCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const create = useQuickCreateJob();
  const assign = useUpdateJob();
  const updateItem = useUpdateJobLineItem();
  const pull = usePullCrewToJob();
  const broadcast = useBroadcastJob();

  // GPS-proximity preselect: nearest property with coordinates, only when the
  // dialog opens without an explicit property.
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
  // Group the price book for the picker: services sized by bedroom count
  // ("Cabinet Paint — 1/2/3 BR") collapse into one group with a size submenu;
  // everything else is a single flat entry. Prices never show in the list.
  const serviceGroups = useMemo(() => {
    type Group = { base: string; sized: boolean; items: typeof priceItems };
    const strip = (s: string) => s.replace(/\s*[—–-]\s*\d\s*BR\s*$/i, "").trim();
    const byBase = new Map<string, Group>();
    for (const pi of priceItems) {
      const base = strip(pi.service);
      const sized = /\d\s*BR\s*$/i.test(pi.service) || /^\d\s*BR$/i.test(pi.unit ?? "");
      const g = byBase.get(base) ?? { base, sized: false, items: [] as typeof priceItems };
      g.sized = g.sized || sized;
      g.items.push(pi);
      byBase.set(base, g);
    }
    const groups = [...byBase.values()];
    for (const g of groups) {
      // Only treat as a sized group when there is more than one option;
      // sort sizes 1 BR → 3 BR.
      g.sized = g.sized && g.items.length > 1;
      if (g.sized) g.items.sort((a, b) => (a.unit ?? a.service).localeCompare(b.unit ?? b.service));
    }
    return groups.sort((a, b) => a.base.localeCompare(b.base));
  }, [priceItems]);
  // Size-first view of the same price book: every sized option lands under a
  // "1 Bedroom" / "2 Bedroom" / "3 Bedroom" heading (option label = the
  // service name); anything without a bedroom size goes under Other services.
  const sizeGroups = useMemo(() => {
    const strip = (s: string) => s.replace(/\s*[—–-]\s*\d\s*BR\s*$/i, "").trim();
    const sizeOf = (pi: (typeof priceItems)[number]): number | null => {
      const m = /(\d)\s*BR\s*$/i.exec(pi.service) ?? /^(\d)\s*BR$/i.exec(pi.unit ?? "");
      return m ? Number(m[1]) : null;
    };
    const bySize = new Map<number, typeof priceItems>();
    const other: typeof priceItems = [];
    for (const pi of priceItems) {
      const n = sizeOf(pi);
      if (n == null) other.push(pi);
      else bySize.set(n, [...(bySize.get(n) ?? []), pi]);
    }
    const groups = [...bySize.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([n, items]) => ({
        label: `${n} Bedroom`,
        items: items
          .map((pi) => ({ pi, name: strip(pi.service) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }));
    if (other.length > 0)
      groups.push({
        label: "Other services",
        items: other
          .map((pi) => ({ pi, name: pi.service }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      });
    return groups;
  }, [priceItems]);
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
    setItems([]);
    setStaffMode(null);
    setStaffedNote(null);
    setBroadcastCount(0);
    setErrorMsg(null);
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
          setItems((job.lineItems ?? []).filter((li) => li.service !== "Quoted price"));
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
    // With line items, broadcast by specialty: each crew only gets an alert
    // for the services in their specialty profile, with their start time.
    const bySpecialty = items.length > 0;
    broadcast.mutate(
      {
        id: createdJob.id,
        data: bySpecialty
          ? {
              mode: "specialties",
              itemTimes: items.map((li) => ({
                lineItemId: li.id,
                startTime: li.startTime ?? null,
              })),
            }
          : { mode: "all" },
      },
      {
        onSuccess: (r) => {
          setBroadcastCount((c) => c + 1);
          const unmatched = r.unmatchedServices ?? [];
          setStaffedNote(
            r.sent > 0
              ? `Broadcast to ${r.sent} crew${r.sent === 1 ? "" : "s"}${bySpecialty ? " by specialty" : ""} — first to accept wins.${unmatched.length > 0 ? ` No specialty match for: ${unmatched.join(", ")}.` : ""}`
              : "All matching crews already have this offer — rebroadcast refreshed it.",
          );
          invalidateAll(createdJob.propertyId ?? selectedProp);
        },
        onError: (e) => {
          const msg =
            (e as { data?: { error?: string } })?.data?.error ??
            "Broadcast failed. Try again.";
          setErrorMsg(msg);
        },
      },
    );
  };

  const staffed = !!staffedNote;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="border-none shadow-xl max-h-[88vh] overflow-y-auto">
        {!createdJob ? (
          <>
            <DialogHeader>
              <DialogTitle className="font-display">Quick job</DialogTitle>
              <DialogDescription>
                Build it fast, staff it in the next tap.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-2">
              <label className="flex flex-col gap-1.5">
                <span className={labelCls}>Property</span>
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
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-[var(--gold-dark)]">
                    <MapPin className="w-3 h-3" /> Picked from your location
                  </span>
                )}
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className={labelCls}>Unit #</span>
                  <input
                    className={fieldCls}
                    placeholder="Optional"
                    value={unitNo}
                    onChange={(e) => setUnitNo(e.target.value)}
                    data-testid="input-quickjob-unit"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={labelCls}>Due date</span>
                  <input
                    type="date"
                    className={fieldCls}
                    value={dueOn}
                    onChange={(e) => setDueOn(e.target.value)}
                    data-testid="input-quickjob-due"
                  />
                </label>
              </div>

              <label className="flex flex-col gap-1.5">
                <span className={labelCls}>Work description</span>
                <input
                  className={fieldCls}
                  placeholder="Or tap services below"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  data-testid="input-quickjob-description"
                />
              </label>

              {selectedProp && priceItems.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className={`${labelCls} flex items-center gap-1`}>
                    <Zap className="w-3 h-3" /> Add services — price book
                  </span>
                  {/* Organized picker: options grouped by bedroom size
                      (1/2/3 Bedroom), unsized work under Other services; no
                      prices in the list — the rate comes straight from the
                      price book when a service is picked. */}
                  <select
                    className={fieldCls}
                    value=""
                    onChange={(e) => {
                      if (e.target.value) setPillIds((ids) => [...ids, e.target.value]);
                    }}
                    data-testid="select-quickjob-service"
                  >
                    <option value="">Add a service…</option>
                    {sizeGroups.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.items.map(({ pi, name }) => (
                          <option key={pi.id} value={pi.id}>
                            {name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {pillIds.length > 0 && (
                    <div className="flex flex-col gap-1">
                      {[...pillCount.entries()].map(([id, qty]) => {
                        const pi = priceItems.find((p) => p.id === id);
                        if (!pi) return null;
                        return (
                          <div
                            key={id}
                            className="flex items-center justify-between rounded-xl border border-border bg-white px-3 py-1.5 text-sm"
                            data-testid={`selected-service-${id}`}
                          >
                            <span className="truncate font-semibold">
                              {pi.service}
                              {qty > 1 ? ` ×${qty}` : ""}
                            </span>
                            <button
                              type="button"
                              aria-label={`Remove ${pi.service}`}
                              className="ml-2 shrink-0 text-muted-foreground hover:text-destructive font-bold"
                              onClick={() =>
                                setPillIds((ids) => {
                                  const idx = ids.lastIndexOf(id);
                                  return idx === -1 ? ids : ids.filter((_, i) => i !== idx);
                                })
                              }
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                      <div className="flex items-center justify-between px-1">
                        <button
                          type="button"
                          className="text-xs font-semibold text-muted-foreground underline"
                          onClick={() => setPillIds([])}
                        >
                          Clear services
                        </button>
                        <span className="text-sm font-display font-bold tabular-nums">
                          {money(pillTotal)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <label className="flex flex-col gap-1.5">
                <span className={labelCls}>
                  {pillIds.length > 0 ? "Extra price (optional)" : "Price ($, optional)"}
                </span>
                <input
                  type="number"
                  min={0}
                  className={fieldCls}
                  placeholder="0"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  data-testid="input-quickjob-price"
                />
              </label>
            </div>
            <button
              className={primaryBtn}
              onClick={submitCreate}
              disabled={!canCreate}
              data-testid="button-quickjob-create"
            >
              {create.isPending ? "Creating…" : "Create job"}
            </button>
            {errorMsg && <div className={errorCls}>{errorMsg}</div>}
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-display">
                Job {createdJob.jobNo} created
              </DialogTitle>
              <DialogDescription>
                {createdJob.propertyName ?? ""} — staff it now, no navigation.
              </DialogDescription>
            </DialogHeader>

            {staffedNote && (
              <div className="flex items-start gap-2 bg-[var(--gold-light)]/25 border border-[var(--gold-light)] rounded-2xl p-3 my-1">
                <Check className="w-4 h-4 mt-0.5 shrink-0" />
                <div className="text-sm font-semibold" data-testid="text-quickjob-staffed">
                  {staffedNote}
                </div>
              </div>
            )}

            {items.length > 0 && (
              <div className="flex flex-col gap-1.5 py-1">
                <span className={labelCls}>Staff by service — specialty crews</span>
                {items.map((li) => {
                  const specialists = (staffing ?? []).filter((c) =>
                    crewCoversService(c, li.service),
                  );
                  const pool = specialists.length > 0 ? specialists : (staffing ?? []);
                  return (
                    <div
                      key={li.id}
                      className="flex flex-col gap-1.5 bg-white border border-border rounded-xl p-3"
                      data-testid={`quickjob-item-${li.id}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{li.service}</span>
                        {specialists.length === 0 && (
                          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                            No specialty match — showing all
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          className={fieldCls}
                          value={li.assignedCrewId ?? ""}
                          onChange={(e) => {
                            const crewId = e.target.value || null;
                            setItems((cur) =>
                              cur.map((x) =>
                                x.id === li.id
                                  ? {
                                      ...x,
                                      assignedCrewId: crewId,
                                      assignedCrewName:
                                        pool.find((c) => c.id === crewId)?.name ?? null,
                                    }
                                  : x,
                              ),
                            );
                            updateItem.mutate(
                              { id: li.id, data: { assignedCrewId: crewId } },
                              {
                                onSuccess: () =>
                                  invalidateAll(createdJob.propertyId ?? selectedProp),
                                onError: () =>
                                  setErrorMsg("Couldn't save that crew pick. Try again."),
                              },
                            );
                          }}
                          data-testid={`select-quickjob-itemcrew-${li.id}`}
                        >
                          <option value="">
                            {specialists.length > 0 ? "Pick a specialist…" : "Pick a crew…"}
                          </option>
                          {pool.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                              {c.currentJob ? ` — on ${c.currentJob.jobNo}` : ""}
                            </option>
                          ))}
                        </select>
                        {items.length > 1 && (
                          <input
                            type="time"
                            className={fieldCls}
                            value={li.startTime ?? ""}
                            title="Start time — stagger arrivals so crews aren't on site at once"
                            onChange={(e) => {
                              const startTime = e.target.value || null;
                              setItems((cur) =>
                                cur.map((x) => (x.id === li.id ? { ...x, startTime } : x)),
                              );
                              updateItem.mutate(
                                { id: li.id, data: { startTime } },
                                {
                                  onError: () =>
                                    setErrorMsg("Couldn't save that start time. Try again."),
                                },
                              );
                            }}
                            data-testid={`input-quickjob-itemtime-${li.id}`}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
                {items.length > 1 && (
                  <span className="text-[11px] text-muted-foreground px-1">
                    Set start times so specialty crews arrive staggered, not all at once.
                  </span>
                )}
              </div>
            )}

            {!staffed && (
              <div className="flex flex-col gap-2 py-1">
                <button
                  type="button"
                  onClick={() => setStaffMode(staffMode === "assign" ? null : "assign")}
                  className={`w-full flex items-center gap-2.5 rounded-2xl p-3.5 border text-left font-display font-bold text-sm transition-colors ${staffMode === "assign" ? "bg-[var(--gold-light)] border-transparent text-black" : "bg-white border-border hover:border-[var(--gold-dark)]"}`}
                  data-testid="button-quickjob-mode-assign"
                >
                  <UserCheck className="w-4 h-4" /> Assign a crew
                </button>
                {staffMode === "assign" && (
                  <div className="flex flex-col gap-1.5 pl-1.5">
                    {(staffing ?? []).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        disabled={assign.isPending}
                        onClick={() => doAssign(c.id, c.name)}
                        className="flex items-center justify-between bg-white border border-border rounded-xl p-3 text-left hover:border-[var(--gold-dark)] transition-colors disabled:opacity-60"
                        data-testid={`button-quickjob-assign-${c.id}`}
                      >
                        <div className="flex items-center gap-2.5">
                          {c.selfiePath ? (
                            <img
                              src={`/api/storage${c.selfiePath}`}
                              className="w-7 h-7 rounded-full object-cover"
                              alt=""
                            />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-black/10 grid place-items-center text-xs font-bold">
                              {c.name.slice(0, 1)}
                            </div>
                          )}
                          <div>
                            <div className="text-sm font-semibold">{c.name}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {c.currentJob
                                ? `On ${c.currentJob.jobNo} — ${c.currentJob.propertyName ?? ""}`
                                : "Free right now"}
                            </div>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                          {c.todayStatus}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setStaffMode(staffMode === "pull" ? null : "pull")}
                  className={`w-full flex items-center gap-2.5 rounded-2xl p-3.5 border text-left font-display font-bold text-sm transition-colors ${staffMode === "pull" ? "bg-[var(--gold-light)] border-transparent text-black" : "bg-white border-border hover:border-[var(--gold-dark)]"}`}
                  data-testid="button-quickjob-mode-pull"
                >
                  <UserMinus className="w-4 h-4" /> Pull from another job
                </button>
                {staffMode === "pull" && (
                  <div className="flex flex-col gap-1.5 pl-1.5">
                    {(staffing ?? []).filter((c) => c.currentJob).length === 0 && (
                      <div className="text-sm text-muted-foreground p-2">
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
                          className="flex flex-col bg-white border border-border rounded-xl p-3 text-left hover:border-[var(--gold-dark)] transition-colors disabled:opacity-60"
                          data-testid={`button-quickjob-pull-${c.id}`}
                        >
                          <div className="text-sm font-semibold">{c.name}</div>
                          <div className="text-[11px] text-muted-foreground">
                            Now on {c.currentJob!.jobNo} — {c.currentJob!.propertyName ?? ""}
                            {c.currentJob!.scheduledOn ? ` · ${c.currentJob!.scheduledOn}` : ""}
                          </div>
                          <div className="text-[11px] text-[var(--gold-dark)] font-semibold mt-0.5">
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
                  className="w-full flex items-center gap-2.5 rounded-2xl p-3.5 border border-border bg-white text-left font-display font-bold text-sm hover:border-[var(--gold-dark)] transition-colors disabled:opacity-60"
                  data-testid="button-quickjob-broadcast"
                >
                  <Radio className="w-4 h-4" />
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
                className="w-full flex items-center justify-center gap-2 rounded-2xl p-3 border border-border bg-white font-display font-bold text-sm hover:border-[var(--gold-dark)] transition-colors disabled:opacity-60"
              >
                <Radio className="w-4 h-4" />
                {broadcastCount > 0 ? "Rebroadcast for more help" : "Also broadcast for more help"}
              </button>
            )}

            {errorMsg && <div className={`${errorCls} mb-1`}>{errorMsg}</div>}

            <button
              className={primaryBtn}
              onClick={() => close(false)}
              data-testid="button-quickjob-done"
            >
              Done
            </button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
