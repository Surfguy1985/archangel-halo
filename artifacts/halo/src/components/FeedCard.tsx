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
import { Loader2 } from "lucide-react";
import { HaloRing } from "./HaloRing";

export function BriefCard({ brief }: { brief: Brief }) {
  return (
    <div className="bg-[linear-gradient(135deg,#FFFDF8,#FBF6EA)] border border-[rgba(185,138,47,0.28)] rounded-[16px] p-[14px_15px] shadow-[0_1px_2px_rgba(23,24,28,0.05),0_8px_28px_rgba(23,24,28,0.07)] mb-[18px]">
      <div className="flex items-center gap-[8px] mb-[7px]">
        <HaloRing className="w-[16px] h-[16px]" />
        <span className="font-display font-semibold text-[11px] tracking-[0.18em] uppercase text-[var(--gold-dark)]">Morning brief</span>
        <span className="ml-auto text-[11.5px] text-muted-foreground">{brief.when}</span>
      </div>
      <div className="text-[14px] text-[var(--ink2)] leading-relaxed" dangerouslySetInnerHTML={{ __html: brief.body }} />
      <div className="mt-[9px] flex gap-[6px]">
        <span className="text-[11px] font-semibold text-[var(--gold-dark)] bg-[var(--gold-tint)] rounded-[20px] px-[9px] py-[3px]">Written by HALO</span>
        {brief.needsYou > 0 && (
          <span className="text-[11px] font-semibold text-[var(--gold-dark)] bg-[var(--gold-tint)] rounded-[20px] px-[9px] py-[3px]">{brief.needsYou} need you</span>
        )}
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

  return (
    <div
      onClick={route ? () => navigate(route) : undefined}
      className={`bg-card rounded-[16px] shadow-[0_1px_2px_rgba(23,24,28,0.05),0_8px_28px_rgba(23,24,28,0.07)] p-[13px_14px] mb-[10px] border border-transparent ${card.tier === 'handled' ? 'opacity-60 bg-[#FCFBF9]' : ''} ${route ? 'cursor-pointer active:scale-[0.99] transition-transform' : ''}`}
    >
      <div className="flex gap-[9px] items-start">
        <div className={`w-[9px] h-[9px] rounded-full shrink-0 mt-[6px] ${card.tier === 'now' ? 'bg-destructive' : 'bg-[var(--gold)]'}`} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[15px] tracking-[-0.01em]">{card.title}</div>
          {card.sub && <div className="text-[13px] text-muted-foreground mt-[2px]">{card.sub}</div>}
          {card.meta && card.meta.length > 0 && (
            <div className="flex flex-wrap gap-[6px] mt-[8px]">
              {card.meta.map((m, i) => (
                <span key={i} className={`text-[11.5px] rounded-[20px] px-[9px] py-[3px] font-medium ${m.mono ? 'font-mono text-[10.5px] tracking-[0.02em]' : ''} ${m.warn ? 'text-destructive bg-[rgba(192,69,58,0.09)] font-semibold' : m.gold ? 'text-[var(--gold-dark)] bg-[var(--gold-tint)] font-semibold' : 'text-[var(--ink2)] bg-[rgba(23,24,28,0.055)]'}`}>
                  {m.label}
                </span>
              ))}
            </div>
          )}
          {card.actions && card.actions.length > 0 && (
            <div className="flex gap-[8px] mt-[11px]">
              {card.actions.map((a, i) => (
                <button
                  key={i}
                  disabled={actionPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    runAction(a.action);
                  }}
                  className={`rounded-[11px] px-[13px] py-[8px] text-[13.5px] font-semibold transition-transform active:scale-95 disabled:opacity-60 inline-flex items-center gap-[6px] ${a.kind === 'gold' ? 'btn-gold' : a.kind === 'ghost' ? 'btn-ghost' : 'btn-line'}`}
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
