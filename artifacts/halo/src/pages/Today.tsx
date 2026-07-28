import { 
  useGetToday, 
  useListActivities,
  getListActivitiesQueryKey,
  useGetMoneySummary,
  useGetCalendar,
  useListJobs,
  useListCrews,
} from "@workspace/api-client-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { 
  History, 
  Wallet, 
  Briefcase, 
  Users, 
  Calendar as CalendarIcon,
  ChevronRight,
  Activity
} from "lucide-react";
import { BriefCard, FeedCard } from "@/components/FeedCard";
import { AutopilotActions } from "@/components/AutopilotActions";
import { InvoiceEditor } from "@/components/InvoiceEditor";

export default function Today() {
  const [location, setLocation] = useLocation();
  const { data: today, isLoading: isLoadingToday } = useGetToday();
  const { data: activities } = useListActivities(
    { limit: 10 },
    { query: { queryKey: getListActivitiesQueryKey({ limit: 10 }), refetchInterval: 10_000 } },
  );
  const { data: moneySummary, isLoading: isLoadingMoney } = useGetMoneySummary();
  const { data: jobs, isLoading: isLoadingJobs } = useListJobs();
  const { data: crews, isLoading: isLoadingCrews } = useListCrews();
  
  const d = new Date();
  const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const { data: calendar, isLoading: isLoadingCalendar } = useGetCalendar({ from: todayStr, to: todayStr });

  const [invoiceJobId, setInvoiceJobId] = useState<string | null>(null);

  const isLoading = isLoadingToday || isLoadingMoney || isLoadingJobs || isLoadingCrews || isLoadingCalendar;

  if (isLoading || !today) {
    return (
      <div className="animate-pulse space-y-4 pt-4 px-2 flex flex-col min-h-screen">
        <div className="h-[200px] bg-card rounded-[20px] border border-border"></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="h-[120px] bg-card rounded-[20px] border border-border"></div>
          <div className="h-[120px] bg-card rounded-[20px] border border-border"></div>
        </div>
      </div>
    );
  }

  const nowCards = today.feed.filter(c => c.tier === 'now');
  const todayCards = today.feed.filter(c => c.tier === 'today');
  const weekCards = today.feed.filter(c => c.tier === 'week');

  const activeJobsCount = jobs?.filter(j => j.status !== 'complete' && j.status !== 'paid' && j.status !== 'cancelled').length || 0;
  const activeCrewsCount = crews?.length || 0;
  const eventsCount = calendar?.events.length || 0;
  
  const mtd = moneySummary?.mtd ?? 0;
  const mtdStr = mtd >= 1000 ? `$${(mtd/1000).toFixed(1)}k` : `$${mtd}`;

  return (
    <div className="pt-2 animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both pb-20 px-2 flex flex-col min-h-[100dvh]">
      {/* Date Header */}
      <div className="flex items-center justify-between mb-6 px-1">
        <div className="text-[12px] font-bold text-[var(--ink)] uppercase tracking-[0.2em] flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--gold)]" />
          {(() => {
            const [y, m, d] = today.date.split("-").map(Number);
            return new Date(y, m - 1, d).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
          })()}
        </div>
      </div>
      
      <BriefCard brief={today.brief} />

      {/* Cockpit HUD Numbers */}
      <div className="grid grid-cols-2 gap-3 mb-8">
        <div 
          onClick={() => setLocation('/money')}
          className="bg-[var(--ink)] p-5 rounded-[20px] cursor-pointer active:scale-95 transition-all relative overflow-hidden group flex flex-col justify-between"
        >
          <div className="flex items-center gap-2 text-[11px] font-bold tracking-[0.1em] text-white/60 uppercase mb-4">
            <Wallet className="w-3.5 h-3.5 text-[var(--gold-light)]" /> MTD Rev
          </div>
          <div className="font-display font-bold text-[32px] leading-none text-white tracking-tight group-hover:text-[var(--gold-light)] transition-colors">{mtdStr}</div>
        </div>

        <div 
          onClick={() => setLocation('/properties')}
          className="bg-[var(--gold-light)] p-5 rounded-[20px] cursor-pointer active:scale-95 transition-all relative overflow-hidden group flex flex-col justify-between"
        >
          <div className="flex items-center gap-2 text-[11px] font-bold tracking-[0.1em] text-[var(--ink)]/60 uppercase mb-4">
            <Briefcase className="w-3.5 h-3.5 text-[var(--ink)]" /> Jobs
          </div>
          <div className="font-display font-bold text-[32px] leading-none text-[var(--ink)] tracking-tight">{activeJobsCount}</div>
        </div>

        <div 
          onClick={() => setLocation('/calendar')}
          className="bg-card p-5 rounded-[20px] border border-[var(--hairline)] hover:border-[var(--gold)]/30 cursor-pointer active:scale-95 transition-all relative overflow-hidden group flex flex-col justify-between"
        >
          <div className="flex items-center gap-2 text-[11px] font-bold tracking-[0.1em] text-muted-foreground uppercase mb-4">
            <CalendarIcon className="w-3.5 h-3.5 text-[var(--ink)]" /> Events
          </div>
          <div className="font-display font-bold text-[32px] leading-none text-[var(--ink)] tracking-tight">{eventsCount}</div>
        </div>

        <div 
          onClick={() => setLocation('/crews')}
          className="bg-card p-5 rounded-[20px] border border-[var(--hairline)] hover:border-[var(--gold)]/30 cursor-pointer active:scale-95 transition-all relative overflow-hidden group flex flex-col justify-between"
        >
          <div className="flex items-center gap-2 text-[11px] font-bold tracking-[0.1em] text-muted-foreground uppercase mb-4">
            <Users className="w-3.5 h-3.5 text-[var(--ink)]" /> Crews
          </div>
          <div className="font-display font-bold text-[32px] leading-none text-[var(--ink)] tracking-tight">{activeCrewsCount}</div>
        </div>
      </div>

      <AutopilotActions />

      {/* Feed Sections */}
      <div className="flex flex-col gap-8">
        {nowCards.length > 0 && (
          <div>
            <div className="flex items-center gap-2 px-1 mb-4">
              <div className="w-2 h-2 rounded-full bg-destructive" />
              <span className="font-display font-bold text-[11px] tracking-[0.2em] uppercase text-destructive">Action Required</span>
            </div>
            <div className="flex flex-col gap-3">
              {nowCards.map(c => <FeedCard key={c.id} card={c} onCreateInvoice={setInvoiceJobId} />)}
            </div>
          </div>
        )}

        {todayCards.length > 0 && (
          <div>
            <div className="flex items-center gap-2 px-1 mb-4">
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--ink)]" />
              <span className="font-display font-bold text-[11px] tracking-[0.2em] uppercase text-[var(--ink)]">Up Next</span>
            </div>
            <div className="flex flex-col gap-3">
              {todayCards.map(c => <FeedCard key={c.id} card={c} onCreateInvoice={setInvoiceJobId} />)}
            </div>
          </div>
        )}

        {weekCards.length > 0 && (
          <div>
            <div className="flex items-center gap-2 px-1 mb-4">
              <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
              <span className="font-display font-bold text-[11px] tracking-[0.2em] uppercase text-muted-foreground">Later This Week</span>
            </div>
            <div className="flex flex-col gap-3">
              {weekCards.map(c => <FeedCard key={c.id} card={c} onCreateInvoice={setInvoiceJobId} />)}
            </div>
          </div>
        )}
      </div>

      {/* Activity Log */}
      {(activities?.length ?? 0) > 0 && (
        <div className="mt-10">
          <div className="flex items-center gap-2 px-1 mb-4 text-[10px] tracking-[0.2em] font-bold uppercase text-muted-foreground">
            <Activity className="w-3.5 h-3.5" /> System Log
          </div>
          <div className="bg-card rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] divide-y divide-[var(--hairline)]">
            {activities!.slice(0, 5).map((a) => (
              <div key={a.id} className="p-4 flex flex-col gap-1.5">
                <div className="text-[13px] text-[var(--ink)] font-medium">{a.body || a.kind}</div>
                {a.createdAt && (
                  <div className="text-[10px] text-muted-foreground font-mono uppercase">
                    {new Date(a.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <InvoiceEditor
        open={!!invoiceJobId}
        onOpenChange={(o) => { if (!o) setInvoiceJobId(null); }}
        initialJobId={invoiceJobId}
      />
    </div>
  );
}
