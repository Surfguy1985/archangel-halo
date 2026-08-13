import { useGetToday, useRefreshBrief, useGetQueues, useListActivities, useListJobs, useDismissFeedItem, useAcceptWorkRequest, useDeclineWorkRequest, useRemindInvoice, useNudgeBid, getGetTodayQueryKey, getGetQueuesQueryKey, getListActivitiesQueryKey, getListWorkRequestsQueryKey, getListJobsQueryKey, getListInvoicesQueryKey, getListBidsQueryKey, type FeedCard} from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { PushCardDialog, type PushPrefill} from "@/components/PushCardDialog";
import { InvoiceWizardDialog} from "@/components/InvoiceWizardDialog";
import { Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import { Skeleton} from "@/components/ui/skeleton";
import { useState, useMemo } from "react";
import { useQueryClient} from "@tanstack/react-query";
import { useToast} from "@/hooks/use-toast";
import { useLocation} from "wouter";
import { AutopilotActions} from "@/components/AutopilotActions";
import { Sparkles, ArrowRight, RefreshCw, X, History, ChevronDown, Zap, Network} from "lucide-react";
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

  const { data: jobs } = useListJobs(undefined, {
    query: { queryKey: getListJobsQueryKey(), refetchInterval: 10_000 },
  });

  // Falkon inbound requests awaiting approval
  const BASE = import.meta.env.BASE_URL as string;
  const {
    data: falkonRequests,
    isError: falkonError,
    isFetching: falkonFetching,
  } = useQuery<Array<{ id: string; direction: string; approval_state: string }>>({
    queryKey: ["falkon-network-requests"],
    queryFn: async () => {
      // Filter server-side to inbound+awaiting_approval only; limit=200 avoids the
      // default-50 truncation — operators must never miss an approval request.
      const url = `${BASE}api/falkon/network/requests?direction=inbound&state=awaiting_approval&limit=200`;
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error(`Falkon requests fetch failed: ${r.status}`);
      const json = await r.json();
      return Array.isArray(json) ? json : (json.requests ?? []);
    },
    refetchInterval: 30_000,
    retry: 2,
  });
  // Server already filters to inbound+awaiting_approval; length is the full count.
  const pendingFalkonCount = (falkonRequests ?? []).length;

  // Work happening at each property today: in-progress jobs + jobs scheduled for today.
  const todayByProperty = useMemo(() => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const active = (jobs ?? []).filter(
      j => j.status === "in_progress" || (j.status === "scheduled" && j.scheduledOn === todayStr),
    );
    const groups = new Map<string, { propertyId: string; propertyName: string; jobs: typeof active }>();
    for (const j of active) {
      const key = j.propertyId ?? "unknown";
      const g = groups.get(key) ?? { propertyId: key, propertyName: j.propertyName ?? "Unknown property", jobs: [] };
      g.jobs.push(j);
      groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => a.propertyName.localeCompare(b.propertyName));
  }, [jobs]);

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

          {/* Falkon: inbound requests awaiting approval */}
          {pendingFalkonCount > 0 && (
            <button
              type="button"
              onClick={() => navigate("/integrations?tab=requests")}
              className="w-full text-left bg-amber-50 border border-amber-300 rounded-3xl p-5 flex items-center gap-4 shadow-sm hover:bg-amber-100 transition-colors group"
              data-testid="falkon-pending-blocker"
            >
              <div className="w-10 h-10 rounded-2xl bg-amber-400/20 flex items-center justify-center shrink-0">
                <Network className="w-5 h-5 text-amber-700" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-amber-900 text-sm">
                  {pendingFalkonCount === 1
                    ? "1 Falkon request needs your approval"
                    : `${pendingFalkonCount} Falkon requests need your approval`}
                </p>
                <p className="text-amber-700 text-xs mt-0.5">
                  Inbound cross-business requests are waiting — review in Request Inbox
                </p>
              </div>
              <ArrowRight className="w-4 h-4 text-amber-600 shrink-0 group-hover:translate-x-0.5 transition-transform" />
            </button>
          )}

          {/* Today at the properties */}
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-border">
            <div className="flex items-center justify-between pb-4">
              <h2 className="text-xl font-display font-bold text-foreground">Today at the properties</h2>
              <button
                onClick={() => queryClient.invalidateQueries({ queryKey: getListJobsQueryKey()})}
                className="text-xs font-bold text-muted-foreground bg-black/5 hover:bg-black/10 px-4 py-2 rounded-full transition-colors"
              >
                Refresh
              </button>
            </div>

            <div className="space-y-5">
              {todayByProperty.map(group => (
                <div key={group.propertyId}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--gold-light)]" />
                    <h3 className="font-bold text-foreground text-sm">{group.propertyName}</h3>
                    <span className="text-xs text-muted-foreground font-mono">{group.jobs.length}</span>
                  </div>
                  <div className="space-y-2">
                    {group.jobs.map(job => (
                      <div
                        key={job.id}
                        onClick={() => navigate(`/jobs/${job.id}`)}
                        data-testid={`today-job-${job.id}`}
                        className="group flex items-center gap-4 p-3.5 rounded-2xl bg-black/[0.02] hover:bg-black/[0.04] transition-colors cursor-pointer"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-foreground text-sm truncate">
                            {job.description || job.category || job.jobNo}
                          </p>
                          <p className="text-muted-foreground text-xs truncate mt-0.5">
                            {[
                              job.unitNo ? `Unit ${job.unitNo}` : null,
                              job.crewLeaderName ?? "Unassigned",
                              job.scheduledTime ?? null,
                            ].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <span className={`shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-widest ${
                          job.status === "in_progress"
                            ? "bg-[var(--gold-light)] text-black"
                            : "bg-sky-100 text-sky-800"
                        }`}>
                          {job.status === "in_progress" ? "In progress" : "Scheduled"}
                        </span>
                        <ArrowRight className="w-4 h-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {todayByProperty.length === 0 && (
                <div className="p-12 text-center text-muted-foreground text-sm">
                  No work scheduled at the properties today.
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
