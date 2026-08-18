/**
 * Price list dialog — two modes:
 *
 *  1. Master list (vendor = null/undefined): read-only view of catalog_items,
 *     opened from the "Price list" button at the top of the Vendors page.
 *
 *  2. Vendor rate sheet (vendor provided): shows master rates alongside this
 *     vendor's own rates, with inline editing. Opened via "Rates" on a row.
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

function rateLabel(rate: number | null | undefined, unit: string | null | undefined) {
  if (rate == null) return "—";
  const money = `$${rate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return unit ? `${money} / ${unit}` : money;
}

/** Inline editable rate cell for a vendor's rate sheet. */
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
      <div className="flex items-center justify-end gap-1">
        <span className="text-muted-foreground text-xs">$</span>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-24 text-right bg-background border border-[var(--gold)]/50 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40"
          autoFocus
        />
        {unit && <span className="text-xs text-muted-foreground">/ {unit}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1 group">
      <span className={`font-semibold text-sm ${existing ? "text-[var(--ink)]" : "text-muted-foreground italic"}`}>
        {existing ? rateLabel(existing.rate, unit) : "—"}
      </span>
      <button
        onClick={startEdit}
        aria-label="Edit vendor rate"
        className="w-5 h-5 grid place-items-center rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
      >
        <Pencil className="w-3 h-3" />
      </button>
      {existing && (
        <button
          onClick={clear}
          aria-label="Clear vendor rate"
          className="w-5 h-5 grid place-items-center rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

export function PriceListDialog({
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

  const isVendorMode = !!vendor;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="dialog-price-list">
        <DialogHeader>
          <DialogTitle className="font-display">
            {isVendorMode ? `${vendor!.name} — Rate sheet` : "Master price list"}
          </DialogTitle>
          <DialogDescription>
            {isVendorMode
              ? "Vendor's rates for each service alongside the master price. Hover a row to edit."
              : "The company's standard rates. Edit them in Purchasing → Price Book."}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a service…"
            autoFocus
            data-testid="input-price-list-search"
            className="w-full bg-background border border-border rounded-full py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40"
          />
        </div>

        <div className="max-h-[55vh] overflow-y-auto -mx-1 px-1">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : !items?.length ? (
            <p className="text-sm text-muted-foreground py-10 text-center">
              No services on the master list yet.
            </p>
          ) : !visible.length ? (
            <p className="text-sm text-muted-foreground py-10 text-center">
              No service matches "{query.trim()}".
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 font-semibold">Service</th>
                  <th className="py-2 font-semibold">Category</th>
                  <th className="py-2 font-semibold text-right">
                    {isVendorMode ? "Master rate" : "Rate"}
                  </th>
                  {isVendorMode && (
                    <th className="py-2 font-semibold text-right pl-4">
                      Vendor rate
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--hairline)]">
                {visible.map((i) => (
                  <tr key={i.id} data-testid={`row-price-${i.id}`}>
                    <td className="py-2.5 pr-3">
                      <div className="font-semibold text-[var(--ink)]">{i.service}</div>
                      {i.detail ? (
                        <div className="text-xs text-muted-foreground">{i.detail}</div>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{i.category || "—"}</td>
                    <td className="py-2.5 text-right font-semibold whitespace-nowrap text-[var(--ink)]">
                      {rateLabel(i.rate, i.unit)}
                    </td>
                    {isVendorMode && (
                      <td className="py-2.5 pl-4 whitespace-nowrap">
                        <VendorRateCell
                          catalogItemId={i.id}
                          vendorId={vendor!.id}
                          existing={rateByItemId.get(i.id)}
                          unit={i.unit}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
