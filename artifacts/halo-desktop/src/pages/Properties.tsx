import {
  useListProperties,
  useListJobs,
  useGeneratePropertyImage,
  useDeleteProperty,
  getListPropertiesQueryKey,
  getListJobsQueryKey,
  getGetPropertyQueryKey,
  type Job,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, useLocation } from "wouter";
import { Building, Plus, Search, MapPin, Building2, Sparkles, Settings, LayoutList, LayoutGrid, Trash2, AlertTriangle } from "lucide-react";
import { useState, useEffect, useRef, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AddPropertyDialog } from "@/components/PropertyDialogs";
import { PropertySopDialog } from "@/components/PropertySopDialog";
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

function useAutoGenerateImages(properties?: { id: string; imagePath?: string | null }[]) {
  const queryClient = useQueryClient();
  const requested = useRef<Set<string>>(new Set());
  const { mutate } = useGeneratePropertyImage({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPropertiesQueryKey() });
      },
    },
  });

  useEffect(() => {
    if (!properties) return;
    for (const p of properties) {
      if (!p.imagePath && !requested.current.has(p.id)) {
        requested.current.add(p.id);
        mutate({ id: p.id });
      }
    }
  }, [properties, mutate]);
}

// 5-segment job stage bars — same derivation as PropertyDetail site-map boxes.
function jobStages(job: Job): boolean[] {
  const crewAssigned = !!job.crewLeaderId;
  // Work is started once the crew has checked in or the board advances past open/scheduled.
  const workDone =
    !!job.workStartedAt ||
    job.status === "complete" ||
    job.status === "paid" ||
    ["in_progress", "completed", "billing", "pay_alert", "done"].includes(job.boardStatus ?? "");
  // Invoice is "sent" only when boardStatus reaches billing or later — NOT when
  // invoicedTotal > 0, which is true even for draft invoices and causes every
  // box to falsely jump to stage 3.
  const invoiced =
    ["billing", "pay_alert", "done"].includes(job.boardStatus ?? "") ||
    job.status === "paid";
  // Money settled = both client payment AND crew pay confirmed.
  const moneySettled =
    (job.status === "paid" && job.crewPaymentStatus === "paid") ||
    job.boardStatus === "done";
  const closed = !!job.clearedAt;
  return [crewAssigned, workDone, invoiced, moneySettled, closed];
}

const STAGE_LABELS = ["Needs crew", "Work", "Invoice", "Get paid", "Close out"] as const;

function JobBox({ job, onClick }: { job: Job; onClick?: () => void }) {
  const stages = jobStages(job);
  const doneCount = stages.filter(Boolean).length;
  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-[var(--secondary)] text-white rounded-xl p-3 text-left hover:shadow-[var(--shadow-lift)] transition-all active:scale-[0.97] w-full border border-transparent"
      data-testid={`prop-sitemap-job-${job.id}`}
    >
      <div className="font-display font-bold text-base leading-tight truncate">
        {job.unitNo || "Common"}
      </div>
      <div className="text-[10px] text-[rgba(255,255,255,0.6)] truncate mt-0.5">
        {job.category || "General"}
      </div>
      <div className="mt-2 flex gap-[3px]">
        {stages.map((done, i) => (
          <span
            key={i}
            className={`h-[4px] flex-1 rounded-full ${done ? "bg-[var(--gold-light)]" : "bg-[rgba(255,255,255,0.2)]"}`}
          />
        ))}
      </div>
      <div className="mt-1 text-[9px] font-bold uppercase tracking-wide text-[rgba(255,255,255,0.55)]">
        {doneCount >= 5 ? "Closed" : STAGE_LABELS[doneCount]}
      </div>
    </button>
  );
}

