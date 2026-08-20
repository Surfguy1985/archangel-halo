/**
 * Portfolio Home — corporate property lens.
 * 30-second story: which properties need attention.
 * ZERO invoicing / crew pay / vendor money.
 */
import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronRight, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";

type PropCard = {
  propertyId: string;
  name: string;
  city: string | null;
  turning: number;
  waiting: number;
  done: number;
  blocked: number;
  total: number;
  health: "good" | "watch" | "attention";
  healthLabel: string;
};

type PortfolioData = {
  ok: true;
  headline: string;
  counts: {
    properties: number;
    turning: number;
    waiting: number;
    done: number;
    blocked: number;
  };
  properties: PropCard[];
};

const healthColor = {
  attention: "text-[#FF453A]",
  watch: "text-[#0A84FF]",
  good: "text-[#30D158]",
};

export default function PortfolioHome() {
  const [, setLocation] = useLocation();
  const [filter, setFilter] = useState<"all" | "attention" | "watch" | "good">("all");

  const q = useQuery({
    queryKey: ["portfolio-home"],
    queryFn: async () => {
      const r = await fetch("/api/portfolio/home", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load Portfolio");
      return r.json() as Promise<PortfolioData>;
    },
    refetchInterval: 30_000,
  });

  const data = q.data;
  const list = useMemo(() => {
    const props = data?.properties || [];
    if (filter === "all") return props;
    return props.filter((p) => p.health === filter);
  }, [data, filter]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <header className="mx-auto max-w-2xl px-6 pb-2 pt-12">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium tracking-wide text-white/40">Portfolio</p>
            <h1 className="mt-1 text-[34px] font-semibold tracking-tight">Overview</h1>
          </div>
          <button
            type="button"
            onClick={() => q.refetch()}
            className="rounded-full bg-white/10 p-2.5 text-white/70"
            aria-label="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
        <p className="mt-2 text-[17px] leading-snug text-white/55">
          {data?.headline || "Loading portfolio…"}
        </p>
      </header>

      <section className="mx-auto mt-8 grid max-w-2xl grid-cols-4 gap-2 px-6">
        <Count
          label="Attention"
          value={data?.counts.blocked ?? "—"}
          tone="attention"
          active={filter === "attention"}
          onClick={() => setFilter(filter === "attention" ? "all" : "attention")}
        />
        <Count
          label="Turning"
          value={data?.counts.turning ?? "—"}
          tone="watch"
          active={false}
          onClick={() => setFilter("all")}
        />
        <Count
          label="Waiting"
          value={data?.counts.waiting ?? "—"}
          tone="watch"
          active={false}
          onClick={() => setFilter("all")}
        />
        <Count
          label="Ready"
          value={data?.counts.done ?? "—"}
          tone="good"
          active={filter === "good"}
          onClick={() => setFilter(filter === "good" ? "all" : "good")}
        />
      </section>

      <section className="mx-auto mt-10 max-w-2xl px-6 pb-24">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[12px] font-medium text-white/35">
            {data?.counts.properties ?? 0} properties
          </p>
          {filter !== "all" && (
            <button type="button" onClick={() => setFilter("all")} className="text-[12px] text-white/40">
              Show all
            </button>
          )}
        </div>

        {q.isLoading && <p className="text-center text-white/30">Loading…</p>}
        {!q.isLoading && list.length === 0 && (
          <div className="rounded-[16px] border border-white/10 bg-white/[0.03] px-6 py-14 text-center">
            <p className="text-[17px] text-white/50">No properties in this view</p>
          </div>
        )}

        <ul className="space-y-2.5">
          {list.map((p) => (
            <li key={p.propertyId}>
              <button
                type="button"
                onClick={() => setLocation(`/pulse?propertyId=${p.propertyId}`)}
                className="flex w-full items-center gap-3 rounded-[16px] border border-white/10 bg-white/[0.04] px-4 py-3.5 text-left transition active:scale-[0.99]"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-white/10">
                  <Building2 className="h-4 w-4 text-white/50" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[16px] font-semibold tracking-tight">{p.name}</div>
                  <div className={`mt-0.5 text-[13px] font-medium ${healthColor[p.health]}`}>
                    {p.healthLabel}
                  </div>
                </div>
                <div className="shrink-0 text-right text-[12px] text-white/35">
                  <div>{p.turning > 0 ? `${p.turning} on` : p.total > 0 ? `${p.total}` : "—"}</div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-white/25" />
              </button>
            </li>
          ))}
        </ul>

        <p className="mt-10 text-center text-[12px] text-white/25">
          Corporate view · Invoicing lives in Base44
        </p>
      </section>
    </div>
  );
}

function Count({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number | string;
  tone: "attention" | "watch" | "good";
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[14px] border px-2 py-3 text-left transition ${
        active ? "border-white/25 bg-white/10" : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <div className={`text-[22px] font-semibold tabular-nums ${healthColor[tone]}`}>{value}</div>
      <div className="mt-0.5 text-[10px] font-medium text-white/40">{label}</div>
    </button>
  );
}
