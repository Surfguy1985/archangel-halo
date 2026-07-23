import { useState } from "react";
import {
  useGetBusinessReport,
  useGenerateReportInsights,
  type ReportInsights,
  type PropertyReportRow,
  type ReportJob,
} from "@workspace/api-client-react";
import {
  Download,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Loader2,
  Building2,
} from "lucide-react";

const money = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

const pct = (f: number | null | undefined) =>
  f == null ? "—" : `${(f * 100).toFixed(1)}%`;

function marginColor(f: number | null | undefined): string {
  if (f == null) return "text-muted-foreground";
  if (f < 0) return "text-destructive";
  if (f < 0.25) return "text-[#b8860b]";
  return "text-[#3c7a4e]";
}

function JobLine({ job }: { job: ReportJob }) {
  const weak = (job.marginPct ?? 1) < 0.25 || (job.grossProfit ?? 0) < 0;
  return (
    <div className="flex items-center justify-between py-[8px] border-b last:border-b-0 border-border/60">
      <div className="min-w-0">
        <div className="font-display font-bold text-[13px] truncate">
          {job.jobNo} · {job.propertyName}
        </div>
        {job.description && (
          <div className="text-[11px] text-muted-foreground truncate">
            {job.description}
          </div>
        )}
      </div>
      <div
        className={`text-[13px] font-bold tabular-nums shrink-0 ml-3 ${
          weak ? "text-destructive" : "text-[#3c7a4e]"
        }`}
      >
        {job.grossProfit != null ? money(job.grossProfit) : "—"}
        <span className="text-[11px] font-normal"> · {pct(job.marginPct)}</span>
      </div>
    </div>
  );
}

function PropertyCard({ row }: { row: PropertyReportRow }) {
  return (
    <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[14px] space-y-[10px]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-[6px] min-w-0">
          <Building2 className="w-[14px] h-[14px] text-[var(--gold)] shrink-0" />
          <span className="font-display font-bold text-[14px] truncate">
            {row.propertyName}
          </span>
        </div>
        <div className="text-right shrink-0">
          <div
            className={`font-bold text-[14px] tabular-nums ${
              row.netProfit >= 0 ? "text-[#3c7a4e]" : "text-destructive"
            }`}
          >
            {money(row.netProfit)}
          </div>
          <div className={`text-[11px] font-bold ${marginColor(row.marginPct)}`}>
            {pct(row.marginPct)} margin
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-[8px] text-[12px]">
        {(
          [
            ["Revenue", money(row.revenue)],
            ["Still owed", money(row.outstanding)],
            ["Crew / sub invoices", money(row.laborExpenses)],
            ["Supplies", money(row.suppliesExpenses)],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              {label}
            </div>
            <div className="font-bold tabular-nums">{value}</div>
          </div>
        ))}
      </div>
      {row.supplyCategories.length > 0 && (
        <div className="flex flex-wrap gap-[6px]">
          {row.supplyCategories.map((c) => (
            <span
              key={c.category}
              className="text-[10px] font-semibold bg-muted rounded-full px-[8px] py-[3px]"
            >
              {c.category}: {money(c.amount)}
            </span>
          ))}
        </div>
      )}
      <div className="text-[11px] text-muted-foreground">
        {row.jobsCompleted} jobs done · {row.jobsActive} active
      </div>
    </div>
  );
}

