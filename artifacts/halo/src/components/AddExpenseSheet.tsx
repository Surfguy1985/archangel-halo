import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateExpense,
  useListProperties,
  useListJobs,
  getListExpensesQueryKey,
  getGetMoneySummaryQueryKey,
  getGetPropertyQueryKey,
} from "@workspace/api-client-react";

const fieldCls =
  "w-full bg-card border border-border rounded-[13px] py-[11px] px-[14px] text-[14.5px] shadow-[var(--shadow)] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]";

export function AddExpenseSheet({
  open,
  onOpenChange,
  propertyId: fixedPropertyId,
  jobId: fixedJobId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId?: string;
  jobId?: string;
}) {
  const queryClient = useQueryClient();
  const { data: properties } = useListProperties();
  const [propertyId, setPropertyId] = useState(fixedPropertyId ?? "");
  const { data: jobs } = useListJobs(propertyId ? { propertyId } : undefined);
  const [jobId, setJobId] = useState(fixedJobId ?? "");
  const [amount, setAmount] = useState("");
  const [vendor, setVendor] = useState("");
  const [category, setCategory] = useState("");
  const create = useCreateExpense();

  const reset = () => {
    setPropertyId(fixedPropertyId ?? "");
    setJobId(fixedJobId ?? "");
    setAmount("");
    setVendor("");
    setCategory("");
  };

  const submit = () => {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum)) return;
    create.mutate(
      {
        data: {
          amount: amountNum,
          propertyId: propertyId || undefined,
          jobId: jobId || undefined,
          vendor: vendor.trim() || undefined,
          category: category.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListExpensesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey() });
          if (propertyId) {
            queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId) });
          }
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
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">Log expense</SheetTitle>
            <div className="text-[13px] text-muted-foreground">Or snap a receipt with the mic.</div>
          </SheetHeader>
          <div className="flex flex-col gap-[10px]">
            <input className={fieldCls} placeholder="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            <input className={fieldCls} placeholder="Vendor (optional)" value={vendor} onChange={(e) => setVendor(e.target.value)} />
            <input className={fieldCls} placeholder="Category (e.g. Materials, Labor)" value={category} onChange={(e) => setCategory(e.target.value)} />
            {!fixedPropertyId && (
              <select className={fieldCls} value={propertyId} onChange={(e) => { setPropertyId(e.target.value); setJobId(""); }}>
                <option value="">No property</option>
                {properties?.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
            {!fixedJobId && propertyId && (
              <select className={fieldCls} value={jobId} onChange={(e) => setJobId(e.target.value)}>
                <option value="">No linked job</option>
                {jobs?.map((j) => (
                  <option key={j.id} value={j.id}>{j.jobNo} · {j.category || j.description}</option>
                ))}
              </select>
            )}
          </div>
          <button
            className="w-full mt-[18px] rounded-[13px] py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_6px_20px_rgba(143,106,31,0.34)] disabled:opacity-50 transition-transform active:scale-[0.98]"
            onClick={submit}
            disabled={!amount.trim() || create.isPending}
          >
            {create.isPending ? "Saving…" : "Log expense"}
          </button>
          {create.isError && (
            <div className="text-[12.5px] text-destructive text-center mt-[10px]">Couldn't save. Try again.</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
