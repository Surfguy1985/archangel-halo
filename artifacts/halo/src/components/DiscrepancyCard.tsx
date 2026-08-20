import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";

type Disc = {
  id: string; jobId: string; type: string; serviceCode: string | null;
  expectedCents: number | null; actualCents: number | null; varianceCents: number | null;
  severity: string; status: string; explanation: string;
  suggestedFix?: { recommendedInvoiceCents?: number } | null;
};

function dollars(cents: number | null | undefined) {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

async function fetchOpen(): Promise<Disc[]> {
  const res = await fetch("/api/discrepancies/open", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load discrepancies");
  const data = await res.json();
  return data.discrepancies || [];
}

/** Full-screen discrepancy cards — Punchlist / vendor only. */
export function DiscrepancyCardOverlay({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: ["discrepancies-open"],
    queryFn: fetchOpen,
    enabled,
    refetchInterval: enabled ? 30_000 : false,
  });
  const open = rows.filter((d) => d.status === "open" || d.status === "pending_review");
  const [idx, setIdx] = useState(0);
  const [invoiceDollars, setInvoiceDollars] = useState("");
  const [payoutDollars, setPayoutDollars] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const current = open[idx] ?? null;

  const resolve = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      if (!current) return;
      const res = await fetch(`/api/discrepancies/${current.id}/resolve`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Resolve failed");
      return data;
    },
    onSuccess: () => {
      setError(""); setReason(""); setInvoiceDollars(""); setPayoutDollars("");
      qc.invalidateQueries({ queryKey: ["discrepancies-open"] });
      setIdx(0);
    },
    onError: (e: Error) => setError(e.message),
  });

  if (!enabled || !current) return null;

  const suggested = current.suggestedFix?.recommendedInvoiceCents;
  const defaultInvoice =
    invoiceDollars ||
    (suggested != null ? (suggested / 100).toFixed(2) : current.expectedCents != null ? (current.expectedCents / 100).toFixed(2) : "");

  const toCents = (s: string) => {
    const n = parseFloat(s.replace(/[$,]/g, ""));
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 100);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-xl rounded-2xl border border-amber-400/40 bg-[#0f1410] p-6 shadow-2xl">
        <button type="button" className="absolute right-3 top-3 rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
          onClick={() => setIdx((i) => (i + 1 >= open.length ? 0 : i + 1))} aria-label="Skip">
          <X className="h-5 w-5" />
        </button>
        <div className="mb-4 flex items-start gap-3">
          <div className="rounded-xl bg-amber-400/15 p-2.5 text-amber-300"><AlertTriangle className="h-6 w-6" /></div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-300/80">
              {current.severity} · {current.type.replace(/_/g, " ")}
              {open.length > 1 ? ` · ${idx + 1}/${open.length}` : ""}
            </p>
            <h2 className="mt-1 text-lg font-bold text-white">Pricing needs attention</h2>
            <p className="mt-2 text-sm leading-relaxed text-white/75">{current.explanation}</p>
            {current.type === "missing_invoice" && (
              <p className="mt-2 text-xs text-amber-200/80">
                No invoice exists yet. Dismiss after creating the invoice on the job, or Save as Pending until billing is ready.
              </p>
            )}
          </div>
        </div>
        <div className="mb-4 grid grid-cols-3 gap-2 rounded-xl border border-white/10 bg-white/5 p-3 text-center text-xs">
          <div><div className="text-white/45">Expected</div><div className="mt-1 text-sm font-semibold text-[#B4FF44]">{dollars(current.expectedCents)}</div></div>
          <div><div className="text-white/45">Actual</div><div className="mt-1 text-sm font-semibold text-white">{dollars(current.actualCents)}</div></div>
          <div><div className="text-white/45">Variance</div><div className="mt-1 text-sm font-semibold text-amber-300">{dollars(current.varianceCents)}</div></div>
        </div>
        <label className="mb-3 block text-xs text-white/55">Invoice amount (USD)
          <input className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-[#B4FF44]/50"
            value={invoiceDollars || defaultInvoice} onChange={(e) => setInvoiceDollars(e.target.value)} placeholder="320.00" />
        </label>
        <label className="mb-3 block text-xs text-white/55">Crew payout (USD) — optional
          <input className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-[#B4FF44]/50"
            value={payoutDollars} onChange={(e) => setPayoutDollars(e.target.value)} placeholder="170.00" />
        </label>
        <label className="mb-3 block text-xs text-white/55">Reason (required to apply / dismiss)
          <input className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-[#B4FF44]/50"
            value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Matched master rate sheet" />
        </label>
        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={resolve.isPending} className="rounded-xl bg-[#B4FF44] px-4 py-2.5 text-sm font-bold text-black disabled:opacity-50"
            onClick={() => resolve.mutate({ status: "adjusted", adminOverrideCents: toCents(invoiceDollars || defaultInvoice), crewOverrideCents: payoutDollars ? toCents(payoutDollars) : null, adminReason: reason })}>
            Save & Apply
          </button>
          <button type="button" disabled={resolve.isPending} className="rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            onClick={() => resolve.mutate({ status: "pending_review", adminOverrideCents: toCents(invoiceDollars || defaultInvoice), crewOverrideCents: payoutDollars ? toCents(payoutDollars) : null, adminReason: reason || "Pending review" })}>
            Save as Pending
          </button>
          <button type="button" disabled={resolve.isPending} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/60 hover:text-white disabled:opacity-50"
            onClick={() => resolve.mutate({ status: "dismissed", adminReason: reason })}>
            Dismiss
          </button>
        </div>
        <p className="mt-3 text-[11px] text-white/35">Vendor / Punchlist only · Portfolio & Pulse never see this card</p>
      </div>
    </div>
  );
}
export default DiscrepancyCardOverlay;
