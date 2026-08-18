import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  useCreatePurchaseOrder,
  useListVendors,
  useListJobs,
  useListVendorRates,
  useListCatalogItems,
  getListVendorRatesQueryKey,
  getListPurchaseOrdersQueryKey,
  type ListVendorRatesQueryResult,
} from "@workspace/api-client-react";
import type { UseQueryOptions } from "@tanstack/react-query";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddPurchaseOrderDialog({ open, onOpenChange }: Props) {
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

  // Fetch the selected vendor's rate sheet
  const { data: vendorRates } = useListVendorRates(vendorId, {
    query: {
      queryKey: getListVendorRatesQueryKey(vendorId),
      enabled: !!vendorId,
    } as UseQueryOptions<ListVendorRatesQueryResult>,
  });

  // Pre-fill amount from vendor's rate sheet when a service is selected
  useEffect(() => {
    if (!catalogItemId || !vendorRates || amountTouched) return;
    const rate = vendorRates.find((r) => r.catalogItemId === catalogItemId);
    if (rate) setAmount(String(rate.rate));
  }, [catalogItemId, vendorRates, amountTouched]);

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
          reset();
          onOpenChange(false);
        },
      },
    );
  };

  const rateOnFile = vendorRates?.find((r) => r.catalogItemId === catalogItemId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle>New purchase order</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          {/* Vendor */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Vendor *</label>
            <select
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={vendorId}
              onChange={(e) => handleVendorChange(e.target.value)}
            >
              <option value="">Select vendor…</option>
              {vendors?.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}{v.trade ? ` · ${v.trade}` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Service */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Service</label>
            <select
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={catalogItemId}
              onChange={(e) => handleCatalogChange(e.target.value)}
            >
              <option value="">No service selected</option>
              {catalog?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.service}{c.detail ? ` — ${c.detail}` : ""}{c.unit ? ` (${c.unit})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Amount */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Amount</label>
              {rateOnFile && !amountTouched && (
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--gold)] bg-[var(--gold)]/10 px-2 py-0.5 rounded-full">
                  Rate on file
                </span>
              )}
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                className="w-full rounded-lg border border-input bg-background pl-6 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setAmountTouched(true);
                }}
              />
            </div>
          </div>

          {/* Linked job */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Linked job</label>
            <select
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
            >
              <option value="">No linked job</option>
              {jobs?.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.jobNo} · {j.category || j.description}
                </option>
              ))}
            </select>
          </div>

          {/* Expected on */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Expected on</label>
            <input
              type="date"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={expectedOn}
              onChange={(e) => setExpectedOn(e.target.value)}
            />
          </div>
        </div>

        {create.isError && (
          <p className="text-xs text-destructive">Couldn't create the PO. Make sure a vendor is selected.</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!vendorId || create.isPending}>
            {create.isPending ? "Creating…" : "Create PO"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
