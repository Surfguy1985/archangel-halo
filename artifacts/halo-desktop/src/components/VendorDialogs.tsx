/**
 * Vendor dialogs for the desktop app:
 *  - VendorDialog: create or edit a vendor (with delete for existing ones)
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useEffect, useState} from "react";
import { useQueryClient} from "@tanstack/react-query";
import { Trash2} from "lucide-react";
import {
  useCreateVendor,
  useUpdateVendor,
  useDeleteVendor,
  getListVendorsQueryKey,
  getGetTodayQueryKey,
  getListPurchaseOrdersQueryKey,
  type Vendor,
} from "@workspace/api-client-react";
import { useToast} from "@/hooks/use-toast";

const fieldCls =
  "w-full bg-white border border-border rounded-[11px] py-2.5 px-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40";

const primaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-md bg-[var(--gold-light)] text-black px-4 py-2.5 text-sm font-medium hover:bg-[var(--gold-dark)] transition-colors shadow-sm disabled:opacity-50 disabled:pointer-events-none";

const errorCls = "text-xs text-destructive mt-1";

function Field({ label, children}: { label: string; children: React.ReactNode}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] font-bold text-[var(--gold-dark)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function apiError(err: unknown): string | null {
  return (err as { data?: { error?: string}})?.data?.error ?? null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function VendorDialog({
  open,
  onOpenChange,
  vendor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, the dialog edits this vendor; otherwise it creates one. */
  vendor?: Vendor | null;
}) {
  const queryClient = useQueryClient();
  const { toast} = useToast();
  const isEdit = !!vendor;

  const [name, setName] = useState("");
  const [trade, setTrade] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [coiExpiresOn, setCoiExpiresOn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(vendor?.name ?? "");
    setTrade(vendor?.trade ?? "");
    setEmail(vendor?.email ?? "");
    setPhone(vendor?.phone ?? "");
    setCoiExpiresOn(vendor?.coiExpiresOn ?? "");
    setError(null);
 }, [open, vendor]);

  const create = useCreateVendor();
  const update = useUpdateVendor();
  const del = useDeleteVendor();
  const pending = create.isPending || update.isPending;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListVendorsQueryKey()});
    queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey()});
 };

  const submit = () => {
    if (!name.trim()) {
      setError("Vendor name is required.");
      return;
   }
    if (email.trim() && !EMAIL_RE.test(email.trim())) {
      setError("That email address doesn't look valid.");
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

  const confirmDelete = () => {
    if (!vendor) return;
    del.mutate(
      { id: vendor.id},
      {
        onSuccess: () => {
          invalidate();
          queryClient.invalidateQueries({
            queryKey: getListPurchaseOrdersQueryKey(),
         });
          setConfirmOpen(false);
          onOpenChange(false);
          toast({ title: "Vendor deleted", description: vendor.name});
       },
        onError: (err: unknown) => {
          setConfirmOpen(false);
          setError(apiError(err) || "Couldn't delete the vendor.");
       },
     },
    );
 };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md border-none shadow-xl">
          <DialogHeader>
            <DialogTitle className="font-display">
              {isEdit ? "Edit vendor" : "Add vendor"}
            </DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Update details or COI expiration."
                : "Track a third-party vendor and their COI compliance."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-2">
            <Field label="Name">
              <input
                className={fieldCls}
                placeholder="e.g. Apex Plumbing Co."
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </Field>
            <Field label="Trade">
              <input
                className={fieldCls}
                placeholder="e.g. Plumbing, HVAC, Flooring"
                value={trade}
                onChange={(e) => setTrade(e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Email">
                <input
                  type="email"
                  className={fieldCls}
                  placeholder="billing@vendor.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field label="Phone">
                <input
                  type="tel"
                  className={fieldCls}
                  placeholder="(555) 123-4567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </Field>
            </div>
            <Field label="COI expires on">
              <input
                type="date"
                className={fieldCls}
                value={coiExpiresOn}
                onChange={(e) => setCoiExpiresOn(e.target.value)}
              />
            </Field>
            {error && <p className={errorCls}>{error}</p>}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            {isEdit && (
              <button
                className="inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2.5 text-sm font-semibold text-destructive border border-[rgba(190,60,60,0.28)] hover:bg-destructive/5 transition-colors"
                onClick={() => setConfirmOpen(true)}
                disabled={del.isPending}
              >
                <Trash2 className="w-4 h-4" />
                {del.isPending ? "Deleting…" : "Delete"}
              </button>
            )}
            <button className={primaryBtn} onClick={submit} disabled={pending}>
              {pending ? "Saving…" : isEdit ? "Save changes" : "Add vendor"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
