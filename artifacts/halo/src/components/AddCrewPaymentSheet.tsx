import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateCrewPayment,
  useListCrews,
  getListCrewPaymentsQueryKey,
} from "@workspace/api-client-react";

const fieldCls =
  "w-full bg-card border border-border rounded-[13px] py-[11px] px-[14px] text-[14.5px] shadow-[var(--shadow)] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]";

const METHODS = ["Direct deposit (ACH)", "Check", "Zelle", "Venmo", "Cash App", "PayPal", "Cash"];

export function AddCrewPaymentSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data: crews } = useListCrews();
  const [crewId, setCrewId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [status, setStatus] = useState("pending");
  const [note, setNote] = useState("");
  const create = useCreateCrewPayment();

  const reset = () => {
    setCrewId("");
    setAmount("");
    setMethod("");
    setStatus("pending");
    setNote("");
  };

  const submit = () => {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || !crewId) return;
    create.mutate(
      {
        data: {
          crewId,
          amount: amountNum,
          method: method || undefined,
          status,
          note: note.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCrewPaymentsQueryKey() });
          reset();
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
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">
              Record crew payment
            </SheetTitle>
            <div className="text-[13px] text-muted-foreground">
              Track what each crew is owed and what's been paid.
            </div>
          </SheetHeader>
          <div className="flex flex-col gap-[10px]">
            <select
              className={fieldCls}
              value={crewId}
              onChange={(e) => setCrewId(e.target.value)}
            >
              <option value="">Select crew</option>
              {crews?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              className={fieldCls}
              placeholder="Amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <select
              className={fieldCls}
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              <option value="">Payment method (optional)</option>
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <div className="flex gap-[8px]">
              <button
                onClick={() => setStatus("pending")}
                className={`flex-1 rounded-[13px] py-[11px] text-[14px] font-display font-bold border transition-colors ${
                  status === "pending"
                    ? "bg-[var(--ink)] text-white border-[var(--ink)]"
                    : "bg-card border-border text-muted-foreground"
                }`}
              >
                Pending
              </button>
              <button
                onClick={() => setStatus("completed")}
                className={`flex-1 rounded-[13px] py-[11px] text-[14px] font-display font-bold border transition-colors ${
                  status === "completed"
                    ? "bg-[var(--ink)] text-white border-[var(--ink)]"
                    : "bg-card border-border text-muted-foreground"
                }`}
              >
                Completed
              </button>
            </div>
            <input
              className={fieldCls}
              placeholder="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <button
            className="w-full mt-[18px] rounded-[13px] py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_6px_20px_rgba(180,255,68,0.35)] disabled:opacity-50 transition-transform active:scale-[0.98]"
            onClick={submit}
            disabled={!amount.trim() || !crewId || create.isPending}
          >
            {create.isPending ? "Saving…" : "Record payment"}
          </button>
          {create.isError && (
            <div className="text-[12.5px] text-destructive text-center mt-[10px]">
              Couldn't save. Try again.
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
