import { useState} from "react";
import { useQueryClient} from "@tanstack/react-query";
import {
  useGetPayoutDistribution,
  useCreateCrewPayout,
  PaymentRequestDetail,
  getGetPayoutDistributionQueryKey,
  getGetPayHubOverviewQueryKey,
  getListCrewPayoutsQueryKey,
  getListPaymentRequestsQueryKey,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button} from "@/components/ui/button";
import { Input} from "@/components/ui/input";
import { Skeleton} from "@/components/ui/skeleton";
import { useToast} from "@/hooks/use-toast";
import { CheckCircle2, ArrowRight, Landmark, AlertTriangle, Send} from "lucide-react";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2});

export function PayoutDistributionPanel({ req, open, onOpenChange}: { req: PaymentRequestDetail, open: boolean, onOpenChange: (open: boolean) => void}) {
  const { data: dist, isLoading} = useGetPayoutDistribution(req.id, { query: { enabled: open, queryKey: getGetPayoutDistributionQueryKey(req.id)}});
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] p-0 overflow-hidden border-none shadow-xl rounded-3xl bg-[var(--background)]">
        <DialogHeader className="px-6 pt-6 pb-2 border-b border-border bg-white">
          <DialogTitle className="text-2xl font-display font-bold text-foreground">Payout distribution</DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Request #{req.requestNo} • {req.propertyName}
          </p>
        </DialogHeader>

        <div className="p-6 space-y-6 bg-white">
          <div className="flex items-center justify-between p-5 bg-emerald-50 border border-emerald-200 rounded-2xl">
            <div>
              <div className="text-sm font-bold text-emerald-800 mb-1">Total received</div>
              <div className="text-3xl font-display font-bold text-emerald-900">{money(req.paidAmount || req.total)}</div>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-1.5 justify-end text-emerald-700 font-bold">
                <CheckCircle2 className="w-5 h-5" /> Settled
              </div>
              <div className="text-xs text-emerald-600/80 mt-1 font-mono">{req.confirmationNo}</div>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="font-bold text-foreground flex items-center gap-2 text-sm">
              <ArrowRight className="w-4 h-4 text-muted-foreground" />
              Route to crew
            </h3>
            
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full rounded-xl" />
                <Skeleton className="h-16 w-full rounded-xl" />
              </div>
            ) : (
              <div className="space-y-3">
                {dist?.rows.map((row, idx) => (
                  <PayoutRow key={`${row.jobId}-${row.crewId || idx}`} row={row} requestId={req.id} />
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PayoutRow({ row, requestId}: { row: any, requestId: string}) {
  const [amount, setAmount] = useState<number | "">(row.crewRate || 0);
  const payCrew = useCreateCrewPayout();
  const { toast} = useToast();
  const queryClient = useQueryClient();

  const handlePay = () => {
    if (!row.crewId) {
      toast({ title: "No crew assigned", variant: "destructive"});
      return;
   }
    if (typeof amount !== "number" || amount <= 0) {
      toast({ title: "Enter a valid payout amount", variant: "destructive"});
      return;
   }
    
    payCrew.mutate({
      data: {
        crewId: row.crewId,
        jobId: row.jobId,
        amount,
        paymentRequestId: requestId,
     }
   }, {
      onSuccess: () => {
        toast({ title:`Payout sent to ${row.crewName}`});
        queryClient.invalidateQueries({ queryKey: getGetPayoutDistributionQueryKey(requestId)});
        queryClient.invalidateQueries({ queryKey: getListCrewPayoutsQueryKey()});
        queryClient.invalidateQueries({ queryKey: getGetPayHubOverviewQueryKey()});
        queryClient.invalidateQueries({ queryKey: getListPaymentRequestsQueryKey()});
     },
      onError: (err) => {
        // Handle 409 bank not verified
        toast({ title: "Payout failed", description: err.message, variant: "destructive"});
     }
   });
 };

  if (row.crewPaid) {
    return (
      <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-[var(--background)] opacity-80">
        <div>
          <div className="font-medium text-foreground text-sm">{row.jobLabel}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{row.crewName || "Unknown crew"}</div>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-bold text-foreground">{money(row.crewRate || 0)}</span>
          <span className="text-xs font-semibold text-emerald-800 bg-emerald-100 px-3 py-1 rounded-full flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Paid
          </span>
        </div>
      </div>
    );
 }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border border-border bg-white shadow-sm gap-3 transition-colors hover:border-[var(--primary)]">
      <div className="flex-1 min-w-0">
        <div className="font-medium text-foreground text-sm truncate">{row.jobLabel}</div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs font-medium text-muted-foreground">{row.crewName || "Unassigned"}</span>
          {row.crewId && (
            row.bankVerified ? (
              <span className="flex items-center gap-0.5 text-[10px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-full">
                <Landmark className="w-3 h-3" /> Ready
              </span>
            ) : (
              <span className="flex items-center gap-0.5 text-[10px] text-amber-700 font-bold bg-amber-50 px-2 py-0.5 rounded-full" title="Bank not verified">
                <AlertTriangle className="w-3 h-3" /> Action req
              </span>
            )
          )}
        </div>
      </div>
      
      <div className="flex items-center gap-2">
        <div className="relative w-28">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
          <Input 
            type="number" 
            value={amount} 
            onChange={(e) => setAmount(e.target.value ? Number(e.target.value) : "")}
            className="pl-7 h-10 rounded-xl font-mono text-sm border-border bg-[var(--background)]"
          />
        </div>
        <Button 
          onClick={handlePay} 
          disabled={!row.crewId || payCrew.isPending || row.bankVerified === false}
          size="sm"
          className="h-10 rounded-full bg-[var(--primary)] text-black font-bold hover:opacity-90 px-5 whitespace-nowrap"
        >
          <Send className="w-3.5 h-3.5 mr-1.5" /> Pay
        </Button>
      </div>
    </div>
  );
}
