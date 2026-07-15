import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import {
  useUpdatePriceItem,
  useDeletePriceItem,
  getGetPropertyQueryKey,
} from "@workspace/api-client-react";

const fieldCls =
  "w-full bg-card border border-border rounded-[13px] py-[11px] px-[14px] text-[14.5px] shadow-[var(--shadow)] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]";

type PriceItemLike = {
  id: string;
  service: string;
  detail?: string | null;
  unit?: string | null;
  rate: number;
};

export function EditPriceItemSheet({
  open,
  onOpenChange,
  item,
  propertyId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: PriceItemLike;
  propertyId: string;
}) {
  const queryClient = useQueryClient();
  const [service, setService] = useState(item.service);
  const [detail, setDetail] = useState(item.detail ?? "");
  const [unit, setUnit] = useState(item.unit ?? "");
  const [rate, setRate] = useState(String(item.rate));
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setService(item.service);
      setDetail(item.detail ?? "");
      setUnit(item.unit ?? "");
      setRate(String(item.rate));
    }
  }, [open, item]);

  const update = useUpdatePriceItem();
  const del = useDeletePriceItem();

  const done = () => {
    queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId) });
    onOpenChange(false);
  };

  const submit = () => {
    const rateNum = parseFloat(rate);
    if (!service.trim() || isNaN(rateNum)) return;
    update.mutate(
      {
        id: item.id,
        data: {
          service: service.trim(),
          detail: detail.trim() || null,
          unit: unit.trim() || null,
          rate: rateNum,
        },
      },
      { onSuccess: done },
    );
  };

  const confirmDelete = () => {
    del.mutate(
      { id: item.id },
      {
        onSuccess: () => {
          setConfirmOpen(false);
          done();
        },
      },
    );
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="rounded-t-[26px] bg-[var(--paper)] p-0 flex flex-col max-h-[86vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]"
        >
          <div className="w-[40px] h-[4.5px] rounded-[3px] bg-[rgba(23,24,28,0.16)] mx-auto mt-[10px] mb-[4px] shrink-0" />
          <div className="p-[8px_20px_26px] overflow-y-auto">
            <SheetHeader className="text-left mb-[16px]">
              <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">Edit price item</SheetTitle>
              <div className="text-[13px] text-muted-foreground">Update the agreed rate, or remove it.</div>
            </SheetHeader>
            <div className="flex flex-col gap-[10px]">
              <input className={fieldCls} placeholder="Service (e.g. Full turn)" value={service} onChange={(e) => setService(e.target.value)} />
              <input className={fieldCls} placeholder="Detail (optional)" value={detail} onChange={(e) => setDetail(e.target.value)} />
              <div className="flex gap-[10px]">
                <input className={`${fieldCls} flex-1`} placeholder="Rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
                <input className={`${fieldCls} w-[110px]`} placeholder="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
              </div>
            </div>
            <button
              className="w-full mt-[18px] rounded-[13px] py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_6px_20px_rgba(143,106,31,0.34)] disabled:opacity-50 transition-transform active:scale-[0.98]"
              onClick={submit}
              disabled={!service.trim() || !rate.trim() || update.isPending}
            >
              {update.isPending ? "Saving…" : "Save changes"}
            </button>
            <button
              className="w-full mt-[10px] rounded-[13px] py-[12px] font-semibold text-[14px] text-destructive border border-destructive/30 bg-destructive/5 flex items-center justify-center gap-[7px] disabled:opacity-50"
              onClick={() => setConfirmOpen(true)}
              disabled={del.isPending}
            >
              <Trash2 className="w-[15px] h-[15px]" />
              Delete price item
            </button>
          </div>
        </SheetContent>
      </Sheet>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this price item?</AlertDialogTitle>
            <AlertDialogDescription>
              "{item.service}" will be removed from this property's price list. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
