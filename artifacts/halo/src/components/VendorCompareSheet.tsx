/**
 * VendorCompareSheet — mobile bottom sheet to compare vendor prices for a
 * catalog service. Step 1: pick a service. Step 2: ranked vendor list.
 */
import { useState, useMemo } from "react";
import { Search, ArrowLeft, BarChart2 } from "lucide-react";
import {
  useListCatalogItems,
  useListCatalogItemVendorRates,
} from "@workspace/api-client-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

function rateLabel(rate: number, unit: string | null | undefined) {
  const money = `$${rate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return unit ? `${money} / ${unit}` : money;
}

/* ---------------------------------------------------------- compare cards */

function CompareTable({
  catalogItemId,
  serviceName,
  onBack,
}: {
  catalogItemId: string;
  serviceName: string;
  onBack: () => void;
}) {
  const { data: vendors, isLoading } = useListCatalogItemVendorRates(catalogItemId);

  return (
    <div>
      <button
        onClick={onBack}
        className="flex items-center gap-[6px] text-[13px] text-muted-foreground mb-[14px]"
      >
        <ArrowLeft className="w-[14px] h-[14px]" /> Back to services
      </button>

      <div className="font-display font-bold text-[17px] text-[var(--ink)] mb-[14px]">
        {serviceName}
      </div>

      {isLoading ? (
        <div className="animate-pulse h-24 bg-card rounded-[16px] border border-[var(--hairline)]" />
      ) : !vendors?.length ? (
        <div className="text-center text-[13px] text-muted-foreground py-[36px]">
          No vendors have a rate for this service yet.
        </div>
      ) : (
        <div className="flex flex-col gap-[8px]">
          {vendors.map((v, idx) => {
            const diff =
              v.masterRate != null ? v.rate - v.masterRate : null;
            const pct =
              v.masterRate != null && v.masterRate > 0
                ? ((v.rate / v.masterRate) - 1) * 100
                : null;
            return (
              <div
                key={v.vendorId}
                data-testid={`row-compare-${v.vendorId}`}
                className={`rounded-[16px] border p-[12px_14px] ${
                  idx === 0
                    ? "bg-[var(--gold-light)]/15 border-[var(--gold-light)]"
                    : "bg-card border-[var(--hairline)]"
                }`}
              >
                <div className="flex items-center justify-between gap-[8px]">
                  <div className="flex items-center gap-[6px] min-w-0">
                    {idx === 0 && (
                      <span className="shrink-0 px-[7px] py-[2px] rounded-full bg-[var(--ink)] text-white text-[9.5px] font-bold uppercase tracking-[0.06em]">
                        Lowest
                      </span>
                    )}
                    <span className="font-semibold text-[14px] text-[var(--ink)] truncate">
                      {v.vendorName}
                    </span>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-bold text-[15px] text-[var(--ink)]">
                      {rateLabel(v.rate, v.unit)}
                    </div>
                    {diff != null && pct != null && (
                      <div
                        className={`text-[11px] font-semibold ${
                          diff > 0
                            ? "text-red-600"
                            : diff < 0
                              ? "text-green-700"
                              : "text-muted-foreground"
                        }`}
                      >
                        {diff > 0 ? "+" : ""}
                        {pct.toFixed(1)}% vs. master
                      </div>
                    )}
                  </div>
                </div>
                {v.masterRate != null && (
                  <div className="text-[11.5px] text-muted-foreground mt-[6px] pt-[6px] border-t border-[var(--hairline)]">
                    Master rate: {rateLabel(v.masterRate, v.unit)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------- service picker */

export function VendorCompareSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: items, isLoading } = useListCatalogItems();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{
    id: string;
    service: string;
  } | null>(null);

  const visible = useMemo(() => {
    const list = items ?? [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? list.filter((i) =>
          [i.service, i.category, i.detail]
            .filter(Boolean)
            .some((s) => String(s).toLowerCase().includes(q)),
        )
      : list;
    return [...filtered].sort((a, b) => a.service.localeCompare(b.service));
  }, [items, query]);

  const handleOpenChange = (o: boolean) => {
    if (!o) {
      setSelected(null);
      setQuery("");
    }
    onOpenChange(o);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[26px] bg-[var(--paper)] p-0 flex flex-col max-h-[88vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]"
      >
        <div className="w-[40px] h-[4.5px] rounded-[3px] bg-[rgba(23,24,28,0.16)] mx-auto mt-[10px] mb-[4px] shrink-0" />
        <div className="p-[8px_18px_28px] overflow-y-auto">
          <SheetHeader className="text-left mb-[12px]">
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px] flex items-center gap-[8px]">
              <BarChart2 className="w-[18px] h-[18px] text-[var(--gold)]" />
              Compare vendors
            </SheetTitle>
            <div className="text-[13px] text-muted-foreground">
              {selected
                ? "Vendors with a rate for this service, cheapest first."
                : "Pick a service to compare vendor prices."}
            </div>
          </SheetHeader>

          {selected ? (
            <CompareTable
              catalogItemId={selected.id}
              serviceName={selected.service}
              onBack={() => setSelected(null)}
            />
          ) : (
            <>
              <div className="relative mb-[12px]">
                <Search className="absolute left-[14px] top-1/2 -translate-y-1/2 w-[15px] h-[15px] text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search a service…"
                  data-testid="input-compare-search"
                  className="w-full bg-card border border-[var(--hairline)] rounded-full py-[11px] pl-[38px] pr-[14px] text-[14px] text-[var(--ink)] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40"
                />
              </div>

              {isLoading ? (
                <div className="animate-pulse h-24 bg-card rounded-[16px] border border-[var(--hairline)]" />
              ) : !items?.length ? (
                <div className="text-center text-[13px] text-muted-foreground py-[36px]">
                  No services on the master list yet.
                </div>
              ) : !visible.length ? (
                <div className="text-center text-[13px] text-muted-foreground py-[36px]">
                  No service matches "{query.trim()}".
                </div>
              ) : (
                <div className="flex flex-col gap-[8px]">
                  {visible.map((i) => (
                    <button
                      key={i.id}
                      onClick={() =>
                        setSelected({ id: i.id, service: i.service })
                      }
                      data-testid={`row-service-${i.id}`}
                      className="text-left rounded-[16px] border border-[var(--hairline)] bg-card p-[12px_14px] active:scale-[0.98] transition-transform w-full"
                    >
                      <div className="flex items-center justify-between gap-[8px]">
                        <div className="min-w-0">
                          <div className="font-semibold text-[14px] text-[var(--ink)] truncate">
                            {i.service}
                          </div>
                          <div className="text-[11.5px] text-muted-foreground truncate">
                            {[i.category, i.detail].filter(Boolean).join(" · ") ||
                              "Catalog"}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[11px] text-muted-foreground">
                            Master
                          </div>
                          <div className="font-bold text-[13px] text-[var(--ink)]">
                            {i.rate != null
                              ? `$${i.rate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${i.unit ? ` / ${i.unit}` : ""}`
                              : "—"}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
