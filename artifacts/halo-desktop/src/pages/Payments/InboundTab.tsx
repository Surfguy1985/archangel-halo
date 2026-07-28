import { useState, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPaymentRequests,
  useSendPaymentRequest,
  useReturnPaymentRequest,
  PaymentRequestDetail,
  getListPaymentRequestsQueryKey,
  getGetPayHubOverviewQueryKey,
} from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, XCircle, Send, Link as LinkIcon, ScanLine, Smartphone, Plus, MoreHorizontal, RotateCcw, AlertTriangle, ChevronRight } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { NewPaymentRequestDialog } from "./NewPaymentRequestDialog";
import { PayoutDistributionPanel } from "./PayoutDistributionPanel";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const fmtDate = (s?: string | null) => {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

export function InboundTab() {
  const { data: requests, isLoading } = useListPaymentRequests();
  const [newOpen, setNewOpen] = useState(false);
  const [selectedReq, setSelectedReq] = useState<PaymentRequestDetail | null>(null);
  const [returnReq, setReturnReq] = useState<PaymentRequestDetail | null>(null);
  const [sendReq, setSendReq] = useState<PaymentRequestDetail | null>(null);

  if (isLoading) {
    return <Skeleton className="h-64 w-full rounded-2xl" />;
  }

  const sorted = [...(requests ?? [])].sort((a, b) => 
    new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-display font-bold text-[var(--ink)]">Payment Requests</h2>
        <Button className="rounded-full gap-2 bg-[var(--ink)] text-white hover:bg-[var(--ink2)]" onClick={() => setNewOpen(true)}>
          <Plus className="w-4 h-4" /> Request Payment
        </Button>
      </div>

      {sorted.length === 0 ? (
        <div className="p-12 text-center border border-dashed border-border rounded-2xl bg-white text-muted-foreground">
          No payment requests yet. Create one to get paid.
        </div>
      ) : (
        <div className="grid gap-3">
          {sorted.map((req) => (
            <RequestCard 
              key={req.id} 
              req={req} 
              onClick={() => req.status === "paid" ? setSelectedReq(req) : null} 
              onReturn={() => setReturnReq(req)}
              onSend={() => setSendReq(req)}
            />
          ))}
        </div>
      )}

      {newOpen && <NewPaymentRequestDialog open={newOpen} onOpenChange={setNewOpen} />}
      {selectedReq && <PayoutDistributionPanel req={selectedReq} open={!!selectedReq} onOpenChange={(o) => !o && setSelectedReq(null)} />}
      {returnReq && <ReturnPaymentRequestDialog req={returnReq} open={!!returnReq} onOpenChange={(o) => !o && setReturnReq(null)} />}
      {sendReq && <SendPaymentDialog req={sendReq} open={!!sendReq} onOpenChange={(o) => !o && setSendReq(null)} />}
    </div>
  );
}

function SendPaymentDialog({ req, open, onOpenChange }: { req: PaymentRequestDetail, open: boolean, onOpenChange: (open: boolean) => void }) {
  const [to, setTo] = useState(req.sentTo || "");
  const sendReqApi = useSendPaymentRequest();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleSend = () => {
    if (!to) {
      toast({ title: "Please provide an email or phone number", variant: "destructive" });
      return;
    }
    const isEmail = to.includes("@");
    sendReqApi.mutate(
      { id: req.id, data: { via: isEmail ? "email" : "sms", to } },
      {
        onSuccess: () => {
          toast({ title: "Payment link sent" });
          queryClient.invalidateQueries({ queryKey: getListPaymentRequestsQueryKey() });
          onOpenChange(false);
        },
        onError: (err) => {
          toast({ title: "Failed to send link", description: err.message, variant: "destructive" });
        }
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px] border-none shadow-2xl rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-display font-bold">Send Payment Link</DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div className="space-y-2">
            <Label>Email or Phone Number</Label>
            <Input 
              value={to} 
              onChange={e => setTo(e.target.value)} 
              placeholder="e.g. manager@property.com" 
              className="rounded-xl"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="rounded-full">Cancel</Button>
          <Button onClick={handleSend} disabled={sendReqApi.isPending || !to} className="rounded-full bg-[var(--ink)] text-white hover:bg-[var(--ink2)]">
            Send Link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RequestCard({ req, onClick, onReturn, onSend }: { req: PaymentRequestDetail, onClick: () => void, onReturn: () => void, onSend: () => void }) {
  const { toast } = useToast();

  const copyLink = () => {
    const url = `${window.location.origin}/pay/${req.token}`;
    navigator.clipboard.writeText(url);
    toast({ title: "Link copied", description: "Payment link copied to clipboard." });
  };

  return (
    <Card 
      className={`rounded-2xl border-none shadow-sm overflow-hidden transition-all ${req.status === "paid" ? "cursor-pointer hover:shadow-md ring-1 ring-emerald-500/20" : ""}`}
      onClick={onClick}
    >
      <div className="p-4 flex flex-col sm:flex-row gap-4 justify-between sm:items-center">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-xs text-muted-foreground">{req.requestNo}</span>
            <StatusBadge status={req.status} />
          </div>
          <h3 className="font-display font-semibold text-[var(--ink)] text-base">{req.propertyName}</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            {req.memo || `${req.jobs?.length || 0} job${req.jobs?.length !== 1 ? "s" : ""}`}
          </p>
        </div>

        <div className="flex flex-col sm:items-end justify-center gap-2">
          <div className="font-display font-bold text-xl tabular-nums text-[var(--ink)]">
            {money(req.total)}
          </div>
          
          {req.status === "paid" && (
            <div className="flex items-center gap-2">
              <div className="text-xs text-emerald-600 font-medium flex items-center gap-1 bg-emerald-50 px-2 py-1 rounded-md">
                <CheckCircle2 className="w-3.5 h-3.5" /> Paid {fmtDate(req.paidAt)} via {req.paymentMethod}
                {req.confirmationNo && <span className="opacity-70 ml-1">#{req.confirmationNo}</span>}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-slate-600">
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 rounded-xl">
                  <DropdownMenuItem className="text-red-600 focus:bg-red-50 focus:text-red-700" onClick={(e) => { e.stopPropagation(); onReturn(); }}>
                    <RotateCcw className="w-4 h-4 mr-2" /> Mark Returned
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {req.status === "returned" && (
            <div className="text-xs text-red-600 font-medium flex items-center gap-1 bg-red-50 px-2 py-1 rounded-md">
              <XCircle className="w-3.5 h-3.5" /> Returned: {req.returnReason || "Unknown"}
            </div>
          )}

          {(req.status === "draft" || req.status === "sent") && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-8 rounded-full text-xs" onClick={(e) => { e.stopPropagation(); copyLink(); }}>
                <LinkIcon className="w-3.5 h-3.5 mr-1" /> Copy Link
              </Button>
              <Button size="sm" className="h-8 rounded-full text-xs bg-[var(--gold-dark)] text-white hover:bg-[var(--gold-dark)]/90" onClick={(e) => {
                e.stopPropagation();
                onSend();
              }}>
                <Send className="w-3.5 h-3.5 mr-1" /> Send
              </Button>
            </div>
          )}
        </div>
      </div>
      
      {req.status === "paid" && (
        <div className="bg-[var(--paper)] px-4 py-2 text-xs text-muted-foreground flex items-center justify-between border-t border-border">
          <span>Funds received. Tap to distribute payouts.</span>
          <ChevronRight className="w-4 h-4" />
        </div>
      )}
    </Card>
  );
}

function ReturnPaymentRequestDialog({ req, open, onOpenChange }: { req: PaymentRequestDetail, open: boolean, onOpenChange: (open: boolean) => void }) {
  const [reason, setReason] = useState("");
  const ret = useReturnPaymentRequest();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleReturn = () => {
    ret.mutate({
      id: req.id,
      data: { reason: reason || "Bank returned funds" }
    }, {
      onSuccess: () => {
        toast({ title: "Payment marked returned", variant: "destructive" });
        queryClient.invalidateQueries({ queryKey: getListPaymentRequestsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetPayHubOverviewQueryKey() });
        onOpenChange(false);
      },
      onError: (err) => {
        toast({ title: "Failed", description: err.message, variant: "destructive" });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px] border-none shadow-2xl rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-display font-bold text-red-600 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" /> Return Payment
          </DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <p className="text-sm text-slate-600">
            Marking this request as returned will flag it in the system. The funds ({money(req.total)}) did not settle successfully.
          </p>
          <div className="space-y-2">
            <Label>Return Reason / Code</Label>
            <Input 
              value={reason} 
              onChange={e => setReason(e.target.value)} 
              placeholder="e.g. Insufficient Funds (R01)" 
              className="rounded-xl"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="rounded-full">Cancel</Button>
          <Button onClick={handleReturn} disabled={ret.isPending} className="rounded-full bg-red-600 text-white hover:bg-red-700">
            Confirm Return
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "paid":
      return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 uppercase text-[10px]">Paid</Badge>;
    case "sent":
      return <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 uppercase text-[10px]">Sent</Badge>;
    case "returned":
      return <Badge className="bg-red-100 text-red-700 hover:bg-red-100 uppercase text-[10px]">Returned</Badge>;
    default:
      return <Badge variant="secondary" className="uppercase text-[10px] text-muted-foreground">Draft</Badge>;
  }
}
