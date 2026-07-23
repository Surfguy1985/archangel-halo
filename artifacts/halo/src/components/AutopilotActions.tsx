import {
  useListAutopilotActions,
  getListAutopilotActionsQueryKey,
  useApproveAutopilotAction,
  useDismissAutopilotAction,
  getGetTodayQueryKey,
  getListActivitiesQueryKey,
  getGetMoneySummaryQueryKey,
  getListJobsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Check, X, Loader2 } from "lucide-react";

export function AutopilotActions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: actions } = useListAutopilotActions({
    query: { queryKey: getListAutopilotActionsQueryKey(), refetchInterval: 15_000 },
  });
  const approve = useApproveAutopilotAction();
  const dismiss = useDismissAutopilotAction();

  const pending = (actions ?? []).filter((a) => a.status === "pending");
  if (pending.length === 0) return null;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListAutopilotActionsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey({ limit: 10 }) });
    queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
  };

  const onApprove = (id: string) => {
    approve.mutate(
      { id },
      {
        onSuccess: (a) => {
          invalidate();
          if (a.status === "executed") {
            toast({ title: "Done", description: a.result ?? "Autopilot handled it." });
          } else {
            toast({ title: "Couldn't complete it", description: a.result ?? "Try again.", variant: "destructive" });
          }
        },
        onError: (e) =>
          toast({ title: "Couldn't complete it", description: e.message, variant: "destructive" }),
      },
    );
  };

  const onDismiss = (id: string) => {
    dismiss.mutate(
      { id },
      {
        onSuccess: () => invalidate(),
        onError: (e) =>
          toast({ title: "Couldn't dismiss", description: e.message, variant: "destructive" }),
      },
    );
  };

  const busy = approve.isPending || dismiss.isPending;

  return (
    <div className="mb-[24px]">
      <div className="flex items-center gap-[8px] mx-[6px] mb-[12px] font-display font-bold text-[13px] tracking-[0.1em] uppercase text-[var(--gold)]">
        <Sparkles className="w-[14px] h-[14px]" />
        Autopilot Suggests
        <span className="min-w-[20px] h-[20px] px-[6px] rounded-[10px] bg-[var(--gold-tint)] text-[var(--gold)] text-[11px] grid place-items-center tracking-normal font-sans">
          {pending.length}
        </span>
      </div>
      {pending.map((a) => (
        <div
          key={a.id}
          className="bg-white rounded-[24px] shadow-[0_4px_14px_rgba(0,0,0,0.04)] border border-[var(--gold)]/25 p-[16px] mb-[12px]"
        >
          <div className="font-display font-bold text-[15px] text-[var(--ink)] mb-[4px]">{a.title}</div>
          <p className="text-[13px] text-muted-foreground leading-[1.5]">{a.body}</p>
          <div className="flex gap-[10px] mt-[14px]">
            <button
              onClick={() => onApprove(a.id)}
              disabled={busy}
              className="flex-1 flex items-center justify-center gap-[6px] rounded-[12px] bg-[var(--gold-light)] text-black font-display font-bold text-[13.5px] py-[11px] transition-transform active:scale-[0.98] disabled:opacity-60"
            >
              {approve.isPending && approve.variables?.id === a.id ? (
                <Loader2 className="w-[15px] h-[15px] animate-spin" />
              ) : (
                <Check className="w-[15px] h-[15px]" strokeWidth={2.5} />
              )}
              Do it
            </button>
            <button
              onClick={() => onDismiss(a.id)}
              disabled={busy}
              className="flex-1 flex items-center justify-center gap-[6px] rounded-[12px] bg-card border border-border text-muted-foreground font-display font-bold text-[13.5px] py-[11px] transition-transform active:scale-[0.98] disabled:opacity-60"
            >
              <X className="w-[15px] h-[15px]" strokeWidth={2.5} />
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
