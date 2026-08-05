import { useState} from "react";
import { useQueryClient} from "@tanstack/react-query";
import {
  useListCrewPayouts,
  useReturnCrewPayout,
  useGetPayoutQueue,
  useCreateCrewPayoutBatch,
  CrewPayoutView,
  PayoutQueueCrew,
  getListCrewPayoutsQueryKey,
  getGetPayHubOverviewQueryKey,
  getGetPayoutQueueQueryKey,
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
import { CheckCircle2, XCircle, RotateCcw, AlertTriangle, Banknote, Landmark} from "lucide-react";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2});

const fmtDate = (s?: string | null) => {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit"});
};

export function OutboundTab() {
  const { data: payouts, isLoading} = useListCrewPayouts();
  const { data: queue, isLoading: queueLoading} = useGetPayoutQueue();
  const [returnPayout, setReturnPayout] = useState<CrewPayoutView | null>(null);
  const [payOpen, setPayOpen] = useState(false);

  if (isLoading || queueLoading) {
    return <Skeleton className="h-64 w-full rounded-none bg-muted" />;
 }

  const sorted = [...(payouts ?? [])].sort((a, b) => 
    new Date(b.paidAt || 0).getTime() - new Date(a.paidAt || 0).getTime()
  );

  const readyCrews = queue ?? [];

  return (
    <div className="space-y-4">
      {/* Ready to pay — crews whose completed jobs landed here automatically */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-display font-bold text-[var(--secondary)]">Ready to Pay</h2>
        <Button
          onClick={() => setPayOpen(true)}
          disabled={readyCrews.length === 0}
          className="rounded-none bg-[var(--secondary)] text-white font-bold text-xs px-6 hover:opacity-90"
          data-testid="button-pay-crews"
        >
          <Banknote className="w-4 h-4 mr-2" /> Pay Crews
        </Button>
      </div>

      {readyCrews.length === 0 ? (
        <div className="p-8 text-center border border-dashed border-border rounded-none bg-white text-muted-foreground text-sm">
          No crews awaiting payout. Crews land here automatically once their jobs are verified complete.
        </div>
      ) : (
        <div className="bg-white rounded-none border border-border shadow-sm divide-y divide-border overflow-hidden">
          {readyCrews.map((c) => (
            <div key={c.crewId} className="p-4 flex items-center justify-between gap-4" data-testid={`row-queue-${c.crewId}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-[var(--secondary)]">{c.crewName}</h3>
                  {c.bankVerified ? (
                    <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-100 rounded-full px-2 py-0.5">
                      <CheckCircle2 className="w-3 h-3" /> Bank verified
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-100 rounded-full px-2 py-0.5">
                      <Landmark className="w-3 h-3" /> No verified bank
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground truncate mt-0.5">
                  {c.jobs.length} completed job{c.jobs.length !== 1 ? "s" : ""} — {c.jobs.map((j) => j.jobLabel).join(", ")}
                </p>
              </div>
              <div className="font-display font-bold text-lg tabular-nums text-[var(--secondary)] shrink-0">
                {c.suggestedAmount > 0 ? money(c.suggestedAmount) : "—"}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <h2 className="text-lg font-display font-bold text-[var(--secondary)]">Payout History</h2>
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
      {payOpen && (
        <PayCrewsDialog crews={readyCrews} open={payOpen} onOpenChange={setPayOpen} />
      )}
    </div>
  );
}

function PayCrewsDialog({ crews, open, onOpenChange}: { crews: PayoutQueueCrew[], open: boolean, onOpenChange: (open: boolean) => void}) {
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(crews.map((c) => [c.crewId, c.suggestedAmount > 0 ? c.suggestedAmount.toFixed(2) : ""]))
  );
  // Manual amounts for crews without a verified bank, keyed "crewId|jobId".
  const [manualAmounts, setManualAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      crews
        .filter((c) => !c.bankVerified)
        .flatMap((c) => c.jobs.map((j) => [`${c.crewId}|${j.jobId}`, j.suggestedAmount > 0 ? j.suggestedAmount.toFixed(2) : ""]))
    )
  );
  const batch = useCreateCrewPayoutBatch();
  const { toast} = useToast();
  const queryClient = useQueryClient();

  const achItems = crews
    .filter((c) => c.bankVerified)
    .map((c) => ({ crewId: c.crewId, amount: parseFloat(amounts[c.crewId] || "0")}))
    .filter((i) => i.amount > 0);
  const manualItems = crews
    .filter((c) => !c.bankVerified)
    .flatMap((c) =>
      c.jobs.map((j) => ({
        crewId: c.crewId,
        jobId: j.jobId,
        method: "manual" as const,
        amount: parseFloat(manualAmounts[`${c.crewId}|${j.jobId}`] || "0"),
      }))
    )
    .filter((i) => i.amount > 0);
  const items = [...achItems, ...manualItems];
  const total = items.reduce((s, i) => s + i.amount, 0);

  const handlePay = () => {
    batch.mutate({ data: { items}}, {
      onSuccess: (rows) => {
        const parts = [];
        if (achItems.length) parts.push(`${achItems.length} ACH payout${achItems.length !== 1 ? "s" : ""}`);
        if (manualItems.length) parts.push(`${manualItems.length} manual payment${manualItems.length !== 1 ? "s" : ""} logged`);
        toast({ title: "Payouts recorded", description: `${parts.join(" + ")} totaling ${money(total)}. (${rows.length} total)`});
        queryClient.invalidateQueries({ queryKey: getListCrewPayoutsQueryKey()});
        queryClient.invalidateQueries({ queryKey: getGetPayoutQueueQueryKey()});
        queryClient.invalidateQueries({ queryKey: getGetPayHubOverviewQueryKey()});
        onOpenChange(false);
     },
      onError: (err) => {
        toast({ title: "Payout failed", description: err.message, variant: "destructive"});
     },
   });
 };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] border-none shadow-xl rounded-3xl bg-[var(--background)]">
        <DialogHeader>
          <DialogTitle className="text-2xl font-display font-bold text-[var(--secondary)] flex items-center gap-2">
            <Banknote className="w-6 h-6" /> Pay crews
          </DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-3 max-h-[50vh] overflow-y-auto">
          {crews.map((c) => c.bankVerified ? (
            <div key={c.crewId} className="flex items-center gap-3 bg-white border border-border p-3" data-testid={`row-pay-${c.crewId}`}>
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" aria-label="Verified bank account" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[var(--secondary)] text-sm">{c.crewName}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {c.jobs.length} job{c.jobs.length !== 1 ? "s" : ""}: {c.jobs.map((j) => j.jobLabel).join(", ")}
                </div>
              </div>
              <div className="relative shrink-0 w-28">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input
                  value={amounts[c.crewId] ?? ""}
                  onChange={(e) => setAmounts((a) => ({ ...a, [c.crewId]: e.target.value}))}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="pl-6 h-10 rounded-none border-border text-right tabular-nums"
                  data-testid={`input-amount-${c.crewId}`}
                />
              </div>
            </div>
          ) : (
            <div key={c.crewId} className="bg-white border border-border p-3 space-y-2" data-testid={`row-pay-${c.crewId}`}>
              <div className="flex items-center gap-3">
                <Landmark className="w-5 h-5 text-amber-500 shrink-0" aria-label="No verified bank account" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[var(--secondary)] text-sm">{c.crewName}</div>
                  <div className="text-xs text-amber-700">
                    No verified bank — log a manual payment (cash, check, or other) per job instead
                  </div>
                </div>
              </div>
              {c.jobs.map((j) => (
                <div key={j.jobId} className="flex items-center gap-3 pl-8" data-testid={`row-manual-${c.crewId}-${j.jobId}`}>
                  <div className="flex-1 min-w-0 text-xs text-muted-foreground truncate">{j.jobLabel}</div>
                  <div className="relative shrink-0 w-28">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input
                      value={manualAmounts[`${c.crewId}|${j.jobId}`] ?? ""}
                      onChange={(e) => setManualAmounts((a) => ({ ...a, [`${c.crewId}|${j.jobId}`]: e.target.value}))}
                      inputMode="decimal"
                      placeholder="0.00"
                      className="pl-6 h-10 rounded-none border-border text-right tabular-nums"
                      data-testid={`input-manual-${c.crewId}-${j.jobId}`}
                    />
                  </div>
                </div>
              ))}
            </div>
          ))}
          {manualItems.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Manual payments are logged against the job for the books — no money moves through the app.
            </p>
          )}
        </div>
        <DialogFooter className="items-center gap-3 sm:justify-between">
          <div className="text-sm font-bold text-[var(--secondary)]">
            Total: <span className="font-display text-lg">{money(total)}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="rounded-full font-medium px-6 hover:bg-black/5 text-foreground">Cancel</Button>
            <Button
              onClick={handlePay}
              disabled={batch.isPending || items.length === 0}
              className="rounded-full bg-[var(--secondary)] text-white font-bold hover:opacity-90 px-6"
              data-testid="button-send-payouts"
            >
              {batch.isPending ? "Sending…" : `Send ${items.length} payout${items.length !== 1 ? "s" : ""}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

