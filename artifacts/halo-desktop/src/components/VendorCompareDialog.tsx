/**
 * VendorCompareDialog — pick a catalog service, see every vendor's rate for
 * it ranked cheapest-first, with the master price as a reference column.
 */
import { useState, useMemo } from "react";
import { Search, ArrowLeft, BarChart2, Download } from "lucide-react";
import {
  useListCatalogItems,
  useListCatalogItemVendorRates,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { exportCsv } from "@/lib/exportCsv";

function rateLabel(rate: number, unit: string | null | undefined) {
  const money = `$${rate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return unit ? `${money} / ${unit}` : money;
}

/* ---------------------------------------------------------- compare table */

function CompareTable({
  catalogItemId,
  onBack,
}: {
  catalogItemId: string;
  onBack: () => void;
}) {
  const { data: vendors, isLoading } = useListCatalogItemVendorRates(catalogItemId);
  const { data: items } = useListCatalogItems();
  const item = useMemo(
    () => items?.find((i) => i.id === catalogItemId),
    [items, catalogItemId],
  );

  function handleExport() {
    if (!vendors?.length || !item) return;
    const today = new Date().toISOString().slice(0, 10);
    const slug = (item.service ?? "service")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const filename = `vendor-compare-${slug}-${today}.csv`;
    const rows = (vendors as Array<Record<string, any>>).map((v) => {
      const pct =
        v.masterRate != null && v.masterRate > 0
          ? ((v.rate / v.masterRate - 1) * 100).toFixed(1) + "%"
          : "";
      return {
        vendor: v.vendorName,
        theirRate: v.rate.toFixed(2),
        masterRate: v.masterRate != null ? v.masterRate.toFixed(2) : "",
        vsMaster: pct,
        unit: v.unit ?? "",
      };
    });
    exportCsv(filename, [
      { key: "vendor", label: "Vendor" },
      { key: "theirRate", label: "Their rate" },
      { key: "masterRate", label: "Master rate" },
      { key: "vsMaster", label: "vs. master %" },
      { key: "unit", label: "Unit" },
    ], rows);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to services
        </button>
        {vendors && vendors.length > 0 && (
          <button
            type="button"
            onClick={handleExport}
            data-testid="btn-export-csv"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
        )}
      </div>

      <div className="mb-3">
        <div className="font-display font-bold text-lg text-[var(--ink)]">
          {item?.service ?? "—"}
        </div>
        {item?.category && (
          <div className="text-sm text-muted-foreground">{item.category}</div>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : !vendors?.length ? (
        <p className="text-sm text-muted-foreground py-10 text-center">
          No vendors have a rate for this service yet. Open a vendor's rate sheet
          to add one.
        </p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted-foreground border-b border-[var(--hairline)]">
            <tr>
              <th className="py-2 font-semibold">Vendor</th>
              <th className="py-2 font-semibold text-right">Their rate</th>
              <th className="py-2 font-semibold text-right pl-6">Master rate</th>
              <th className="py-2 font-semibold text-right pl-4">vs. master</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--hairline)]">
            {vendors.map((v, idx) => {
              const diff =
                v.masterRate != null ? v.rate - v.masterRate : null;
              const pct =
                v.masterRate != null && v.masterRate > 0
                  ? ((v.rate / v.masterRate) - 1) * 100
                  : null;
              return (
                <tr key={v.vendorId} data-testid={`row-compare-${v.vendorId}`}>
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-2">
                      {idx === 0 && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-[var(--gold-light)] text-black">
                          Lowest
                        </span>
                      )}
                      <span className="font-semibold text-[var(--ink)]">
                        {v.vendorName}
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 text-right font-bold text-[var(--ink)] whitespace-nowrap">
                    {rateLabel(v.rate, v.unit)}
                  </td>
                  <td className="py-2.5 text-right pl-6 text-muted-foreground whitespace-nowrap">
                    {v.masterRate != null ? rateLabel(v.masterRate, v.unit) : "—"}
                  </td>
                  <td className="py-2.5 text-right pl-4 whitespace-nowrap">
                    {diff != null && pct != null ? (
                      <span
                        className={`text-xs font-semibold ${
                          diff > 0
                            ? "text-red-600"
                            : diff < 0
                              ? "text-green-700"
                              : "text-muted-foreground"
                        }`}
                      >
                        {diff > 0 ? "+" : ""}
                        {pct.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- service picker */

export function VendorCompareDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: items, isLoading } = useListCatalogItems();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const list = items ?? [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? list.filter((i) =>
          [i.service, i.category, i.detail, i.unit]
            .filter(Boolean)
            .some((s) => String(s).toLowerCase().includes(q)),
        )
      : list;
    return [...filtered].sort((a, b) => a.service.localeCompare(b.service));
  }, [items, query]);

  const handleOpenChange = (o: boolean) => {
    if (!o) {
      setSelectedId(null);
      setQuery("");
    }
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="dialog-vendor-compare">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <BarChart2 className="w-4 h-4" /> Compare vendors
          </DialogTitle>
          <DialogDescription>
            {selectedId
              ? "All vendors with a rate for this service, cheapest first."
              : "Pick a catalog service to see every vendor's rate side by side."}
          </DialogDescription>
        </DialogHeader>

        {selectedId ? (
          <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1">
            <CompareTable
              catalogItemId={selectedId}
              onBack={() => setSelectedId(null)}
            />
          </div>
        ) : (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search a service…"
                autoFocus
                data-testid="input-compare-search"
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
                        Master rate
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--hairline)]">
                    {visible.map((i) => (
                      <tr
                        key={i.id}
                        onClick={() => setSelectedId(i.id)}
                        data-testid={`row-service-${i.id}`}
                        className="cursor-pointer hover:bg-black/[0.02] transition-colors"
                      >
                        <td className="py-2.5 pr-3">
                          <div className="font-semibold text-[var(--ink)]">
                            {i.service}
                          </div>
                          {i.detail && (
                            <div className="text-xs text-muted-foreground">
                              {i.detail}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 text-muted-foreground">
                          {i.category || "—"}
                        </td>
                        <td className="py-2.5 text-right font-semibold text-[var(--ink)] whitespace-nowrap">
                          {i.rate != null
                            ? `$${i.rate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${i.unit ? ` / ${i.unit}` : ""}`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
