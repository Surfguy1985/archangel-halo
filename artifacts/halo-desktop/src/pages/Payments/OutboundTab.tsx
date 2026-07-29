import { useState} from "react";
import { useQueryClient} from "@tanstack/react-query";
import {
  useListCrewPayouts,
  useReturnCrewPayout,
  CrewPayoutView,
  getListCrewPayoutsQueryKey,
  getGetPayHubOverviewQueryKey,
} from "@workspace/api-client-react";
import { Card} from "@/components/ui/card";
import { Button} from "@/components/ui/button";
import { Skeleton} from "@/components/ui/skeleton";
import { Badge} from "@/components/ui/badge";
import { useToast} from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label} from "@/components/ui/label";
import { Input} from "@/components/ui/input";
import { CheckCircle2, XCircle, RotateCcw, AlertTriangle} from "lucide-react";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2});

const fmtDate = (s?: string | null) => {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit"});
};

export function OutboundTab() {
  const { data: payouts, isLoading} = useListCrewPayouts();
  const [returnPayout, setReturnPayout] = useState<CrewPayoutView | null>(null);

  if (isLoading) {
    return <Skeleton className="h-64 w-full rounded-none bg-muted" />;
 }

  const sorted = [...(payouts ?? [])].sort((a, b) => 
    new Date(b.paidAt || 0).getTime() - new Date(a.paidAt || 0).getTime()
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-display font-bold text-[var(--secondary)]">Crew Payouts</h2>
      </div>

      {sorted.length === 0 ? (
        <div className="p-12 text-center border border-dashed border-border rounded-none bg-white text-muted-foreground">
          No crew payouts recorded.
        </div>
      ) : (
        <div className="bg-white rounded-none border border-border shadow-sm divide-y divide-border overflow-hidden">
          {sorted.map((p) => (
            <PayoutRow key={p.id} p={p} onReturn={() => setReturnPayout(p)} />
          ))}
        </div>
      )}

      {returnPayout && (
        <ReturnPayoutDialog payout={returnPayout} open={!!returnPayout} onOpenChange={(o) => !o && setReturnPayout(null)} />
      )}
    </div>
  );
}

function PayoutRow({ p, onReturn}: { p: CrewPayoutView, onReturn: () => void}) {
  return (
    <div className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${p.status === "returned" ? "bg-red-50" : "hover:bg-[var(--background)]"}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="font-semibold text-[var(--secondary)]">{p.crewName}</h3>
          {p.status === "returned" ? (
            <Badge className="bg-red-100 text-red-800 border-none hover:bg-red-100 text-[10px] rounded-full shadow-none">Returned</Badge>
          ) : (
            <Badge className="bg-emerald-100 text-emerald-800 border-none hover:bg-emerald-100 text-[10px] rounded-full shadow-none">Settled</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground truncate">{p.jobLabel}</p>
        <p className="text-xs text-muted-foreground mt-1 font-mono">
          Ref: {p.confirmationNo} • {p.method}
        </p>
      </div>

      <div className="flex flex-col sm:items-end gap-1 shrink-0">
        <div className={`font-display font-bold text-lg tabular-nums ${p.status === "returned" ? "text-red-700 line-through opacity-70" : "text-[var(--secondary)]"}`}>
          {money(p.amount)}
        </div>
        
        {p.status === "paid" ? (
          <div className="flex items-center justify-end gap-3 mt-1">
            <span className="text-xs text-muted-foreground">{fmtDate(p.paidAt)}</span>
            <Button size="sm" variant="ghost" className="h-6 text-xs text-muted-foreground hover:text-red-600 px-2 rounded-none" onClick={onReturn}>
              <RotateCcw className="w-3 h-3 mr-1" /> Mark Returned
            </Button>
          </div>
        ) : (
          <div className="text-xs text-red-700 font-medium flex items-center justify-end gap-1 mt-1">
            <XCircle className="w-3.5 h-3.5" /> {p.returnReason || "Returned"} on {fmtDate(p.returnedAt)}
          </div>
        )}
      </div>
    </div>
  );
}

function ReturnPayoutDialog({ payout, open, onOpenChange}: { payout: CrewPayoutView, open: boolean, onOpenChange: (open: boolean) => void}) {
  const [reason, setReason] = useState("");
  const ret = useReturnCrewPayout();
  const { toast} = useToast();
  const queryClient = useQueryClient();

  const handleReturn = () => {
    ret.mutate({
      id: payout.id,
      data: { reason: reason || "Bank returned funds"}
   }, {
      onSuccess: () => {
        toast({ title: "Payout marked returned", variant: "destructive"});
        queryClient.invalidateQueries({ queryKey: getListCrewPayoutsQueryKey()});
        queryClient.invalidateQueries({ queryKey: getGetPayHubOverviewQueryKey()});
        onOpenChange(false);
     },
      onError: (err) => {
        toast({ title: "Failed", description: err.message, variant: "destructive"});
     }
   });
 };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px] border-none shadow-xl rounded-3xl bg-[var(--background)]">
        <DialogHeader>
          <DialogTitle className="text-2xl font-display font-bold text-red-600 flex items-center gap-2">
            <AlertTriangle className="w-6 h-6" /> Return payout
          </DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <p className="text-sm text-foreground">
            Marking this payout as returned will flag it in the system. The funds ({money(payout.amount)}) did not reach <strong>{payout.crewName}</strong>.
          </p>
          <div className="space-y-2">
            <Label className="text-muted-foreground">Return reason / code</Label>
            <Input 
              value={reason} 
              onChange={e => setReason(e.target.value)} 
              placeholder="e.g. Invalid account number (R03)" 
              className="rounded-xl border-border bg-white focus-visible:ring-red-600 h-12"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="rounded-full font-medium px-6 hover:bg-black/5 text-foreground">Cancel</Button>
          <Button onClick={handleReturn} disabled={ret.isPending} className="rounded-full bg-red-600 text-white font-bold hover:bg-red-700 px-6">
            Confirm return
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

