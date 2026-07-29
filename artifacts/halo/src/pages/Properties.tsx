import { useListProperties, useGeneratePropertyImage, getListPropertiesQueryKey } from "@workspace/api-client-react";
import { Search, Plus, MapPin, Briefcase, Building2, Sparkles } from "lucide-react";
import { useState, useMemo, useEffect, useRef } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { AddPropertySheet } from "@/components/AddPropertySheet";
import { FalkonBadge } from "@/components/FalkonBadge";

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
  const { data: properties, isLoading } = useListProperties({ search: search || undefined });

  useAutoGenerateImages(properties);

  const totalOwed = useMemo(() => properties?.reduce((sum, p) => sum + p.owed, 0) || 0, [properties]);
  const activeJobs = useMemo(() => properties?.reduce((sum, p) => sum + p.openJobs, 0) || 0, [properties]);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both pb-24">
      {/* Header Area */}
      <div className="px-[6px] mb-[20px]">
        <div className="flex items-center justify-between mb-[16px]">
          <h1 className="font-display font-bold text-[32px] tracking-[-0.02em] text-[var(--ink)] leading-none">
            Properties
          </h1>
          <button
            onClick={() => setAddOpen(true)}
            aria-label="Add property"
            className="w-[38px] h-[38px] rounded-full grid place-items-center bg-[var(--gold-light)] text-[var(--ink)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all hover:brightness-105 active:scale-[0.9]"
          >
            <Plus className="w-[20px] h-[20px]" strokeWidth={3} />
          </button>
        </div>

        {/* Global Stats - hidden when searching */}
        {!search && properties && properties.length > 0 && (
          <div className="grid grid-cols-2 gap-[12px] mb-[20px]">
            <div className="bg-card rounded-[20px] p-[16px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] flex flex-col justify-between">
              <div className="text-[11px] font-display font-bold text-muted-foreground uppercase tracking-[0.1em] mb-[8px]">
                Total Owed
              </div>
              <div className="font-display font-bold text-[24px] text-[var(--ink)] tracking-tight tabular-nums">
                ${totalOwed.toLocaleString()}
              </div>
            </div>
            <div className="bg-card rounded-[20px] p-[16px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] flex flex-col justify-between">
              <div className="text-[11px] font-display font-bold text-muted-foreground uppercase tracking-[0.1em] mb-[8px]">
                Active Jobs
              </div>
              <div className="font-display font-bold text-[24px] text-[var(--ink)] tracking-tight tabular-nums">
                {activeJobs}
              </div>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-[16px] flex items-center pointer-events-none">
            <Search className="w-[18px] h-[18px] text-muted-foreground" />
          </div>
          <input 
            type="search" 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find property, city, or PMC" 
            className="w-full bg-card border border-[var(--hairline)] rounded-[18px] py-[14px] pl-[42px] pr-[16px] text-[15px] font-medium shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-[var(--ink)] placeholder:text-muted-foreground focus:outline-none focus:border-[var(--gold)] focus:ring-1 focus:ring-[var(--gold)]/40 transition-all"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-[16px] px-[6px]">
          {[1, 2, 3].map(i => <div key={i} className="h-[240px] bg-card rounded-[20px] border border-[var(--hairline)]"></div>)}
        </div>
      ) : (
        <div className="flex flex-col gap-[16px] px-[6px]">
          {properties?.map(p => {
            const hasOwed = p.owed > 0;
            const hasJobs = p.openJobs > 0;

            return (
              <Link
                key={p.id}
                href={`/properties/${p.id}`}
                className="group relative block rounded-[20px] overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.04)] cursor-pointer transition-transform active:scale-[0.98] bg-card border border-[var(--hairline)]"
              >
                {/* Full-bleed hero image */}
                <div className="relative w-full aspect-[3/2]">
                  {p.imagePath ? (
                    <img
                      src={`/api/storage${p.imagePath}`}
                      alt={p.name}
                      loading="lazy"
                      className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-[var(--paper)] flex flex-col items-center justify-center gap-[10px]">
                      <div className="w-[52px] h-[52px] rounded-[18px] bg-[var(--gold-tint)] border border-[var(--hairline)] grid place-items-center">
                        <Building2 className="w-[24px] h-[24px] text-[var(--gold-dark)]" />
                      </div>
                      <div className="flex items-center gap-[6px] text-[12px] font-semibold text-muted-foreground uppercase tracking-[0.1em]">
                        <Sparkles className="w-[12px] h-[12px] animate-pulse text-[var(--gold-dark)]" />
                        Creating photo
                      </div>
                    </div>
                  )}

                  {/* Bottom gradient scrim */}
                  <div className="absolute inset-x-0 bottom-0 h-[70%] bg-gradient-to-t from-black via-black/60 to-transparent pointer-events-none" />

                  {/* Top-right badges */}
                  <div className="absolute top-[14px] right-[14px] flex flex-col items-end gap-[6px]">
                    {hasOwed && (
                      <span className="px-[12px] py-[5px] rounded-full bg-[var(--ink)] text-white text-[13px] font-display font-bold tabular-nums shadow-[0_2px_8px_rgba(0,0,0,0.12)]">
                        ${p.owed.toLocaleString()} owed
                      </span>
                    )}
                    {hasJobs && (
                      <span className="inline-flex items-center gap-[5px] px-[12px] py-[5px] rounded-full bg-white text-[var(--ink)] text-[12px] font-display font-bold shadow-[0_2px_8px_rgba(0,0,0,0.12)]">
                        <Briefcase className="w-[11px] h-[11px] text-[var(--gold-dark)]" />
                        {p.openJobs} active
                      </span>
                    )}
                  </div>

                  {/* Bottom text block */}
                  <div className="absolute inset-x-0 bottom-0 p-[18px]">
                    <div className="font-display font-bold text-[24px] leading-[1.1] tracking-[-0.02em] text-white drop-shadow-md mb-[6px]">
                      {p.name}
                    </div>
                    <div className="flex items-center gap-[6px] text-[13px] font-medium text-white/80">
                      {p.city && (
                        <span className="flex items-center gap-[4px] shrink-0">
                          <MapPin className="w-[12px] h-[12px] text-[var(--gold-light)]" />
                          <span className="text-white drop-shadow-sm">{p.city}</span>
                        </span>
                      )}
                      {p.city && p.pmcName && <span className="opacity-50 text-white">•</span>}
                      {p.pmcName && <span className="truncate text-white drop-shadow-sm">{p.pmcName}</span>}
                      {!p.city && !p.pmcName && <span className="text-white/60">No location set</span>}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
          
          {properties?.length === 0 && (
            <div className="flex flex-col items-center justify-center py-[60px] text-center bg-card rounded-[20px] border border-[var(--hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
              <div className="w-[64px] h-[64px] rounded-full bg-[var(--gold-tint)] border border-[var(--hairline)] flex items-center justify-center mb-[16px]">
                <Building2 className="w-[28px] h-[28px] text-[var(--gold-dark)]" />
              </div>
              <div className="font-display font-bold text-[18px] text-[var(--ink)] mb-[6px]">
                {search ? "No matches found" : "No properties yet"}
              </div>
              <div className="text-[14px] text-muted-foreground max-w-[260px] leading-relaxed">
                {search ? `We couldn't find anything for "${search}".` : "Tap the plus button to add your first property to the system."}
              </div>
            </div>
          )}
        </div>
      )}

      <AddPropertySheet open={addOpen} onOpenChange={setAddOpen} />
      
      <FalkonBadge />
    </div>
  );
}
