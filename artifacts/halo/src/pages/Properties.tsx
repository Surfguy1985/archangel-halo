import { useListProperties, useGeneratePropertyImage, getListPropertiesQueryKey } from "@workspace/api-client-react";
import { Search, Plus, MapPin, Briefcase, Building2, Sparkles } from "lucide-react";
import { useState, useMemo, useEffect, useRef } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { AddPropertySheet } from "@/components/AddPropertySheet";

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
            className="w-[38px] h-[38px] rounded-full grid place-items-center bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] text-[var(--ink)] shadow-[0_6px_16px_rgba(143,106,31,0.25)] transition-transform active:scale-[0.9]"
          >
            <Plus className="w-[20px] h-[20px]" strokeWidth={2.5} />
          </button>
        </div>

        {/* Global Stats - hidden when searching */}
        {!search && properties && properties.length > 0 && (
          <div className="grid grid-cols-2 gap-[12px] mb-[20px]">
            <div className="bg-card rounded-[20px] p-[16px] shadow-[0_2px_8px_rgba(0,0,0,0.03)] border border-[rgba(23,24,28,0.03)] flex flex-col justify-between">
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.08em] mb-[8px]">
                Total Owed
              </div>
              <div className="font-display font-bold text-[24px] text-[var(--ink)] tracking-tight tabular-nums">
                ${totalOwed.toLocaleString()}
              </div>
            </div>
            <div className="bg-card rounded-[20px] p-[16px] shadow-[0_2px_8px_rgba(0,0,0,0.03)] border border-[rgba(23,24,28,0.03)] flex flex-col justify-between">
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.08em] mb-[8px]">
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
            <Search className="w-[18px] h-[18px] text-muted-foreground/60" />
          </div>
          <input 
            type="search" 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find property, city, or PMC" 
            className="w-full bg-card/60 backdrop-blur-sm border border-[rgba(23,24,28,0.06)] rounded-[18px] py-[14px] pl-[42px] pr-[16px] text-[15px] font-medium shadow-[0_2px_8px_rgba(0,0,0,0.02)] text-[var(--ink)] placeholder:text-muted-foreground/60 focus:outline-none focus:bg-card focus:border-[var(--gold)] focus:ring-1 focus:ring-[var(--gold)] transition-all"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-[16px] px-[6px]">
          {[1, 2, 3].map(i => <div key={i} className="h-[240px] bg-card rounded-[28px]"></div>)}
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
                className="group relative block rounded-[28px] overflow-hidden shadow-[0_8px_28px_rgba(23,24,28,0.12)] cursor-pointer transition-transform active:scale-[0.98] bg-[var(--ink)]"
              >
                {/* Full-bleed hero image */}
                <div className="relative w-full aspect-[3/2]">
                  {p.imagePath ? (
                    <img
                      src={`/api/storage${p.imagePath}`}
                      alt={p.name}
                      loading="lazy"
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-[linear-gradient(135deg,#2a2b31,#17181c)] flex flex-col items-center justify-center gap-[10px]">
                      <div className="w-[52px] h-[52px] rounded-[18px] bg-white/[0.06] border border-white/[0.08] grid place-items-center">
                        <Building2 className="w-[24px] h-[24px] text-white/40" />
                      </div>
                      <div className="flex items-center gap-[6px] text-[12px] font-semibold text-white/50 uppercase tracking-[0.1em]">
                        <Sparkles className="w-[12px] h-[12px] animate-pulse" />
                        Creating photo
                      </div>
                    </div>
                  )}

                  {/* Apple-style bottom gradient scrim */}
                  <div className="absolute inset-x-0 bottom-0 h-[65%] bg-[linear-gradient(to_top,rgba(10,10,12,0.88),rgba(10,10,12,0.45)_45%,transparent)]" />

                  {/* Top-right badges */}
                  <div className="absolute top-[14px] right-[14px] flex flex-col items-end gap-[6px]">
                    {hasOwed && (
                      <span className="px-[12px] py-[5px] rounded-full bg-white/90 backdrop-blur-md text-[var(--ink)] text-[13px] font-bold tabular-nums shadow-sm">
                        ${p.owed.toLocaleString()} owed
                      </span>
                    )}
                    {hasJobs && (
                      <span className="inline-flex items-center gap-[5px] px-[12px] py-[5px] rounded-full bg-black/40 backdrop-blur-md text-white text-[12px] font-bold shadow-sm">
                        <Briefcase className="w-[11px] h-[11px]" />
                        {p.openJobs} active
                      </span>
                    )}
                  </div>

                  {/* Bottom text block */}
                  <div className="absolute inset-x-0 bottom-0 p-[18px]">
                    <div className="font-display font-bold text-[24px] leading-[1.1] tracking-[-0.02em] text-white drop-shadow-sm mb-[5px]">
                      {p.name}
                    </div>
                    <div className="flex items-center gap-[6px] text-[13px] font-medium text-white/75">
                      {p.city && (
                        <span className="flex items-center gap-[4px] shrink-0">
                          <MapPin className="w-[12px] h-[12px]" />
                          {p.city}
                        </span>
                      )}
                      {p.city && p.pmcName && <span className="opacity-50">•</span>}
                      {p.pmcName && <span className="truncate">{p.pmcName}</span>}
                      {!p.city && !p.pmcName && <span>No location set</span>}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
          
          {properties?.length === 0 && (
            <div className="flex flex-col items-center justify-center py-[60px] text-center">
              <div className="w-[64px] h-[64px] rounded-full bg-card border border-[rgba(23,24,28,0.05)] flex items-center justify-center mb-[16px] shadow-sm">
                <Building2 className="w-[28px] h-[28px] text-muted-foreground/40" />
              </div>
              <div className="font-display font-bold text-[18px] text-[var(--ink)] mb-[4px]">
                {search ? "No matches found" : "No properties yet"}
              </div>
              <div className="text-[14px] text-muted-foreground max-w-[240px]">
                {search ? `We couldn't find anything for "${search}".` : "Tap the plus button to add your first property to the system."}
              </div>
            </div>
          )}
        </div>
      )}

      <AddPropertySheet open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
