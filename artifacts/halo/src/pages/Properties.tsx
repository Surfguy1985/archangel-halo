import { useListProperties } from "@workspace/api-client-react";
import { Search, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { AddPropertySheet } from "@/components/AddPropertySheet";

export default function Properties() {
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const { data: properties, isLoading } = useListProperties({ search: search || undefined });

  return (
    <div className="pt-2 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="flex items-center gap-[10px] mb-[14px]">
        <div className="text-[13px] text-muted-foreground flex-1">One page per property. Prices, paper, people, money.</div>
        <button
          onClick={() => setAddOpen(true)}
          aria-label="Add property"
          className="w-[32px] h-[32px] shrink-0 rounded-full grid place-items-center bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] text-[var(--ink)] shadow-[0_4px_14px_rgba(143,106,31,0.34)] transition-transform active:scale-[0.9]"
        >
          <Plus className="w-[18px] h-[18px]" strokeWidth={2.4} />
        </button>
      </div>

      <div className="relative mb-[14px]">
        <Search className="absolute left-[14px] top-1/2 -translate-y-1/2 w-[16px] h-[16px] text-muted-foreground" />
        <input 
          type="search" 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search properties or management companies" 
          className="w-full bg-card border border-border rounded-[13px] py-[11px] pl-[38px] pr-[14px] text-[14.5px] shadow-[var(--shadow)] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]"
        />
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-20 bg-card rounded-[16px]"></div>)}
        </div>
      ) : (
        <div className="flex flex-col gap-[10px]">
          {properties?.map(p => (
            <Link key={p.id} href={`/properties/${p.id}`} className="flex items-center gap-[12px] bg-card rounded-[16px] p-[14px] shadow-[var(--shadow)] transition-transform active:scale-[0.98]">
              <div className="w-[38px] h-[38px] rounded-[12px] bg-[var(--gold-tint)] text-[var(--gold-dark)] grid place-items-center shrink-0 font-display font-bold">
                {p.name.substring(0, 1)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[15px] truncate">{p.name}</div>
                <div className="text-[12.5px] text-muted-foreground truncate">{p.pmcName || p.city || "No PMC"}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-display font-bold text-[15px] tabular-nums">${p.owed.toLocaleString()}</div>
                <div className="text-[11.5px] text-muted-foreground">{p.openJobs} open jobs</div>
              </div>
            </Link>
          ))}
          {properties?.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-[14px]">No properties found</div>
          )}
        </div>
      )}

      <AddPropertySheet open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
