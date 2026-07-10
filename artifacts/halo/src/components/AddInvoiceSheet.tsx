import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateInvoice,
  useListProperties,
  useListJobs,
  getListInvoicesQueryKey,
  getGetMoneySummaryQueryKey,
} from "@workspace/api-client-react";

const fieldCls =
  "w-full bg-card border border-border rounded-[13px] py-[11px] px-[14px] text-[14.5px] shadow-[var(--shadow)] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]";

export function AddInvoiceSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data: properties } = useListProperties();
  const [propertyId, setPropertyId] = useState("");
  const { data: jobs } = useListJobs(propertyId ? { propertyId } : undefined);
  const [jobId, setJobId] = useState("");
  const [amount, setAmount] = useState("");
  const [dueInDays, setDueInDays] = useState("30");
  const create = useCreateInvoice();

  const reset = () => {
    setPropertyId("");
    setJobId("");
    setAmount("");
    setDueInDays("30");
  };

  const submit = () => {
    const amountNum = parseFloat(amount);
    if (!propertyId || isNaN(amountNum)) return;
    const days = parseInt(dueInDays, 10);
    create.mutate(
      {
        data: {
          propertyId,
          jobId: jobId || undefined,
          amount: amountNum,
          dueInDays: isNaN(days) ? undefined : days,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey() });
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
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">New invoice</SheetTitle>
            <div className="text-[13px] text-muted-foreground">Number auto-assigns. Send it in one tap after.</div>
          </SheetHeader>
          <div className="flex flex-col gap-[10px]">
            <select className={fieldCls} value={propertyId} onChange={(e) => { setPropertyId(e.target.value); setJobId(""); }} autoFocus>
              <option value="">Select property…</option>
              {properties?.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {propertyId && (
              <select className={fieldCls} value={jobId} onChange={(e) => setJobId(e.target.value)}>
                <option value="">No linked job</option>
                {jobs?.map((j) => (
                  <option key={j.id} value={j.id}>{j.jobNo} · {j.category || j.description}</option>
                ))}
              </select>
            )}
            <div className="flex gap-[10px]">
              <input className={`${fieldCls} flex-1`} placeholder="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <input className={`${fieldCls} w-[130px]`} placeholder="Due in days" inputMode="numeric" value={dueInDays} onChange={(e) => setDueInDays(e.target.value)} />
            </div>
          </div>
          <button
            className="w-full mt-[18px] rounded-[13px] py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_6px_20px_rgba(143,106,31,0.34)] disabled:opacity-50 transition-transform active:scale-[0.98]"
            onClick={submit}
            disabled={!propertyId || !amount.trim() || create.isPending}
          >
            {create.isPending ? "Creating…" : "Create invoice"}
          </button>
          {create.isError && (
            <div className="text-[12.5px] text-destructive text-center mt-[10px]">Couldn't create. Try again.</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
