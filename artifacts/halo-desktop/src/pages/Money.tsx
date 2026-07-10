import { useGetMoneySummary } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowUpRight, ArrowDownRight, DollarSign, AlertCircle } from "lucide-react";

export default function Money() {
  const { data: summary, isLoading } = useGetMoneySummary();

  if (isLoading) {
    return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-[var(--ink)] tracking-tight">Money</h1>
          <p className="text-muted-foreground">Cash flow & receivables</p>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-[var(--gold)] text-white border-none shadow-md">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-4 opacity-90">
              <ArrowDownRight className="w-5 h-5" />
              <span className="font-semibold uppercase tracking-wider text-xs">Landing (Owed)</span>
            </div>
            <div className="text-4xl font-mono font-bold tracking-tight">
              ${summary?.landing.toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-destructive text-white border-none shadow-md">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-4 opacity-90">
              <AlertCircle className="w-5 h-5" />
              <span className="font-semibold uppercase tracking-wider text-xs">At Risk (&gt;30 days)</span>
            </div>
            <div className="text-4xl font-mono font-bold tracking-tight">
              ${summary?.atRisk.toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-4 text-muted-foreground">
              <ArrowUpRight className="w-5 h-5" />
              <span className="font-semibold uppercase tracking-wider text-xs">MTD Revenue</span>
            </div>
            <div className="text-4xl font-mono font-bold tracking-tight text-[var(--ink)]">
              ${summary?.mtd.toLocaleString()}
            </div>
            <div className="mt-2 text-sm font-medium text-[var(--gold-dark)]">
              {summary?.marginPct}% Margin
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
          <h2 className="text-xl font-display font-bold mb-4 text-[var(--ink)]">Aging Receivables</h2>
          <div className="space-y-3">
            {summary?.aging.map((bucket, i) => (
              <div key={i} className="flex items-center justify-between p-4 bg-card rounded-lg border border-border">
                <span className="font-medium text-[var(--ink)]">{bucket.label}</span>
                <span className={`font-mono font-bold ${bucket.color ? 'text-destructive' : 'text-muted-foreground'}`}>
                  ${bucket.value.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
        
        {/* Placeholder for invoices list */}
        <div>
          <h2 className="text-xl font-display font-bold mb-4 text-[var(--ink)]">Recent Invoices</h2>
          <div className="p-12 text-center border border-dashed border-border rounded-xl text-muted-foreground">
            Invoices list coming soon...
          </div>
        </div>
      </div>
    </div>
  );
}
