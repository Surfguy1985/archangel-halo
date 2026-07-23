import { useGetToday, useRefreshBrief, useGetQueues, useListActivities, useDismissFeedItem, getGetTodayQueryKey, getGetQueuesQueryKey, getListActivitiesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, ArrowRight, RefreshCw, X, History, ChevronDown } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { AutopilotActions } from "@/components/AutopilotActions";

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
  const dismissItem = useDismissFeedItem();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [queueFilter, setQueueFilter] = useState<string | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);

  const handleRefresh = async () => {
    try {
      await refreshBrief.mutateAsync();
      queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
      toast({ title: "Brief updated" });
    } catch {
      toast({ title: "Failed to update brief", variant: "destructive" });
    }
  };

  const handleDismiss = async (e: React.MouseEvent, itemId: string) => {
    e.stopPropagation();
    if (dismissItem.isPending) return;
    try {
      await dismissItem.mutateAsync({ data: { itemId } });
      queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetQueuesQueryKey() });
      toast({ title: "Cleared" });
    } catch {
      toast({ title: "Failed to clear", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 space-y-6">
        <Skeleton className="h-10 w-64 bg-[var(--muted)]" />
        <Skeleton className="h-48 w-full bg-[var(--muted)]" />
        <div className="grid grid-cols-4 gap-4">
          <Skeleton className="h-32 bg-[var(--muted)]" />
          <Skeleton className="h-32 bg-[var(--muted)]" />
          <Skeleton className="h-32 bg-[var(--muted)]" />
          <Skeleton className="h-32 bg-[var(--muted)]" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-display font-bold text-foreground tracking-tight uppercase">Today</h1>
          <p className="text-muted-foreground font-mono mt-1 text-sm">{today?.date}</p>
        </div>
      </header>

      {/* Brief */}
      {today?.brief && (
        <Card data-tour="morning-brief" className="bg-[var(--card)] border-[var(--primary)] border shadow-[0_0_20px_rgba(198,242,17,0.1)] relative overflow-hidden rounded-none">
          <div className="absolute top-0 right-0 p-4 opacity-5">
            <Sparkles className="w-48 h-48 text-[var(--primary)]" />
          </div>
          <CardHeader className="pb-2 flex flex-row items-center justify-between border-b border-[var(--border)] bg-[var(--muted)]/30">
            <CardTitle className="text-sm font-display font-bold uppercase tracking-widest flex items-center gap-2 text-[var(--primary)]">
              <span className="custom-icon"><Sparkles className="w-4 h-4" /></span> Morning Brief
            </CardTitle>
            <button 
              onClick={handleRefresh}
              disabled={refreshBrief.isPending}
              className="text-muted-foreground hover:text-[var(--primary)] transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${refreshBrief.isPending ? "animate-spin" : ""}`} />
            </button>
          </CardHeader>
          <CardContent className="pt-6">
            <p className="text-foreground leading-relaxed text-lg max-w-4xl font-light">
              {today.brief.body}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Feed */}
        <div data-tour="needs-attention" className="lg:col-span-2 space-y-6">
          <div className="flex items-center gap-3 border-b border-[var(--border)] pb-2">
            <h2 className="text-xl font-display font-bold text-foreground uppercase tracking-wide">Needs Attention</h2>
            {queueFilter && (
              <button
                onClick={() => setQueueFilter(null)}
                className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-black px-2 py-1 bg-[var(--primary)] hover:bg-[var(--gold-light)] transition-colors rounded-none"
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
                className={`hover:border-[var(--primary)] transition-all group ${route ? "cursor-pointer" : ""} rounded-none border-[var(--border)] bg-[var(--card)] hover:shadow-[0_0_15px_rgba(198,242,17,0.1)]`}
              >
                <CardContent className="p-5 flex items-start gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--primary)] border border-[var(--primary)] px-2 py-0.5">
                        {item.queue}
                      </span>
                      {item.amount != null && (
                        <span className="text-sm font-mono font-medium text-foreground">
                          ${item.amount.toLocaleString()}
                        </span>
                      )}
                    </div>
                    <h3 className="font-semibold text-foreground text-lg mb-1">{item.title}</h3>
                    <p className="text-muted-foreground text-sm font-light">{item.sub}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {route && (
                      <div className="w-8 h-8 border border-[var(--border)] flex items-center justify-center group-hover:bg-[var(--primary)] transition-colors rounded-none">
                        <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-black" />
                      </div>
                    )}
                    <button
                      onClick={(e) => handleDismiss(e, item.id)}
                      disabled={dismissItem.isPending}
                      aria-label="Clear"
                      title="Clear from feed"
                      data-testid={`button-dismiss-${item.id}`}
                      className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-black hover:bg-[var(--primary)] transition-colors rounded-none"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </CardContent>
              </Card>
              );
            })}
            {today?.feed.length === 0 && (
              <div className="p-8 text-center border border-dashed border-[var(--border)] text-muted-foreground font-mono text-sm uppercase tracking-widest">
                All caught up for now.
              </div>
            )}
            {(today?.feed.length ?? 0) > 0 && queueFilter && today?.feed.every(item => item.queue !== queueFilter) && (
              <div className="p-8 text-center border border-dashed border-[var(--border)] text-muted-foreground font-mono text-sm uppercase tracking-widest">
                Nothing needs attention in this queue.
              </div>
            )}
          </div>
        </div>

        {/* Sidebar Widgets */}
        <div className="space-y-8">
          {/* Autopilot proposals */}
          <AutopilotActions />

          {/* Queues */}
          <div data-tour="operations">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground mb-4 border-b border-[var(--border)] pb-2">Operations</h2>
            <div className="grid grid-cols-2 gap-3">
              {queues?.map(q => (
                <button
                  key={q.key}
                  onClick={() => setQueueFilter(prev => (prev === q.key ? null : q.key))}
                  className={`p-4 bg-card border flex flex-col justify-between aspect-square text-left transition-all cursor-pointer group rounded-none ${queueFilter === q.key ? "border-[var(--primary)] shadow-[inset_0_0_20px_rgba(198,242,17,0.15)]" : "border-[var(--border)] hover:border-[var(--primary)]/50"}`}
                >
                  <span className={`text-4xl font-display font-bold transition-colors ${queueFilter === q.key ? "text-[var(--primary)]" : "text-foreground group-hover:text-[var(--primary)]"}`}>{q.count}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{q.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Activity Log */}
          <Card className="border-[var(--border)] bg-card rounded-none">
            <CardHeader className="pb-3 cursor-pointer hover:bg-[var(--muted)]/50 transition-colors" onClick={() => setActivityOpen((o) => !o)}>
              <CardTitle className="text-xs font-display font-bold uppercase tracking-widest flex items-center gap-2 text-foreground">
                <span className="custom-icon py-1 px-1"><History className="w-3 h-3" /></span> Activity Log
                <span className="ml-auto flex items-center gap-2 text-xs font-mono font-medium text-muted-foreground">
                  {activities?.length ?? 0}
                  <ChevronDown className={`w-4 h-4 transition-transform ${activityOpen ? "rotate-180" : ""}`} />
                </span>
              </CardTitle>
            </CardHeader>
            {activityOpen && (
            <CardContent className="pt-2 border-t border-[var(--border)]">
              {(activities?.length ?? 0) > 0 ? (
                <div className="space-y-4 pt-2">
                  {activities!.slice(0, 12).map((a) => (
                    <div key={a.id} className="flex items-start gap-3 text-sm">
                      <div className="w-1 h-full min-h-[20px] bg-[var(--primary)] shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-foreground leading-snug text-sm font-light">{a.body || a.kind}</div>
                        {a.createdAt && (
                          <div className="text-[10px] font-mono text-muted-foreground mt-1 uppercase">
                            {new Date(a.createdAt).toLocaleDateString()} · {new Date(a.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground font-light">No activity recorded yet.</p>
              )}
              <p className="mt-4 pt-4 border-t border-[var(--border)] text-[10px] uppercase tracking-wider text-muted-foreground">
                This log is permanent — it stays even after a data wipe.
              </p>
            </CardContent>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
