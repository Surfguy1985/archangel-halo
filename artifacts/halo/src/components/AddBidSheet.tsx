import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import {
  useCreateBid,
  useListProperties,
  getListBidsQueryKey,
  getGetTodayQueryKey,
} from "@workspace/api-client-react";

const fieldCls =
  "w-full bg-card border border-border rounded-[13px] py-[11px] px-[14px] text-[14.5px] shadow-[var(--shadow)] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]";

interface ItemDraft {
  service: string;
  qty: string;
  unitPrice: string;
}

const emptyItem = (): ItemDraft => ({ service: "", qty: "1", unitPrice: "" });

export function AddBidSheet({
  open,
  onOpenChange,
  propertyId: fixedPropertyId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId?: string;
  onCreated?: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const { data: properties } = useListProperties();
  const [scope, setScope] = useState("");
  const [welcome, setWelcome] = useState("");
  const [estCost, setEstCost] = useState("");
  const [unitNo, setUnitNo] = useState("");
  const [propertyId, setPropertyId] = useState(fixedPropertyId ?? "");
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);
  const create = useCreateBid();

  const parsedItems = useMemo(
    () =>
      items
        .filter((it) => it.service.trim())
        .map((it) => ({
          service: it.service.trim(),
          qty: Math.max(0, Number(it.qty) || 0),
          unitPrice: Math.max(0, Number(it.unitPrice) || 0),
        })),
    [items],
  );
  const total = parsedItems.reduce((s, it) => s + it.qty * it.unitPrice, 0);

  const reset = () => {
    setScope("");
    setWelcome("");
    setEstCost("");
    setUnitNo("");
    setPropertyId(fixedPropertyId ?? "");
    setItems([emptyItem()]);
  };

  const setItem = (idx: number, patch: Partial<ItemDraft>) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const submit = () => {
    if (!scope.trim() || !parsedItems.length) return;
    const costNum = parseFloat(estCost);
    create.mutate(
      {
        data: {
          scope: scope.trim(),
          welcomeMessage: welcome.trim() || undefined,
          amount: total,
          estCost: isNaN(costNum) ? undefined : costNum,
          unitNo: unitNo.trim() || undefined,
          propertyId: propertyId || undefined,
          status: "draft",
          lineItems: parsedItems,
        },
      },
      {
        onSuccess: (res) => {
          queryClient.invalidateQueries({ queryKey: getListBidsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
          reset();
          onOpenChange(false);
          onCreated?.(res.id);
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
            <div className="text-[13px] text-muted-foreground">Build line items — the proposal PDF is generated for you.</div>
          </SheetHeader>
          <div className="flex flex-col gap-[10px]">
            <textarea className={`${fieldCls} min-h-[56px] resize-none`} placeholder="Scope of work" value={scope} onChange={(e) => setScope(e.target.value)} autoFocus />
            <textarea className={`${fieldCls} min-h-[56px] resize-none`} placeholder="Welcome message for the proposal (optional)" value={welcome} onChange={(e) => setWelcome(e.target.value)} />

            <div className="flex items-center justify-between mt-[4px]">
              <span className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Line items</span>
              <button
                className="flex items-center gap-[4px] text-[12.5px] font-bold text-[var(--gold-dark)]"
                onClick={() => setItems((p) => [...p, emptyItem()])}
              >
                <Plus className="w-[14px] h-[14px]" /> Add
              </button>
            </div>
            {items.map((it, idx) => (
              <div key={idx} className="flex gap-[8px] items-center">
                <input className={`${fieldCls} flex-1`} placeholder="Service" value={it.service} onChange={(e) => setItem(idx, { service: e.target.value })} />
                <input className={`${fieldCls} w-[64px] px-[10px]`} placeholder="Qty" inputMode="numeric" value={it.qty} onChange={(e) => setItem(idx, { qty: e.target.value })} />
                <input className={`${fieldCls} w-[90px] px-[10px]`} placeholder="Price" inputMode="decimal" value={it.unitPrice} onChange={(e) => setItem(idx, { unitPrice: e.target.value })} />
                <button
                  className="shrink-0 text-muted-foreground disabled:opacity-30"
                  onClick={() => setItems((p) => (p.length > 1 ? p.filter((_, i) => i !== idx) : p))}
                  disabled={items.length === 1}
                >
                  <X className="w-[16px] h-[16px]" />
                </button>
              </div>
            ))}
            <div className="flex justify-between items-center px-[4px]">
              <span className="text-[13px] text-muted-foreground">Proposal total</span>
              <span className="font-display font-bold text-[19px] tabular-nums">${total.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
            </div>

            <div className="flex gap-[10px]">
              <input className={`${fieldCls} flex-1`} placeholder="Est. cost (optional)" inputMode="decimal" value={estCost} onChange={(e) => setEstCost(e.target.value)} />
              <input className={`${fieldCls} flex-1`} placeholder="Unit # (optional)" value={unitNo} onChange={(e) => setUnitNo(e.target.value)} />
            </div>
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
            disabled={!scope.trim() || !parsedItems.length || create.isPending}
          >
            {create.isPending ? "Saving…" : "Create bid (draft)"}
          </button>
          {create.isError && (
            <div className="text-[12.5px] text-destructive text-center mt-[10px]">Couldn't save. Try again.</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
