/**
 * Invoice Drafts — Apple-simple, exception-first.
 * 30-second test: PM sees Green / Yellow / Red counts and one primary action.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, RefreshCw, AlertTriangle, XCircle, ChevronRight } from "lucide-react";
import { useState } from "react";

type DraftRow = {
  id: string;
  job_id: string;
  job_no: string | null;
  unit_no: string | null;
  bucket: "green" | "yellow" | "red";
  summary: string | null;
  invoice_total_cents: number;
  crew_total_cents: number;
  margin_pct: number | null;
  checks?: Array<{ id: string; label: string; pass: boolean; severity: string; detail: string }>;
};

function money(cents?: number | null) {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}
function pct(p?: number | null) {
  if (p == null) return "—";
  return `${Math.round(p * 100)}%`;
}

export default function InvoiceDrafts() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"green" | "yellow" | "red" | "all">("all");

  const summary = useQuery({
    queryKey: ["invoice-drafts-summary"],
    queryFn: async () => {
      const r = await fetch("/api/invoice-drafts/summary", { credentials: "include" });
      if (!r.ok) throw new Error("summary failed");
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const drafts = useQuery({
    queryKey: ["invoice-drafts", tab],
    queryFn: async () => {
      const q = tab === "all" ? "" : `?bucket=${tab}`;
      const r = await fetch(`/api/invoice-drafts${q}`, { credentials: "include" });
      if (!r.ok) throw new Error("drafts failed");
      return r.json() as Promise<{ drafts: DraftRow[]; count: number }>;
    },
    refetchInterval: 30_000,
  });

  const run = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/invoice-drafts/run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 50 }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "run failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoice-drafts"] });
      qc.invalidateQueries({ queryKey: ["invoice-drafts-summary"] });
    },
  });

  const approveAll = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/invoice-drafts/approve-all-green", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor: "office" }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "approve failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoice-drafts"] });
      qc.invalidateQueries({ queryKey: ["invoice-drafts-summary"] });
    },
  });

  const approveOne = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/invoice-drafts/${id}/approve`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor: "office" }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "approve failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoice-drafts"] });
      qc.invalidateQueries({ queryKey: ["invoice-drafts-summary"] });
    },
  });

  const s = summary.data;
  const list = drafts.data?.drafts || [];

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Hero — readable in 30 seconds */}
      <header className="mx-auto max-w-2xl px-6 pb-2 pt-12">
        <p className="text-[13px] font-medium tracking-wide text-white/40">Invoicing</p>
        <h1 className="mt-1 text-[34px] font-semibold tracking-tight text-white">Drafts</h1>
        <p className="mt-2 text-[17px] leading-snug text-white/55">
          {s?.headline || "Bot builds the bill. You approve."}
        </p>
      </header>

      {/* Three numbers — the whole story */}
      <section className="mx-auto mt-8 flex max-w-2xl gap-3 px-6">
        <Stat
          active={tab === "green"}
          onClick={() => setTab("green")}
          tone="green"
          label="Ready"
          value={s?.green ?? "—"}
        />
        <Stat
          active={tab === "yellow"}
          onClick={() => setTab("yellow")}
          tone="yellow"
          label="Review"
          value={s?.yellow ?? "—"}
        />
        <Stat
          active={tab === "red"}
          onClick={() => setTab("red")}
          tone="red"
          label="Blocked"
          value={s?.red ?? "—"}
        />
      </section>

      {/* One primary action */}
      <section className="mx-auto mt-8 max-w-2xl space-y-3 px-6">
        {(s?.green ?? 0) > 0 && (
          <button
            type="button"
            disabled={approveAll.isPending}
            onClick={() => approveAll.mutate()}
            className="flex w-full items-center justify-center gap-2 rounded-[14px] bg-[#30D158] py-[16px] text-[17px] font-semibold text-black transition active:scale-[0.99] disabled:opacity-50"
          >
            <Check className="h-5 w-5" strokeWidth={2.5} />
            {approveAll.isPending ? "Approving…" : `Approve all ready (${s?.green})`}
          </button>
        )}
        <button
          type="button"
          disabled={run.isPending}
          onClick={() => run.mutate()}
          className="flex w-full items-center justify-center gap-2 rounded-[14px] bg-white/10 py-[14px] text-[15px] font-medium text-white/90 transition active:scale-[0.99] disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${run.isPending ? "animate-spin" : ""}`} />
          {run.isPending ? "Building drafts…" : "Run draft autopilot"}
        </button>
        {tab !== "all" && (
          <button
            type="button"
            onClick={() => setTab("all")}
            className="w-full py-2 text-center text-[13px] text-white/40"
          >
            Show all
          </button>
        )}
      </section>

      {/* List — cards, not tables */}
      <section className="mx-auto mt-10 max-w-2xl px-6 pb-24">
        {drafts.isLoading && <p className="text-center text-white/30">Loading…</p>}
        {!drafts.isLoading && list.length === 0 && (
          <div className="rounded-[16px] border border-white/10 bg-white/[0.03] px-6 py-14 text-center">
            <p className="text-[17px] text-white/50">Nothing here</p>
            <p className="mt-1 text-[14px] text-white/30">Run autopilot to build drafts from Dispatch</p>
          </div>
        )}
        <ul className="space-y-3">
          {list.map((d) => (
            <li
              key={d.id}
              className="rounded-[16px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <BucketDot bucket={d.bucket} />
                    <span className="text-[17px] font-semibold tracking-tight">
                      {d.job_no || d.job_id.slice(0, 8)}
                    </span>
                    {d.unit_no && (
                      <span className="text-[14px] text-white/35">Unit {d.unit_no}</span>
                    )}
                  </div>
                  <p className="mt-1 text-[14px] text-white/45">{d.summary}</p>
                </div>
                <div className="text-right">
                  <div className="text-[17px] font-semibold tabular-nums">{money(d.invoice_total_cents)}</div>
                  <div className="text-[12px] text-white/35">Margin {pct(d.margin_pct)}</div>
                </div>
              </div>

              {/* Multipoint checks — compact */}
              {Array.isArray(d.checks) && d.checks.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {d.checks.map((c) => (
                    <span
                      key={c.id}
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        c.pass
                          ? "bg-white/5 text-white/40"
                          : c.severity === "fail"
                            ? "bg-[#FF453A]/15 text-[#FF453A]"
                            : "bg-[#FFD60A]/15 text-[#FFD60A]"
                      }`}
                    >
                      {c.pass ? "✓" : "!"} {c.label}
                    </span>
                  ))}
                </div>
              )}

              {d.bucket !== "red" && (
                <button
                  type="button"
                  disabled={approveOne.isPending}
                  onClick={() => approveOne.mutate(d.id)}
                  className="mt-3 flex w-full items-center justify-center gap-1 rounded-[12px] bg-white/10 py-2.5 text-[14px] font-medium text-white/90"
                >
                  Approve
                  <ChevronRight className="h-4 w-4 opacity-50" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number | string;
  tone: "green" | "yellow" | "red";
  active: boolean;
  onClick: () => void;
}) {
  const colors = {
    green: "text-[#30D158]",
    yellow: "text-[#FFD60A]",
    red: "text-[#FF453A]",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-[16px] border px-3 py-4 text-left transition ${
        active ? "border-white/25 bg-white/10" : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <div className={`text-[28px] font-semibold tabular-nums tracking-tight ${colors[tone]}`}>{value}</div>
      <div className="mt-0.5 text-[12px] font-medium text-white/40">{label}</div>
    </button>
  );
}

function BucketDot({ bucket }: { bucket: string }) {
  if (bucket === "green") return <Check className="h-4 w-4 text-[#30D158]" strokeWidth={2.5} />;
  if (bucket === "yellow") return <AlertTriangle className="h-4 w-4 text-[#FFD60A]" strokeWidth={2.5} />;
  return <XCircle className="h-4 w-4 text-[#FF453A]" strokeWidth={2.5} />;
}
