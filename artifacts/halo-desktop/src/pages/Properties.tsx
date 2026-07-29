import { useListProperties, useGeneratePropertyImage, getListPropertiesQueryKey} from "@workspace/api-client-react";
import { Skeleton} from "@/components/ui/skeleton";
import { Link} from "wouter";
import { Building, Plus, Search, MapPin, Briefcase, Building2, Sparkles} from "lucide-react";
import { useState, useEffect, useRef} from "react";
import { useQueryClient} from "@tanstack/react-query";
import { AddPropertyDialog} from "@/components/PropertyDialogs";

function useAutoGenerateImages(properties?: { id: string; imagePath?: string | null}[]) {
  const queryClient = useQueryClient();
  const requested = useRef<Set<string>>(new Set());
  const { mutate} = useGeneratePropertyImage({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPropertiesQueryKey()});
     },
   },
 });

  useEffect(() => {
    if (!properties) return;
    for (const p of properties) {
      if (!p.imagePath && !requested.current.has(p.id)) {
        requested.current.add(p.id);
        mutate({ id: p.id});
     }
   }
 }, [properties, mutate]);
}

export default function Properties() {
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const { data: properties, isLoading} = useListProperties();

  useAutoGenerateImages(properties);

  const filtered = properties?.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) || 
    p.pmcName?.toLowerCase().includes(search.toLowerCase())
  ) || [];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500">
      <header className="flex items-center justify-between pb-4">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <input 
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search properties or PMCs..."
            className="w-full pl-12 pr-4 py-3.5 rounded-full border-none bg-black/5 text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] font-medium text-foreground"
          />
        </div>
        <button
          data-tour="new-property"
          onClick={() => setAddOpen(true)}
          className="bg-[var(--primary)] text-black hover:opacity-90 font-bold px-6 py-3.5 flex items-center gap-2 rounded-full"
        >
          <Plus className="w-5 h-5" /> New Property
        </button>
      </header>

      <div className="pb-2">
        <h1 className="text-4xl font-display font-bold text-foreground">Properties</h1>
        <p className="text-muted-foreground mt-1 text-sm">{properties?.length || 0} active location{(properties?.length === 1) ? '' : 's'}</p>
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
                className="group relative block rounded-3xl overflow-hidden bg-white border border-border hover:border-[var(--primary)] shadow-sm hover:shadow-[0_0_20px_rgba(180,255,68,0.15)] hover:-translate-y-1 transition-all duration-300"
              >
                <div className="relative w-full aspect-[3/2] overflow-hidden">
                  {p.imagePath ? (
                    <img
                      src={`/api/storage${p.imagePath}`}
                      alt={p.name}
                      loading="lazy"
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-muted flex flex-col items-center justify-center gap-3">
                      <div className="w-12 h-12 bg-black/5 border border-border grid place-items-center rounded-2xl">
                        <Building2 className="w-5 h-5 text-[var(--secondary)]/50" />
                      </div>
                      <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground tracking-[0.2em]">
                        <Sparkles className="w-3 h-3 text-[var(--secondary)] animate-pulse" />
                        Creating photo
                      </div>
                    </div>
                  )}

                  {/* Badges - Floating top-left */}
                  <div className="absolute top-4 left-4 flex flex-col items-start gap-2">
                    {hasOwed && (
                      <span className="px-4 py-1.5 bg-[var(--primary)] text-black text-xs font-bold tabular-nums rounded-full shadow-sm">
                        ${p.owed.toLocaleString()} Owed
                      </span>
                    )}
                  </div>
                </div>
                
                {/* Text section under image */}
                <div className="p-6 bg-white">
                  <div className="font-display font-bold text-2xl text-foreground mb-1 group-hover:text-[var(--primary)] transition-colors">
                    {p.name}
                  </div>
                  <div className="text-base text-muted-foreground font-medium">
                    {p.city && p.pmcName ? (
                      <span className="truncate">{p.city}, {p.pmcName}</span>
                    ) : p.city ? (
                      <span>{p.city}</span>
                    ) : p.pmcName ? (
                      <span className="truncate">{p.pmcName}</span>
                    ) : (
                      <span>No location set</span>
                    )}
                    {p.units ? ` · ${p.units} units` : null}
                  </div>
                </div>
              </Link>
            );
         })}
          {filtered.length === 0 && (
            <div className="col-span-full flex flex-col items-center justify-center py-20 text-center bg-[var(--card)] border border-dashed border-[var(--border)] rounded-none">
              <span className="custom-icon mb-4"><Building className="w-8 h-8" /></span>
              <div className="font-display font-bold text-lg text-foreground">No properties found.</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
