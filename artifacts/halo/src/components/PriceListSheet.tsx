/**
 * Price list bottom sheet — two modes:
 *
 *  1. Master list (vendor = null/undefined): read-only view of catalog_items,
 *     opened from the "Price list" button at the top of the Vendors page.
 *
 *  2. Vendor rate sheet (vendor provided): shows master rates alongside this
 *     vendor's own rates, with tap-to-edit inline rows.
 */
import { useMemo, useState, useRef } from "react";
import { Search, X, Pencil } from "lucide-react";
import {
  useListCatalogItems,
  useListVendorRates,
  useUpsertVendorRate,
  useDeleteVendorRate,
  getListVendorRatesQueryKey,
  type VendorRate,
  type ListVendorRatesQueryResult,
} from "@workspace/api-client-react";
import type { UseQueryOptions } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

function rateLabel(rate: number | null | undefined, unit: string | null | undefined) {
  if (rate == null) return "—";
  const money = `$${rate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return unit ? `${money} / ${unit}` : money;
}

function VendorRateCell({
  catalogItemId,
  vendorId,
  existing,
  unit,
}: {
  catalogItemId: string;
  vendorId: string;
  existing: VendorRate | undefined;
  unit: string | null | undefined;
}) {
  const qc = useQueryClient();
  const upsert = useUpsertVendorRate();
  const remove = useDeleteVendorRate();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getListVendorRatesQueryKey(vendorId) });

  const startEdit = () => {
    setDraft(existing?.rate != null ? String(existing.rate) : "");
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commit = () => {
    const val = parseFloat(draft.replace(/[^0-9.]/g, ""));
    if (!isNaN(val) && val >= 0) {
      upsert.mutate(
        { id: vendorId, catalogItemId, data: { rate: val } },
        { onSuccess: () => { invalidate(); setEditing(false); } },
      );
    } else {
      setEditing(false);
    }
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!existing) return;
    remove.mutate(
      { id: vendorId, catalogItemId },
      { onSuccess: () => invalidate() },
    );
  };

  if (editing) {
    return (
      <div className="flex items-center gap-[6px] mt-[6px]">
        <span className="text-[11px] text-muted-foreground">Vendor rate: $</span>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-20 bg-background border border-[var(--gold)]/50 rounded-[8px] px-2 py-1 text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40"
          autoFocus
          inputMode="decimal"
        />
        {unit && <span className="text-[11px] text-muted-foreground">/ {unit}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-[8px] mt-[5px]">
      <span className="text-[11px] text-muted-foreground">Vendor rate:</span>
      <button
        onClick={startEdit}
        className="flex items-center gap-[4px] text-[13px] font-bold text-[var(--gold-dark)] active:opacity-70"
      >
        {existing ? rateLabel(existing.rate, unit) : <span className="italic font-normal text-muted-foreground">tap to add</span>}
        <Pencil className="w-[11px] h-[11px] text-muted-foreground" />
      </button>
      {existing && (
        <button
          onClick={clear}
          aria-label="Clear vendor rate"
          className="w-[18px] h-[18px] grid place-items-center text-muted-foreground active:text-red-500"
        >
          <X className="w-[12px] h-[12px]" />
        </button>
      )}
    </div>
  );
}

export function PriceListSheet({
  open,
  onOpenChange,
  vendor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendor?: { id: string; name: string } | null;
}) {
  const { data: items, isLoading: catalogLoading } = useListCatalogItems();
  const vendorId = vendor?.id ?? "";
  const { data: vendorRates, isLoading: ratesLoading } = useListVendorRates(vendorId, {
    query: {
      queryKey: getListVendorRatesQueryKey(vendorId),
      enabled: !!vendor?.id,
    } as UseQueryOptions<ListVendorRatesQueryResult>,
  });
  const [query, setQuery] = useState("");

  const rateByItemId = useMemo(() => {
    const map = new Map<string, VendorRate>();
    for (const r of vendorRates ?? []) map.set(r.catalogItemId, r);
    return map;
  }, [vendorRates]);

  const isLoading = catalogLoading || (!!vendor && ratesLoading);
  const isVendorMode = !!vendor;

  const visible = useMemo(() => {
    const list = items ?? [];
    const q = query.trim().toLowerCase();
    const matched = q
      ? list.filter((i) =>
          [i.service, i.detail, i.category, i.unit]
            .filter(Boolean)
            .some((s) => String(s).toLowerCase().includes(q)),
        )
      : list;
    return [...matched].sort((a, b) => a.service.localeCompare(b.service));
  }, [items, query]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[26px] bg-[var(--paper)] p-0 flex flex-col max-h-[86vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]"
      >
        <div className="w-[40px] h-[4.5px] rounded-[3px] bg-[rgba(23,24,28,0.16)] mx-auto mt-[10px] mb-[4px] shrink-0" />
        <div className="p-[8px_18px_26px] overflow-y-auto">
          <SheetHeader className="text-left mb-[12px]">
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">
              {isVendorMode ? `${vendor!.name} — Rates` : "Master price list"}
            </SheetTitle>
            <div className="text-[13px] text-muted-foreground">
              {isVendorMode
                ? "Tap any row to record or change this vendor's rate."
                : "Standard rates. Edit them in the Price Book."}
            </div>
          </SheetHeader>
          <div className="relative mb-[12px]">
            <Search className="absolute left-[14px] top-1/2 -translate-y-1/2 w-[15px] h-[15px] text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a service…"
              data-testid="input-price-list-search"
              className="w-full bg-card border border-[var(--hairline)] rounded-full py-[11px] pl-[38px] pr-[14px] text-[14px] text-[var(--ink)] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40"
            />
          </div>
          {isLoading ? (
            <div className="animate-pulse h-32 bg-card rounded-[20px] border border-[var(--hairline)]" />
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
                <div
                  key={i.id}
                  data-testid={`row-price-${i.id}`}
                  className="bg-card rounded-[16px] border border-[var(--hairline)] p-[12px_14px]"
                >
                  <div className="flex items-start gap-[10px]">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-[14px] text-[var(--ink)] truncate">
                        {i.service}
                      </div>
                      <div className="text-[11.5px] text-muted-foreground truncate">
                        {[i.category, i.detail].filter(Boolean).join(" · ") || "Catalog"}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[11px] text-muted-foreground">
                        {isVendorMode ? "Master" : ""}
                      </div>
                      <div className="text-[13.5px] font-bold text-[var(--ink)]">
                        {rateLabel(i.rate, i.unit)}
                      </div>
                    </div>
                  </div>
                  {isVendorMode && (
                    <VendorRateCell
                      catalogItemId={i.id}
                      vendorId={vendor!.id}
                      existing={rateByItemId.get(i.id)}
                      unit={i.unit}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
