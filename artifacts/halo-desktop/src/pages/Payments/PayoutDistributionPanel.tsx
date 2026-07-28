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
      <DialogContent className="sm:max-w-[600px] p-0 overflow-hidden border-border shadow-md rounded-none">
        <DialogHeader className="px-6 pt-6 pb-2 bg-[var(--background)] border-b border-border">
          <DialogTitle className="text-xl font-display font-bold text-[var(--secondary)]">Payout Distribution</DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Request #{req.requestNo} • {req.propertyName}
          </p>
        </DialogHeader>

        <div className="p-6 space-y-6 bg-white">
          <div className="flex items-center justify-between p-4 bg-emerald-50 border border-emerald-200 rounded-none">
            <div>
              <div className="text-sm font-bold text-emerald-800 uppercase tracking-wider mb-1">Total Received</div>
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
            <h3 className="font-bold text-[var(--secondary)] flex items-center gap-2 uppercase text-xs tracking-wider">
              <ArrowRight className="w-4 h-4 text-muted-foreground" />
              Route to Crew
            </h3>
            
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full rounded-none" />
                <Skeleton className="h-16 w-full rounded-none" />
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
      <div className="flex items-center justify-between p-3 rounded-none border border-border bg-[var(--background)] opacity-80">
        <div>
          <div className="font-medium text-[var(--secondary)] text-sm">{row.jobLabel}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{row.crewName || "Unknown Crew"}</div>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-bold text-[var(--secondary)]">{money(row.crewRate || 0)}</span>
          <span className="text-xs font-semibold text-emerald-800 bg-emerald-100 px-2 py-1 rounded-full flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Paid
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-none border border-border bg-white shadow-sm gap-3 transition-colors hover:border-[var(--secondary)]">
      <div className="flex-1 min-w-0">
        <div className="font-medium text-[var(--secondary)] text-sm truncate">{row.jobLabel}</div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs font-medium text-muted-foreground">{row.crewName || "Unassigned"}</span>
          {row.crewId && (
            row.bankVerified ? (
              <span className="flex items-center gap-0.5 text-[10px] text-emerald-700 font-bold uppercase tracking-wider">
                <Landmark className="w-3 h-3" /> Ready
              </span>
            ) : (
              <span className="flex items-center gap-0.5 text-[10px] text-amber-700 font-bold uppercase tracking-wider" title="Bank not verified">
                <AlertTriangle className="w-3 h-3" /> Action Req
              </span>
            )
          )}
        </div>
      </div>
      
      <div className="flex items-center gap-2">
        <div className="relative w-24">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
          <Input 
            type="number" 
            value={amount} 
            onChange={(e) => setAmount(e.target.value ? Number(e.target.value) : "")}
            className="pl-6 h-9 rounded-none font-mono text-sm border-border"
          />
        </div>
        <Button 
          onClick={handlePay} 
          disabled={!row.crewId || payCrew.isPending || row.bankVerified === false}
          size="sm"
          className="h-9 rounded-none bg-[var(--primary)] text-[var(--secondary)] font-bold hover:opacity-90 whitespace-nowrap"
        >
          <Send className="w-3.5 h-3.5 mr-1" /> Pay
        </Button>
      </div>
    </div>
  );
}