export function BusinessReportTab() {
  const { data: report, isLoading } = useGetBusinessReport();
  const insightsMut = useGenerateReportInsights();
  const [insights, setInsights] = useState<ReportInsights | null>(null);

  if (isLoading || !report) {
    return (
      <div className="space-y-[12px]">
        <div className="bg-card rounded-[16px] h-[120px] animate-pulse" />
        <div className="bg-card rounded-[16px] h-[200px] animate-pulse" />
      </div>
    );
  }

  const t = report.totals;

  return (
    <div className="flex flex-col gap-[16px] pb-[24px]">
      <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[14px]">
        <div className="font-display font-bold text-[14px] mb-[10px]">
          Business at a glance
        </div>
        <div className="grid grid-cols-2 gap-[10px] text-[12px]">
          {(
            [
              ["Revenue", money(t.revenue), ""],
              ["Collected", money(t.collected), ""],
              ["Still owed", money(t.outstanding), ""],
              [
                "Net profit",
                money(t.netProfit),
                t.netProfit >= 0 ? "text-[#3c7a4e]" : "text-destructive",
              ],
              ["Crew / sub invoices", money(t.laborExpenses), ""],
              ["Supplies", money(t.suppliesExpenses), ""],
              ["Overall margin", pct(t.marginPct), marginColor(t.marginPct)],
              ["Jobs", `${t.jobsCompleted} done · ${t.jobsActive} active`, ""],
            ] as const
          ).map(([label, value, cls]) => (
            <div key={label}>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                {label}
              </div>
              <div className={`font-bold text-[15px] tabular-nums ${cls}`}>
                {value}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-[8px]">
        <button
          onClick={() =>
            insightsMut.mutate(undefined, { onSuccess: (d) => setInsights(d) })
          }
          disabled={insightsMut.isPending}
          className="flex-1 flex items-center justify-center gap-[6px] bg-[var(--ink)] text-white rounded-[13px] py-[12px] text-[13px] font-display font-bold disabled:opacity-60"
          data-testid="button-generate-insights"
        >
          {insightsMut.isPending ? (
            <Loader2 className="w-[15px] h-[15px] animate-spin" />
          ) : (
            <Sparkles className="w-[15px] h-[15px]" />
          )}
          {insightsMut.isPending ? "Thinking…" : "Improvement ideas"}
        </button>
        <a
          href="/api/money/report/pdf"
          className="flex-1 flex items-center justify-center gap-[6px] bg-[var(--gold-light)] text-black rounded-[13px] py-[12px] text-[13px] font-display font-bold"
          data-testid="button-download-report"
        >
          <Download className="w-[15px] h-[15px]" />
          Full report (PDF)
        </a>
      </div>

      {insightsMut.isError && (
        <div className="text-[12px] text-destructive">
          Couldn't generate suggestions right now — try again in a moment.
        </div>
      )}
      {insights && (
        <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[14px] space-y-[10px] border border-[var(--gold)]">
          <div className="flex items-center gap-[6px] font-display font-bold text-[14px]">
            <Sparkles className="w-[14px] h-[14px] text-[var(--gold)]" />
            Suggested improvements
          </div>
          <p className="text-[12px]">{insights.summary}</p>
          {insights.suggestions.map((s, i) => (
            <div key={i} className="border-l-2 border-[var(--gold)] pl-[10px]">
              <div className="font-bold text-[12px]">
                {s.propertyName ? `${s.propertyName}: ` : ""}
                {s.title}
              </div>
              <div className="text-[12px] text-muted-foreground">{s.detail}</div>
            </div>
          ))}
        </div>
      )}

      <div>
        <div className="font-display font-bold text-[14px] mb-[8px] flex items-center gap-[6px]">
          <Building2 className="w-[14px] h-[14px] text-[var(--gold)]" /> By
          property
        </div>
        <div className="flex flex-col gap-[10px]">
          {report.properties.length === 0 ? (
            <div className="text-[12px] text-muted-foreground">
              No financial activity yet.
            </div>
          ) : (
            report.properties.map((row) => (
              <PropertyCard key={row.propertyId ?? "unassigned"} row={row} />
            ))
          )}
        </div>
      </div>

      <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[14px]">
        <div className="font-display font-bold text-[13px] flex items-center gap-[6px] mb-[4px]">
          <TrendingUp className="w-[14px] h-[14px] text-[#3c7a4e]" /> Most
          profitable jobs
        </div>
        {report.topJobs.length === 0 ? (
          <div className="text-[12px] text-muted-foreground py-[6px]">
            No jobs with profit tracked yet.
          </div>
        ) : (
          report.topJobs.map((j) => <JobLine key={j.jobId} job={j} />)
        )}
      </div>

      <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[14px]">
        <div className="font-display font-bold text-[13px] flex items-center gap-[6px] mb-[4px]">
          <TrendingDown className="w-[14px] h-[14px] text-destructive" /> Weak
          jobs
        </div>
        {report.weakJobs.length === 0 ? (
          <div className="text-[12px] text-muted-foreground py-[6px]">
            No weak jobs — margins look healthy.
          </div>
        ) : (
          report.weakJobs.map((j) => <JobLine key={j.jobId} job={j} />)
        )}
      </div>
    </div>
  );
}
