import { useListProperties } from "@workspace/api-client-react";
import { Search, Plus, MapPin, Briefcase, ChevronRight, Building2 } from "lucide-react";
import { useState, useMemo } from "react";
import { Link } from "wouter";
import { AddPropertySheet } from "@/components/AddPropertySheet";

export default function Properties() {
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const { data: properties, isLoading } = useListProperties({ search: search || undefined });

  // Quick summary stats if no search is active
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
        <div className="animate-pulse space-y-[12px] px-[6px]">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-[90px] bg-card rounded-[24px]"></div>)}
        </div>
      ) : (
        <div className="flex flex-col gap-[12px] px-[6px]">
          {properties?.map(p => {
            const hasOwed = p.owed > 0;
            const hasJobs = p.openJobs > 0;
            
            return (
              <Link
                key={p.id}
                href={`/properties/${p.id}`}
                className="group relative block bg-card rounded-[24px] p-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.03)] border border-[rgba(23,24,28,0.03)] cursor-pointer overflow-hidden transition-transform active:scale-[0.98]"
              >
                {/* Decorative background accent based on status */}
                <div className={`absolute top-0 right-0 w-[120px] h-[120px] opacity-[0.03] pointer-events-none rounded-full blur-2xl transition-colors ${hasOwed ? 'bg-destructive' : hasJobs ? 'bg-blue-500' : 'bg-[var(--gold)]'} -translate-y-1/2 translate-x-1/4`}></div>
                
                <div className="flex items-start gap-[14px] relative z-10">
                  <div className="w-[46px] h-[46px] rounded-[16px] bg-[linear-gradient(135deg,rgba(185,138,47,0.1),rgba(185,138,47,0.2))] text-[var(--gold-dark)] flex items-center justify-center shrink-0 shadow-inner">
                    <Building2 className="w-[20px] h-[20px]" />
                  </div>
                  
                  <div className="flex-1 min-w-0 pt-[2px]">
                    <div className="flex justify-between items-start gap-[12px] mb-[4px]">
                      <div className="font-semibold text-[17px] tracking-[-0.01em] text-[var(--ink)] truncate">
                        {p.name}
                      </div>
                      <div className={`font-display font-bold text-[16px] tabular-nums shrink-0 ${hasOwed ? "text-destructive" : "text-muted-foreground/50"}`}>
                        ${p.owed.toLocaleString()}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-[6px] text-[13px] text-muted-foreground truncate mb-[12px]">
                      {p.city && (
                        <span className="flex items-center gap-[3px] shrink-0">
                          <MapPin className="w-[12px] h-[12px]" />
                          {p.city}
                        </span>
                      )}
                      {p.city && p.pmcName && <span className="opacity-40">•</span>}
                      {p.pmcName && (
                        <span className="truncate">{p.pmcName}</span>
                      )}
                      {!p.city && !p.pmcName && <span>No location/PMC set</span>}
                    </div>

                    <div className="flex items-center gap-[8px]">
                      {hasJobs ? (
                        <span className="inline-flex items-center gap-[4px] px-[10px] py-[4px] rounded-full bg-blue-500/10 text-blue-700 text-[11px] font-bold tracking-wide uppercase">
                          <Briefcase className="w-[10px] h-[10px]" />
                          {p.openJobs} Active Job{p.openJobs === 1 ? '' : 's'}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-[4px] px-[10px] py-[4px] rounded-full bg-[rgba(23,24,28,0.05)] text-muted-foreground text-[11px] font-bold tracking-wide uppercase">
                          <Briefcase className="w-[10px] h-[10px]" />
                          0 Open Jobs
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <div className="shrink-0 self-center pl-[4px]">
                    <ChevronRight className="w-[20px] h-[20px] text-muted-foreground/30 group-hover:translate-x-[2px] transition-transform" />
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
