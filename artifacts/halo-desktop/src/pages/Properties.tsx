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
      <header className="flex items-center justify-between border-b border-[var(--border)] pb-4">
        <div>
          <h1 className="text-4xl font-display font-bold text-foreground uppercase tracking-tight">Properties</h1>
          <p className="text-muted-foreground font-mono mt-1 text-sm uppercase tracking-widest">{properties?.length || 0} active locations</p>
        </div>
        <button
          data-tour="new-property"
          onClick={() => setAddOpen(true)}
          className="btn-gold px-6 py-3 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> New Property
        </button>
      </header>

      <AddPropertyDialog open={addOpen} onOpenChange={setAddOpen} />

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input 
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="SEARCH PROPERTIES OR PMCS..."
          className="w-full max-w-md pl-12 pr-4 py-3 rounded-none border border-[var(--border)] bg-[var(--card)] text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-1 focus-visible:ring-[var(--primary)] font-mono uppercase tracking-wider text-foreground"
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          <Skeleton className="h-[260px] w-full rounded-none bg-[var(--muted)] border border-[var(--border)]" />
          <Skeleton className="h-[260px] w-full rounded-none bg-[var(--muted)] border border-[var(--border)]" />
          <Skeleton className="h-[260px] w-full rounded-none bg-[var(--muted)] border border-[var(--border)]" />
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
                className="group relative block rounded-none overflow-hidden bg-[var(--card)] border border-[var(--border)] hover:border-[var(--primary)] shadow-sm hover:shadow-[0_0_20px_rgba(198,242,17,0.15)] hover:-translate-y-1 transition-all duration-300"
              >
                <div className="relative w-full aspect-[3/2]">
                  {p.imagePath ? (
                    <img
                      src={`/api/storage${p.imagePath}`}
                      alt={p.name}
                      loading="lazy"
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105 mix-blend-luminosity group-hover:mix-blend-normal opacity-80 group-hover:opacity-100"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-[var(--muted)] flex flex-col items-center justify-center gap-3">
                      <div className="w-12 h-12 bg-black/40 border border-[var(--border)] grid place-items-center rounded-none">
                        <Building2 className="w-5 h-5 text-[var(--primary)]/50" />
                      </div>
                      <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">
                        <Sparkles className="w-3 h-3 text-[var(--primary)] animate-pulse" />
                        Creating photo
                      </div>
                    </div>
                  )}

                  {/* Bottom scrim */}
                  <div className="absolute inset-x-0 bottom-0 h-[70%] bg-gradient-to-t from-[#050505] via-[#050505]/80 to-transparent" />

                  {/* Badges */}
                  <div className="absolute top-4 right-4 flex flex-col items-end gap-2">
                    {hasOwed && (
                      <span className="px-3 py-1 bg-[var(--primary)] text-black text-[10px] font-bold tabular-nums uppercase tracking-wider rounded-none">
                        ${p.owed.toLocaleString()} owed
                      </span>
                    )}
                    {hasJobs && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-black/80 backdrop-blur border border-[var(--border)] text-white text-[10px] font-bold uppercase tracking-wider rounded-none">
                        <Briefcase className="w-3 h-3 text-[var(--primary)]" />
                        {p.openJobs} active
                      </span>
                    )}
                  </div>

                  {/* Text */}
                  <div className="absolute inset-x-0 bottom-0 p-5">
                    <div className="font-display font-bold text-2xl uppercase tracking-wider text-white drop-shadow-md mb-2 group-hover:text-[var(--primary)] transition-colors">
                      {p.name}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-white/70">
                      {p.city && (
                        <span className="flex items-center gap-1 shrink-0">
                          <MapPin className="w-3 h-3 text-[var(--primary)]" />
                          {p.city}
                        </span>
                      )}
                      {p.city && p.pmcName && <span className="text-[var(--primary)]">•</span>}
                      {p.pmcName && <span className="truncate">{p.pmcName}</span>}
                      {!p.city && !p.pmcName && <span>No location set</span>}
                      {p.units ? (
                        <>
                          <span className="text-[var(--primary)]">•</span>
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
            <div className="col-span-full flex flex-col items-center justify-center py-20 text-center bg-[var(--card)] border border-dashed border-[var(--border)] rounded-none">
              <span className="custom-icon mb-4"><Building className="w-8 h-8" /></span>
              <div className="font-display font-bold text-lg uppercase tracking-wider text-foreground">No properties found.</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
