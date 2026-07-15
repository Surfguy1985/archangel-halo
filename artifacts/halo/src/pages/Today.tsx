import { useGetToday, useListActivities } from "@workspace/api-client-react";
import { useState } from "react";
import { History } from "lucide-react";
import { BriefCard, FeedCard } from "@/components/FeedCard";
import { InvoiceEditor } from "@/components/InvoiceEditor";

export default function Today() {
  const { data: today, isLoading } = useGetToday();
  const { data: activities } = useListActivities({ limit: 10 });
  const [invoiceJobId, setInvoiceJobId] = useState<string | null>(null);

  if (isLoading || !today) {
    return (
      <div className="animate-pulse space-y-4 pt-4">
        <div className="h-4 bg-muted rounded w-1/3"></div>
        <div className="h-32 bg-card rounded-2xl"></div>
        <div className="h-24 bg-card rounded-2xl"></div>
      </div>
    );
  }

  const nowCards = today.feed.filter(c => c.tier === 'now');
  const todayCards = today.feed.filter(c => c.tier === 'today');
  const weekCards = today.feed.filter(c => c.tier === 'week');

  return (
    <div className="pt-2 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="text-[13px] text-muted-foreground mb-[12px] px-[2px]">{today.date}</div>
      <BriefCard brief={today.brief} />

      {nowCards.length > 0 && (
        <>
          <div className="flex items-center gap-[8px] mx-[2px] mt-[20px] mb-[9px] font-display font-semibold text-[11.5px] tracking-[0.2em] uppercase text-muted-foreground">
            Now
            <span className="min-w-[20px] h-[20px] px-[6px] rounded-[10px] bg-foreground text-background text-[11px] grid place-items-center tracking-normal">{nowCards.length}</span>
          </div>
          {nowCards.map(c => <FeedCard key={c.id} card={c} onCreateInvoice={setInvoiceJobId} />)}
        </>
      )}

      {todayCards.length > 0 && (
        <>
          <div className="flex items-center gap-[8px] mx-[2px] mt-[20px] mb-[9px] font-display font-semibold text-[11.5px] tracking-[0.2em] uppercase text-muted-foreground">
            Today
            <span className="min-w-[20px] h-[20px] px-[6px] rounded-[10px] bg-[rgba(23,24,28,0.08)] text-[var(--ink2)] text-[11px] grid place-items-center tracking-normal">{todayCards.length}</span>
          </div>
          {todayCards.map(c => <FeedCard key={c.id} card={c} onCreateInvoice={setInvoiceJobId} />)}
        </>
      )}

      {weekCards.length > 0 && (
        <>
          <div className="flex items-center gap-[8px] mx-[2px] mt-[20px] mb-[9px] font-display font-semibold text-[11.5px] tracking-[0.2em] uppercase text-muted-foreground">
            This Week
            <span className="min-w-[20px] h-[20px] px-[6px] rounded-[10px] bg-[rgba(23,24,28,0.08)] text-[var(--ink2)] text-[11px] grid place-items-center tracking-normal">{weekCards.length}</span>
          </div>
          {weekCards.map(c => <FeedCard key={c.id} card={c} onCreateInvoice={setInvoiceJobId} />)}
        </>
      )}

      {(activities?.length ?? 0) > 0 && (
        <>
          <div className="flex items-center gap-[8px] mx-[2px] mt-[20px] mb-[9px] font-display font-semibold text-[11.5px] tracking-[0.2em] uppercase text-muted-foreground">
            <History className="w-[13px] h-[13px]" /> Activity Log
          </div>
          <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[6px_14px]">
            {activities!.slice(0, 10).map((a, idx) => (
              <div key={a.id} className={`py-[10px] ${idx !== 0 ? 'border-t border-border' : ''}`}>
                <div className="text-[13px] leading-snug">{a.body || a.kind}</div>
                {a.createdAt && (
                  <div className="text-[11px] text-muted-foreground mt-[2px]">
                    {new Date(a.createdAt).toLocaleDateString()} · {new Date(a.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="text-[11px] text-muted-foreground mx-[2px] mt-[6px] mb-[4px]">
            This log is permanent — it stays even after a data wipe.
          </div>
        </>
      )}

      <InvoiceEditor
        open={!!invoiceJobId}
        onOpenChange={(o) => { if (!o) setInvoiceJobId(null); }}
        initialJobId={invoiceJobId}
      />
    </div>
  );
}
