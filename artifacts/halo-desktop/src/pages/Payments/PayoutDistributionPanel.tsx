import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, ArrowRight, Landmark, AlertTriangle, Send } from "lucide-react";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export function PayoutDistributionPanel({ req, open, onOpenChange }: { req: PaymentRequestDetail, open: boolean, onOpenChange: (open: boolean) => void }) {
  const { data: dist, isLoading } = useGetPayoutDistribution(req.id, { query: { enabled: open, queryKey: getGetPayoutDistributionQueryKey(req.id) } });
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] p-0 overflow-hidden border-none shadow-2xl rounded-3xl">
        <DialogHeader className="px-6 pt-6 pb-2 bg-slate-50 border-b border-slate-100">
          <DialogTitle className="text-xl font-display font-bold">Payout Distribution</DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Request #{req.requestNo} • {req.propertyName}
          </p>
        </DialogHeader>

        <div className="p-6 space-y-6 bg-white">
          <div className="flex items-center justify-between p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
            <div>
              <div className="text-sm font-semibold text-emerald-700 uppercase tracking-wider mb-1">Total Received</div>
              <div className="text-3xl font-display font-bold text-emerald-900">{money(req.paidAmount || req.total)}</div>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-1.5 justify-end text-emerald-600 font-medium">
                <CheckCircle2 className="w-5 h-5" /> Settled
              </div>
              <div className="text-xs text-emerald-600/80 mt-1 font-mono">{req.confirmationNo}</div>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="font-semibold text-[var(--ink)] flex items-center gap-2">
              <ArrowRight className="w-4 h-4 text-muted-foreground" />
              Route to Crew
            </h3>
            
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full rounded-xl" />
                <Skeleton className="h-16 w-full rounded-xl" />
              </div>
            ) : (
              <div className="space-y-3">
                {dist?.rows.map((row) => (
                  <PayoutRow key={row.jobId} row={row} requestId={req.id} />
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PayoutRow({ row, requestId }: { row: any, requestId: string }) {
  const [amount, setAmount] = useState<number | "">(row.crewRate || 0);
  const payCrew = useCreateCrewPayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handlePay = () => {
    if (!row.crewId) {
      toast({ title: "No crew assigned", variant: "destructive" });
      return;
    }
    if (typeof amount !== "number" || amount <= 0) {
      toast({ title: "Enter a valid payout amount", variant: "destructive" });
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
        toast({ title: `Payout sent to ${row.crewName}` });
        queryClient.invalidateQueries({ queryKey: getGetPayoutDistributionQueryKey(requestId) });
        queryClient.invalidateQueries({ queryKey: getListCrewPayoutsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetPayHubOverviewQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListPaymentRequestsQueryKey() });
      },
      onError: (err) => {
        // Handle 409 bank not verified
        toast({ title: "Payout failed", description: err.message, variant: "destructive" });
      }
    });
  };

  if (row.crewPaid) {
    return (
      <div className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50 opacity-80">
        <div>
          <div className="font-medium text-slate-800 text-sm">{row.jobLabel}</div>
          <div className="text-xs text-slate-500 mt-0.5">{row.crewName || "Unknown Crew"}</div>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-bold text-slate-700">{money(row.crewRate || 0)}</span>
          <span className="text-xs font-semibold text-emerald-600 bg-emerald-100 px-2 py-1 rounded-md flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Paid
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-xl border border-slate-200 bg-white shadow-sm gap-3 transition-colors hover:border-slate-300">
      <div className="flex-1 min-w-0">
        <div className="font-medium text-[var(--ink)] text-sm truncate">{row.jobLabel}</div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs font-medium text-slate-600">{row.crewName || "Unassigned"}</span>
          {row.crewId && (
            row.bankVerified ? (
              <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 font-medium">
                <Landmark className="w-3 h-3" /> Ready
              </span>
            ) : (
              <span className="flex items-center gap-0.5 text-[10px] text-amber-600 font-medium" title="Bank not verified">
                <AlertTriangle className="w-3 h-3" /> Action Req
              </span>
            )
          )}
        </div>
      </div>
      
      <div className="flex items-center gap-2">
        <div className="relative w-24">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
          <Input 
            type="number" 
            value={amount} 
            onChange={(e) => setAmount(e.target.value ? Number(e.target.value) : "")}
            className="pl-6 h-9 rounded-lg font-mono text-sm"
          />
        </div>
        <Button 
          onClick={handlePay} 
          disabled={!row.crewId || payCrew.isPending || row.bankVerified === false}
          size="sm"
          className="h-9 rounded-lg bg-[var(--ink)] text-white hover:bg-[var(--ink2)] whitespace-nowrap"
        >
          <Send className="w-3.5 h-3.5 mr-1" /> Pay
        </Button>
      </div>
    </div>
  );
}
