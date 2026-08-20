/**
 * Punchlist Home — vendor/back-office, exception-first.
 * Money tools live here (and Base44 invoicing). Not for PM portals.
 */
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, RefreshCw } from "lucide-react";
import { useLocation } from "wouter";
import { PortalNav } from "@/components/PortalNav";

export default function PunchlistHome() {
  const [, setLocation] = useLocation();

  const summary = useQuery({
    queryKey: ["punchlist-money-lock-summary"],
    queryFn: async () => {
      const r = await fetch("/api/work-reviews/money-lock/summary", { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const drafts = useQuery({
    queryKey: ["punchlist-draft-summary"],
    queryFn: async () => {
      const r = await fetch("/api/invoice-drafts/summary", { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const s = summary.data;
  const d = drafts.data;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <header className="mx-auto max-w-2xl px-6 pb-2 pt-12">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium tracking-wide text-white/40">Punchlist</p>
            <h1 className="mt-1 text-[34px] font-semibold tracking-tight">Back office</h1>
          </div>
          <button
            type="button"
            onClick={() => {
              summary.refetch();
              drafts.refetch();
            }}
            className="rounded-full bg-white/10 p-2.5 text-white/70"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-[17px] leading-snug text-white/55">
          {s?.message || "Dispatch exceptions and invoice drafts"}
        </p>
      </header>

      <section className="mx-auto mt-8 grid max-w-2xl grid-cols-3 gap-3 px-6">
        <Metric label="Dispatch issues" value={s?.exceptions ?? "—"} tone="red" />
        <Metric label="Ready to bill" value={d?.green ?? "—"} tone="green" />
        <Metric label="Draft review" value={d?.yellow ?? "—"} tone="yellow" />
      </section>

      <section className="mx-auto mt-10 max-w-2xl space-y-2 px-6 pb-28">
        <NavRow
          title="Invoice drafts"
          subtitle="Approve in Base44 · Halo brain"
          onClick={() => setLocation("/invoice-drafts")}
        />
        <NavRow
          title="Run Operator"
          subtitle="Scan dispatch · lock clean · nudge field"
          onClick={async () => {
            await fetch("/api/halo-operator/run", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ dryRun: false, limit: 40 }),
            });
            summary.refetch();
          }}
        />
        <NavRow title="Pulse (property)" subtitle="PM view · no money" onClick={() => setLocation("/pulse")} />
        <NavRow title="Portfolio" subtitle="Corporate · no money" onClick={() => setLocation("/portfolio")} />
        <p className="pt-8 text-center text-[12px] text-white/25">
          Vendor tools · Invoicing UI preferred in Base44
        </p>
      </section>
      <PortalNav portal="punchlist" />
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number | string; tone: string }) {
  const c =
    tone === "red" ? "text-[#FF453A]" : tone === "green" ? "text-[#30D158]" : "text-[#FFD60A]";
  return (
    <div className="rounded-[14px] border border-white/10 bg-white/[0.03] px-3 py-4">
      <div className={`text-[26px] font-semibold tabular-nums ${c}`}>{value}</div>
      <div className="mt-0.5 text-[11px] font-medium text-white/40">{label}</div>
    </div>
  );
}

function NavRow({
  title,
  subtitle,
  onClick,
}: {
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-[16px] border border-white/10 bg-white/[0.04] px-4 py-3.5 text-left transition active:scale-[0.99]"
    >
      <div className="min-w-0 flex-1">
        <div className="text-[16px] font-semibold tracking-tight">{title}</div>
        <div className="mt-0.5 text-[13px] text-white/40">{subtitle}</div>
      </div>
      <ChevronRight className="h-4 w-4 text-white/25" />
    </button>
  );
}
