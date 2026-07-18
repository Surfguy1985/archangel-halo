import { 
  useGetToday, 
  useListActivities,
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
import { InvoiceEditor } from "@/components/InvoiceEditor";

export default function Today() {
  const [location, setLocation] = useLocation();
  const { data: today, isLoading: isLoadingToday } = useGetToday();
  const { data: activities } = useListActivities({ limit: 10 });
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
        <div className="h-[240px] bg-card rounded-[28px]"></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="h-[100px] bg-card rounded-[22px]"></div>
          <div className="h-[100px] bg-card rounded-[22px]"></div>
          <div className="h-[100px] bg-card rounded-[22px]"></div>
          <div className="h-[100px] bg-card rounded-[22px]"></div>
        </div>
        <div className="h-[140px] bg-card rounded-[22px]"></div>
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
      <div className="text-[13px] font-bold text-muted-foreground/60 mb-[14px] px-[6px] uppercase tracking-[0.15em]">
        {(() => {
          const [y, m, d] = today.date.split("-").map(Number);
          return new Date(y, m - 1, d).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
        })()}
      </div>
      
      <BriefCard brief={today.brief} />

      {/* Bento Grid */}
      <div className="grid grid-cols-2 gap-[12px] mb-[24px]">
        {/* Money */}
        <div 
          onClick={() => setLocation('/money')}
          className="bg-[linear-gradient(135deg,#FFFFFF,#F7F6F2)] p-[16px] rounded-[24px] shadow-[0_4px_14px_rgba(23,24,28,0.04)] border border-[rgba(23,24,28,0.04)] cursor-pointer active:scale-95 transition-transform relative overflow-hidden group"
        >
          <div className="w-[36px] h-[36px] rounded-[14px] bg-[var(--gold-tint)] flex items-center justify-center mb-[12px]">
            <Wallet className="w-[18px] h-[18px] text-[var(--gold-dark)]" />
          </div>
          <div className="font-display font-bold text-[24px] leading-none text-[var(--ink)] tracking-tight mb-[4px]">{mtdStr}</div>
          <div className="text-[12px] font-medium text-muted-foreground">MTD Revenue</div>
          <ChevronRight className="w-[16px] h-[16px] text-muted-foreground/30 absolute bottom-[16px] right-[16px] group-hover:translate-x-[2px] transition-transform" />
        </div>

        {/* Calendar */}
        <div 
          onClick={() => setLocation('/calendar')}
          className="bg-[linear-gradient(135deg,#FFFFFF,#F7F6F2)] p-[16px] rounded-[24px] shadow-[0_4px_14px_rgba(23,24,28,0.04)] border border-[rgba(23,24,28,0.04)] cursor-pointer active:scale-95 transition-transform relative overflow-hidden group"
        >
          <div className="w-[36px] h-[36px] rounded-[14px] bg-[#E8F2FF] flex items-center justify-center mb-[12px]">
            <CalendarIcon className="w-[18px] h-[18px] text-[#0066FF]" />
          </div>
          <div className="font-display font-bold text-[24px] leading-none text-[var(--ink)] tracking-tight mb-[4px]">{eventsCount}</div>
          <div className="text-[12px] font-medium text-muted-foreground">Events Today</div>
          <ChevronRight className="w-[16px] h-[16px] text-muted-foreground/30 absolute bottom-[16px] right-[16px] group-hover:translate-x-[2px] transition-transform" />
        </div>

        {/* Jobs */}
        <div 
          onClick={() => setLocation('/properties')}
          className="bg-[linear-gradient(135deg,#FFFFFF,#F7F6F2)] p-[16px] rounded-[24px] shadow-[0_4px_14px_rgba(23,24,28,0.04)] border border-[rgba(23,24,28,0.04)] cursor-pointer active:scale-95 transition-transform relative overflow-hidden group"
        >
          <div className="w-[36px] h-[36px] rounded-[14px] bg-[#F2F0FF] flex items-center justify-center mb-[12px]">
            <Briefcase className="w-[18px] h-[18px] text-[#5E5CE6]" />
          </div>
          <div className="font-display font-bold text-[24px] leading-none text-[var(--ink)] tracking-tight mb-[4px]">{activeJobsCount}</div>
          <div className="text-[12px] font-medium text-muted-foreground">Active Jobs</div>
          <ChevronRight className="w-[16px] h-[16px] text-muted-foreground/30 absolute bottom-[16px] right-[16px] group-hover:translate-x-[2px] transition-transform" />
        </div>

        {/* Crews */}
        <div 
          onClick={() => setLocation('/crews')}
          className="bg-[linear-gradient(135deg,#FFFFFF,#F7F6F2)] p-[16px] rounded-[24px] shadow-[0_4px_14px_rgba(23,24,28,0.04)] border border-[rgba(23,24,28,0.04)] cursor-pointer active:scale-95 transition-transform relative overflow-hidden group"
        >
          <div className="w-[36px] h-[36px] rounded-[14px] bg-[#E8FAF0] flex items-center justify-center mb-[12px]">
            <Users className="w-[18px] h-[18px] text-[#00C566]" />
          </div>
          <div className="font-display font-bold text-[24px] leading-none text-[var(--ink)] tracking-tight mb-[4px]">{activeCrewsCount}</div>
          <div className="text-[12px] font-medium text-muted-foreground">Active Crews</div>
          <ChevronRight className="w-[16px] h-[16px] text-muted-foreground/30 absolute bottom-[16px] right-[16px] group-hover:translate-x-[2px] transition-transform" />
        </div>
      </div>

      {nowCards.length > 0 && (
        <div className="mb-[24px]">
          <div className="flex items-center gap-[8px] mx-[6px] mb-[12px] font-display font-bold text-[13px] tracking-[0.1em] uppercase text-[#FF453A]">
            Requires Action
            <span className="min-w-[20px] h-[20px] px-[6px] rounded-[10px] bg-[#FF453A]/10 text-[#FF453A] text-[11px] grid place-items-center tracking-normal font-sans">{nowCards.length}</span>
          </div>
          {nowCards.map(c => <FeedCard key={c.id} card={c} onCreateInvoice={setInvoiceJobId} />)}
        </div>
      )}

      {todayCards.length > 0 && (
        <div className="mb-[24px]">
          <div className="flex items-center gap-[8px] mx-[6px] mb-[12px] font-display font-bold text-[13px] tracking-[0.1em] uppercase text-[var(--ink)]">
            Up Next
            <span className="min-w-[20px] h-[20px] px-[6px] rounded-[10px] bg-[rgba(23,24,28,0.08)] text-[var(--ink2)] text-[11px] grid place-items-center tracking-normal font-sans">{todayCards.length}</span>
          </div>
          {todayCards.map(c => <FeedCard key={c.id} card={c} onCreateInvoice={setInvoiceJobId} />)}
        </div>
      )}

      {weekCards.length > 0 && (
        <div className="mb-[24px]">
          <div className="flex items-center gap-[8px] mx-[6px] mb-[12px] font-display font-bold text-[13px] tracking-[0.1em] uppercase text-muted-foreground">
            Later This Week
            <span className="min-w-[20px] h-[20px] px-[6px] rounded-[10px] bg-[rgba(23,24,28,0.06)] text-muted-foreground text-[11px] grid place-items-center tracking-normal font-sans">{weekCards.length}</span>
          </div>
          {weekCards.map(c => <FeedCard key={c.id} card={c} onCreateInvoice={setInvoiceJobId} />)}
        </div>
      )}

      {(activities?.length ?? 0) > 0 && (
        <div className="mt-[32px]">
          <div className="flex items-center gap-[8px] mx-[6px] mb-[12px] font-display font-bold text-[12px] tracking-[0.15em] uppercase text-muted-foreground/60">
            <History className="w-[14px] h-[14px]" /> System Activity
          </div>
          <div className="bg-card/50 rounded-[24px] border border-[rgba(23,24,28,0.04)] p-[12px_16px] backdrop-blur-sm">
            {activities!.slice(0, 5).map((a, idx) => (
              <div key={a.id} className={`py-[12px] ${idx !== 0 ? 'border-t border-[rgba(23,24,28,0.04)]' : ''}`}>
                <div className="text-[13px] text-[var(--ink)] leading-[1.4] font-medium">{a.body || a.kind}</div>
                {a.createdAt && (
                  <div className="text-[11px] text-muted-foreground/60 mt-[4px] font-medium">
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
