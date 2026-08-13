/**
 * Desktop MoneyPanel — right-side slide-over with financial overview.
 */
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  useGetMoneySummary, useListInvoices,
  getGetMoneySummaryQueryKey, getListInvoicesQueryKey,
} from "@workspace/api-client-react";
import { X, DollarSign, Loader2, AlertCircle } from "lucide-react";

const fmt$ = (n?: number | null) => {
  if (n == null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n).toLocaleString()}`;
};
const fmtPct = (n?: number | null) => n == null ? "—" : `${Math.round(n * 100)}%`;

export function MoneyPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: summary, isLoading: sl } = useGetMoneySummary({
    query: { queryKey: getGetMoneySummaryQueryKey(), refetchInterval: 30_000, enabled: open },
  });
  const { data: invoicesData, isLoading: il } = useListInvoices(
    { status: "sent" },
    { query: { queryKey: getListInvoicesQueryKey({ status: "sent" }), enabled: open, refetchInterval: 30_000 } }
  );

  const isLoading = sl || il;
  const s = summary as any;
  const invoices = ((invoicesData ?? []) as any[]).sort((a, b) => {
    const aO = a.status === "past_due" ? 1 : 0, bO = b.status === "past_due" ? 1 : 0;
    if (aO !== bO) return bO - aO;
    return (b.total ?? 0) - (a.total ?? 0);
  });

  const mtd = s?.mtd?.revenue ?? s?.landing?.revenue ?? null;
  const rec = s?.landing?.receivables ?? null;
  const margin = s?.marginPct ?? null;
  const overdueAmt = s?.aging?.find?.((a: any) => a.bucket === "60+" || a.bucket === "90+")?.amount ?? null;

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <SheetContent
        side="right"
        className="w-[420px] flex flex-col p-0 border-none"
        style={{ background: "#080D17", boxShadow: "-1px 0 0 rgba(255,255,255,0.07)" }}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4 shrink-0 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-[#B4FF44]/12 border border-[#B4FF44]/25 grid place-items-center">
              <DollarSign className="w-3.5 h-3.5 text-[#B4FF44]" />
            </div>
            <div>
              <div className="text-[14px] font-semibold text-white/92">Money</div>
              <div className="text-[11px] text-white/35">{isLoading ? "Loading…" : `${invoices.length} outstanding`}</div>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-white/[0.06] grid place-items-center text-white/40 hover:text-white/70 transition-colors">
            <X className="w-3 h-3" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-white/25" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <div className="grid grid-cols-3 gap-2 px-4 py-4">
              {[
                { label: "MTD Revenue", value: fmt$(mtd) },
                { label: "Receivables", value: fmt$(rec), accent: "#F59E0B" },
                { label: "Avg Margin", value: fmtPct(margin), accent: margin != null && margin < 0.2 ? "#E11D48" : "#22C55E" },
              ].map(kpi => (
                <div key={kpi.label} className="rounded-[11px] bg-white/[0.04] border border-white/[0.06] px-3 py-3">
                  <div className="text-[8.5px] font-bold tracking-[0.14em] uppercase text-white/25 mb-1">{kpi.label}</div>
                  <div className="text-[17px] font-bold leading-none" style={{ color: kpi.accent ?? "#ffffff", opacity: kpi.accent ? 1 : 0.85 }}>{kpi.value}</div>
                </div>
              ))}
            </div>

            {overdueAmt != null && overdueAmt > 0 && (
              <div className="mx-4 mb-3 flex items-center gap-2 bg-[#E11D48]/8 border border-[#E11D48]/18 rounded-[9px] px-3 py-2">
                <AlertCircle className="w-3 h-3 text-[#E11D48] shrink-0" />
                <span className="text-[11.5px] text-[#E11D48]/75">{fmt$(overdueAmt)} past 60+ days</span>
              </div>
            )}

            <div className="px-4 pb-4">
              <div className="text-[9.5px] font-bold tracking-[0.16em] uppercase text-white/22 mb-2">Outstanding Invoices</div>
              {invoices.length === 0 && <div className="text-[12px] text-white/28 py-5 text-center">No outstanding invoices</div>}
              {invoices.map((inv: any) => (
                <div key={inv.id} className="flex items-center gap-3 py-2.5 border-b border-white/[0.04] last:border-0">
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${inv.status === "past_due" ? "bg-[#E11D48]" : "bg-[#F59E0B]"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-medium text-white/75 truncate">{inv.propertyName ?? inv.clientName ?? "Invoice"}</div>
                    <div className="text-[10.5px] text-white/32">{inv.invoiceNo ?? inv.id?.slice(0, 8)}{inv.status === "past_due" ? " · Past due" : " · Sent"}</div>
                  </div>
                  <div className="text-[13px] font-semibold tabular-nums" style={{ color: inv.status === "past_due" ? "#E11D48" : "#F59E0B" }}>
                    {fmt$(inv.total ?? inv.amount)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
