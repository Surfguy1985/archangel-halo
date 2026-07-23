import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAdjustInventory, getListInventoryQueryKey, type InventoryItem } from "@workspace/api-client-react";

const fieldCls =
  "w-full bg-card border border-border rounded-[13px] py-[11px] px-[14px] text-[14.5px] shadow-[var(--shadow)] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]";

export function AdjustInventorySheet({
  open,
  onOpenChange,
  item,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: InventoryItem | null;
}) {
  const queryClient = useQueryClient();
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const adjust = useAdjustInventory();

  const apply = (sign: number) => {
    const magnitude = Math.abs(parseFloat(delta));
    if (!item || isNaN(magnitude) || magnitude === 0) return;
    adjust.mutate(
      { id: item.id, data: { delta: sign * magnitude, reason: reason.trim() || undefined } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListInventoryQueryKey() });
          setDelta("");
          setReason("");
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
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">Adjust stock</SheetTitle>
            <div className="text-[13px] text-muted-foreground">
              {item ? `${item.name} · ${item.qty} on hand` : ""}
            </div>
          </SheetHeader>
          <div className="flex flex-col gap-[10px]">
            <input className={fieldCls} placeholder="Quantity" inputMode="decimal" value={delta} onChange={(e) => setDelta(e.target.value)} autoFocus />
            <input className={fieldCls} placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="flex gap-[10px] mt-[18px]">
            <button
              className="flex-1 rounded-[13px] py-[13px] font-display font-bold text-[15px] bg-card border border-border shadow-[var(--shadow)] disabled:opacity-50 transition-transform active:scale-[0.98]"
              onClick={() => apply(-1)}
              disabled={!delta.trim() || adjust.isPending}
            >
              − Remove
            </button>
            <button
              className="flex-1 rounded-[13px] py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_6px_20px_rgba(180,255,68,0.35)] disabled:opacity-50 transition-transform active:scale-[0.98]"
              onClick={() => apply(1)}
              disabled={!delta.trim() || adjust.isPending}
            >
              + Add
            </button>
          </div>
          {adjust.isError && (
            <div className="text-[12.5px] text-destructive text-center mt-[10px]">Couldn't adjust. Try again.</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
