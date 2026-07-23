import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateInventoryItem, getListInventoryQueryKey } from "@workspace/api-client-react";

const fieldCls =
  "w-full bg-card border border-border rounded-[13px] py-[11px] px-[14px] text-[14.5px] shadow-[var(--shadow)] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]";

export function AddInventorySheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [reorderAt, setReorderAt] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [preferredVendor, setPreferredVendor] = useState("");
  const create = useCreateInventoryItem();

  const reset = () => {
    setName("");
    setQty("");
    setReorderAt("");
    setUnitCost("");
    setPreferredVendor("");
  };

  const submit = () => {
    if (!name.trim()) return;
    const qtyNum = parseFloat(qty);
    const reorderNum = parseFloat(reorderAt);
    const costNum = parseFloat(unitCost);
    create.mutate(
      {
        data: {
          name: name.trim(),
          qty: isNaN(qtyNum) ? undefined : qtyNum,
          reorderAt: isNaN(reorderNum) ? undefined : reorderNum,
          unitCost: isNaN(costNum) ? undefined : costNum,
          preferredVendor: preferredVendor.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListInventoryQueryKey() });
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
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">Add inventory item</SheetTitle>
            <div className="text-[13px] text-muted-foreground">Silent until it drops to the reorder point.</div>
          </SheetHeader>
          <div className="flex flex-col gap-[10px]">
            <input className={fieldCls} placeholder="Item name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <div className="flex gap-[10px]">
              <input className={`${fieldCls} flex-1`} placeholder="On hand" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
              <input className={`${fieldCls} flex-1`} placeholder="Reorder at" inputMode="decimal" value={reorderAt} onChange={(e) => setReorderAt(e.target.value)} />
            </div>
            <input className={fieldCls} placeholder="Unit cost (optional)" inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
            <input className={fieldCls} placeholder="Preferred vendor (optional)" value={preferredVendor} onChange={(e) => setPreferredVendor(e.target.value)} />
          </div>
          <button
            className="w-full mt-[18px] rounded-[13px] py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_6px_20px_rgba(180,255,68,0.35)] disabled:opacity-50 transition-transform active:scale-[0.98]"
            onClick={submit}
            disabled={!name.trim() || create.isPending}
          >
            {create.isPending ? "Saving…" : "Save item"}
          </button>
          {create.isError && (
            <div className="text-[12.5px] text-destructive text-center mt-[10px]">Couldn't save. Try again.</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
