/**
 * Pulse Home — property view only.
 * 30-second story: what's turning, what needs attention, proof photos.
 * ZERO invoicing, crew pay, vendor rates, or back-office money.
 */
import { useQuery } from "@tanstack/react-query";
import { Camera, MapPin, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";

type PulseUnit = {
  jobId: string;
  jobNo: string | null;
  unitNo: string | null;
  propertyName: string | null;
  status: "turning" | "waiting" | "done" | "blocked";
  statusLabel: string;
  hasPhotos: boolean;
};

type PulseHomeData = {
  ok: true;
  headline: string;
  property: { name: string; city: string | null } | null;
  counts: { turning: number; waiting: number; doneToday: number; blocked: number };
  units: PulseUnit[];
  recentPhotoPaths: string[];
};

const statusColor: Record<string, string> = {
  blocked: "text-[#FF453A]",
  turning: "text-[#0A84FF]",
  waiting: "text-[#FFD60A]",
  done: "text-[#30D158]",
};

export default function PulseHome() {
  const [filter, setFilter] = useState<"all" | "blocked" | "turning" | "waiting" | "done">("all");

  const q = useQuery({
    queryKey: ["pulse-home"],
    queryFn: async () => {
      const r = await fetch("/api/pulse/home?limit=40", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load Pulse");
      return r.json() as Promise<PulseHomeData>;
    },
    refetchInterval: 20_000,
  });

  const data = q.data;
  const units = useMemo(() => {
    const list = data?.units || [];
    if (filter === "all") return list;
    return list.filter((u) => u.status === filter);
  }, [data, filter]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <header className="mx-auto max-w-2xl px-6 pb-2 pt-12">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium tracking-wide text-white/40">Pulse</p>
            <h1 className="mt-1 text-[34px] font-semibold tracking-tight">
              {data?.property?.name || "Property"}
            </h1>
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
          {data?.headline || "Loading your units…"}
        </p>
      </header>

      {/* Four property counts — no money */}
      <section className="mx-auto mt-8 grid max-w-2xl grid-cols-4 gap-2 px-6">
        <CountChip
          label="Attention"
          value={data?.counts.blocked ?? "—"}
          tone="blocked"
          active={filter === "blocked"}
          onClick={() => setFilter(filter === "blocked" ? "all" : "blocked")}
        />
        <CountChip
          label="Turning"
          value={data?.counts.turning ?? "—"}
          tone="turning"
          active={filter === "turning"}
          onClick={() => setFilter(filter === "turning" ? "all" : "turning")}
        />
        <CountChip
          label="Waiting"
          value={data?.counts.waiting ?? "—"}
          tone="waiting"
          active={filter === "waiting"}
          onClick={() => setFilter(filter === "waiting" ? "all" : "waiting")}
        />
        <CountChip
          label="Ready"
          value={data?.counts.doneToday ?? "—"}
          tone="done"
          active={filter === "done"}
          onClick={() => setFilter(filter === "done" ? "all" : "done")}
        />
      </section>

      {/* Proof strip */}
      {(data?.recentPhotoPaths?.length ?? 0) > 0 && (
        <section className="mx-auto mt-8 max-w-2xl px-6">
          <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-white/35">
            <Camera className="h-3.5 w-3.5" />
            Latest field proof
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {data!.recentPhotoPaths.map((path, i) => (
              <div
                key={path + i}
                className="h-16 w-16 shrink-0 overflow-hidden rounded-[12px] bg-white/10"
              >
                <img
                  src={path.startsWith("http") ? path : path}
                  alt=""
                  className="h-full w-full object-cover opacity-90"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Unit list */}
      <section className="mx-auto mt-10 max-w-2xl px-6 pb-24">
        {q.isLoading && <p className="text-center text-white/30">Loading…</p>}
        {!q.isLoading && units.length === 0 && (
          <div className="rounded-[16px] border border-white/10 bg-white/[0.03] px-6 py-14 text-center">
            <p className="text-[17px] text-white/50">No units in this view</p>
            <p className="mt-1 text-[14px] text-white/30">Turns will show up here as work moves</p>
          </div>
        )}
        <ul className="space-y-2.5">
          {units.map((u) => (
            <li
              key={u.jobId}
              className="flex items-center gap-3 rounded-[16px] border border-white/10 bg-white/[0.04] px-4 py-3.5"
            >
              <div className={`h-2 w-2 shrink-0 rounded-full ${dotBg(u.status)}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[16px] font-semibold tracking-tight">
                    {u.unitNo ? `Unit ${u.unitNo}` : u.jobNo || "Unit"}
                  </span>
                  {u.hasPhotos && <Camera className="h-3.5 w-3.5 shrink-0 text-white/30" />}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-white/40">
                  <MapPin className="h-3 w-3" />
                  <span className="truncate">{u.propertyName || "Property"}</span>
                </div>
              </div>
              <span className={`shrink-0 text-[13px] font-medium ${statusColor[u.status]}`}>
                {u.statusLabel}
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-10 text-center text-[12px] text-white/25">
          Property view · Invoicing lives in Base44
        </p>
      </section>
    </div>
  );
}

function CountChip({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number | string;
  tone: string;
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
      <div className={`text-[22px] font-semibold tabular-nums ${statusColor[tone] || "text-white"}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[10px] font-medium text-white/40">{label}</div>
    </button>
  );
}

function dotBg(status: string) {
  switch (status) {
    case "blocked": return "bg-[#FF453A]";
    case "turning": return "bg-[#0A84FF]";
    case "waiting": return "bg-[#FFD60A]";
    case "done": return "bg-[#30D158]";
    default: return "bg-white/30";
  }
}
