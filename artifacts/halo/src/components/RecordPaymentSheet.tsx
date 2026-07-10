import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useRecordPayment,
  getListInvoicesQueryKey,
  getGetMoneySummaryQueryKey,
  type Invoice,
} from "@workspace/api-client-react";

const fieldCls =
  "w-full bg-card border border-border rounded-[13px] py-[11px] px-[14px] text-[14.5px] shadow-[var(--shadow)] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]";

export function RecordPaymentSheet({
  open,
  onOpenChange,
  invoice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: Invoice | null;
}) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("check");
  const record = useRecordPayment();

  useEffect(() => {
    if (invoice) setAmount(String(invoice.amount));
  }, [invoice]);

  const submit = () => {
    const amountNum = parseFloat(amount);
    if (!invoice || isNaN(amountNum)) return;
    record.mutate(
      { data: { invoiceId: invoice.id, amount: amountNum, method: method || undefined } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey() });
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[26px] bg-[var(--paper)] p-0 flex flex-col max-h-[86vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]"
      >
        <div className="w-[40px] h-[4.5px] rounded-[3px] bg-[rgba(23,24,28,0.16)] mx-auto mt-[10px] mb-[4px] shrink-0" />
        <div className="p-[8px_20px_26px] overflow-y-auto">
          <SheetHeader className="text-left mb-[16px]">
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">Record payment</SheetTitle>
            <div className="text-[13px] text-muted-foreground">
              {invoice ? `${invoice.invoiceNo} · ${invoice.propertyName ?? ""}` : ""}
            </div>
          </SheetHeader>
          <div className="flex flex-col gap-[10px]">
            <input className={fieldCls} placeholder="Amount received" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            <select className={fieldCls} value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="check">Check</option>
              <option value="ach">ACH / Transfer</option>
              <option value="card">Card</option>
              <option value="cash">Cash</option>
            </select>
          </div>
          <button
            className="w-full mt-[18px] rounded-[13px] py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_6px_20px_rgba(143,106,31,0.34)] disabled:opacity-50 transition-transform active:scale-[0.98]"
            onClick={submit}
            disabled={!amount.trim() || record.isPending}
          >
            {record.isPending ? "Recording…" : "Record payment"}
          </button>
          {record.isError && (
            <div className="text-[12.5px] text-destructive text-center mt-[10px]">Couldn't record. Try again.</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
