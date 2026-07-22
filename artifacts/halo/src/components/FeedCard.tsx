import {
  Brief,
  FeedCard as FeedCardType,
  useRemindInvoice,
  useNudgeBid,
  getGetTodayQueryKey,
  getListInvoicesQueryKey,
  getListBidsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Sparkles, ChevronRight } from "lucide-react";
import { HaloRing } from "./HaloRing";

export function BriefCard({ brief }: { brief: Brief }) {
  return (
    <div className="relative overflow-hidden bg-[linear-gradient(145deg,#1C1C1E,#000000)] rounded-[28px] p-[22px] shadow-[0_20px_40px_rgba(0,0,0,0.15)] mb-[20px] border border-[rgba(255,255,255,0.1)] text-white">
      <div className="absolute top-[-20%] right-[-10%] opacity-30 pointer-events-none">
         <div className="w-[180px] h-[180px] rounded-full bg-[var(--gold)] blur-[60px]" />
      </div>
      <div className="relative z-10 flex items-center gap-[8px] mb-[12px]">
        <HaloRing className="w-[18px] h-[18px] text-[var(--gold-light)]" />
        <span className="font-display font-semibold text-[12px] tracking-[0.2em] uppercase text-[var(--gold-light)] opacity-90">
          {(() => {
            const h = new Date().getHours();
            return h < 12 ? "Morning Brief" : h < 17 ? "Afternoon Brief" : "Evening Brief";
          })()}
        </span>
      </div>
      <div className="relative z-10 text-[16px] text-white/95 leading-[1.4] font-medium mb-[16px]" dangerouslySetInnerHTML={{ __html: brief.body }} />
      <div className="relative z-10 mt-[8px] flex items-center justify-between">
        <div className="flex gap-[8px]">
          <span className="text-[11px] font-bold text-white bg-[var(--gold)] rounded-[20px] px-[10px] py-[4px] shadow-[0_4px_12px_rgba(0,122,255,0.3)] flex items-center gap-[4px]">
            <Sparkles className="w-[12px] h-[12px]" />
            HALO
          </span>
          {brief.needsYou > 0 && (
            <span className="text-[11px] font-bold text-white bg-white/15 backdrop-blur-md rounded-[20px] px-[10px] py-[4px] border border-white/10">
              {brief.needsYou} NEED YOU
            </span>
          )}
        </div>
        <span className="text-[11.5px] text-white/50 font-medium">{brief.when}</span>
      </div>
    </div>
  );
}

