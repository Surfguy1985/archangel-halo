/**
 * Read-only view of the master price list, opened from the Vendors module.
 *
 * This is the same master catalog the Price Book page edits — the vendors
 * module deliberately does not keep its own copy of pricing, so a rate
 * corrected in one place is corrected everywhere.
 */
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useListCatalogItems } from "@workspace/api-client-react";
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

export function PriceListDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: items, isLoading } = useListCatalogItems();
  const [query, setQuery] = useState("");

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="dialog-price-list">
        <DialogHeader>
          <DialogTitle className="font-display">Master price list</DialogTitle>
          <DialogDescription>
            The company's standard rates. Edit them in Purchasing → Price Book.
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
                  <th className="py-2 font-semibold text-right">Rate</th>
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
