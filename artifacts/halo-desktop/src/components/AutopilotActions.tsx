import {
  useListAutopilotActions,
  getListAutopilotActionsQueryKey,
  useApproveAutopilotAction,
  useDismissAutopilotAction,
  getGetTodayQueryKey,
  getListActivitiesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey({ limit: 12 }) });
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
    <Card className="border-[var(--gold)]/30 bg-[var(--gold-tint)]/40 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-display flex items-center gap-2 text-[var(--gold-dark)]">
          <Sparkles className="w-4 h-4" /> Autopilot Suggests
          <span className="ml-auto text-xs font-sans font-semibold px-2 py-0.5 rounded-full bg-[var(--gold)]/15 text-[var(--gold-dark)]">
            {pending.length}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {pending.map((a) => (
          <div key={a.id} className="rounded-lg border border-[var(--gold)]/20 bg-card p-4">
            <div className="font-semibold text-[var(--ink)] text-sm mb-1">{a.title}</div>
            <p className="text-xs text-muted-foreground leading-relaxed">{a.body}</p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => onApprove(a.id)}
                disabled={busy}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-[var(--gold)] text-white text-xs font-bold py-2 hover:opacity-90 transition-opacity disabled:opacity-60"
                data-testid={`button-approve-${a.id}`}
              >
                {approve.isPending && approve.variables?.id === a.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                )}
                Do it
              </button>
              <button
                onClick={() => onDismiss(a.id)}
                disabled={busy}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-card text-muted-foreground text-xs font-bold py-2 hover:bg-muted transition-colors disabled:opacity-60"
                data-testid={`button-dismiss-${a.id}`}
              >
                <X className="w-3.5 h-3.5" strokeWidth={2.5} />
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
