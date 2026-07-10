import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateBid, useListProperties, getListBidsQueryKey } from "@workspace/api-client-react";

const fieldCls =
  "w-full bg-card border border-border rounded-[13px] py-[11px] px-[14px] text-[14.5px] shadow-[var(--shadow)] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]";

export function AddBidSheet({
  open,
  onOpenChange,
  propertyId: fixedPropertyId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId?: string;
}) {
  const queryClient = useQueryClient();
  const { data: properties } = useListProperties();
  const [scope, setScope] = useState("");
  const [amount, setAmount] = useState("");
  const [estCost, setEstCost] = useState("");
  const [unitNo, setUnitNo] = useState("");
  const [propertyId, setPropertyId] = useState(fixedPropertyId ?? "");
  const create = useCreateBid();

  const reset = () => {
    setScope("");
    setAmount("");
    setEstCost("");
    setUnitNo("");
    setPropertyId(fixedPropertyId ?? "");
  };

  const submit = () => {
    const amountNum = parseFloat(amount);
    if (!scope.trim() || isNaN(amountNum)) return;
    const costNum = parseFloat(estCost);
    create.mutate(
      {
        data: {
          scope: scope.trim(),
          amount: amountNum,
          estCost: isNaN(costNum) ? undefined : costNum,
          unitNo: unitNo.trim() || undefined,
          propertyId: propertyId || undefined,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListBidsQueryKey() });
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
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">New bid</SheetTitle>
            <div className="text-[13px] text-muted-foreground">Margin Guardian flags anything under your floor.</div>
          </SheetHeader>
          <div className="flex flex-col gap-[10px]">
            <textarea className={`${fieldCls} min-h-[64px] resize-none`} placeholder="Scope of work" value={scope} onChange={(e) => setScope(e.target.value)} autoFocus />
            <div className="flex gap-[10px]">
              <input className={`${fieldCls} flex-1`} placeholder="Bid amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <input className={`${fieldCls} flex-1`} placeholder="Est. cost" inputMode="decimal" value={estCost} onChange={(e) => setEstCost(e.target.value)} />
            </div>
            <input className={fieldCls} placeholder="Unit # (optional)" value={unitNo} onChange={(e) => setUnitNo(e.target.value)} />
            {!fixedPropertyId && (
              <select className={fieldCls} value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                <option value="">No property</option>
                {properties?.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
          </div>
          <button
            className="w-full mt-[18px] rounded-[13px] py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_6px_20px_rgba(143,106,31,0.34)] disabled:opacity-50 transition-transform active:scale-[0.98]"
            onClick={submit}
            disabled={!scope.trim() || !amount.trim() || create.isPending}
          >
            {create.isPending ? "Saving…" : "Save bid"}
          </button>
          {create.isError && (
            <div className="text-[12.5px] text-destructive text-center mt-[10px]">Couldn't save. Try again.</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
