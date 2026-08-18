import { useMemo, useState } from "react";
import { useListVendors, type Vendor } from "@workspace/api-client-react";
import { Plus, Search, ListOrdered, Home, ChevronRight } from "lucide-react";
import { AddVendorSheet } from "@/components/AddVendorSheet";
import { PriceListSheet } from "@/components/PriceListSheet";

const isInHouse = (v: Vendor) => v.vendorType === "in_house";
const isContracted = (v: Vendor) => (v.contractStatus ?? "contracted") !== "inactive";

/** Never fake an average: "No data yet" reads differently than "0 days". */
function Metric({
  label,
  days,
  samples,
  noun,
}: {
  label: string;
  days: number | null | undefined;
  samples: number | null | undefined;
  noun: string;
}) {
  return (
    <div className="flex-1 min-w-0">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      {days == null ? (
        <div className="text-[12.5px] italic text-muted-foreground">No data yet</div>
      ) : (
        <div className="text-[14px] font-bold text-[var(--ink)] leading-tight">
          {days.toFixed(1)}d
          <span className="ml-[5px] text-[11px] font-normal text-muted-foreground">
            {samples ?? 0} {noun}
            {(samples ?? 0) === 1 ? "" : "s"}
          </span>
        </div>
      )}
    </div>
  );
}

