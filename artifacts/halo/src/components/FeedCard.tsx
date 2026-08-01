import {
  Brief,
  FeedCard as FeedCardType,
  useRemindInvoice,
  useNudgeBid,
  useDismissFeedItem,
  useAcceptWorkRequest,
  useDeclineWorkRequest,
  getGetTodayQueryKey,
  getListInvoicesQueryKey,
  getListBidsQueryKey,
  getListWorkRequestsQueryKey,
  getListJobsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Sparkles, ChevronRight, X } from "lucide-react";
import { HaloRing } from "./HaloRing";

export function BriefCard({ brief }: { brief: Brief }) {
  return (
    <div className="relative overflow-hidden bg-[linear-gradient(145deg,#1C1C1E,#000000)] rounded-[28px] p-[22px] shadow-[0_20px_40px_rgba(0,0,0,0.15)] mb-[20px] border border-[rgba(255,255,255,0.1)] text-white">
      <div className="absolute top-[-20%] right-[-10%] opacity-30 pointer-events-none">
         <div className="w-[180px] h-[180px] rounded-full bg-[var(--gold-light)] blur-[60px]" />
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
          <span className="text-[11px] font-bold text-black bg-[var(--gold-light)] rounded-[20px] px-[10px] py-[4px] shadow-[0_4px_12px_rgba(180,255,68,0.35)] flex items-center gap-[4px]">
            <Sparkles className="w-[12px] h-[12px]" />
            HALO
          </span>
          {brief.needsYou > 0 && (
            <span className="text-[11px] font-bold text-white bg-white/15 backdrop-blur-md rounded-[20px] px-[10px] py-[4px] border border-border">
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
    case "work_request":
      return "/pipeline";
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
  const dismissItem = useDismissFeedItem();
  const acceptRequest = useAcceptWorkRequest();
  const declineRequest = useDeclineWorkRequest();
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  const handleDismiss = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (dismissItem.isPending) return;
    try {
      await dismissItem.mutateAsync({ data: { itemId: card.id } });
      queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
      toast({ title: "Cleared" });
    } catch {
      toast({ title: "Failed to clear", variant: "destructive" });
    }
  };

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
      case "approveRequest": {
        if (!card.entityId) return;
        try {
          const rec = await acceptRequest.mutateAsync({ id: card.entityId, data: {} });
          toast({ title: `Approved — Job ${rec.jobNo ?? ""} created`.trim() });
          queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListWorkRequestsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
          // Next step lives on the job: broadcast, schedule, assign.
          if (rec.jobId) navigate(`/jobs/${rec.jobId}`);
        } catch (err) {
          toast({ title: errMessage(err, "Failed to approve request"), variant: "destructive" });
        }
        return;
      }
      case "declineRequest": {
        setDeclineOpen((v) => !v);
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
      className={`group relative overflow-hidden bg-card shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] rounded-[22px] p-[16px] mb-[12px] transition-all ${isHandled ? 'opacity-60 grayscale-[0.2]' : ''} ${route ? 'cursor-pointer active:scale-[0.98] hover:border-[var(--gold)]' : ''} ${isNow ? 'border-[#FF3B30]' : ''}`}
    >
      <div className="flex gap-[12px] items-start">
        <div className={`w-[10px] h-[10px] rounded-full shrink-0 mt-[6px] ${isNow ? 'bg-[#FF3B30]' : 'bg-[var(--gold-light)]'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-start gap-[8px]">
            <div className="font-display font-bold text-[16px] leading-[1.2] text-[var(--ink)] tracking-[-0.01em] pr-[8px]">
              {card.title}
            </div>
            <div className="flex items-center gap-[6px] shrink-0 mt-[2px]">
              {route && <ChevronRight className="w-[16px] h-[16px] text-muted-foreground/50" />}
              <button
                onClick={handleDismiss}
                disabled={dismissItem.isPending}
                aria-label="Clear"
                data-testid={`button-dismiss-${card.id}`}
                className="w-[26px] h-[26px] -mr-[4px] -mt-[4px] grid place-items-center rounded-full text-muted-foreground/60 hover:text-[var(--ink)] hover:bg-[rgba(0,0,0,0.06)] transition-colors"
              >
                {dismissItem.isPending ? (
                  <Loader2 className="w-[14px] h-[14px] animate-spin" />
                ) : (
                  <X className="w-[14px] h-[14px]" />
                )}
              </button>
            </div>
          </div>
          
          {card.sub && <div className="text-[13.5px] text-muted-foreground mt-[4px] leading-[1.3] pr-[20px]">{card.sub}</div>}
          
          {card.meta && card.meta.length > 0 && (
            <div className="flex flex-wrap gap-[6px] mt-[10px]">
              {card.meta.map((m, i) => (
                <span key={i} className={`text-[11px] rounded-full px-[8px] py-[3px] font-semibold tracking-wide flex items-center ${m.mono ? 'font-mono text-[10px] tracking-[0.04em]' : ''} ${m.warn ? 'text-white bg-[#FF3B30]' : m.gold ? 'text-[var(--ink)] bg-[var(--gold-light)]' : 'text-[var(--ink)] bg-[var(--muted)]/20 border border-[var(--hairline)]'}`}>
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
                  className={`rounded-full px-[14px] py-[8px] text-[13px] font-bold tracking-wide transition-all active:scale-95 disabled:opacity-50 inline-flex items-center justify-center gap-[6px] ${a.kind === 'gold' ? 'bg-[var(--gold-light)] text-[#07101E]' : a.kind === 'ghost' ? 'bg-transparent border border-[var(--hairline)] text-[var(--ink)]' : 'bg-[var(--ink)] text-white'}`}
                >
                  {actionPending && (a.action === "remindInvoice" || a.action === "nudgeBid") && (
                    <Loader2 className="w-[14px] h-[14px] animate-spin" />
                  )}
                  {a.label}
                </button>
              ))}
            </div>
          )}

          {declineOpen && (
            <div className="mt-[10px] flex flex-col gap-[8px]" onClick={(e) => e.stopPropagation()}>
              <textarea
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                rows={2}
                placeholder="Reason the client will see (optional)"
                data-testid={`input-decline-reason-${card.id}`}
                className="w-full rounded-[12px] border border-[var(--hairline)] bg-card px-[12px] py-[8px] text-[13px] outline-none focus:border-[var(--gold)]"
              />
              <div className="flex gap-[8px]">
                <button
                  disabled={declineRequest.isPending}
                  data-testid={`button-confirm-decline-${card.id}`}
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!card.entityId) return;
                    try {
                      await declineRequest.mutateAsync({
                        id: card.entityId,
                        data: { reason: declineReason.trim() || null },
                      });
                      toast({ title: "Request declined" });
                      setDeclineOpen(false);
                      queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
                      queryClient.invalidateQueries({ queryKey: getListWorkRequestsQueryKey() });
                    } catch (err) {
                      toast({ title: errMessage(err, "Failed to decline request"), variant: "destructive" });
                    }
                  }}
                  className="rounded-full px-[14px] py-[8px] text-[13px] font-bold bg-[#FF3B30] text-white active:scale-95 disabled:opacity-50 inline-flex items-center gap-[6px]"
                >
                  {declineRequest.isPending && <Loader2 className="w-[14px] h-[14px] animate-spin" />}
                  Confirm decline
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeclineOpen(false);
                  }}
                  className="rounded-full px-[14px] py-[8px] text-[13px] font-bold border border-[var(--hairline)] text-[var(--ink)]"
                >
                  Keep it
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
