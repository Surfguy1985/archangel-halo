import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreatePurchaseOrder,
  useListVendors,
  useListJobs,
  getListPurchaseOrdersQueryKey,
  getGetTodayQueryKey,
} from "@workspace/api-client-react";

const fieldCls =
  "w-full bg-card border border-border rounded-[13px] py-[11px] px-[14px] text-[14.5px] shadow-[var(--shadow)] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]";

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
  const [vendorId, setVendorId] = useState("");
  const [jobId, setJobId] = useState("");
  const [expectedOn, setExpectedOn] = useState("");
  const create = useCreatePurchaseOrder();

  const reset = () => {
    setVendorId("");
    setJobId("");
    setExpectedOn("");
  };

  const submit = () => {
    if (!vendorId) return;
    create.mutate(
      {
        data: {
          vendorId,
          jobId: jobId || undefined,
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
            <select className={fieldCls} value={vendorId} onChange={(e) => setVendorId(e.target.value)} autoFocus>
              <option value="">Select vendor…</option>
              {vendors?.map((v) => (
                <option key={v.id} value={v.id}>{v.name}{v.trade ? ` · ${v.trade}` : ""}</option>
              ))}
            </select>
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
            className="w-full mt-[18px] rounded-[13px] py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_6px_20px_rgba(180,255,68,0.35)] disabled:opacity-50 transition-transform active:scale-[0.98]"
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
