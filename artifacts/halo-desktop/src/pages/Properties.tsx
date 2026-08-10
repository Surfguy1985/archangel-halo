import {
  useListProperties,
  useListJobs,
  useGeneratePropertyImage,
  getListPropertiesQueryKey,
  getListJobsQueryKey,
  type Job,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, useLocation } from "wouter";
import { Building, Plus, Search, MapPin, Building2, Sparkles, Settings, LayoutList, LayoutGrid } from "lucide-react";
import { useState, useEffect, useRef, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AddPropertyDialog } from "@/components/PropertyDialogs";
import { PropertySopDialog } from "@/components/PropertySopDialog";

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
      className="bg-[var(--ink)] text-white rounded-xl p-3 text-left hover:opacity-90 transition-all active:scale-[0.97] w-full"
      data-testid={`prop-sitemap-job-${job.id}`}
    >
      <div className="font-display font-bold text-base leading-tight truncate">
        {job.unitNo || "Common"}
      </div>
      <div className="text-[10px] text-white/50 truncate mt-0.5">
        {job.category || "General"}
      </div>
      <div className="mt-2 flex gap-[3px]">
        {stages.map((done, i) => (
          <span
            key={i}
            className={`h-[4px] flex-1 rounded-full ${done ? "bg-[var(--gold-light)]" : "bg-white/15"}`}
          />
        ))}
      </div>
      <div className="mt-1 text-[9px] font-bold uppercase tracking-wide text-white/40">
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
  const { data: properties, isLoading: propsLoading } = useListProperties({ query: { queryKey: getListPropertiesQueryKey(), refetchInterval: 30000 } });
  const { data: allJobs, isLoading: jobsLoading } = useListJobs(undefined, {
    query: { queryKey: getListJobsQueryKey(), refetchInterval: 30000 },
  });
  const [, navigate] = useLocation();

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
    <div className="p-8 max-w-[1200px] mx-auto animate-in fade-in duration-500">
      <div className="bg-[var(--secondary)] rounded-[24px] p-6 md:p-8 shadow-2xl flex flex-col min-h-[70vh] border border-white/5">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="font-display font-bold text-2xl text-white tracking-tight">Properties</h1>
            <p className="text-white/50 mt-1 text-sm">{properties?.length || 0} active locations</p>
          </div>
          <div className="flex items-center gap-3">
            {/* View toggle */}
            <div className="flex rounded-xl overflow-hidden border border-white/10">
              <button
                onClick={() => setView("map")}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold transition-colors ${view === "map" ? "bg-[var(--gold-light)] text-black" : "text-white/50 hover:text-white"}`}
                title="Site map view"
              >
                <LayoutGrid className="w-3.5 h-3.5" /> Map
              </button>
              <button
                onClick={() => setView("list")}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold transition-colors ${view === "list" ? "bg-[var(--gold-light)] text-black" : "text-white/50 hover:text-white"}`}
                title="List view"
              >
                <LayoutList className="w-3.5 h-3.5" /> List
              </button>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search properties…"
                className="w-full md:w-64 pl-9 pr-4 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-[var(--gold-light)] focus:ring-1 focus:ring-[var(--gold-light)] transition-all"
              />
            </div>
            <button
              data-tour="new-property"
              onClick={() => setAddOpen(true)}
              className="shrink-0 bg-[var(--gold-light)] text-black px-4 py-2 rounded-xl font-bold text-sm hover:bg-[#A1E44D] transition-colors flex items-center gap-2"
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
                  <Skeleton className="h-8 w-48 rounded-xl bg-white/5" />
                  <div className="grid grid-cols-4 gap-3">
                    {[1, 2, 3].map((j) => (
                      <Skeleton key={j} className="h-20 rounded-xl bg-white/5" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : view === "map" ? (
            /* ── SITE MAP VIEW ── */
            <div className="flex flex-col gap-8">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center text-white/30">
                  <Building className="w-8 h-8 mb-3 opacity-20" />
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
                        <div className="w-9 h-9 rounded-lg overflow-hidden bg-white/5 border border-white/10 shrink-0 relative flex items-center justify-center">
                          {p.imagePath ? (
                            <img
                              src={`/api/storage${p.imagePath}`}
                              alt={p.name}
                              loading="lazy"
                              className="absolute inset-0 w-full h-full object-cover"
                            />
                          ) : (
                            <div className="flex flex-col items-center justify-center">
                              <Building2 className="w-3.5 h-3.5 text-white/20" />
                              <Sparkles className="w-2 h-2 text-[var(--gold-light)] animate-pulse" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link
                              href={`/properties/${p.id}`}
                              className="font-display font-bold text-lg text-white hover:text-[var(--gold-light)] transition-colors truncate"
                            >
                              {p.name}
                            </Link>
                            {p.city && (
                              <span className="flex items-center gap-1 text-xs text-white/40">
                                <MapPin className="w-3 h-3" /> {p.city}
                              </span>
                            )}
                            {owed ? (
                              <span className="inline-block px-2.5 py-0.5 bg-rose-500 text-white text-[10px] font-bold uppercase tracking-wider rounded-full shadow-[0_0_12px_rgba(239,68,68,0.2)]">
                                ${p.owed.toLocaleString()} owed
                              </span>
                            ) : (
                              <span className="inline-block px-2.5 py-0.5 bg-[#B4FF44]/10 text-[#B4FF44] border border-[#B4FF44]/20 text-[10px] font-bold uppercase tracking-wider rounded-full">
                                Settled
                              </span>
                            )}
                            {p.openJobs > 0 && (
                              <span className="text-[10px] text-white/40 font-semibold">
                                {p.openJobs} active job{p.openJobs !== 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                        </div>
                        {/* SOP settings button */}
                        <button
                          type="button"
                          aria-label={`SOP invoice guidelines for ${p.name}`}
                          title="SOP invoice guidelines"
                          data-testid={`property-sop-settings-${p.id}`}
                          onClick={() => setSopProperty({ id: p.id, name: p.name })}
                          className="w-7 h-7 rounded-full grid place-items-center text-white/30 hover:text-[var(--gold-light)] hover:bg-white/10 transition-colors shrink-0"
                        >
                          <Settings className="w-3.5 h-3.5" />
                        </button>
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
                        <div className="pl-12 text-xs text-white/25 italic py-1">
                          No active jobs — <Link href={`/properties/${p.id}`} className="underline hover:text-white/50">open property to add one</Link>
                        </div>
                      )}

                      {/* Divider */}
                      <div className="border-b border-white/5 mt-2" />
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            /* ── LIST VIEW ── */
            <div className="flex flex-col">
              <div className="grid grid-cols-[48px_1fr_1.5fr_100px_100px_40px] gap-4 pb-3 border-b border-white/10 text-white/40 text-xs font-bold uppercase tracking-wider px-4">
                <div></div>
                <div>Name</div>
                <div>Location</div>
                <div>Status</div>
                <div className="text-right">Balance</div>
                <div></div>
              </div>
              <div data-tour="properties-list" className="flex flex-col mt-2">
                {filtered.map((p) => {
                  const hasOwed = p.owed > 0;
                  const hasJobs = p.openJobs > 0;
                  return (
                    <Link
                      key={p.id}
                      href={`/properties/${p.id}`}
                      className="group grid grid-cols-[48px_1fr_1.5fr_100px_100px_40px] gap-4 items-center py-3 border-b border-white/5 hover:bg-white/5 transition-colors px-4 rounded-xl"
                    >
                      <div className="w-12 h-12 rounded-lg overflow-hidden bg-white/5 border border-white/10 shrink-0 relative flex items-center justify-center">
                        {p.imagePath ? (
                          <img
                            src={`/api/storage${p.imagePath}`}
                            alt={p.name}
                            loading="lazy"
                            className="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center">
                            <Building2 className="w-4 h-4 text-white/20 mb-1" />
                            <Sparkles className="w-2 h-2 text-[var(--gold-light)] animate-pulse" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-white truncate text-sm group-hover:text-[var(--gold-light)] transition-colors">{p.name}</div>
                        {p.units ? <div className="text-white/40 text-xs mt-0.5">{p.units} units</div> : null}
                      </div>
                      <div className="min-w-0 flex flex-col justify-center">
                        <div className="text-white/60 text-sm truncate flex items-center gap-1.5">
                          {p.city && <span className="flex items-center gap-1"><MapPin className="w-3 h-3 text-[var(--gold-light)]/60" /> {p.city}</span>}
                          {p.city && p.pmcName && <span className="text-white/20">•</span>}
                          {p.pmcName && <span className="truncate">{p.pmcName}</span>}
                          {!p.city && !p.pmcName && <span className="text-white/30 italic text-xs">No location</span>}
                        </div>
                      </div>
                      <div>
                        {hasJobs ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#EAB308]/10 text-[#EAB308] border border-[#EAB308]/20 text-[10px] font-bold uppercase tracking-wider rounded-full">
                            {p.openJobs} active
                          </span>
                        ) : (
                          <span className="text-white/30 text-xs">—</span>
                        )}
                      </div>
                      <div className="text-right">
                        {hasOwed ? (
                          <span className="inline-block px-3 py-1 bg-[#EF4444] text-white text-[11px] font-bold uppercase tracking-wider rounded-full shadow-[0_0_12px_rgba(239,68,68,0.2)]">
                            ${p.owed.toLocaleString()}
                          </span>
                        ) : (
                          <span className="inline-block px-3 py-1 bg-[#B4FF44]/10 text-[#B4FF44] border border-[#B4FF44]/20 text-[10px] font-bold uppercase tracking-wider rounded-full">
                            Settled
                          </span>
                        )}
                      </div>
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
                        className="w-8 h-8 rounded-full grid place-items-center text-white/40 hover:text-[var(--gold-light)] hover:bg-white/10 transition-colors justify-self-end"
                      >
                        <Settings className="w-4 h-4" />
                      </button>
                    </Link>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 text-center text-white/30">
                    <Building className="w-8 h-8 mb-3 opacity-20" />
                    <div className="font-medium text-sm">No properties found.</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
