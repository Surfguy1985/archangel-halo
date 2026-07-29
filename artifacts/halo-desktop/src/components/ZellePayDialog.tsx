import { useState} from "react";
import { useQueryClient} from "@tanstack/react-query";
import {
  useListCrews,
  useUpdateCrewPayment,
  getListCrewPaymentsQueryKey,
  getGetMoneySummaryQueryKey,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button} from "@/components/ui/button";
import { Copy, Check, Smartphone} from "lucide-react";
import { useToast} from "@/hooks/use-toast";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD"});

function todayLocal() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function CopyRow({ label, value}: { label: string; value: string}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
   } catch {
      // clipboard unavailable — value stays visible for manual copy
   }
 };
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
      <div className="flex-1 min-w-0">
        <div className="text-[11px] text-muted-foreground font-semibold">
          {label}
        </div>
        <div className="font-mono text-sm text-[var(--ink)] truncate">{value}</div>
      </div>
      <Button variant="ghost" size="sm" onClick={copy} className="shrink-0">
        {copied ? <Check className="w-4 h-4 text-[#3c7a4e]" /> : <Copy className="w-4 h-4" />}
      </Button>
    </div>
  );
}

export function ZellePayDialog({
  open,
  onOpenChange,
  payment,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: {
    id: string;
    crewId?: string | null;
    crewName?: string | null;
    amount: number;
    note?: string | null;
 } | null;
}) {
  const queryClient = useQueryClient();
  const { toast} = useToast();
  const { data: crews} = useListCrews();
  const markPaid = useUpdateCrewPayment();

  const crew = payment?.crewId ? crews?.find((c) => c.id === payment.crewId) : undefined;
  const method = (crew?.preferredPaymentMethod || "").toLowerCase();
  const zelleDetails = crew?.paymentDetails || null;
  const fallbackPhone = crew?.phone || null;
  const memo = payment?.note ||`Crew payout — ${payment?.crewName || crew?.name || "crew"}`;

  const confirmSent = () => {
    if (!payment) return;
    markPaid.mutate(
      {
        id: payment.id,
        data: { status: "completed", method: "zelle", paidAt: todayLocal()},
     },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCrewPaymentsQueryKey()});
          queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey()});
          toast({ title: "Payment logged", description: "Marked as paid via Zelle."});
          onOpenChange(false);
       },
        onError: () =>
          toast({
            title: "Couldn't log payment",
            description: "The payment was not marked as paid. Try again.",
            variant: "destructive",
         }),
     },
    );
 };

  if (!payment) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md border-none shadow-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="w-5 h-5" /> Pay via Zelle
          </DialogTitle>
          <DialogDescription>
            Send this from your banking app, then log it here. Zelle doesn't allow apps to send
            money on your behalf.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5">
          <CopyRow
            label={`Zelle recipient — ${payment.crewName || crew?.name || "crew"}`}
            value={
              zelleDetails ||
              fallbackPhone ||
              "No Zelle details on file — check with the crew member"
           }
          />
          {crew?.preferredPaymentMethod && method !== "zelle" && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              Heads up: this crew member's preferred method is{" "}
              <span className="font-semibold">{crew.preferredPaymentMethod}</span>, not Zelle.
            </p>
          )}
          <CopyRow label="Amount" value={money(payment.amount)} />
          <CopyRow label="Memo" value={memo} />
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={confirmSent} disabled={markPaid.isPending}>
            <Check className="w-4 h-4 mr-1.5" />
            {markPaid.isPending ? "Logging…" : "I sent it — mark paid"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
