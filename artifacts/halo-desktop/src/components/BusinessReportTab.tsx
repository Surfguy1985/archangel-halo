import { useState } from "react";
import {
  useGetBusinessReport,
  useGenerateReportInsights,
  type ReportInsights,
  type PropertyReportRow,
  type ReportJob,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
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

function JobRow({ job }: { job: ReportJob }) {
  const weak = (job.marginPct ?? 1) < 0.25 || (job.grossProfit ?? 0) < 0;
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-b-0 border-[var(--line,#eee)]">
      <div className="min-w-0">
        <div className="font-semibold text-sm truncate">
          {job.jobNo} · {job.propertyName}
        </div>
        {job.description && (
          <div className="text-xs text-muted-foreground truncate">
            {job.description}
          </div>
        )}
      </div>
      <div
        className={`text-sm font-mono font-bold shrink-0 ml-4 ${weak ? "text-destructive" : "text-[#3c7a4e]"}`}
      >
        {job.grossProfit != null ? money(job.grossProfit) : "—"}{" "}
        <span className="text-xs font-normal">· {pct(job.marginPct)}</span>
      </div>
    </div>
  );
}

function PropertyRow({ row }: { row: PropertyReportRow }) {
  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="w-4 h-4 text-[var(--gold)] shrink-0" />
            <span className="font-display font-bold truncate">
              {row.propertyName}
            </span>
            <Badge variant="secondary" className="shrink-0">
              {row.jobsCompleted} done · {row.jobsActive} active
            </Badge>
          </div>
          <div className="text-right shrink-0">
            <div
              className={`font-mono font-bold ${row.netProfit >= 0 ? "text-[#3c7a4e]" : "text-destructive"}`}
            >
              {money(row.netProfit)} net
            </div>
            <div className={`text-xs font-semibold ${marginColor(row.marginPct)}`}>
              {pct(row.marginPct)} margin
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
          {(
            [
              ["Revenue", money(row.revenue)],
              ["Collected", money(row.collected)],
              ["Still owed", money(row.outstanding)],
              ["Crew / sub invoices", money(row.laborExpenses)],
              ["Supplies", money(row.suppliesExpenses)],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="font-mono font-semibold">{value}</div>
            </div>
          ))}
        </div>
        {row.supplyCategories.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {row.supplyCategories.map((c) => (
              <Badge key={c.category} variant="outline" className="font-normal">
                {c.category}: {money(c.amount)}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function BusinessReportTab() {
  const { data: report, isLoading } = useGetBusinessReport();
  const insightsMut = useGenerateReportInsights();
  const [insights, setInsights] = useState<ReportInsights | null>(null);

  if (isLoading || !report) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const t = report.totals;
  const tiles: [string, string, string?][] = [
    ["Revenue (invoiced)", money(t.revenue)],
    ["Collected", money(t.collected)],
    ["Still owed", money(t.outstanding)],
    ["Crew / sub invoices", money(t.laborExpenses)],
    ["Supplies & materials", money(t.suppliesExpenses)],
    ["Total expenses", money(t.totalExpenses)],
    [
      "Net profit",
      money(t.netProfit),
      t.netProfit >= 0 ? "text-[#3c7a4e]" : "text-destructive",
    ],
    ["Overall margin", pct(t.marginPct), marginColor(t.marginPct)],
    ["Jobs", `${t.jobsCompleted} done · ${t.jobsActive} active`],
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display font-bold text-lg">Business report</h2>
          <p className="text-sm text-muted-foreground">
            Full picture: money in, money out, margins by property.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() =>
              insightsMut.mutate(undefined, {
                onSuccess: (d) => setInsights(d),
              })
            }
            disabled={insightsMut.isPending}
            data-testid="button-generate-insights"
          >
            {insightsMut.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4 mr-2" />
            )}
            {insightsMut.isPending ? "Thinking…" : "Get improvement ideas"}
          </Button>
          <Button asChild data-testid="button-download-report">
            <a href="/api/money/report/pdf">
              <Download className="w-4 h-4 mr-2" />
              Download full report (PDF)
            </a>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {tiles.map(([label, value, cls]) => (
          <Card key={label}>
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                {label}
              </div>
              <div className={`text-xl font-mono font-bold mt-1 ${cls ?? ""}`}>
                {value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {insightsMut.isError && (
        <p className="text-sm text-destructive">
          Couldn't generate suggestions right now — try again in a moment.
        </p>
      )}
      {insights && (
        <Card className="border-[var(--gold)]">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-2 font-display font-bold">
              <Sparkles className="w-4 h-4 text-[var(--gold)]" />
              Suggested improvements
            </div>
            <p className="text-sm">{insights.summary}</p>
            <div className="space-y-3">
              {insights.suggestions.map((s, i) => (
                <div key={i} className="border-l-2 border-[var(--gold)] pl-3">
                  <div className="font-semibold text-sm">
                    {s.propertyName ? `${s.propertyName}: ` : ""}
                    {s.title}
                  </div>
                  <div className="text-sm text-muted-foreground">{s.detail}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <section className="space-y-3">
        <h3 className="font-display font-bold flex items-center gap-2">
          <Building2 className="w-4 h-4 text-[var(--gold)]" /> By property
        </h3>
        {report.properties.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No financial activity yet.
          </p>
        ) : (
          report.properties.map((row) => (
            <PropertyRow key={row.propertyId ?? "unassigned"} row={row} />
          ))
        )}
      </section>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardContent className="p-5">
            <h3 className="font-display font-bold flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-[#3c7a4e]" /> Most profitable
              jobs
            </h3>
            {report.topJobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No jobs with profit tracked yet.
              </p>
            ) : (
              report.topJobs.map((j) => <JobRow key={j.jobId} job={j} />)
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <h3 className="font-display font-bold flex items-center gap-2 mb-2">
              <TrendingDown className="w-4 h-4 text-destructive" /> Weak jobs
            </h3>
            {report.weakJobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No weak jobs — margins look healthy.
              </p>
            ) : (
              report.weakJobs.map((j) => <JobRow key={j.jobId} job={j} />)
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