export default function Properties() {
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"list" | "map">("map");
  const [addOpen, setAddOpen] = useState(false);
  const [sopProperty, setSopProperty] = useState<{ id: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { data: properties, isLoading: propsLoading } = useListProperties(undefined, { query: { queryKey: getListPropertiesQueryKey(), refetchInterval: 30000 } });
  const { data: allJobs, isLoading: jobsLoading } = useListJobs(undefined, {
    query: { queryKey: getListJobsQueryKey(), refetchInterval: 30000 },
  });
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const del = useDeleteProperty();

  const confirmDelete = () => {
    if (!deleteTarget) return;
    setDeleteError(null);
    del.mutate(
      { id: deleteTarget.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPropertiesQueryKey() });
          queryClient.removeQueries({ queryKey: getGetPropertyQueryKey(deleteTarget.id) });
          setDeleteTarget(null);
          navigate("/properties");
        },
        onError: (err: unknown) => {
          const msg =
            (err as { data?: { error?: string } })?.data?.error ||
            "Couldn't delete — it may still have jobs attached.";
          setDeleteError(msg);
        },
      },
    );
  };

  useAutoGenerateImages(properties);

  const filtered = (properties ?? []).filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.pmcName?.toLowerCase().includes(search.toLowerCase()),
  );

  // For site map: group active (non-cleared) jobs by propertyId.
  const jobsByProperty = useMemo(() => {
    const map = new Map<string, Job[]>();
    for (const job of allJobs ?? []) {
      if (job.clearedAt) continue;
      const pid = job.propertyId ?? "none";
      const list = map.get(pid) ?? [];
      list.push(job);
      map.set(pid, list);
    }
    return map;
  }, [allJobs]);

  const isLoading = propsLoading || jobsLoading;

  return (
    <>
    <div className="theme-light p-8 max-w-[1200px] mx-auto animate-in fade-in duration-500">
      <div className="cl-panel rounded-[24px] p-6 md:p-8 flex flex-col min-h-[70vh]">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="font-display font-bold text-2xl text-[var(--ink)] tracking-tight">Properties</h1>
            <p className="text-[var(--ink2)] mt-1 text-sm">{properties?.length || 0} active locations</p>
          </div>
          <div className="flex items-center gap-3">
            {/* View toggle */}
            <div className="flex rounded-xl overflow-hidden border border-[var(--hairline)]">
              <button
                onClick={() => setView("map")}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold transition-colors ${view === "map" ? "bg-[var(--gold-light)] text-[var(--ink)]" : "bg-white text-[var(--ink2)] hover:bg-[var(--muted)]"}`}
                title="Site map view"
              >
                <LayoutGrid className="w-3.5 h-3.5" /> Map
              </button>
              <button
                onClick={() => setView("list")}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold transition-colors ${view === "list" ? "bg-[var(--gold-light)] text-[var(--ink)]" : "bg-white text-[var(--ink2)] hover:bg-[var(--muted)]"}`}
                title="List view"
              >
                <LayoutList className="w-3.5 h-3.5" /> List
              </button>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--hairline2)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search properties…"
                className="w-full md:w-64 pl-9 pr-4 py-2 bg-white border border-[var(--hairline)] rounded-xl text-sm text-[var(--ink)] placeholder:text-[var(--hairline2)] focus:outline-none focus:border-[var(--secondary)] focus:ring-2 focus:ring-[var(--secondary)]/20 transition-all"
              />
            </div>
            <button
              data-tour="new-property"
              onClick={() => setAddOpen(true)}
              className="shrink-0 bg-[var(--gold-light)] text-[var(--ink)] px-4 py-2 rounded-xl font-bold text-sm hover:bg-[#A3E63D] transition-colors flex items-center gap-2 shadow-sm"
            >
              <Plus className="w-4 h-4" /> New Property
            </button>
          </div>
        </header>

        {sopProperty && (
          <PropertySopDialog
            propertyId={sopProperty.id}
            propertyName={sopProperty.name}
            open={!!sopProperty}
            onOpenChange={(v) => { if (!v) setSopProperty(null); }}
          />
        )}
        <AddPropertyDialog open={addOpen} onOpenChange={setAddOpen} />

        <div className="flex-1 flex flex-col">
          {isLoading ? (
            <div className="space-y-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="space-y-3">
                  <Skeleton className="h-8 w-48 rounded-xl bg-[var(--muted)]" />
                  <div className="grid grid-cols-4 gap-3">
                    {[1, 2, 3].map((j) => (
                      <Skeleton key={j} className="h-20 rounded-xl bg-[var(--muted)]" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : view === "map" ? (
            /* ── SITE MAP VIEW ── */
            <div className="flex flex-col gap-8">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center text-[var(--ink2)]">
                  <Building className="w-8 h-8 mb-3 opacity-30" />
                  <div className="font-medium text-sm">No properties found.</div>
                </div>
              ) : (
                filtered.map((p) => {
                  const jobs = jobsByProperty.get(p.id) ?? [];
                  const owed = p.owed > 0;
                  return (
                    <div key={p.id} className="space-y-3">
                      {/* Property header */}
                      <div className="flex items-center gap-3">
                        {/* Thumbnail */}
                        <div className="w-9 h-9 rounded-lg overflow-hidden bg-[var(--muted)] border border-[var(--hairline)] shrink-0 relative flex items-center justify-center">
                          {p.imagePath ? (
                            <img
                              src={`/api/storage${p.imagePath}`}
                              alt={p.name}
                              loading="lazy"
                              className="absolute inset-0 w-full h-full object-cover"
                            />
                          ) : (
                            <div className="flex flex-col items-center justify-center">
                              <Building2 className="w-3.5 h-3.5 text-[var(--hairline2)]" />
                              <Sparkles className="w-2 h-2 text-[#3D6B00] animate-pulse" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link
                              href={`/properties/${p.id}`}
                              className="font-display font-bold text-lg text-[var(--ink)] hover:text-[var(--secondary)] transition-colors truncate"
                            >
                              {p.name}
                            </Link>
                            {p.city && (
                              <span className="flex items-center gap-1 text-xs text-[var(--ink2)]">
                                <MapPin className="w-3 h-3" /> {p.city}
                              </span>
                            )}
                            {owed ? (
                              <span className="inline-block px-2.5 py-0.5 bg-[#FEE2E2] text-[#B91C1C] border border-[#FCA5A5] text-[10px] font-bold uppercase tracking-wider rounded-full tabular-nums">
                                ${p.owed.toLocaleString()} owed
                              </span>
                            ) : (
                              <span className="inline-block px-2.5 py-0.5 bg-[#EAFFC7] text-[#3D6B00] border border-[#B4FF44] text-[10px] font-bold uppercase tracking-wider rounded-full">
                                Settled
                              </span>
                            )}
                            {p.openJobs > 0 && (
                              <span className="text-[10px] text-[var(--ink2)] font-semibold">
                                {p.openJobs} active job{p.openJobs !== 1 ? "s" : ""}
                              </span>
                            )}
                            {p.geocodeFailed && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-[#FEF3C7] text-[#92400E] border border-[#FCD34D] text-[10px] font-bold uppercase tracking-wider rounded-full" title="Address couldn't be geocoded — fix the address or drop a manual pin">
                                <AlertTriangle className="w-2.5 h-2.5" /> No map pin
                              </span>
                            )}
                          </div>
                        </div>
                        {/* Action buttons */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            aria-label={`SOP invoice guidelines for ${p.name}`}
                            title="SOP invoice guidelines"
                            data-testid={`property-sop-settings-${p.id}`}
                            onClick={() => setSopProperty({ id: p.id, name: p.name })}
                            className="w-7 h-7 rounded-full grid place-items-center text-[var(--hairline2)] hover:text-[var(--secondary)] hover:bg-[var(--muted)] transition-colors"
                          >
                            <Settings className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete ${p.name}`}
                            title="Delete property"
                            data-testid={`property-delete-${p.id}`}
                            onClick={() => { setDeleteError(null); setDeleteTarget({ id: p.id, name: p.name }); }}
                            className="w-7 h-7 rounded-full grid place-items-center text-[var(--hairline2)] hover:text-[#B91C1C] hover:bg-[#FEE2E2] transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Job boxes */}
                      {jobs.length > 0 ? (
                        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2 pl-12">
                          {jobs.map((job) => (
                            <JobBox
                              key={job.id}
                              job={job}
                              onClick={() => navigate(`/properties/${p.id}`)}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="pl-12 text-xs text-[var(--hairline2)] italic py-1">
                          No active jobs — <Link href={`/properties/${p.id}`} className="underline hover:text-[var(--ink2)]">open property to add one</Link>
                        </div>
                      )}

                      {/* Divider */}
                      <div className="border-b border-[var(--hairline)] mt-2" />
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            /* ── LIST VIEW ── */
            <div className="flex flex-col">
              <div className="grid grid-cols-[48px_1fr_1.5fr_100px_100px_72px] gap-4 pb-3 border-b border-[var(--hairline)] text-[var(--ink2)] text-xs font-bold uppercase tracking-wider px-4">
                <div></div>
                <div>Name</div>
                <div>Location</div>
                <div>Status</div>
                <div className="text-right">Balance</div>
                <div></div>
              </div>
              <div data-tour="properties-list" className="flex flex-col mt-2">
                {filtered.map((p, i) => {
                  const hasOwed = p.owed > 0;
                  const hasJobs = p.openJobs > 0;
                  return (
                    <Link
                      key={p.id}
                      href={`/properties/${p.id}`}
                      className={`group grid grid-cols-[48px_1fr_1.5fr_100px_100px_72px] gap-4 items-center py-3 border-b border-[var(--hairline)] transition-colors px-4 rounded-xl ${i % 2 === 1 ? "bg-[#F8FAFC]" : ""} hover:bg-[#EEF2F7]`}
                    >
                      <div className="w-12 h-12 rounded-lg overflow-hidden bg-[var(--muted)] border border-[var(--hairline)] shrink-0 relative flex items-center justify-center">
                        {p.imagePath ? (
                          <img
                            src={`/api/storage${p.imagePath}`}
                            alt={p.name}
                            loading="lazy"
                            className="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center">
                            <Building2 className="w-4 h-4 text-[var(--hairline2)] mb-1" />
                            <Sparkles className="w-2 h-2 text-[#3D6B00] animate-pulse" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-[var(--ink)] truncate text-sm group-hover:text-[var(--secondary)] transition-colors">{p.name}</div>
                        {p.units ? <div className="text-[var(--ink2)] text-xs mt-0.5">{p.units} units</div> : null}
                      </div>
                      <div className="min-w-0 flex flex-col justify-center">
                        <div className="text-[var(--ink2)] text-sm truncate flex items-center gap-1.5">
                          {p.city && <span className="flex items-center gap-1"><MapPin className="w-3 h-3 text-[#3D6B00]" /> {p.city}</span>}
                          {p.city && p.pmcName && <span className="text-[var(--hairline2)]">•</span>}
                          {p.pmcName && <span className="truncate">{p.pmcName}</span>}
                          {!p.city && !p.pmcName && <span className="text-[var(--hairline2)] italic text-xs">No location</span>}
                        </div>
                        {p.geocodeFailed && (
                          <div className="flex items-center gap-1 mt-0.5 text-[#92400E] text-[10px] font-semibold">
                            <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
                            Address not found on map — fix address or drop a pin
                          </div>
                        )}
                      </div>
                      <div>
                        {hasJobs ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#FEF3C7] text-[#92400E] border border-[#FCD34D] text-[10px] font-bold uppercase tracking-wider rounded-full">
                            {p.openJobs} active
                          </span>
                        ) : (
                          <span className="text-[var(--hairline2)] text-xs">—</span>
                        )}
                      </div>
                      <div className="text-right">
                        {hasOwed ? (
                          <span className="inline-block px-3 py-1 bg-[#FEE2E2] text-[#B91C1C] border border-[#FCA5A5] text-[11px] font-bold uppercase tracking-wider rounded-full tabular-nums">
                            ${p.owed.toLocaleString()}
                          </span>
                        ) : (
                          <span className="inline-block px-3 py-1 bg-[#EAFFC7] text-[#3D6B00] border border-[#B4FF44] text-[10px] font-bold uppercase tracking-wider rounded-full">
                            Settled
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 justify-self-end">
                        <button
                          type="button"
                          aria-label={`SOP invoice guidelines for ${p.name}`}
                          title="SOP invoice guidelines"
                          data-testid={`property-sop-settings-${p.id}`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setSopProperty({ id: p.id, name: p.name });
                          }}
                          className="w-8 h-8 rounded-full grid place-items-center text-[var(--hairline2)] hover:text-[var(--secondary)] hover:bg-[var(--muted)] transition-colors"
                        >
                          <Settings className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${p.name}`}
                          title="Delete property"
                          data-testid={`property-delete-list-${p.id}`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDeleteError(null);
                            setDeleteTarget({ id: p.id, name: p.name });
                          }}
                          className="w-8 h-8 rounded-full grid place-items-center text-[var(--hairline2)] hover:text-[#B91C1C] hover:bg-[#FEE2E2] transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </Link>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 text-center text-[var(--ink2)]">
                    <Building className="w-8 h-8 mb-3 opacity-30" />
                    <div className="font-medium text-sm">No properties found.</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>

    <AlertDialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display">
            Delete {deleteTarget?.name}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This removes the property, its price list, and its contacts. All jobs must be removed first. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {deleteError && (
          <p className="text-sm text-destructive px-1 -mt-1">{deleteError}</p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setDeleteTarget(null)}>Keep it</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); confirmDelete(); }}
            disabled={del.isPending}
            className="bg-destructive text-white hover:bg-destructive/90 disabled:opacity-50"
          >
            {del.isPending ? "Deleting…" : "Delete property"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
