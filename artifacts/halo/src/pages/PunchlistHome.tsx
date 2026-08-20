/**
 * Punchlist Home — vendor/back-office, map-first + board.
 * Money tools only here (and Base44 invoicing). Not for PM portals.
 */
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, LayoutGrid, Map, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { PortalNav } from "@/components/PortalNav";
import { SimpleOpsMap, type MapPin as OpsPin } from "@/components/SimpleOpsMap";

export default function PunchlistHome() {
  const [, setLocation] = useLocation();
  const [view, setView] = useState<"map" | "board">("map");
  const [running, setRunning] = useState(false);

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

  const portfolio = useQuery({
    queryKey: ["punchlist-portfolio-pins"],
    queryFn: async () => {
      const r = await fetch("/api/portfolio/home", { credentials: "include" });
      if (!r.ok) return null;
      return r.json() as Promise<{
        properties: Array<{
          propertyId: string;
          name: string;
          health: string;
          healthLabel: string;
          blocked: number;
          turning: number;
          lat: number | null;
          lng: number | null;
        }>;
      }>;
    },
    refetchInterval: 30_000,
  });

  const s = summary.data;
  const d = drafts.data;
  const loading = summary.isLoading && drafts.isLoading;

  const pins: OpsPin[] = useMemo(() => {
    const props = portfolio.data?.properties || [];
    return props
      .filter((p) => p.lat != null && p.lng != null)
      .map((p) => ({
        id: p.propertyId,
        lat: p.lat as number,
        lng: p.lng as number,
        label: p.name,
        sublabel: p.healthLabel,
        tone:
          p.health === "attention" ? "attention" : p.health === "watch" ? "watch" : ("good" as const),
        onClick: () => setLocation(`/pulse?propertyId=${p.propertyId}`),
      }));
  }, [portfolio.data, setLocation]);

  async function runOperator() {
    setRunning(true);
    try {
      await fetch("/api/halo-operator/run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false, limit: 40 }),
      });
      await Promise.all([summary.refetch(), drafts.refetch()]);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <header className="mx-auto max-w-2xl px-6 pb-2 pt-12">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium tracking-wide text-white/40">Punchlist</p>
            <h1 className="mt-1 text-[34px] font-semibold tracking-tight">Back office</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="inline-flex rounded-full border border-white/10 bg-white/5 p-0.5">
              <button
                type="button"
                onClick={() => setView("map")}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-semibold ${
                  view === "map" ? "bg-white text-black" : "text-white/50"
                }`}
              >
                <Map className="h-3 w-3" /> Map
              </button>
              <button
                type="button"
                onClick={() => setView("board")}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-semibold ${
                  view === "board" ? "bg-white text-black" : "text-white/50"
                }`}
              >
                <LayoutGrid className="h-3 w-3" /> Board
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                summary.refetch();
                drafts.refetch();
                portfolio.refetch();
              }}
              className="rounded-full bg-white/10 p-2.5 text-white/70"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
        <p className="mt-2 text-[17px] leading-snug text-white/55">
          {loading ? "Loading…" : s?.message || "Dispatch exceptions and invoice drafts"}
        </p>
      </header>

      <section className="mx-auto mt-8 grid max-w-2xl grid-cols-3 gap-3 px-6">
        {loading ? (
          <>
            <SkeletonMetric />
            <SkeletonMetric />
            <SkeletonMetric />
          </>
        ) : (
          <>
            <Metric label="Dispatch issues" value={s?.exceptions ?? 0} tone="red" />
            <Metric label="Ready to bill" value={d?.green ?? 0} tone="green" />
            <Metric label="Draft review" value={d?.yellow ?? 0} tone="yellow" />
          </>
        )}
      </section>

      {view === "map" && (
        <section className="mx-auto mt-6 max-w-2xl px-6">
          <SimpleOpsMap pins={pins} height={300} />
        </section>
      )}

      <section className="mx-auto mt-8 max-w-2xl space-y-2 px-6 pb-28">
        {!loading && (s?.exceptions ?? 0) === 0 && (d?.green ?? 0) === 0 && (d?.yellow ?? 0) === 0 && (
          <div className="mb-4 rounded-[16px] border border-white/10 bg-white/[0.03] px-6 py-10 text-center">
            <p className="text-[17px] text-white/50">All clear</p>
            <p className="mt-1 text-[14px] text-white/30">No dispatch exceptions or open drafts</p>
          </div>
        )}

        <NavRow
          title="Invoice drafts"
          subtitle="Approve in Base44 · Halo brain"
          onClick={() => setLocation("/invoice-drafts")}
        />
        <NavRow
          title={running ? "Operator running…" : "Run Operator"}
          subtitle="Scan dispatch · lock clean · nudge field"
          onClick={() => !running && runOperator()}
        />
        {(view === "board" || true) && (
          <>
            <NavRow title="Pulse (property)" subtitle="PM view · no money" onClick={() => setLocation("/pulse")} />
            <NavRow title="Portfolio" subtitle="Corporate · no money" onClick={() => setLocation("/portfolio")} />
          </>
        )}
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

function SkeletonMetric() {
  return (
    <div className="animate-pulse rounded-[14px] border border-white/10 bg-white/[0.03] px-3 py-4">
      <div className="h-7 w-10 rounded bg-white/10" />
      <div className="mt-2 h-3 w-16 rounded bg-white/5" />
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