export function entityRoute(entityType?: string | null, entityId?: string | null): string | null {
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

export function FeedCard({
  card,
  onCreateInvoice,
}: {
  card: FeedCardType;
  onCreateInvoice?: (jobId: string) => void;
}) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const remindInvoice = useRemindInvoice();
  const nudgeBid = useNudgeBid();

  const route = entityRoute(card.entityType, card.entityId);
  const actionPending = remindInvoice.isPending || nudgeBid.isPending;

  const errMessage = (err: unknown, fallback: string) => {
    const e = err as { data?: { error?: string } };
    return e?.data?.error ?? fallback;
  };

  const runAction = async (action: string) => {
    if (actionPending) return;
    switch (action) {
      case "remindInvoice": {
        if (!card.entityId) return;
        try {
          await remindInvoice.mutateAsync({ id: card.entityId });
          toast({ title: "Reminder sent" });
          queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        } catch (err) {
          toast({ title: errMessage(err, "Failed to send reminder"), variant: "destructive" });
        }
        return;
      }
      case "nudgeBid": {
        if (!card.entityId) return;
        try {
          await nudgeBid.mutateAsync({ id: card.entityId });
          toast({ title: "Nudge sent" });
          queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListBidsQueryKey() });
        } catch (err) {
          toast({ title: errMessage(err, "Failed to send nudge"), variant: "destructive" });
        }
        return;
      }
      case "createInvoice": {
        if (card.entityId && onCreateInvoice) onCreateInvoice(card.entityId);
        return;
      }
      case "scheduleJob":
      case "openJob": {
        if (card.entityId) navigate(`/jobs/${card.entityId}`);
        return;
      }
      default: {
        if (route) navigate(route);
      }
    }
  };

  const isNow = card.tier === 'now';
  const isHandled = card.tier === 'handled';

  return (
    <div
      onClick={route ? () => navigate(route) : undefined}
      className={`group relative overflow-hidden bg-card rounded-[22px] p-[16px] mb-[12px] border border-[var(--hairline)] shadow-[0_2px_10px_rgba(0,0,0,0.04),0_10px_20px_rgba(0,0,0,0.02)] transition-all ${isHandled ? 'opacity-60 bg-[rgba(255,255,255,0.5)] grayscale-[0.2]' : ''} ${route ? 'cursor-pointer active:scale-[0.98]' : ''} ${isNow ? 'bg-[linear-gradient(160deg,#fff,#FFF5F5)] border-[#FF3B30]/30' : ''}`}
    >
      <div className="flex gap-[12px] items-start">
        <div className={`w-[10px] h-[10px] rounded-full shrink-0 mt-[6px] shadow-sm ${isNow ? 'bg-[#FF3B30] shadow-[#FF3B30]/40' : 'bg-[var(--gold)] shadow-[var(--gold)]/40'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-start gap-[8px]">
            <div className="font-display font-bold text-[16px] leading-[1.2] text-[var(--ink)] tracking-[-0.01em] pr-[8px]">
              {card.title}
            </div>
            {route && <ChevronRight className="w-[16px] h-[16px] text-muted-foreground/50 shrink-0 mt-[2px]" />}
          </div>
          
          {card.sub && <div className="text-[13.5px] text-muted-foreground mt-[4px] leading-[1.3] pr-[20px]">{card.sub}</div>}
          
          {card.meta && card.meta.length > 0 && (
            <div className="flex flex-wrap gap-[6px] mt-[10px]">
              {card.meta.map((m, i) => (
                <span key={i} className={`text-[11px] rounded-[8px] px-[8px] py-[3px] font-semibold tracking-wide flex items-center ${m.mono ? 'font-mono text-[10px] tracking-[0.04em]' : ''} ${m.warn ? 'text-[#FF3B30] bg-[#FF3B30]/10' : m.gold ? 'text-[var(--gold-dark)] bg-[var(--gold-tint)]' : 'text-[var(--ink2)] bg-[rgba(0,0,0,0.05)]'}`}>
                  {m.label}
                </span>
              ))}
            </div>
          )}
          
          {card.actions && card.actions.length > 0 && (
            <div className="flex gap-[8px] mt-[14px]">
              {card.actions.map((a, i) => (
                <button
                  key={i}
                  disabled={actionPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    runAction(a.action);
                  }}
                  className={`rounded-[12px] px-[14px] py-[8px] text-[13px] font-bold tracking-wide transition-all active:scale-95 disabled:opacity-50 inline-flex items-center justify-center gap-[6px] shadow-sm ${a.kind === 'gold' ? 'bg-[linear-gradient(135deg,#47A1FF,var(--gold))] text-white shadow-[0_4px_12px_rgba(0,122,255,0.25)] border border-white/20' : a.kind === 'ghost' ? 'bg-[rgba(0,0,0,0.05)] text-[var(--ink)] hover:bg-[rgba(0,0,0,0.08)]' : 'bg-white border border-[rgba(0,0,0,0.1)] text-[var(--ink)] shadow-[0_2px_4px_rgba(0,0,0,0.04)]'}`}
                >
                  {actionPending && (a.action === "remindInvoice" || a.action === "nudgeBid") && (
                    <Loader2 className="w-[14px] h-[14px] animate-spin" />
                  )}
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
