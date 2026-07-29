import {
  useListAutopilotActions,
  getListAutopilotActionsQueryKey,
  useApproveAutopilotAction,
  useDismissAutopilotAction,
  getGetTodayQueryKey,
  getListActivitiesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient} from "@tanstack/react-query";
import { useToast} from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import { Sparkles, Check, X, Loader2} from "lucide-react";

export function AutopilotActions() {
  const queryClient = useQueryClient();
  const { toast} = useToast();
  const { data: actions} = useListAutopilotActions({
    query: { queryKey: getListAutopilotActionsQueryKey(), refetchInterval: 15_000},
 });
  const approve = useApproveAutopilotAction();
  const dismiss = useDismissAutopilotAction();

  const pending = (actions ?? []).filter((a) => a.status === "pending");
  if (pending.length === 0) return null;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListAutopilotActionsQueryKey()});
    queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey()});
    queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey({ limit: 12})});
 };

  const onApprove = (id: string) => {
    approve.mutate(
      { id},
      {
        onSuccess: (a) => {
          invalidate();
          if (a.status === "executed") {
            toast({ title: "Done", description: a.result ?? "Autopilot handled it."});
         } else {
            toast({ title: "Couldn't complete it", description: a.result ?? "Try again.", variant: "destructive"});
         }
       },
        onError: (e) =>
          toast({ title: "Couldn't complete it", description: e.message, variant: "destructive"}),
     },
    );
 };

  const onDismiss = (id: string) => {
    dismiss.mutate(
      { id},
      {
        onSuccess: () => invalidate(),
        onError: (e) =>
          toast({ title: "Couldn't dismiss", description: e.message, variant: "destructive"}),
     },
    );
 };

  const busy = approve.isPending || dismiss.isPending;

  return (
    <Card className="border-none bg-[var(--secondary)] text-white shadow-sm rounded-3xl">
      <CardHeader className="pb-3 border-b border-white/10">
        <CardTitle className="text-base font-display font-bold flex items-center gap-2 text-[var(--primary)]">
          <Sparkles className="w-4 h-4" /> Autopilot suggests
          <span className="ml-auto text-xs font-sans font-bold px-3 py-1 rounded-full bg-[var(--primary)] text-black">
            {pending.length}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {pending.map((a) => (
          <div key={a.id} className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="font-bold text-white text-base mb-1">{a.title}</div>
            <p className="text-sm text-white/70 leading-relaxed mb-4">{a.body}</p>
            <div className="flex gap-3 mt-3">
              <button
                onClick={() => onApprove(a.id)}
                disabled={busy}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--primary)] text-black text-sm font-bold py-2.5 hover:opacity-90 transition-opacity disabled:opacity-60"
                data-testid={`button-approve-${a.id}`}
              >
                {approve.isPending && approve.variables?.id === a.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" strokeWidth={2.5} />
                )}
                Do it
              </button>
              <button
                onClick={() => onDismiss(a.id)}
                disabled={busy}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/20 bg-transparent text-white/70 text-sm font-bold py-2.5 hover:bg-white/10 transition-colors disabled:opacity-60"
                data-testid={`button-dismiss-${a.id}`}
              >
                <X className="w-4 h-4" strokeWidth={2.5} />
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
