import { useGetToday, useRefreshBrief, useGetQueues, useListActivities, useDismissFeedItem, useAcceptWorkRequest, useDeclineWorkRequest, useRemindInvoice, useNudgeBid, getGetTodayQueryKey, getGetQueuesQueryKey, getListActivitiesQueryKey, getListWorkRequestsQueryKey, getListJobsQueryKey, getListInvoicesQueryKey, getListBidsQueryKey, type FeedCard} from "@workspace/api-client-react";
import { PushCardDialog, type PushPrefill} from "@/components/PushCardDialog";
import { InvoiceWizardDialog} from "@/components/InvoiceWizardDialog";
import { Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import { Skeleton} from "@/components/ui/skeleton";
import { useState} from "react";
import { useQueryClient} from "@tanstack/react-query";
import { useToast} from "@/hooks/use-toast";
import { useLocation} from "wouter";
import { AutopilotActions} from "@/components/AutopilotActions";
import { Sparkles, ArrowRight, RefreshCw, X, History, ChevronDown, Zap} from "lucide-react";
import { QuickJobDialog} from "@/components/QuickJobDialog";

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
    case "work_request":
      return "/pipeline";
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
  requests:   { text: "text-indigo-700",   bg: "bg-indigo-100"},
};

const DEFAULT_QUEUE_COLOR: QueueColor = {
  text: "text-black",
  bg: "bg-[var(--primary)]",
};

function queueColor(queue: string) {
  return QUEUE_COLORS[queue] ?? DEFAULT_QUEUE_COLOR;
}

