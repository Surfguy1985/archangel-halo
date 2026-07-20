import { useListProperties, useGeneratePropertyImage, getListPropertiesQueryKey } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Building, Plus, Search, MapPin, Briefcase, Building2, Sparkles } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AddPropertyDialog } from "@/components/PropertyDialogs";

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

export default function Properties() {
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const { data: properties, isLoading } = useListProperties();

  useAutoGenerateImages(properties);

  const filtered = properties?.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) || 
    p.pmcName?.toLowerCase().includes(search.toLowerCase())
  ) || [];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-[var(--ink)] tracking-tight">Properties</h1>
          <p className="text-muted-foreground">{properties?.length || 0} active locations</p>
        </div>
        <button
          data-tour="new-property"
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-2 bg-[var(--gold)] text-white px-4 py-2 rounded-md font-medium hover:bg-[var(--gold-dark)] transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" /> New Property
        </button>
      </header>

      <AddPropertyDialog open={addOpen} onOpenChange={setAddOpen} />

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <input 
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search properties or PMCs..."
          className="w-full max-w-md pl-10 pr-4 py-2.5 rounded-md border border-input bg-card text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          <Skeleton className="h-[260px] w-full rounded-2xl" />
          <Skeleton className="h-[260px] w-full rounded-2xl" />
          <Skeleton className="h-[260px] w-full rounded-2xl" />
        </div>
      ) : (
        <div data-tour="properties-list" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filtered.map(p => {
            const hasOwed = p.owed > 0;
            const hasJobs = p.openJobs > 0;
            return (
              <Link
                key={p.id}
                href={`/properties/${p.id}`}
                className="group relative block rounded-2xl overflow-hidden bg-[var(--ink)] shadow-[0_8px_30px_rgba(23,24,28,0.12)] hover:shadow-[0_16px_44px_rgba(23,24,28,0.22)] hover:-translate-y-0.5 transition-all duration-300"
              >
                <div className="relative w-full aspect-[3/2]">
                  {p.imagePath ? (
                    <img
                      src={`/api/storage${p.imagePath}`}
                      alt={p.name}
                      loading="lazy"
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-[linear-gradient(135deg,#2a2b31,#17181c)] flex flex-col items-center justify-center gap-2.5">
                      <div className="w-12 h-12 rounded-xl bg-white/[0.06] border border-white/[0.08] grid place-items-center">
                        <Building2 className="w-6 h-6 text-white/40" />
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-white/50 uppercase tracking-[0.1em]">
                        <Sparkles className="w-3 h-3 animate-pulse" />
                        Creating photo
                      </div>
                    </div>
                  )}

                  {/* Bottom scrim */}
                  <div className="absolute inset-x-0 bottom-0 h-[65%] bg-[linear-gradient(to_top,rgba(10,10,12,0.88),rgba(10,10,12,0.45)_45%,transparent)]" />

                  {/* Badges */}
                  <div className="absolute top-3.5 right-3.5 flex flex-col items-end gap-1.5">
                    {hasOwed && (
                      <span className="px-3 py-1 rounded-full bg-white/90 backdrop-blur-md text-[var(--ink)] text-xs font-bold tabular-nums shadow-sm">
                        ${p.owed.toLocaleString()} owed
                      </span>
                    )}
                    {hasJobs && (
                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-black/40 backdrop-blur-md text-white text-[11px] font-bold shadow-sm">
                        <Briefcase className="w-2.5 h-2.5" />
                        {p.openJobs} active
                      </span>
                    )}
                  </div>

                  {/* Text */}
                  <div className="absolute inset-x-0 bottom-0 p-5">
                    <div className="font-display font-bold text-[22px] leading-[1.1] tracking-[-0.02em] text-white drop-shadow-sm mb-1">
                      {p.name}
                    </div>
                    <div className="flex items-center gap-1.5 text-[13px] font-medium text-white/75">
                      {p.city && (
                        <span className="flex items-center gap-1 shrink-0">
                          <MapPin className="w-3 h-3" />
                          {p.city}
                        </span>
                      )}
                      {p.city && p.pmcName && <span className="opacity-50">•</span>}
                      {p.pmcName && <span className="truncate">{p.pmcName}</span>}
                      {!p.city && !p.pmcName && <span>No location set</span>}
                      {p.units ? (
                        <>
                          <span className="opacity-50">•</span>
                          <span className="shrink-0">{p.units} units</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-full flex flex-col items-center justify-center py-16 text-center bg-card rounded-2xl border border-border">
              <Building className="w-8 h-8 text-muted-foreground/40 mb-3" />
              <div className="text-muted-foreground">No properties found.</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
