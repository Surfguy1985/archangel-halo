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
    <div className="p-8 max-w-[1000px] mx-auto animate-in fade-in duration-500">
      <div className="bg-[var(--secondary)] rounded-[24px] p-6 md:p-8 shadow-2xl flex flex-col min-h-[70vh] border border-white/5">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="font-display font-bold text-2xl text-white tracking-tight">Properties</h1>
            <p className="text-white/50 mt-1 text-sm">{properties?.length || 0} active locations</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
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

        <AddPropertyDialog open={addOpen} onOpenChange={setAddOpen} />

        <div className="flex-1 flex flex-col">
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-16 w-full rounded-xl bg-white/5" />
              <Skeleton className="h-16 w-full rounded-xl bg-white/5" />
              <Skeleton className="h-16 w-full rounded-xl bg-white/5" />
            </div>
          ) : (
            <div className="flex flex-col">
              <div className="grid grid-cols-[48px_1fr_1.5fr_100px_100px] gap-4 pb-3 border-b border-white/10 text-white/40 text-xs font-bold uppercase tracking-wider px-4">
                <div></div>
                <div>Name</div>
                <div>Location</div>
                <div>Status</div>
                <div className="text-right">Balance</div>
              </div>

              <div data-tour="properties-list" className="flex flex-col mt-2">
                {filtered.map(p => {
                  const hasOwed = p.owed > 0;
                  const hasJobs = p.openJobs > 0;
                  return (
                    <Link
                      key={p.id}
                      href={`/properties/${p.id}`}
                      className="group grid grid-cols-[48px_1fr_1.5fr_100px_100px] gap-4 items-center py-3 border-b border-white/5 hover:bg-white/5 transition-colors px-4 rounded-xl"
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
                        {p.units ? (
                          <div className="text-white/40 text-xs mt-0.5">{p.units} units</div>
                        ) : null}
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
