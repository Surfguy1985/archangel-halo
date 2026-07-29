import { useGetToday, useRefreshBrief, useGetQueues, useListActivities, useDismissFeedItem, getGetTodayQueryKey, getGetQueuesQueryKey, getListActivitiesQueryKey} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import { Skeleton} from "@/components/ui/skeleton";
import { Sparkles, ArrowRight, RefreshCw, X, History, ChevronDown} from "lucide-react";
import { useState} from "react";
import { useQueryClient} from "@tanstack/react-query";
import { useToast} from "@/hooks/use-toast";
import { useLocation} from "wouter";
import { AutopilotActions} from "@/components/AutopilotActions";

function entityRoute(entityType?: string | null, entityId?: string | null): string | null {
  if (!entityType) return null;
  switch (entityType) {
    case "job":
      return entityId ?`/jobs/${entityId}` : null;
    case "invoice":
      return entityId ?`/invoices/${entityId}` : null;
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

type QueueColor = { text: string; bg: string};

const QUEUE_COLORS: Record<string, QueueColor> = {
  money:      { text: "text-emerald-700",  bg: "bg-emerald-100"},
  invoice:    { text: "text-violet-700",   bg: "bg-violet-100"},
  schedule:   { text: "text-sky-700",      bg: "bg-sky-100"},
  bids:       { text: "text-amber-700",    bg: "bg-amber-100"},
  margin:     { text: "text-rose-700",     bg: "bg-rose-100"},
  supply:     { text: "text-orange-700",   bg: "bg-orange-100"},
  compliance: { text: "text-red-700",      bg: "bg-red-100"},
  leads:      { text: "text-cyan-700",     bg: "bg-cyan-100"},
  followup:   { text: "text-fuchsia-700",  bg: "bg-fuchsia-100"},
};

const DEFAULT_QUEUE_COLOR: QueueColor = {
  text: "text-black",
  bg: "bg-[var(--primary)]",
};

function queueColor(queue: string) {
  return QUEUE_COLORS[queue] ?? DEFAULT_QUEUE_COLOR;
}

export default function Today() {
  const { data: today, isLoading} = useGetToday({
    query: { queryKey: getGetTodayQueryKey(), refetchInterval: 10_000},
 });
  const { data: queues} = useGetQueues();
  const { data: activities} = useListActivities(
    { limit: 12},
    { query: { queryKey: getListActivitiesQueryKey({ limit: 12}), refetchInterval: 10_000}},
  );
  const refreshBrief = useRefreshBrief();
  const dismissItem = useDismissFeedItem();
  const queryClient = useQueryClient();
  const { toast} = useToast();
  const [, navigate] = useLocation();

  const [queueFilter, setQueueFilter] = useState<string | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);

  const handleRefresh = async () => {
    try {
      await refreshBrief.mutateAsync();
      queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey()});
      toast({ title: "Brief updated"});
   } catch {
      toast({ title: "Failed to update brief", variant: "destructive"});
   }
 };

  const handleDismiss = async (e: React.MouseEvent, itemId: string) => {
    e.stopPropagation();
    if (dismissItem.isPending) return;
    try {
      await dismissItem.mutateAsync({ data: { itemId}});
      queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey()});
      queryClient.invalidateQueries({ queryKey: getGetQueuesQueryKey()});
      toast({ title: "Cleared"});
   } catch {
      toast({ title: "Failed to clear", variant: "destructive"});
   }
 };

  if (isLoading) {
    return (
      <div className="p-8 space-y-6 bg-[var(--background)] min-h-screen">
        <Skeleton className="h-10 w-64 bg-muted" />
        <Skeleton className="h-48 w-full bg-muted" />
        <div className="grid grid-cols-4 gap-4">
          <Skeleton className="h-32 bg-muted" />
          <Skeleton className="h-32 bg-muted" />
          <Skeleton className="h-32 bg-muted" />
          <Skeleton className="h-32 bg-muted" />
        </div>
      </div>
    );
 }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8 bg-[var(--background)] min-h-[100dvh]">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-display font-bold text-foreground">Today</h1>
          <p className="text-muted-foreground font-mono mt-1 text-sm">{today?.date}</p>
        </div>
      </header>

      {/* Brief */}
      {today?.brief && (
        <Card data-tour="morning-brief" className="bg-[var(--secondary)] text-white border-none rounded-3xl shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Sparkles className="w-48 h-48 text-white" />
          </div>
          <CardHeader className="pb-2 flex flex-row items-center justify-between border-b border-white/10">
            <CardTitle className="text-sm font-display font-bold flex items-center gap-2 text-[var(--primary)]">
              <Sparkles className="w-4 h-4" /> Morning Brief
            </CardTitle>
            <button 
              onClick={handleRefresh}
              disabled={refreshBrief.isPending}
              className="text-white/60 hover:text-[var(--primary)] transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${refreshBrief.isPending ? "animate-spin" : ""}`} />
            </button>
          </CardHeader>
          <CardContent className="pt-6">
            <p className="text-white/90 leading-relaxed text-lg max-w-4xl font-normal">
              {today.brief.body}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Feed */}
        <div data-tour="needs-attention" className="lg:col-span-2 space-y-6">
          <div className="flex items-center gap-3 border-b border-border pb-2">
            <h2 className="text-xl font-display font-bold text-foreground">Needs Attention</h2>
            {queueFilter && (
              <button
                onClick={() => setQueueFilter(null)}
                className="inline-flex items-center gap-1 text-[10px] font-bold px-3 py-1.5 bg-[var(--secondary)] text-white hover:bg-[var(--secondary)]/90 transition-colors rounded-full"
              >
                {queues?.find(q => q.key === queueFilter)?.label ?? queueFilter}
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="space-y-4">
            {(today?.feed.filter(item => !queueFilter || item.queue === queueFilter) ?? []).map(item => {
              const route = entityRoute(item.entityType, item.entityId);
              const qc = queueColor(item.queue);
              return (
              <Card
                key={item.id}
                onClick={route ? () => navigate(route) : undefined}
                className={`relative overflow-hidden group ${route ? "cursor-pointer hover:border-[var(--secondary)]" : ""} rounded-2xl border border-border bg-card shadow-sm transition-colors`}
              >
                <CardContent className="p-5 flex items-start gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className={`text-[10px] font-bold   px-2.5 py-1 rounded-full ${qc.bg} ${qc.text}`}>
                        {item.queue}
                      </span>
                      {item.amount != null && (
                        <span className="text-sm font-mono font-medium tabular-nums text-[var(--secondary)]">
                          ${item.amount.toLocaleString()}
                        </span>
                      )}
                    </div>
                    <h3 className="font-semibold text-foreground text-lg mb-1">{item.title}</h3>
                    <p className="text-muted-foreground text-sm font-light">{item.sub}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {route && (
                      <div className="w-8 h-8 flex items-center justify-center text-muted-foreground group-hover:text-[var(--secondary)] transition-colors">
                        <ArrowRight className="w-5 h-5" />
                      </div>
                    )}
                    <button
                      onClick={(e) => handleDismiss(e, item.id)}
                      disabled={dismissItem.isPending}
                      aria-label="Clear"
                      title="Clear from feed"
                      data-testid={`button-dismiss-${item.id}`}
                      className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-[var(--secondary)] hover:bg-muted transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </CardContent>
              </Card>
              );
           })}
            {today?.feed.length === 0 && (
              <div className="p-8 text-center border border-border text-muted-foreground font-mono text-sm bg-card">
                All caught up for now.
              </div>
            )}
            {(today?.feed.length ?? 0) > 0 && queueFilter && today?.feed.every(item => item.queue !== queueFilter) && (
              <div className="p-8 text-center border border-border text-muted-foreground font-mono text-sm bg-card">
                Nothing needs attention in this queue.
              </div>
            )}
          </div>
        </div>

        {/* Sidebar Widgets */}
        <div className="space-y-8">
          <AutopilotActions />

          {/* Queues */}
          <div data-tour="operations">
            <h2 className="text-[10px] font-bold tracking-[0.2em] text-muted-foreground mb-4 border-b border-border pb-2">Operations</h2>
            <div className="grid grid-cols-2 gap-3">
              {queues?.map(q => {
                const active = queueFilter === q.key;
                return (
                <button
                  key={q.key}
                  onClick={() => setQueueFilter(prev => (prev === q.key ? null : q.key))}
                  className={`p-5 flex flex-col justify-between aspect-square text-left transition-colors cursor-pointer rounded-3xl border ${active ?`bg-[var(--primary)] text-black border-transparent` :`bg-card text-foreground border-border hover:border-[var(--secondary)]`}`}
                >
                  <span className={`text-4xl font-display font-bold ${active ? "text-black" : "text-[var(--secondary)]"}`}>{q.count}</span>
                  <span className={`text-[10px] font-bold   ${active ? "text-black/80" : "text-muted-foreground"}`}>{q.label}</span>
                </button>
                );
             })}
            </div>
          </div>

          {/* Activity Log */}
          <Card className="border-border bg-card rounded-none shadow-sm overflow-hidden">
            <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setActivityOpen((o) => !o)}>
              <CardTitle className="text-xs font-display font-bold flex items-center gap-2 text-foreground">
                <History className="w-4 h-4 text-[var(--secondary)]" /> Activity Log
                <span className="ml-auto flex items-center gap-2 text-xs font-mono font-medium text-muted-foreground">
                  {activities?.length ?? 0}
                  <ChevronDown className={`w-4 h-4 transition-transform ${activityOpen ? "rotate-180" : ""}`} />
                </span>
              </CardTitle>
            </CardHeader>
            {activityOpen && (
            <CardContent className="pt-2 border-t border-border">
              {(activities?.length ?? 0) > 0 ? (
                <div className="space-y-4 pt-2">
                  {activities!.slice(0, 12).map((a) => (
                    <div key={a.id} className="flex items-start gap-3 text-sm">
                      <div className="w-1.5 h-1.5 rounded-full bg-[var(--primary)] mt-1.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-foreground leading-snug text-sm font-light">{a.body || a.kind}</div>
                        {a.createdAt && (
                          <div className="text-[10px] font-mono text-muted-foreground mt-1">
                            {new Date(a.createdAt).toLocaleDateString()} · {new Date(a.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit"})}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground font-light">No activity recorded yet.</p>
              )}
              <p className="mt-4 pt-4 border-t border-border text-[10px] text-muted-foreground">
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
