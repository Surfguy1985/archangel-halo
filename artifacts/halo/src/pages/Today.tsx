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
  
  // Date helpers for calendar
  const d = new Date();
  const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const { data: calendar, isLoading: isLoadingCalendar } = useGetCalendar({ from: todayStr, to: todayStr });

  const [invoiceJobId, setInvoiceJobId] = useState<string | null>(null);

  const isLoading = isLoadingToday || isLoadingMoney || isLoadingJobs || isLoadingCrews || isLoadingCalendar;

  if (isLoading || !today) {
    return (
      <div className="animate-pulse space-y-4 pt-4 px-2">
        <div className="h-[240px] bg-card rounded-[28px] border border-[var(--hairline)]"></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="h-[100px] bg-card rounded-[22px] border border-[var(--hairline)]"></div>
          <div className="h-[100px] bg-card rounded-[22px] border border-[var(--hairline)]"></div>
          <div className="h-[100px] bg-card rounded-[22px] border border-[var(--hairline)]"></div>
          <div className="h-[100px] bg-card rounded-[22px] border border-[var(--hairline)]"></div>
        </div>
        <div className="h-[140px] bg-card rounded-[22px] border border-[var(--hairline)]"></div>
      </div>
    );
  }

  const nowCards = today.feed.filter(c => c.tier === 'now');
  const todayCards = today.feed.filter(c => c.tier === 'today');
  const weekCards = today.feed.filter(c => c.tier === 'week');

  // Computed stats
  const activeJobsCount = jobs?.filter(j => j.status !== 'complete' && j.status !== 'paid' && j.status !== 'cancelled').length || 0;
  const activeCrewsCount = crews?.length || 0;
  const eventsCount = calendar?.events.length || 0;
  
  const mtd = moneySummary?.mtd ?? 0;
  const mtdStr = mtd >= 1000 ? `$${(mtd/1000).toFixed(1)}k` : `$${mtd}`;

  return (
    <div className="pt-[6px] animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both pb-6">
      <div className="text-[13px] font-bold text-[var(--gold)] mb-[14px] px-[6px] uppercase tracking-[0.15em] flex items-center gap-[8px]">
        <div className="w-[6px] h-[6px] rounded-full bg-[var(--gold)] shadow-[0_0_8px_var(--gold)] animate-pulse" />
        {(() => {
          const [y, m, d] = today.date.split("-").map(Number);
          return new Date(y, m - 1, d).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
        })()}
      </div>
      
      <BriefCard brief={today.brief} />

      <AutopilotActions />

      {nowCards.length > 0 && (
        <div className="mb-[24px]">
          <div className="flex items-center gap-[8px] mx-[6px] mb-[12px] font-display font-bold text-[13px] tracking-[0.15em] uppercase text-destructive">
            Requires Action
            <span className="min-w-[20px] h-[20px] px-[6px] rounded-[10px] bg-destructive/10 text-destructive text-[11px] grid place-items-center tracking-normal font-sans font-bold border border-destructive/20">{nowCards.length}</span>
          </div>
          {nowCards.map(c => <FeedCard key={c.id} card={c} onCreateInvoice={setInvoiceJobId} />)}
        </div>
      )}

      {/* Bento Grid */}
      <div className="grid grid-cols-2 gap-[12px] mb-[24px]">
        {/* Money */}
        <div 
          onClick={() => setLocation('/money')}
          className="bg-card p-[16px] rounded-[24px] border border-[var(--hairline)] hover:border-[var(--gold)] hover:shadow-[0_0_20px_rgba(198,242,17,0.1)] cursor-pointer active:scale-95 transition-all relative overflow-hidden group"
        >
          <div className="w-[40px] h-[40px] rounded-[14px] bg-[var(--gold-tint)] border border-[var(--gold)]/20 flex items-center justify-center mb-[16px] shadow-[inset_0_0_15px_rgba(198,242,17,0.1)]">
            <Wallet className="w-[20px] h-[20px] text-[var(--gold)]" />
          </div>
          <div className="font-display font-bold text-[28px] leading-none text-white tracking-tight mb-[6px]">{mtdStr}</div>
          <div className="text-[12px] font-bold tracking-wider text-muted-foreground uppercase">MTD Revenue</div>
          <ChevronRight className="w-[16px] h-[16px] text-[var(--gold)] absolute bottom-[16px] right-[16px] opacity-0 translate-x-[-10px] group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
        </div>

        {/* Calendar */}
        <div 
          onClick={() => setLocation('/calendar')}
          className="bg-card p-[16px] rounded-[24px] border border-[var(--hairline)] hover:border-[var(--gold)] hover:shadow-[0_0_20px_rgba(198,242,17,0.1)] cursor-pointer active:scale-95 transition-all relative overflow-hidden group"
        >
          <div className="w-[40px] h-[40px] rounded-[14px] bg-[rgba(255,255,255,0.05)] border border-[var(--hairline)] flex items-center justify-center mb-[16px]">
            <CalendarIcon className="w-[20px] h-[20px] text-white" />
          </div>
          <div className="font-display font-bold text-[28px] leading-none text-white tracking-tight mb-[6px]">{eventsCount}</div>
          <div className="text-[12px] font-bold tracking-wider text-muted-foreground uppercase">Events Today</div>
          <ChevronRight className="w-[16px] h-[16px] text-[var(--gold)] absolute bottom-[16px] right-[16px] opacity-0 translate-x-[-10px] group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
        </div>

        {/* Jobs */}
        <div 
          onClick={() => setLocation('/properties')}
          className="bg-card p-[16px] rounded-[24px] border border-[var(--hairline)] hover:border-[var(--gold)] hover:shadow-[0_0_20px_rgba(198,242,17,0.1)] cursor-pointer active:scale-95 transition-all relative overflow-hidden group"
        >
          <div className="w-[40px] h-[40px] rounded-[14px] bg-[rgba(255,255,255,0.05)] border border-[var(--hairline)] flex items-center justify-center mb-[16px]">
            <Briefcase className="w-[20px] h-[20px] text-white" />
          </div>
          <div className="font-display font-bold text-[28px] leading-none text-white tracking-tight mb-[6px]">{activeJobsCount}</div>
          <div className="text-[12px] font-bold tracking-wider text-muted-foreground uppercase">Active Jobs</div>
          <ChevronRight className="w-[16px] h-[16px] text-[var(--gold)] absolute bottom-[16px] right-[16px] opacity-0 translate-x-[-10px] group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
        </div>

        {/* Crews */}
        <div 
          onClick={() => setLocation('/crews')}
          className="bg-card p-[16px] rounded-[24px] border border-[var(--hairline)] hover:border-[var(--gold)] hover:shadow-[0_0_20px_rgba(198,242,17,0.1)] cursor-pointer active:scale-95 transition-all relative overflow-hidden group"
        >
          <div className="w-[40px] h-[40px] rounded-[14px] bg-[rgba(255,255,255,0.05)] border border-[var(--hairline)] flex items-center justify-center mb-[16px]">
            <Users className="w-[20px] h-[20px] text-white" />
          </div>
          <div className="font-display font-bold text-[28px] leading-none text-white tracking-tight mb-[6px]">{activeCrewsCount}</div>
          <div className="text-[12px] font-bold tracking-wider text-muted-foreground uppercase">Active Crews</div>
          <ChevronRight className="w-[16px] h-[16px] text-[var(--gold)] absolute bottom-[16px] right-[16px] opacity-0 translate-x-[-10px] group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
        </div>
      </div>

      {todayCards.length > 0 && (
        <div className="mb-[24px]">
          <div className="flex items-center gap-[8px] mx-[6px] mb-[12px] font-display font-bold text-[13px] tracking-[0.15em] uppercase text-white">
            Up Next
            <span className="min-w-[20px] h-[20px] px-[6px] rounded-[10px] bg-[rgba(255,255,255,0.1)] text-white text-[11px] grid place-items-center tracking-normal font-sans font-bold">{todayCards.length}</span>
          </div>
          {todayCards.map(c => <FeedCard key={c.id} card={c} onCreateInvoice={setInvoiceJobId} />)}
        </div>
      )}

      {weekCards.length > 0 && (
        <div className="mb-[24px]">
          <div className="flex items-center gap-[8px] mx-[6px] mb-[12px] font-display font-bold text-[13px] tracking-[0.15em] uppercase text-muted-foreground">
            Later This Week
            <span className="min-w-[20px] h-[20px] px-[6px] rounded-[10px] bg-[rgba(255,255,255,0.05)] text-muted-foreground text-[11px] grid place-items-center tracking-normal font-sans font-bold border border-[var(--hairline)]">{weekCards.length}</span>
          </div>
          {weekCards.map(c => <FeedCard key={c.id} card={c} onCreateInvoice={setInvoiceJobId} />)}
        </div>
      )}

      {(activities?.length ?? 0) > 0 && (
        <div className="mt-[32px]">
          <div className="flex items-center gap-[8px] mx-[6px] mb-[12px] font-display font-bold text-[12px] tracking-[0.2em] uppercase text-muted-foreground">
            <History className="w-[14px] h-[14px]" /> System Activity
          </div>
          <div className="bg-card rounded-[24px] border border-[var(--hairline)] p-[12px_20px]">
            {activities!.slice(0, 5).map((a, idx) => (
              <div key={a.id} className={`py-[16px] ${idx !== 0 ? 'border-t border-[var(--hairline)]' : ''}`}>
                <div className="text-[14px] text-white leading-[1.5] font-medium">{a.body || a.kind}</div>
                {a.createdAt && (
                  <div className="text-[11px] text-muted-foreground/80 mt-[6px] font-bold tracking-wider uppercase">
                    {new Date(a.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
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