/** Color coding per feed category (queue key). Grouped families share a hue. */
const QUEUE_TONES: Record<string, { tabActive: string; tabIdle: string; dot: string }> = {
  // client-facing — lime/gold family
  requests: { tabActive: "bg-[var(--gold-light)] text-black", tabIdle: "bg-lime-100 text-lime-800", dot: "bg-lime-500" },
  updates: { tabActive: "bg-[var(--gold-light)] text-black", tabIdle: "bg-lime-100 text-lime-800", dot: "bg-lime-500" },
  // money — red family
  money: { tabActive: "bg-[#FF3B30] text-white", tabIdle: "bg-red-100 text-red-800", dot: "bg-red-500" },
  margin: { tabActive: "bg-[#FF3B30] text-white", tabIdle: "bg-red-100 text-red-800", dot: "bg-red-500" },
  // billing — emerald family
  invoice: { tabActive: "bg-emerald-600 text-white", tabIdle: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
  bids: { tabActive: "bg-teal-600 text-white", tabIdle: "bg-teal-100 text-teal-800", dot: "bg-teal-500" },
  // scheduling / crews — blue family
  schedule: { tabActive: "bg-sky-600 text-white", tabIdle: "bg-sky-100 text-sky-800", dot: "bg-sky-500" },
  crew: { tabActive: "bg-blue-600 text-white", tabIdle: "bg-blue-100 text-blue-800", dot: "bg-blue-500" },
  leads: { tabActive: "bg-indigo-600 text-white", tabIdle: "bg-indigo-100 text-indigo-800", dot: "bg-indigo-500" },
  // operations — amber family
  supply: { tabActive: "bg-amber-500 text-black", tabIdle: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  compliance: { tabActive: "bg-orange-600 text-white", tabIdle: "bg-orange-100 text-orange-800", dot: "bg-orange-500" },
  followup: { tabActive: "bg-violet-600 text-white", tabIdle: "bg-violet-100 text-violet-800", dot: "bg-violet-500" },
};
const QUEUE_TONE_FALLBACK = { tabActive: "bg-[var(--secondary)] text-white", tabIdle: "bg-stone-100 text-stone-700", dot: "bg-stone-400" };
function queueTone(key: string) {
  return QUEUE_TONES[key] ?? QUEUE_TONE_FALLBACK;
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
  const acceptRequest = useAcceptWorkRequest();
  const declineRequest = useDeclineWorkRequest();
  const remindInvoice = useRemindInvoice();
  const nudgeBid = useNudgeBid();
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [pushTarget, setPushTarget] = useState<{ propertyId: string; prefill: PushPrefill | null } | null>(null);
  const [invoiceWizard, setInvoiceWizard] = useState<{ propertyId: string; propertyName: string } | null>(null);
  const queryClient = useQueryClient();
  const { toast} = useToast();
  const [, navigate] = useLocation();

  const [queueFilter, setQueueFilter] = useState<string | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [quickJobOpen, setQuickJobOpen] = useState(false);

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

  const invalidateRequests = () => {
    queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey()});
    queryClient.invalidateQueries({ queryKey: getGetQueuesQueryKey()});
    queryClient.invalidateQueries({ queryKey: getListWorkRequestsQueryKey()});
    queryClient.invalidateQueries({ queryKey: getListJobsQueryKey()});
 };

  const handleApprove = async (e: React.MouseEvent, requestId: string) => {
    e.stopPropagation();
    if (acceptRequest.isPending) return;
    try {
      const rec = await acceptRequest.mutateAsync({ id: requestId, data: {}});
      toast({ title: `Approved — Job ${rec.jobNo ?? ""} created`.trim()});
      invalidateRequests();
      if (rec.jobId) navigate(`/jobs/${rec.jobId}`);
   } catch {
      toast({ title: "Failed to approve request", variant: "destructive"});
   }
 };

  const runFeedAction = async (item: FeedCard, action: string) => {
    switch (action) {
      case "remindInvoice": {
        if (!item.entityId || remindInvoice.isPending) return;
        try {
          await remindInvoice.mutateAsync({ id: item.entityId});
          toast({ title: "Reminder sent"});
          queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey()});
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey()});
        } catch (err) {
          toast({ title: "Couldn't send the reminder", description: (err as { data?: { error?: string}})?.data?.error, variant: "destructive"});
        }
        return;
      }
      case "nudgeBid": {
        if (!item.entityId || nudgeBid.isPending) return;
        try {
          await nudgeBid.mutateAsync({ id: item.entityId});
          toast({ title: "Nudge sent"});
          queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey()});
          queryClient.invalidateQueries({ queryKey: getListBidsQueryKey()});
        } catch (err) {
          toast({ title: "Couldn't nudge", description: (err as { data?: { error?: string}})?.data?.error, variant: "destructive"});
        }
        return;
      }
      case "createInvoice": {
        if (item.propertyId) {
          setInvoiceWizard({ propertyId: item.propertyId, propertyName: item.sub.split("—")[0]?.trim() ?? ""});
        } else if (item.entityType === "job" && item.entityId) {
          navigate(`/jobs/${item.entityId}`);
        }
        return;
      }
      case "openClientBoard": {
        // Unanswered client messages — jump to the mirrored client board.
        if (item.propertyId) navigate(`/properties/${item.propertyId}/board`);
        return;
      }
      case "shareTracker":
      case "sharePhotos": {
        if (!item.propertyId) return;
        setPushTarget({
          propertyId: item.propertyId,
          prefill: {
            templateId: action === "shareTracker" ? "crew_on_site" : "photos",
            source:
              item.entityType === "job" && item.entityId
                ? {
                    type: action === "shareTracker" ? "tracker" : "photos",
                    id: item.entityId,
                    jobId: item.entityId,
                  }
                : null,
          },
        });
        return;
      }
      case "draftRecap":
      case "scheduleJob":
      case "openJob":
      default: {
        const route = entityRoute(item.entityType, item.entityId);
        if (route) navigate(route);
      }
    }
  };

  const handleDecline = async (requestId: string) => {
    if (declineRequest.isPending) return;
    try {
      await declineRequest.mutateAsync({ id: requestId, data: { reason: declineReason.trim() || null}});
      toast({ title: "Request declined"});
      setDecliningId(null);
      setDeclineReason("");
      invalidateRequests();
   } catch {
      toast({ title: "Failed to decline request", variant: "destructive"});
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
    <div className="p-8 max-w-7xl mx-auto space-y-8 bg-[var(--background)] min-h-[100dvh] animate-in fade-in duration-500">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-display font-bold text-foreground">Today</h1>
          <p className="text-muted-foreground mt-1 text-sm">{today?.date}</p>
        </div>
        <button
          onClick={() => setQuickJobOpen(true)}
          className="flex items-center gap-2 bg-[var(--primary)] text-black px-5 py-2.5 rounded-full font-bold shadow-sm hover:opacity-90 transition-opacity"
          data-testid="button-quick-job"
        >
          <Zap className="w-4 h-4" /> Quick job
        </button>
      </header>

      <QuickJobDialog open={quickJobOpen} onOpenChange={setQuickJobOpen} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column */}
        <div data-tour="needs-attention" className="lg:col-span-2 space-y-6">
          
          {/* Brief */}
          {today?.brief && (
            <Card data-tour="morning-brief" className="bg-[var(--primary)] text-black border-none rounded-3xl shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <Sparkles className="w-48 h-48 text-black" />
              </div>
              <CardHeader className="pb-2 flex flex-row items-center justify-between border-b border-black/10">
                <CardTitle className="text-sm font-bold flex items-center gap-2 text-black">
                  <Sparkles className="w-4 h-4" /> Morning brief
                </CardTitle>
                <button 
                  onClick={handleRefresh}
                  disabled={refreshBrief.isPending}
                  className="text-black/60 hover:text-black transition-colors"
                >
                  <RefreshCw className={`w-4 h-4 ${refreshBrief.isPending ? "animate-spin" : ""}`} />
                </button>
              </CardHeader>
              <CardContent className="pt-6">
                <p className="text-black/90 leading-relaxed text-lg max-w-4xl font-normal">
                  {today.brief.body}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Needs Attention */}
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-border">
            <div className="flex items-center justify-between pb-4">
              <h2 className="text-xl font-display font-bold text-foreground">Needs attention</h2>
              <button 
                onClick={() => queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey()})}
                className="text-xs font-bold text-muted-foreground bg-black/5 hover:bg-black/10 px-4 py-2 rounded-full transition-colors"
              >
                Refresh
              </button>
            </div>

            <div className="space-y-3">
              {/* Emergencies only (tier "now"), capped at 3 */}
              {(today?.feed.filter(item => item.tier === "now") ?? []).slice(0, 3).map(item => {
                const route = entityRoute(item.entityType, item.entityId);
                return (
                  <div
                    key={item.id}
                    onClick={route ? () => navigate(route) : undefined}
                    className={`group flex items-center gap-4 p-4 rounded-2xl bg-black/[0.02] hover:bg-black/[0.04] border border-transparent transition-colors ${route ? "cursor-pointer" : ""}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1.5">
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-widest ${queueTone(item.queue).tabIdle}`}>
                          {queues?.find(q => q.key === item.queue)?.label ?? item.queue}
                        </span>
                        {item.amount != null && (
                          <span className="text-sm font-mono font-bold text-[var(--secondary)]">
                            ${item.amount.toLocaleString()}
                          </span>
                        )}
                      </div>
                      <h3 className="font-bold text-foreground text-base truncate">{item.title}</h3>
                      <p className="text-muted-foreground text-sm truncate">{item.sub}</p>
                      {item.entityType === "work_request" && item.entityId && (
                        <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                          {decliningId === item.entityId ? (
                            <div className="flex items-center gap-2">
                              <input
                                value={declineReason}
                                onChange={(e) => setDeclineReason(e.target.value)}
                                placeholder="Reason the client will see (optional)"
                                data-testid={`input-decline-reason-${item.id}`}
                                className="flex-1 max-w-sm rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm outline-none focus:border-[var(--secondary)]"
                              />
                              <button
                                onClick={() => void handleDecline(item.entityId!)}
                                disabled={declineRequest.isPending}
                                data-testid={`button-confirm-decline-${item.id}`}
                                className="rounded-full bg-[#FF3B30] px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                              >
                                Confirm decline
                              </button>
                              <button
                                onClick={() => { setDecliningId(null); setDeclineReason(""); }}
                                className="rounded-full border border-black/10 px-4 py-1.5 text-xs font-bold"
                              >
                                Keep it
                              </button>
                            </div>
                          ) : (
                            <div className="flex gap-2">
                              <button
                                onClick={(e) => void handleApprove(e, item.entityId!)}
                                disabled={acceptRequest.isPending}
                                data-testid={`button-approve-${item.id}`}
                                className="rounded-full bg-[var(--primary)] px-4 py-1.5 text-xs font-bold text-black disabled:opacity-50"
                              >
                                Approve
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); setDecliningId(item.entityId!); setDeclineReason(""); }}
                                data-testid={`button-decline-${item.id}`}
                                className="rounded-full border border-black/10 px-4 py-1.5 text-xs font-bold"
                              >
                                Decline
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                      {item.entityType !== "work_request" && (item.actions?.length ?? 0) > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                          {item.actions!.map((a) => (
                            <button
                              key={a.action}
                              onClick={() => void runFeedAction(item, a.action)}
                              disabled={remindInvoice.isPending || nudgeBid.isPending}
                              data-testid={`button-action-${a.action}-${item.id}`}
                              className={`rounded-full px-4 py-1.5 text-xs font-bold disabled:opacity-50 transition-colors ${
                                a.kind === "gold"
                                  ? "bg-[var(--primary)] text-black hover:opacity-90"
                                  : "border border-black/10 text-foreground hover:bg-black/5"
                              }`}
                            >
                              {a.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <button
                        onClick={(e) => handleDismiss(e, item.id)}
                        disabled={dismissItem.isPending}
                        aria-label="Clear"
                        title="Clear from feed"
                        data-testid={`button-dismiss-${item.id}`}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-black hover:bg-black/10 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                      {route && (
                        <div className="w-10 h-10 rounded-xl bg-[var(--secondary)] text-white flex items-center justify-center group-hover:opacity-90 transition-opacity">
                          <ArrowRight className="w-5 h-5" />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {(today?.feed.filter(item => item.tier === "now").length ?? 0) === 0 && (
                <div className="p-12 text-center text-muted-foreground text-sm">
                  No emergencies right now.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          <AutopilotActions />

          {/* Queues as Stat Cards */}
          <div data-tour="operations" className="grid grid-cols-2 gap-4">
            {queues?.map((q, idx) => {
              const active = queueFilter === q.key;
              const isFirst = idx === 0;
              
              if (isFirst) {
                return (
                  <button
                    key={q.key}
                    onClick={() => setQueueFilter(prev => (prev === q.key ? null : q.key))}
                    className={`col-span-2 p-6 flex flex-col justify-center text-left transition-colors cursor-pointer rounded-3xl border ${active ? "bg-[var(--primary)] text-black border-transparent" : "bg-white text-foreground border-border hover:border-[var(--secondary)]"} shadow-sm`}
                  >
                    <span className="text-sm font-bold text-muted-foreground mb-2">{q.label}</span>
                    <span className={`text-6xl font-display font-bold ${active ? "text-black" : "text-foreground"}`}>{q.count}</span>
                  </button>
                );
              }

              return (
                <button
                  key={q.key}
                  onClick={() => setQueueFilter(prev => (prev === q.key ? null : q.key))}
                  className={`p-5 flex flex-col justify-between aspect-square text-left transition-colors cursor-pointer rounded-3xl border ${active ? "bg-[var(--primary)] text-black border-transparent" : "bg-white text-foreground border-border hover:border-[var(--secondary)]"} shadow-sm`}
                >
                  <span className={`text-4xl font-display font-bold ${active ? "text-black" : "text-foreground"}`}>{q.count}</span>
                  <span className={`text-xs font-bold leading-tight ${active ? "text-black/80" : "text-muted-foreground"}`}>{q.label}</span>
                </button>
              );
            })}
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

      {pushTarget && (
        <PushCardDialog
          propertyId={pushTarget.propertyId}
          open={!!pushTarget}
          onOpenChange={(v) => { if (!v) setPushTarget(null); }}
          prefill={pushTarget.prefill}
        />
      )}
      {invoiceWizard && (
        <InvoiceWizardDialog
          open={!!invoiceWizard}
          onOpenChange={(v) => { if (!v) setInvoiceWizard(null); }}
          propertyId={invoiceWizard.propertyId}
          propertyName={invoiceWizard.propertyName}
        />
      )}
    </div>
  );
}
