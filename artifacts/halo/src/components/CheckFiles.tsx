import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useListCheckFiles, type CheckFileEntry } from "@workspace/api-client-react";
import { Search, FileCheck2, X, ImageOff } from "lucide-react";

const inputCls =
  "w-full bg-card border border-[var(--hairline)] rounded-[18px] py-[12px] px-[16px] text-[15px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-[var(--ink)] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40 focus:border-[var(--gold)]";

function fmtMoney(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function matchesCheckSearch(c: CheckFileEntry, q: string): boolean {
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

export function CheckFiles() {
  const { data: checks, isLoading } = useListCheckFiles();
  const [, navigate] = useLocation();
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
    if (query.trim()) list = list.filter((c) => matchesCheckSearch(c, query));
    return list;
  }, [checks, propertyFilter, query]);

  const total = filtered.reduce((s, c) => s + (c.amount ?? 0), 0);

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="relative">
        <Search className="w-[18px] h-[18px] absolute left-[14px] top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          className={`${inputCls} pl-[42px]`}
          placeholder="Search payer, check #, property, job, amount…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="input-check-search"
        />
      </div>
      {properties.length > 1 && (
        <div className="flex gap-[8px] overflow-x-auto pb-[2px] -mx-[4px] px-[4px]">
          <button
            onClick={() => setPropertyFilter("")}
            className={`shrink-0 px-[14px] py-[7px] rounded-full text-[13px] font-semibold border transition-colors ${!propertyFilter ? "bg-[var(--ink)] text-white border-[var(--ink)]" : "bg-card border-[var(--hairline)] text-muted-foreground"}`}
          >
            All properties
          </button>
          {properties.map(([id, name]) => (
            <button
              key={id}
              onClick={() => setPropertyFilter(propertyFilter === id ? "" : id)}
              className={`shrink-0 px-[14px] py-[7px] rounded-full text-[13px] font-semibold border transition-colors ${propertyFilter === id ? "bg-[var(--ink)] text-white border-[var(--ink)]" : "bg-card border-[var(--hairline)] text-muted-foreground"}`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      <div className="text-[13px] text-muted-foreground px-[4px]">
        {isLoading
          ? "Loading check files…"
          : `${filtered.length} check${filtered.length === 1 ? "" : "s"} on file · ${fmtMoney(total)}`}
      </div>

      {!isLoading && filtered.length === 0 && (
        <div className="bg-card border border-[var(--hairline)] rounded-[24px] p-[28px] text-center text-muted-foreground text-[14px]">
          <FileCheck2 className="w-[28px] h-[28px] mx-auto mb-[10px] opacity-40" />
          {query || propertyFilter
            ? "No checks match this search."
            : "No checks filed yet. Scan a check from the Money tab and it lands here automatically."}
        </div>
      )}

      <div className="flex flex-col gap-[12px]">
        {filtered.map((c) => (
          <div
            key={c.id}
            className="bg-card border border-[var(--hairline)] rounded-[22px] p-[14px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] flex gap-[14px]"
            data-testid={`card-check-${c.id}`}
          >
            <button
              onClick={() => c.checkImagePath && setViewer(c)}
              className="w-[92px] h-[64px] rounded-[12px] overflow-hidden shrink-0 bg-muted/40 border border-[var(--hairline)] flex items-center justify-center"
            >
              {c.checkImagePath ? (
                <img
                  src={`/api/storage${c.checkImagePath}`}
                  alt="Check"
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <ImageOff className="w-[20px] h-[20px] text-muted-foreground/50" />
              )}
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-[8px]">
                <div className="font-semibold text-[15px] text-[var(--ink)] truncate">
                  {c.payerName || "Unknown payer"}
                </div>
                <div className="font-display font-bold text-[15px] text-[var(--ink)] shrink-0">
                  {fmtMoney(c.amount)}
                </div>
              </div>
              <div className="text-[13px] text-muted-foreground truncate mt-[2px]">
                {c.checkNumber ? `Check #${c.checkNumber} · ` : ""}
                {fmtDate(c.receivedAt)}
              </div>
              <div className="text-[13px] text-muted-foreground truncate mt-[2px]">
                {[c.propertyName, c.jobLabel].filter(Boolean).join(" · ") || "Unassigned"}
              </div>
              {c.invoiceId && (
                <button
                  onClick={() => navigate(`/invoices/${c.invoiceId}`)}
                  className="text-[13px] font-semibold text-[var(--gold-dark)] mt-[4px]"
                  data-testid={`link-check-invoice-${c.id}`}
                >
                  Invoice {c.invoiceNo || ""}
                  {c.invoiceStatus === "paid" ? " · Paid" : ""}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {viewer && (
        <div
          className="fixed inset-0 z-[100] bg-black/85 flex flex-col items-center justify-center p-[16px]"
          onClick={() => setViewer(null)}
        >
          <button
            className="absolute top-[18px] right-[18px] text-white/90 p-[8px]"
            onClick={() => setViewer(null)}
            aria-label="Close"
          >
            <X className="w-[26px] h-[26px]" />
          </button>
          <img
            src={`/api/storage${viewer.checkImagePath}`}
            alt="Check"
            className="max-w-full max-h-[70vh] rounded-[12px] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="text-white/90 text-[14px] mt-[14px] text-center">
            {viewer.payerName || "Unknown payer"} · {fmtMoney(viewer.amount)}
            {viewer.checkNumber ? ` · #${viewer.checkNumber}` : ""}
            <div className="text-white/60 text-[13px] mt-[4px]">
              {[viewer.propertyName, viewer.jobLabel, fmtDate(viewer.receivedAt)]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
