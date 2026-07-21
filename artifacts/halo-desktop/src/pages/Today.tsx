import { useGetToday, useRefreshBrief, useGetQueues, useAskHalo, useListActivities, getGetTodayQueryKey, getListActivitiesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, ArrowRight, RefreshCw, Send, Loader2, X, History } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

function entityRoute(entityType?: string | null, entityId?: string | null): string | null {
  if (!entityType) return null;
  switch (entityType) {
    case "job":
      return entityId ? `/jobs/${entityId}` : null;
    case "invoice":
      return entityId ? `/invoices/${entityId}` : null;
    case "bid":
    case "lead":
      return "/pipeline";
    case "inventory":
      return "/supply";
    case "vendor":
      return "/vendors";
    default:
      return null;
  }
}

export default function Today() {
  const { data: today, isLoading } = useGetToday({
    query: { queryKey: getGetTodayQueryKey(), refetchInterval: 10_000 },
  });
  const { data: queues } = useGetQueues();
  const { data: activities } = useListActivities(
    { limit: 12 },
    { query: { queryKey: getListActivitiesQueryKey({ limit: 12 }), refetchInterval: 10_000 } },
  );
  const refreshBrief = useRefreshBrief();
  const askHalo = useAskHalo();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [queueFilter, setQueueFilter] = useState<string | null>(null);

  const handleRefresh = async () => {
    try {
      await refreshBrief.mutateAsync();
      queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
      toast({ title: "Brief updated" });
    } catch {
      toast({ title: "Failed to update brief", variant: "destructive" });
    }
  };

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    try {
      const res = await askHalo.mutateAsync({ data: { question } });
      setAnswer(res.answer);
    } catch {
      toast({ title: "Failed to get answer", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 w-full" />
        <div className="grid grid-cols-4 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-[var(--ink)] tracking-tight">Today</h1>
          <p className="text-muted-foreground">{today?.date}</p>
        </div>
      </header>

      {/* Brief */}
      {today?.brief && (
        <Card data-tour="morning-brief" className="bg-[linear-gradient(135deg,var(--gold-tint),rgba(255,255,255,0.8))] border-[var(--gold)]/20 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Sparkles className="w-24 h-24 text-[var(--gold-dark)]" />
          </div>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-lg font-display flex items-center gap-2 text-[var(--gold-dark)]">
              <Sparkles className="w-5 h-5" /> Morning Brief
            </CardTitle>
            <button 
              onClick={handleRefresh}
              disabled={refreshBrief.isPending}
              className="text-muted-foreground hover:text-[var(--gold-dark)] transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${refreshBrief.isPending ? "animate-spin" : ""}`} />
            </button>
          </CardHeader>
          <CardContent>
            <p className="text-[var(--ink)] leading-relaxed text-lg font-medium max-w-4xl">
              {today.brief.body}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Feed */}
        <div data-tour="needs-attention" className="lg:col-span-2 space-y-6">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-display font-bold text-[var(--ink)]">Needs Attention</h2>
            {queueFilter && (
              <button
                onClick={() => setQueueFilter(null)}
                className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-[var(--gold-dark)] px-2.5 py-1 rounded-full bg-[var(--gold-tint)] hover:bg-[var(--gold)]/20 transition-colors"
              >
                {queues?.find(q => q.key === queueFilter)?.label ?? queueFilter}
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="space-y-4">
            {(today?.feed.filter(item => !queueFilter || item.queue === queueFilter) ?? []).map(item => {
              const route = entityRoute(item.entityType, item.entityId);
              return (
              <Card
                key={item.id}
                onClick={route ? () => navigate(route) : undefined}
                className={`hover:border-[var(--gold)]/50 transition-colors group ${route ? "cursor-pointer" : ""}`}
              >
                <CardContent className="p-5 flex items-start gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold uppercase tracking-wider text-[var(--gold-dark)] px-2 py-0.5 rounded-full bg-[var(--gold-tint)]">
                        {item.queue}
                      </span>
                      {item.amount != null && (
                        <span className="text-sm font-mono font-medium text-muted-foreground">
                          ${item.amount.toLocaleString()}
                        </span>
                      )}
                    </div>
                    <h3 className="font-semibold text-[var(--ink)] text-lg mb-1">{item.title}</h3>
                    <p className="text-muted-foreground text-sm">{item.sub}</p>
                  </div>
                  {route && (
                    <div className="w-8 h-8 rounded-full border border-border flex items-center justify-center group-hover:bg-[var(--gold-tint)] group-hover:border-[var(--gold)]/30 transition-colors">
                      <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-[var(--gold-dark)]" />
                    </div>
                  )}
                </CardContent>
              </Card>
              );
            })}
            {today?.feed.length === 0 && (
              <div className="p-8 text-center border border-dashed border-border rounded-xl text-muted-foreground">
                All caught up for now.
              </div>
            )}
            {(today?.feed.length ?? 0) > 0 && queueFilter && today?.feed.every(item => item.queue !== queueFilter) && (
              <div className="p-8 text-center border border-dashed border-border rounded-xl text-muted-foreground">
                Nothing needs attention in this queue.
              </div>
            )}
          </div>
        </div>

        {/* Sidebar Widgets */}
        <div className="space-y-8">
          {/* Ask HALO */}
          <Card data-tour="ask-halo" className="border-[var(--hairline2)] bg-card shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-display">Ask HALO</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAsk} className="relative">
                <input 
                  type="text" 
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  placeholder="Ask about revenue, jobs..."
                  className="w-full pl-3 pr-10 py-2.5 rounded-md border border-input bg-transparent text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <button 
                  type="submit" 
                  disabled={askHalo.isPending || !question.trim()}
                  className="absolute right-1 top-1 w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-[var(--gold-dark)] hover:bg-[var(--gold-tint)] disabled:opacity-50 transition-colors"
                >
                  {askHalo.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </form>
              {answer && (
                <div className="mt-4 p-3 rounded-md bg-[var(--paper)] text-sm text-[var(--ink)] leading-relaxed border border-border animate-in fade-in slide-in-from-top-2">
                  {answer}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Queues */}
          <div data-tour="operations">
            <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">Operations</h2>
            <div className="grid grid-cols-2 gap-3">
              {queues?.map(q => (
                <button
                  key={q.key}
                  onClick={() => setQueueFilter(prev => (prev === q.key ? null : q.key))}
                  className={`p-4 rounded-xl bg-card border shadow-sm flex flex-col justify-between aspect-square text-left transition-colors cursor-pointer group ${queueFilter === q.key ? "border-[var(--gold)] bg-[var(--gold-tint)]" : "border-border hover:border-[var(--gold)]/30"}`}
                >
                  <span className={`text-3xl font-display font-bold transition-colors ${queueFilter === q.key ? "text-[var(--gold-dark)]" : "text-[var(--ink)] group-hover:text-[var(--gold-dark)]"}`}>{q.count}</span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{q.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Activity Log */}
          <Card className="border-[var(--hairline2)] bg-card shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-display flex items-center gap-2">
                <History className="w-4 h-4 text-muted-foreground" /> Activity Log
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(activities?.length ?? 0) > 0 ? (
                <div className="space-y-3">
                  {activities!.slice(0, 12).map((a) => (
                    <div key={a.id} className="flex items-start gap-2 text-sm">
                      <div className="w-1.5 h-1.5 rounded-full bg-[var(--gold)] mt-1.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[var(--ink)] leading-snug">{a.body || a.kind}</div>
                        {a.createdAt && (
                          <div className="text-xs text-muted-foreground">
                            {new Date(a.createdAt).toLocaleDateString()} · {new Date(a.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
              )}
              <p className="mt-3 text-[11px] text-muted-foreground">
                This log is permanent — it stays even after a data wipe.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
