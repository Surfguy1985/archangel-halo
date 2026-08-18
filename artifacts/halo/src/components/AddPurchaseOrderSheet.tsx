import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreatePurchaseOrder,
  useListVendors,
  useListJobs,
  useListVendorRates,
  useListCatalogItems,
  getListVendorRatesQueryKey,
  getListPurchaseOrdersQueryKey,
  getGetTodayQueryKey,
  type ListVendorRatesQueryResult,
} from "@workspace/api-client-react";
import type { UseQueryOptions } from "@tanstack/react-query";

const fieldCls =
  "w-full bg-card border border-[var(--hairline)] rounded-[18px] py-[14px] px-[16px] text-[15px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-[var(--ink)] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40 focus:border-[var(--gold)]";

export function AddPurchaseOrderSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data: vendors } = useListVendors();
  const { data: jobs } = useListJobs();
  const { data: catalog } = useListCatalogItems();
  const [vendorId, setVendorId] = useState("");
  const [jobId, setJobId] = useState("");
  const [catalogItemId, setCatalogItemId] = useState("");
  const [amount, setAmount] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [expectedOn, setExpectedOn] = useState("");
  const create = useCreatePurchaseOrder();

  // Fetch rates for the selected vendor (only when a vendor is picked)
  const { data: vendorRates } = useListVendorRates(vendorId, {
    query: {
      queryKey: getListVendorRatesQueryKey(vendorId),
      enabled: !!vendorId,
    } as UseQueryOptions<ListVendorRatesQueryResult>,
  });

  // When the vendor + catalog item change, pre-fill the amount from the rate
  // sheet — but only if the user hasn't manually overridden it.
  useEffect(() => {
    if (!catalogItemId || !vendorRates) return;
    const rate = vendorRates.find((r) => r.catalogItemId === catalogItemId);
    if (rate && !amountTouched) {
      setAmount(String(rate.rate));
    }
  }, [catalogItemId, vendorRates, amountTouched]);

  // When the vendor changes, clear the service and amount so the pre-fill
  // can re-run cleanly for the new vendor's rate sheet.
  const handleVendorChange = (id: string) => {
    setVendorId(id);
    setCatalogItemId("");
    setAmount("");
    setAmountTouched(false);
  };

  const handleCatalogChange = (id: string) => {
    setCatalogItemId(id);
    setAmount("");
    setAmountTouched(false);
  };

  const reset = () => {
    setVendorId("");
    setJobId("");
    setCatalogItemId("");
    setAmount("");
    setAmountTouched(false);
    setExpectedOn("");
  };

  const submit = () => {
    if (!vendorId) return;
    const parsedAmount = amount ? parseFloat(amount) : undefined;
    create.mutate(
      {
        data: {
          vendorId,
          jobId: jobId || undefined,
          catalogItemId: catalogItemId || undefined,
          amount: parsedAmount,
          expectedOn: expectedOn || undefined,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPurchaseOrdersQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
          reset();
          onOpenChange(false);
        },
      },
    );
  };

  // Find the selected vendor's rate for the selected service (to show the
  // "Rate on file" hint).
  const rateOnFile = vendorRates?.find((r) => r.catalogItemId === catalogItemId);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[26px] bg-[var(--paper)] p-0 flex flex-col max-h-[86vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]"
      >
        <div className="w-[40px] h-[4.5px] rounded-[3px] bg-[rgba(23,24,28,0.16)] mx-auto mt-[10px] mb-[4px] shrink-0" />
        <div className="p-[8px_20px_26px] overflow-y-auto">
          <SheetHeader className="text-left mb-[16px]">
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">New purchase order</SheetTitle>
            <div className="text-[13px] text-muted-foreground">Late POs surface as blocker cards on Today.</div>
          </SheetHeader>
          <div className="flex flex-col gap-[10px]">
            <select
              className={fieldCls}
              value={vendorId}
              onChange={(e) => handleVendorChange(e.target.value)}
              autoFocus
            >
              <option value="">Select vendor…</option>
              {vendors?.map((v) => (
                <option key={v.id} value={v.id}>{v.name}{v.trade ? ` · ${v.trade}` : ""}</option>
              ))}
            </select>

            <select
              className={fieldCls}
              value={catalogItemId}
              onChange={(e) => handleCatalogChange(e.target.value)}
            >
              <option value="">Service (optional)</option>
              {catalog?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.service}{c.detail ? ` — ${c.detail}` : ""}{c.unit ? ` (${c.unit})` : ""}
                </option>
              ))}
            </select>

            <div className="relative">
              <span className="absolute left-[16px] top-1/2 -translate-y-1/2 text-[15px] text-muted-foreground pointer-events-none">$</span>
              <input
                className={`${fieldCls} pl-[28px]`}
                type="number"
                min="0"
                step="0.01"
                placeholder="Amount"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setAmountTouched(true);
                }}
              />
              {rateOnFile && !amountTouched && (
                <span className="absolute right-[14px] top-1/2 -translate-y-1/2 text-[11px] font-semibold text-[var(--gold)] bg-[var(--gold)]/10 px-[7px] py-[2px] rounded-full pointer-events-none">
                  Rate on file
                </span>
              )}
            </div>

            <select className={fieldCls} value={jobId} onChange={(e) => setJobId(e.target.value)}>
              <option value="">No linked job</option>
              {jobs?.map((j) => (
                <option key={j.id} value={j.id}>{j.jobNo} · {j.category || j.description}</option>
              ))}
            </select>
            <label className="text-[11.5px] font-semibold text-muted-foreground uppercase tracking-[0.1em] mt-[2px] ml-[2px]">Expected on</label>
            <input className={fieldCls} type="date" value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} />
          </div>
          <button
            className="w-full mt-[18px] rounded-full py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] disabled:opacity-50 transition-transform active:scale-[0.98]"
            onClick={submit}
            disabled={!vendorId || create.isPending}
          >
            {create.isPending ? "Creating…" : "Create PO"}
          </button>
          {create.isError && (
            <div className="text-[12.5px] text-destructive text-center mt-[10px]">Couldn't create. Add a vendor first if the list is empty.</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
