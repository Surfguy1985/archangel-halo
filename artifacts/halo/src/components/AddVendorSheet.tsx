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
import {
  useCreateVendor,
  useUpdateVendor,
  useDeleteVendor,
  getListVendorsQueryKey,
  getGetTodayQueryKey,
  getListPurchaseOrdersQueryKey,
  type Vendor,
} from "@workspace/api-client-react";

const fieldCls =
  "w-full bg-card border border-[var(--hairline)] rounded-[18px] py-[14px] px-[16px] text-[15px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-[var(--ink)] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40 focus:border-[var(--gold)]";

type VendorKind = "in_house" | "subcontractor";

function apiError(err: unknown): string | null {
  return (err as { data?: { error?: string } })?.data?.error ?? null;
}

export function AddVendorSheet({
  open,
  onOpenChange,
  vendor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, the sheet edits this vendor; otherwise it creates one. */
  vendor?: Vendor | null;
}) {
  const queryClient = useQueryClient();
  const isEdit = !!vendor;

  const [name, setName] = useState("");
  const [trade, setTrade] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [coiExpiresOn, setCoiExpiresOn] = useState("");
  const [vendorType, setVendorType] = useState<VendorKind>("subcontractor");
  const [contracted, setContracted] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(vendor?.name ?? "");
    setTrade(vendor?.trade ?? "");
    setEmail(vendor?.email ?? "");
    setPhone(vendor?.phone ?? "");
    setCoiExpiresOn(vendor?.coiExpiresOn ?? "");
    setVendorType(vendor?.vendorType === "in_house" ? "in_house" : "subcontractor");
    setContracted((vendor?.contractStatus ?? "contracted") !== "inactive");
    setError(null);
  }, [open, vendor]);

  const create = useCreateVendor();
  const update = useUpdateVendor();
  const del = useDeleteVendor();
  const pending = create.isPending || update.isPending;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListVendorsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
  };

  const confirmDelete = () => {
    if (!vendor) return;
    del.mutate(
      { id: vendor.id },
      {
        onSuccess: () => {
          invalidate();
          queryClient.invalidateQueries({
            queryKey: getListPurchaseOrdersQueryKey(),
          });
          setConfirmOpen(false);
          onOpenChange(false);
        },
        onError: (err: unknown) => {
          setConfirmOpen(false);
          setError(apiError(err) || "Couldn't delete the vendor.");
        },
      },
    );
  };

  const submit = () => {
    if (!name.trim()) {
      setError("Vendor name is required.");
      return;
    }
    setError(null);

    if (isEdit && vendor) {
      update.mutate(
        {
          id: vendor.id,
          data: {
            name: name.trim(),
            trade: trade.trim() || null,
            email: email.trim() || null,
            phone: phone.trim() || null,
            coiExpiresOn: coiExpiresOn || null,
            vendorType,
            contractStatus: contracted ? "contracted" : "inactive",
          },
        },
        {
          onSuccess: () => {
            invalidate();
            onOpenChange(false);
          },
          onError: (err: unknown) =>
            setError(apiError(err) || "Couldn't save the vendor."),
        },
      );
    } else {
      create.mutate(
        {
          data: {
            name: name.trim(),
            trade: trade.trim() || undefined,
            email: email.trim() || undefined,
            phone: phone.trim() || undefined,
            coiExpiresOn: coiExpiresOn || undefined,
            vendorType,
            contractStatus: contracted ? "contracted" : "inactive",
          },
        },
        {
          onSuccess: () => {
            invalidate();
            onOpenChange(false);
          },
          onError: (err: unknown) =>
            setError(apiError(err) || "Couldn't add the vendor."),
        },
      );
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="rounded-t-[26px] bg-[var(--paper)] p-0 flex flex-col max-h-[90vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]"
        >
          <div className="w-[40px] h-[4.5px] rounded-[3px] bg-[rgba(23,24,28,0.16)] mx-auto mt-[10px] mb-[4px] shrink-0" />
          <div className="p-[8px_20px_26px] overflow-y-auto">
            <SheetHeader className="text-left mb-[16px]">
              <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">
                {isEdit ? "Edit vendor" : "Add vendor"}
              </SheetTitle>
              <div className="text-[13px] text-muted-foreground">
                {isEdit
                  ? "Update details or contract status."
                  : "HALO flags a lapsing COI before it bites."}
              </div>
            </SheetHeader>
            <div className="flex flex-col gap-[10px]">
              <input
                className={fieldCls}
                placeholder="Vendor name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
              <input
                className={fieldCls}
                placeholder="Trade (e.g. HVAC, Roofing)"
                value={trade}
                onChange={(e) => setTrade(e.target.value)}
              />
              <input
                className={fieldCls}
                placeholder="Email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <input
                className={fieldCls}
                placeholder="Phone"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <label className="text-[11.5px] font-semibold text-muted-foreground uppercase tracking-[0.1em] mt-[2px] ml-[2px]">
                COI expires
              </label>
              <input
                className={fieldCls}
                type="date"
                value={coiExpiresOn}
                onChange={(e) => setCoiExpiresOn(e.target.value)}
              />

              {/* Vendor type toggle */}
              <label className="text-[11.5px] font-semibold text-muted-foreground uppercase tracking-[0.1em] mt-[4px] ml-[2px]">
                Type
              </label>
              <div className="flex gap-[8px]">
                {(
                  [
                    ["subcontractor", "Subcontractor"],
                    ["in_house", "In-house"],
                  ] as [VendorKind, string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setVendorType(value)}
                    data-testid={`button-vendor-type-${value}`}
                    className={`flex-1 rounded-[18px] border py-[13px] text-[14px] font-semibold transition-colors ${
                      vendorType === value
                        ? "bg-[var(--ink)] text-white border-[var(--ink)]"
                        : "bg-card text-muted-foreground border-[var(--hairline)]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Contracted checkbox */}
              <label className="flex items-start gap-[10px] mt-[4px] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={contracted}
                  onChange={(e) => setContracted(e.target.checked)}
                  data-testid="checkbox-vendor-contracted"
                  className="w-[18px] h-[18px] mt-[1px] accent-[var(--ink)] shrink-0"
                />
                <span className="text-[14px] text-[var(--ink)]">
                  Currently contracted
                  <span className="block text-[12px] text-muted-foreground mt-[1px]">
                    Unchecked keeps the record but hides it from the default list.
                  </span>
                </span>
              </label>

              {error && (
                <div className="text-[12.5px] text-destructive mt-[2px]">{error}</div>
              )}
            </div>
            <button
              className="w-full mt-[18px] rounded-full py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] disabled:opacity-50 transition-transform active:scale-[0.98]"
              onClick={submit}
              disabled={!name.trim() || pending}
            >
              {pending ? "Saving…" : isEdit ? "Save changes" : "Save vendor"}
            </button>
            {isEdit && (
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                disabled={del.isPending}
                className="w-full mt-[10px] rounded-full py-[13px] font-display font-bold text-[15px] text-destructive border border-[rgba(190,60,60,0.28)] bg-transparent disabled:opacity-50 transition-transform active:scale-[0.98]"
              >
                {del.isPending ? "Deleting…" : "Delete vendor"}
              </button>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">
              Delete {vendor?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Received purchase orders keep their history, but the vendor is
              removed for good. Vendors with open purchase orders can't be
              deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep vendor</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete vendor
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
