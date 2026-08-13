/**
 * MoneyPanel — full-screen dark slide-up showing financial overview and key invoices.
 * Summoned from the chat composer, returns user to the same conversation on close.
 */
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  useGetMoneySummary,
  useListInvoices,
  getGetMoneySummaryQueryKey,
  getListInvoicesQueryKey,
} from "@workspace/api-client-react";
import { X, DollarSign, Loader2, TrendingUp, TrendingDown, AlertCircle } from "lucide-react";

const fmt$ = (n?: number | null) => {
  if (n == null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n).toLocaleString()}`;
};

const fmtPct = (n?: number | null) =>
  n == null ? "—" : `${Math.round(n * 100)}%`;

export function MoneyPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { data: summary, isLoading: summaryLoading } = useGetMoneySummary({
    query: { queryKey: getGetMoneySummaryQueryKey(), refetchInterval: 30_000, enabled: open },
  });
  const { data: invoicesData, isLoading: invoicesLoading } = useListInvoices(
    { status: "sent" },
    { query: { queryKey: [...getListInvoicesQueryKey({ status: "sent" })], enabled: open, refetchInterval: 30_000 } }
  );

  const isLoading = summaryLoading || invoicesLoading;
  const invoices = (invoicesData ?? []) as any[];
  const s = summary as any;

  const mtdRevenue = s?.mtd?.revenue ?? s?.landing?.revenue ?? null;
  const receivables = s?.landing?.receivables ?? null;
  const marginPct = s?.marginPct ?? null;
  const overdueAmt = s?.aging?.find?.((a: any) => a.bucket === "60+" || a.bucket === "90+")?.amount ?? null;

  // Sort: past due first, then by amount descending
  const sorted = [...invoices].sort((a, b) => {
    const aOverdue = a.status === "past_due" ? 1 : 0;
    const bOverdue = b.status === "past_due" ? 1 : 0;
    if (aOverdue !== bOverdue) return bOverdue - aOverdue;
    return (b.total ?? b.amount ?? 0) - (a.total ?? a.amount ?? 0);
  });

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent
        side="bottom"
        className="h-[92dvh] flex flex-col p-0 rounded-t-[20px] border-none"
        style={{ background: "#080D17", boxShadow: "0 -1px 0 rgba(255,255,255,0.07)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 shrink-0 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-[#B4FF44]/12 border border-[#B4FF44]/25 grid place-items-center">
              <DollarSign className="w-3.5 h-3.5 text-[#B4FF44]" />
            </div>
            <div>
              <div className="text-[15px] font-semibold text-white/92">Money</div>
              <div className="text-[11px] text-white/35">
                {isLoading ? "Loading…" : `${invoices.length} invoice${invoices.length !== 1 ? "s" : ""} outstanding`}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/[0.06] border border-white/10 grid place-items-center text-white/40 hover:text-white/70 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {isLoading && (
          <div className="flex-1 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-white/25" />
            <span className="text-[12.5px] text-white/30">Fetching financials…</span>
          </div>
        )}

        {!isLoading && (
          <div className="flex-1 overflow-y-auto">
            {/* KPI row */}
            <div className="grid grid-cols-3 gap-2.5 px-4 py-4">
              <KpiCell label="MTD Revenue" value={fmt$(mtdRevenue)} />
              <KpiCell label="Receivables" value={fmt$(receivables)} accent="#F59E0B" />
              <KpiCell label="Avg Margin" value={fmtPct(marginPct)} accent={marginPct != null && marginPct < 0.2 ? "#E11D48" : "#22C55E"} />
            </div>

            {overdueAmt != null && overdueAmt > 0 && (
              <div className="mx-4 mb-3 flex items-center gap-2 bg-[#E11D48]/8 border border-[#E11D48]/18 rounded-[10px] px-3 py-2.5">
                <AlertCircle className="w-3.5 h-3.5 text-[#E11D48] shrink-0" />
                <span className="text-[12px] text-[#E11D48]/80">{fmt$(overdueAmt)} past 60+ days</span>
              </div>
            )}

            {/* Invoice list */}
            <div className="px-4 pb-4">
              <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-white/25 mb-2">
                Outstanding Invoices
              </div>
              {sorted.length === 0 && (
                <div className="text-[13px] text-white/30 py-6 text-center">No outstanding invoices</div>
              )}
              {sorted.map((inv: any) => (
                <InvoiceRow key={inv.id} inv={inv} />
              ))}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function KpiCell({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-[12px] bg-white/[0.04] border border-white/[0.06] px-3 py-3">
      <div className="text-[9px] font-bold tracking-[0.16em] uppercase text-white/28 mb-1">{label}</div>
      <div
        className="text-[18px] font-bold leading-none tabular-nums"
        style={{ color: accent ?? "#ffffff", opacity: accent ? 1 : 0.85 }}
      >
        {value}
      </div>
    </div>
  );
}

function InvoiceRow({ inv }: { inv: any }) {
  const isPastDue = inv.status === "past_due";
  const amount = inv.total ?? inv.amount ?? 0;

  return (
    <div className="flex items-center gap-3 py-3 border-b border-white/[0.04] last:border-0">
      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isPastDue ? "bg-[#E11D48]" : "bg-[#F59E0B]"}`} />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-white/80 truncate">
          {inv.propertyName ?? inv.clientName ?? "Invoice"}
        </div>
        <div className="text-[11px] text-white/35 truncate">
          {inv.invoiceNo ?? inv.id?.slice(0, 8)}
          {isPastDue ? " · Past due" : " · Sent"}
        </div>
      </div>
      <div className="text-[13.5px] font-semibold tabular-nums" style={{ color: isPastDue ? "#E11D48" : "#F59E0B" }}>
        {fmt$(amount)}
      </div>
    </div>
  );
}
