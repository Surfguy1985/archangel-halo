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
  useListCatalogItems,
  useCreatePriceItem,
  getListJobsQueryKey,
  getGetPropertyQueryKey,
  getGetTodayQueryKey,
  getGetCalendarQueryKey,
  getListJobBoardQueryKey,
  getGetStaffingContextQueryKey,
  getListCatalogItemsQueryKey,
  type Job,
  type CatalogItem,
} from "@workspace/api-client-react";
import { MapPin, Zap, Plus, Radio, UserCheck, UserMinus, Check, Siren, ChevronDown, X } from "lucide-react";
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [serviceQuery, setServiceQuery] = useState("");
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);

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

  // Catalog master list — same grouping as the desktop dialog.
  const { data: catalog } = useListCatalogItems({
    query: { queryKey: getListCatalogItemsQueryKey(), enabled: open },
  });
  const createPriceItem = useCreatePriceItem();

  const catalogGroups = useMemo(() => {
    const items = catalog ?? [];
    const strip = (s: string) => s.replace(/\s*[—–-]\s*\d\s*BR\s*$/i, "").trim();
    const sizeOf = (ci: CatalogItem): number | null => {
      const m = /(\d)\s*BR\s*$/i.exec(ci.service) ?? /^(\d)\s*BR$/i.exec(ci.unit ?? "");
      return m ? Number(m[1]) : null;
    };
    type Entry = { base: string; variants: { size: number; item: CatalogItem }[]; single: CatalogItem | null };
    const byCat = new Map<string, Map<string, Entry>>();
    for (const ci of items) {
      const cat = ci.category?.trim() || "Other";
      const byBase = byCat.get(cat) ?? new Map<string, Entry>();
      byCat.set(cat, byBase);
      const size = sizeOf(ci);
      const base = strip(ci.service);
      const entry = byBase.get(base) ?? { base, variants: [], single: null };
      if (size == null) entry.single = ci;
      else entry.variants.push({ size, item: ci });
      byBase.set(base, entry);
    }
    const isMR = (s: string) => /make[\s-]?ready/i.test(s);
    return [...byCat.entries()]
      .sort(([a], [b]) => Number(isMR(b)) - Number(isMR(a)) || a.localeCompare(b))
      .map(([label, byBase]) => ({
        label,
        entries: [...byBase.values()]
          .map((e) => ({ ...e, variants: [...e.variants].sort((a, b) => a.size - b.size) }))
          .sort((a, b) => a.base.localeCompare(b.base)),
      }));
  }, [catalog]);

  const addCatalogService = (ci: CatalogItem) => {
    const norm = (s: string) => s.toLowerCase().replace(/[—–]/g, "-").replace(/\s+/g, " ").trim();
    const existing = priceItems.find((p) => norm(p.service) === norm(ci.service));
    if (existing) {
      setPillIds((ids) => [...ids, existing.id]);
      return;
    }
    setAddingId(ci.id);
    createPriceItem.mutate(
      {
        id: selectedProp,
        data: {
          service: ci.service,
          detail: ci.detail ?? undefined,
          unit: ci.unit ?? undefined,
          rate: ci.rate ?? 0,
          category: ci.category ?? undefined,
        },
      },
      {
        onSuccess: (pi) => {
          setAddingId(null);
          setPillIds((ids) => [...ids, pi.id]);
          queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(selectedProp) });
        },
        onError: () => {
          setAddingId(null);
          setErrorMsg("Couldn't add that service. Try again.");
        },
      },
    );
  };

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
    setPickerOpen(false);
    setServiceQuery("");
    setOpenCat(null);
    setAddingId(null);
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
                {selectedProp && (
                  <div className="flex flex-col gap-[8px]">
                    <div className="text-[12px] font-display font-bold text-muted-foreground ml-[2px] flex items-center gap-[4px]">
                      <Zap className="w-[11px] h-[11px]" /> Add services
                    </div>

                    {/* Catalog picker trigger */}
                    <button
                      type="button"
                      onClick={() => setPickerOpen((o) => !o)}
                      className={`${fieldCls} flex items-center justify-between text-left`}
                      data-testid="button-quickjob-service-picker"
                    >
                      <span className="text-muted-foreground text-[14px]">
                        {pickerOpen ? "Tap a service to add it…" : "Browse services…"}
                      </span>
                      <ChevronDown
                        className={`w-[16px] h-[16px] shrink-0 text-muted-foreground transition-transform ${pickerOpen ? "rotate-180" : ""}`}
                      />
                    </button>

                    {/* Grouped catalog dropdown */}
                    {pickerOpen && (
                      <div className="rounded-[16px] border border-border bg-card shadow-[0_4px_20px_rgba(0,0,0,0.10)] overflow-hidden max-h-[52vh] flex flex-col">
                        {/* Search */}
                        <div className="sticky top-0 z-20 bg-card border-b border-border p-[8px]">
                          <input
                            className={`${fieldCls} py-[10px] text-[13px]`}
                            placeholder="Search services…"
                            value={serviceQuery}
                            onChange={(e) => setServiceQuery(e.target.value)}
                            data-testid="input-quickjob-service-search"
                          />
                        </div>

                        {/* Category groups */}
                        <div className="overflow-y-auto flex-1">
                          {catalogGroups
                            .map((g) => {
                              const q = serviceQuery.trim().toLowerCase();
                              const entries = q
                                ? g.entries.filter((e) => e.base.toLowerCase().includes(q) || g.label.toLowerCase().includes(q))
                                : g.entries;
                              return { ...g, entries };
                            })
                            .filter((g) => g.entries.length > 0)
                            .map((g) => {
                              const searching = serviceQuery.trim().length > 0;
                              const expanded = searching || openCat === g.label;
                              return (
                                <div key={g.label}>
                                  {/* Category header */}
                                  <button
                                    type="button"
                                    onClick={() => !searching && setOpenCat((c) => (c === g.label ? null : g.label))}
                                    className="sticky top-0 z-10 w-full flex items-center justify-between bg-[var(--paper)] px-[14px] py-[9px] text-[10px] font-bold uppercase tracking-widest text-muted-foreground"
                                    data-testid={`toggle-cat-${g.label}`}
                                  >
                                    <span>{g.label}</span>
                                    <span className="flex items-center gap-[5px] normal-case tracking-normal">
                                      <span className="font-semibold">{g.entries.length}</span>
                                      {!searching && (
                                        <ChevronDown className={`w-[13px] h-[13px] transition-transform ${expanded ? "rotate-180" : ""}`} />
                                      )}
                                    </span>
                                  </button>

                                  {expanded && (
                                    <div className="divide-y divide-border">
                                      {g.entries.map((e) => (
                                        <div key={e.base} className="px-[14px] py-[10px]">
                                          {e.variants.length > 0 ? (
                                            /* Bedroom-sized variants — collapse to one row */
                                            <div className="flex items-center justify-between gap-[8px]">
                                              <span className="text-[14px] font-semibold truncate">{e.base}</span>
                                              <div className="flex items-center gap-[6px] shrink-0">
                                                {e.variants.map(({ size, item }) => (
                                                  <button
                                                    key={item.id}
                                                    type="button"
                                                    disabled={addingId != null}
                                                    onClick={() => addCatalogService(item)}
                                                    className="rounded-full border border-border px-[10px] py-[4px] text-[12px] font-bold active:bg-[var(--gold-light)] transition-colors disabled:opacity-50"
                                                    data-testid={`pick-service-${item.id}`}
                                                  >
                                                    {addingId === item.id ? "…" : `${size} BR`}
                                                  </button>
                                                ))}
                                                {e.single && (
                                                  <button
                                                    type="button"
                                                    disabled={addingId != null}
                                                    onClick={() => addCatalogService(e.single!)}
                                                    className="rounded-full border border-border px-[10px] py-[4px] text-[12px] font-bold active:bg-[var(--gold-light)] transition-colors disabled:opacity-50"
                                                    data-testid={`pick-service-${e.single.id}`}
                                                  >
                                                    {addingId === e.single.id ? "…" : "Add"}
                                                  </button>
                                                )}
                                              </div>
                                            </div>
                                          ) : (
                                            /* Single-rate service */
                                            <button
                                              type="button"
                                              disabled={addingId != null}
                                              onClick={() => e.single && addCatalogService(e.single)}
                                              className="w-full flex items-center justify-between gap-[8px] text-left disabled:opacity-50"
                                              data-testid={`pick-service-${e.single?.id}`}
                                            >
                                              <span className="text-[14px] font-semibold truncate">{e.base}</span>
                                              <span className="shrink-0 rounded-full border border-border px-[10px] py-[4px] text-[12px] font-bold">
                                                {addingId === e.single?.id ? "…" : "Add"}
                                              </span>
                                            </button>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}

                          {catalogGroups.length === 0 && (
                            <div className="p-[20px] text-center text-[13px] text-muted-foreground">
                              No services in the master list yet — add them in Admin.
                            </div>
                          )}
                        </div>

                        {/* Done button */}
                        <button
                          type="button"
                          onClick={() => { setPickerOpen(false); setServiceQuery(""); }}
                          className="sticky bottom-0 bg-card border-t border-border px-[14px] py-[10px] text-[12px] font-bold text-[var(--gold-dark)]"
                        >
                          Done
                        </button>
                      </div>
                    )}

                    {/* Selected services list */}
                    {pillIds.length > 0 && (
                      <div className="flex flex-col gap-[5px]">
                        {[...pillCount.entries()].map(([id, qty]) => {
                          const pi = priceItems.find((p) => p.id === id);
                          if (!pi) return null;
                          return (
                            <div
                              key={id}
                              className="flex items-center justify-between rounded-[12px] border border-border bg-card px-[14px] py-[10px] text-[14px]"
                              data-testid={`selected-service-${id}`}
                            >
                              <span className="truncate font-semibold">
                                {pi.service}{qty > 1 ? ` ×${qty}` : ""}
                              </span>
                              <div className="flex items-center gap-[10px] ml-[8px] shrink-0">
                                <span className="text-[13px] font-bold tabular-nums text-muted-foreground">
                                  {money(pi.rate)}
                                </span>
                                <button
                                  type="button"
                                  aria-label={`Remove ${pi.service}`}
                                  className="text-muted-foreground"
                                  onClick={() =>
                                    setPillIds((ids) => {
                                      const idx = ids.lastIndexOf(id);
                                      return idx === -1 ? ids : ids.filter((_, i) => i !== idx);
                                    })
                                  }
                                >
                                  <X className="w-[15px] h-[15px]" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                        <div className="flex items-center justify-between px-[4px] mt-[2px]">
                          <button
                            type="button"
                            className="text-[12px] font-semibold text-muted-foreground underline"
                            onClick={() => setPillIds([])}
                          >
                            Clear services
                          </button>
                          <span className="text-[14px] font-display font-bold tabular-nums">
                            {money(pillTotal)}
                          </span>
                        </div>
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
