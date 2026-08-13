import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useListCheckFiles, type CheckFileEntry } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, FileCheck2, ImageOff } from "lucide-react";

function fmtMoney(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function matches(c: CheckFileEntry, q: string): boolean {
  const hay = [
    c.payerName,
    c.checkNumber,
    c.invoiceNo,
    c.propertyName,
    c.jobLabel,
    c.amount?.toFixed(2),
    String(c.amount ?? ""),
    fmtDate(c.receivedAt),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((tok) => hay.includes(tok));
}

export function CheckFilesTab() {
  const { data: checks, isLoading } = useListCheckFiles();
  const [query, setQuery] = useState("");
  const [propertyFilter, setPropertyFilter] = useState("");
  const [viewer, setViewer] = useState<CheckFileEntry | null>(null);

  const properties = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of checks ?? []) {
      if (c.propertyId && c.propertyName) map.set(c.propertyId, c.propertyName);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [checks]);

  const filtered = useMemo(() => {
    let list = checks ?? [];
    if (propertyFilter) list = list.filter((c) => c.propertyId === propertyFilter);
    if (query.trim()) list = list.filter((c) => matches(c, query));
    return list;
  }, [checks, propertyFilter, query]);

  const total = filtered.reduce((s, c) => s + (c.amount ?? 0), 0);

  return (
    <Card className="rounded-none border border-border shadow-sm">
      <CardContent className="p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[260px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              className="w-full border border-border bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--secondary)]/30"
              placeholder="Search payer, check #, invoice, property, job, amount, date…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="input-check-search"
            />
          </div>
          <select
            className="border border-border bg-white px-3 py-2 text-sm focus:outline-none"
            value={propertyFilter}
            onChange={(e) => setPropertyFilter(e.target.value)}
            data-testid="select-check-property"
          >
            <option value="">All properties</option>
            {properties.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <div className="text-sm text-muted-foreground font-medium">
            {isLoading
              ? "Loading…"
              : `${filtered.length} check${filtered.length === 1 ? "" : "s"} · ${fmtMoney(total)}`}
          </div>
        </div>

        {!isLoading && filtered.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground text-sm">
            <FileCheck2 className="w-7 h-7 mx-auto mb-3 opacity-40" />
            {query || propertyFilter
              ? "No checks match this search."
              : "No checks filed yet. Scan a check (mobile app or the Scan Check button) and it lands here automatically."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                  <th className="py-2 pr-3 font-bold">Check</th>
                  <th className="py-2 pr-3 font-bold">Payer</th>
                  <th className="py-2 pr-3 font-bold">Check #</th>
                  <th className="py-2 pr-3 font-bold">Amount</th>
                  <th className="py-2 pr-3 font-bold">Received</th>
                  <th className="py-2 pr-3 font-bold">Property / Job</th>
                  <th className="py-2 font-bold">Invoice</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="border-b border-border/60" data-testid={`row-check-${c.id}`}>
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        onClick={() => c.checkImagePath && setViewer(c)}
                        className="w-[76px] h-[48px] border border-border bg-muted/30 overflow-hidden flex items-center justify-center hover:opacity-80"
                        aria-label={c.checkImagePath ? `View check image for ${c.payerName ?? "this check"}` : "No check image on file"}
                        title={c.checkImagePath ? "View check image" : "No image on file"}
                      >
                        {c.checkImagePath ? (
                          <img
                            src={`/api/storage${c.checkImagePath}`}
                            alt={`Check from ${c.payerName ?? "unknown payer"}`}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <ImageOff className="w-4 h-4 text-muted-foreground/50" />
                        )}
                      </button>
                    </td>
                    <td className="py-2 pr-3 font-semibold">{c.payerName || "Unknown"}</td>
                    <td className="py-2 pr-3">{c.checkNumber || "—"}</td>
                    <td className="py-2 pr-3 font-bold">{fmtMoney(c.amount)}</td>
                    <td className="py-2 pr-3">{fmtDate(c.receivedAt)}</td>
                    <td className="py-2 pr-3">
                      {[c.propertyName, c.jobLabel].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="py-2">
                      {c.invoiceId ? (
                        <Link
                          href={`/invoices/${c.invoiceId}`}
                          className="text-[var(--secondary)] font-semibold hover:underline"
                        >
                          {c.invoiceNo || "Invoice"}
                          {c.invoiceStatus === "paid" && (
                            <Badge className="ml-2 rounded-none bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Paid</Badge>
                          )}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Dialog open={!!viewer} onOpenChange={(o) => !o && setViewer(null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>
                {viewer?.payerName || "Check"} · {viewer ? fmtMoney(viewer.amount) : ""}
                {viewer?.checkNumber ? ` · #${viewer.checkNumber}` : ""}
              </DialogTitle>
            </DialogHeader>
            {viewer?.checkImagePath && (
              <img
                src={`/api/storage${viewer.checkImagePath}`}
                alt="Check"
                className="w-full max-h-[70vh] object-contain border border-border"
              />
            )}
            <div className="text-sm text-muted-foreground">
              {[viewer?.propertyName, viewer?.jobLabel, fmtDate(viewer?.receivedAt)]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
