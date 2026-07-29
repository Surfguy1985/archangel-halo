import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreatePriceItem, getGetPropertyQueryKey } from "@workspace/api-client-react";

const fieldCls =
  "w-full bg-card border border-[var(--hairline)] rounded-[18px] py-[14px] px-[16px] text-[15px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-[var(--ink)] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40 focus:border-[var(--gold)]";

export const SERVICE_CATEGORIES = [
  "Make Ready",
  "Paint",
  "Resurfacing",
  "Roof Repair/Replacement",
  "Electrical",
  "Plumbing",
  "Landscaping",
  "Cleaning",
  "Firewatch",
  "A/C Repairs",
  "General Handyman",
] as const;

const OTHER = "__other__";

export function AddPriceItemSheet({
  open,
  onOpenChange,
  propertyId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
}) {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState("");
  const [customService, setCustomService] = useState("");
  const [detail, setDetail] = useState("");
  const [unit, setUnit] = useState("each");
  const [rate, setRate] = useState("");
  const create = useCreatePriceItem();

  const service = category === OTHER ? customService : category;

  const reset = () => {
    setCategory("");
    setCustomService("");
    setDetail("");
    setUnit("each");
    setRate("");
  };

  const submit = () => {
    const rateNum = parseFloat(rate);
    if (!service.trim() || isNaN(rateNum)) return;
    create.mutate(
      {
        id: propertyId,
        data: {
          service: service.trim(),
          detail: detail.trim() || undefined,
          unit: unit.trim() || undefined,
          rate: rateNum,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId) });
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
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">Add price item</SheetTitle>
            <div className="text-[13px] text-muted-foreground">The agreed rate — voice will use it automatically.</div>
          </SheetHeader>
          <div className="flex flex-col gap-[10px]">
            <select className={fieldCls} value={category} onChange={(e) => setCategory(e.target.value)} autoFocus>
              <option value="">Select a service…</option>
              {SERVICE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              <option value={OTHER}>Other…</option>
            </select>
            {category === OTHER && (
              <input className={fieldCls} placeholder="Type the service name" value={customService} onChange={(e) => setCustomService(e.target.value)} autoFocus />
            )}
            <input className={fieldCls} placeholder="Detail (optional)" value={detail} onChange={(e) => setDetail(e.target.value)} />
            <div className="flex gap-[10px]">
              <input className={`${fieldCls} flex-1`} placeholder="Rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
              <input className={`${fieldCls} w-[110px]`} placeholder="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>
          </div>
          <button
            className="w-full mt-[18px] rounded-full py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] disabled:opacity-50 transition-transform active:scale-[0.98]"
            onClick={submit}
            disabled={!service.trim() || !rate.trim() || create.isPending}
          >
            {create.isPending ? "Saving…" : "Save price item"}
          </button>
          {create.isError && (
            <div className="text-[12.5px] text-destructive text-center mt-[10px]">Couldn't save. Check the fields and try again.</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