export default function Vendors() {
  const { data: vendors, isLoading } = useListVendors();
  const [addOpen, setAddOpen] = useState(false);
  const [editVendor, setEditVendor] = useState<Vendor | null>(null);
  const [priceOpen, setPriceOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const inactiveCount = useMemo(
    () => (vendors ?? []).filter((v) => !isContracted(v)).length,
    [vendors],
  );

  const visible = useMemo(() => {
    let list = vendors ?? [];
    if (!showInactive) list = list.filter(isContracted);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((v) =>
        [v.name, v.trade, v.email, v.phone]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(q)),
      );
    }
    // Our own organization always leads the list.
    return [...list].sort((a, b) => {
      if (isInHouse(a) !== isInHouse(b)) return isInHouse(a) ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [vendors, query, showInactive]);

  return (
    <div className="pt-2 animate-in fade-in slide-in-from-bottom-4 duration-300 pb-20 px-2">
      <div className="font-display font-bold text-[32px] tracking-[-0.02em] leading-[1.1] mb-[2px] text-[var(--ink)]">
        Vendors
      </div>
      <div className="text-[13px] text-muted-foreground mb-[14px]">
        Who we're contracted with, and how fast they move.
      </div>

      <div className="flex gap-[8px] mb-[12px]">
        <button
          onClick={() => setAddOpen(true)}
          className="flex-1 flex items-center justify-center gap-[7px] rounded-full py-[13px] font-display font-bold text-[14px] btn-gold transition-transform active:scale-[0.98]"
        >
          <Plus className="w-[17px] h-[17px]" /> Add vendor
        </button>
        <button
          onClick={() => setPriceOpen(true)}
          data-testid="button-price-list"
          className="flex-1 flex items-center justify-center gap-[7px] rounded-full py-[13px] font-display font-bold text-[14px] bg-card border border-[var(--hairline)] text-[var(--ink)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-transform active:scale-[0.98]"
        >
          <ListOrdered className="w-[16px] h-[16px]" /> Price list
        </button>
      </div>

      <div className="relative mb-[10px]">
        <Search className="absolute left-[14px] top-1/2 -translate-y-1/2 w-[15px] h-[15px] text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search vendors…"
          data-testid="input-vendor-search"
          className="w-full bg-card border border-[var(--hairline)] rounded-full py-[11px] pl-[38px] pr-[14px] text-[14px] text-[var(--ink)] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40"
        />
      </div>

      {inactiveCount > 0 && (
        <button
          onClick={() => setShowInactive((s) => !s)}
          data-testid="button-toggle-inactive"
          className={`mb-[12px] px-[12px] py-[6px] rounded-full text-[12px] font-semibold border transition-colors ${
            showInactive
              ? "bg-[var(--ink)] text-white border-[var(--ink)]"
              : "bg-card text-muted-foreground border-[var(--hairline)]"
          }`}
        >
          {showInactive ? "Hide" : "Show"} inactive ({inactiveCount})
        </button>
      )}

      {isLoading ? (
        <div className="animate-pulse h-32 bg-card rounded-[20px] border border-[var(--hairline)]" />
      ) : !vendors || vendors.length === 0 ? (
        <div className="text-center text-[13px] text-muted-foreground py-[40px]">
          No vendors yet.
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center text-[13px] text-muted-foreground py-[40px]">
          No vendors match this view.
        </div>
      ) : (
        <div className="flex flex-col gap-[10px]">
          {visible.map((v) => (
            <button
              key={v.id}
              data-testid={`card-vendor-${v.id}`}
              onClick={() => setEditVendor(v)}
              className={`w-full text-left rounded-[20px] border shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-[16px] transition-transform active:scale-[0.98] ${
                isInHouse(v)
                  ? "bg-[var(--gold-light)]/15 border-[var(--gold-light)]"
                  : "bg-card border-[var(--hairline)]"
              }`}
            >
              <div className="flex items-start gap-[10px]">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-[6px]">
                    {isInHouse(v) && (
                      <Home className="w-[14px] h-[14px] text-[var(--gold)] shrink-0" />
                    )}
                    <span className="font-semibold text-[14.5px] truncate text-[var(--ink)]">
                      {v.name}
                    </span>
                    {isInHouse(v) && (
                      <span className="shrink-0 px-[7px] py-[2px] rounded-full bg-[var(--ink)] text-white text-[9.5px] font-bold uppercase tracking-[0.06em]">
                        In-house
                      </span>
                    )}
                    {!isContracted(v) && (
                      <span className="shrink-0 px-[7px] py-[2px] rounded-full bg-black/[0.06] text-muted-foreground text-[9.5px] font-bold uppercase tracking-[0.06em]">
                        Inactive
                      </span>
                    )}
                  </div>
                  <div className="text-[12px] text-muted-foreground truncate mt-[2px]">
                    {[v.trade, v.phone, v.email].filter(Boolean).join(" · ") ||
                      "No details"}
                  </div>
                </div>
                <div className="flex items-start gap-[6px] shrink-0">
                  <div className="text-right">
                    <span
                      className={`text-[10.5px] font-bold uppercase tracking-[0.06em] px-[8px] py-[3px] rounded-full text-white ${
                        v.compliant === false ? "bg-[var(--red)]" : "bg-[var(--green)]"
                      }`}
                    >
                      {v.compliant === false ? "COI lapsing" : "Compliant"}
                    </span>
                    {v.coiExpiresOn && (
                      <div className="text-[11px] text-muted-foreground mt-[3px]">
                        exp {new Date(v.coiExpiresOn).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                  <ChevronRight className="w-[15px] h-[15px] text-muted-foreground mt-[3px]" />
                </div>
              </div>
              <div className="flex gap-[10px] mt-[12px] pt-[10px] border-t border-[var(--hairline)]">
                <Metric
                  label="Avg turn"
                  days={v.avgTurnDays}
                  samples={v.avgTurnSamples}
                  noun="job"
                />
                <Metric
                  label="Avg PO"
                  days={v.avgPoDays}
                  samples={v.avgPoSamples}
                  noun="PO"
                />
              </div>
            </button>
          ))}
        </div>
      )}

      <AddVendorSheet open={addOpen} onOpenChange={setAddOpen} />
      <AddVendorSheet
        open={!!editVendor}
        onOpenChange={(o) => { if (!o) setEditVendor(null); }}
        vendor={editVendor}
      />
      <PriceListSheet open={priceOpen} onOpenChange={setPriceOpen} />
    </div>
  );
}
