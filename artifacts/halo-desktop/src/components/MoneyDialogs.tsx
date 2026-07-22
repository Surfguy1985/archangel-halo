import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useRecordPayment,
  useCreateExpense,
  useExtractReceipt,
  useCreateCrewPayment,
  useListProperties,
  useListCrews,
  getListInvoicesQueryKey,
  getGetInvoiceQueryKey,
  getGetMoneySummaryQueryKey,
  getListExpensesQueryKey,
  getListCrewPaymentsQueryKey,
  getGetPropertyQueryKey,
  getGetTodayQueryKey,
  type Invoice,
  type ReceiptBankMatch,
} from "@workspace/api-client-react";
import { ScanLine, Sparkles, Landmark, X, FileImage } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { prepareScanImage } from "@/lib/scanImage";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function todayLocal() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const RECEIPT_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function fmtShortDate(s?: string | null) {
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result ?? "");
      resolve(s.includes(",") ? s.slice(s.indexOf(",") + 1) : s);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function uploadReceiptFile(file: File): Promise<string | null> {
  try {
    const resp = await fetch("/api/storage/uploads/request-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: file.name,
        size: Math.max(file.size, 1),
        contentType: file.type || "application/octet-stream",
      }),
    });
    if (!resp.ok) return null;
    const { uploadURL, objectPath } = (await resp.json()) as {
      uploadURL: string;
      objectPath: string;
    };
    const put = await fetch(uploadURL, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type || "application/octet-stream" },
    });
    return put.ok ? objectPath : null;
  } catch {
    return null;
  }
}

export function RecordPaymentDialog({
  open,
  onOpenChange,
  invoice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: Invoice | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const record = useRecordPayment();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("check");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && invoice) {
      setAmount(String(invoice.amount));
      setMethod("check");
      setError(null);
    }
  }, [open, invoice]);

  const submit = () => {
    if (!invoice) return;
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    record.mutate(
      { data: { invoiceId: invoice.id, amount: amountNum, method: method || undefined } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(invoice.id) });
          queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey() });
          onOpenChange(false);
          toast({
            title: "Payment recorded",
            description: `${invoice.invoiceNo} marked paid.`,
          });
        },
        onError: (err: unknown) => {
          setError(
            (err as { data?: { error?: string } })?.data?.error ||
              "Couldn't record payment.",
          );
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            {invoice ? `${invoice.invoiceNo} · ${invoice.propertyName || "—"}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pay-amount">Amount</Label>
            <Input
              id="pay-amount"
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="check">Check</SelectItem>
                <SelectItem value="ach">ACH / Bank transfer</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={record.isPending}>
            {record.isPending ? "Recording…" : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AddExpenseDialog({
  open,
  onOpenChange,
  propertyId: fixedPropertyId,
  jobId: fixedJobId,
  billMode = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId?: string;
  jobId?: string;
  /** Opens tuned for uploading an unpaid vendor bill. */
  billMode?: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const create = useCreateExpense();
  const extract = useExtractReceipt();
  const { data: properties } = useListProperties();
  const [vendor, setVendor] = useState("");
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [isBill, setIsBill] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [spentOn, setSpentOn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [scanSummary, setScanSummary] = useState<string | null>(null);
  const [bankMatch, setBankMatch] = useState<ReceiptBankMatch | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setVendor("");
      setCategory("");
      setAmount("");
      setPropertyId(fixedPropertyId ?? "");
      setIsBill(billMode);
      setDueDate("");
      setSpentOn("");
      setError(null);
      setReceiptFile(null);
      setReceiptPreview(null);
      setScanSummary(null);
      setBankMatch(null);
      setSaving(false);
    }
  }, [open, fixedPropertyId, billMode]);

  const clearReceipt = () => {
    setReceiptFile(null);
    setReceiptPreview(null);
    setScanSummary(null);
    setBankMatch(null);
  };

  const onReceiptPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose a photo (JPG, PNG, WebP, or GIF).");
      return;
    }
    setError(null);
    setScanSummary(null);
    setBankMatch(null);
    setReceiptFile(file);
    setReceiptPreview(URL.createObjectURL(file));
    try {
      const { base64, mediaType, blob } = await prepareScanImage(file);
      setReceiptFile(new File([blob], file.name || "receipt.jpg", { type: mediaType }));
      const result = await extract.mutateAsync({
        data: {
          image: base64,
          mediaType,
          filename: file.name,
          kind: isBill ? "bill" : "receipt",
        },
      });
      if (!result.found) {
        setScanSummary(null);
        setError("Couldn't read that photo — you can still fill the fields in yourself.");
        return;
      }
      if (result.vendor) setVendor(result.vendor);
      if (result.amount) setAmount(String(result.amount));
      if (result.category) setCategory(result.category);
      if (result.spentOn) setSpentOn(result.spentOn);
      if (result.isBill) {
        setIsBill(true);
        if (result.dueDate) setDueDate(result.dueDate);
      }
      setScanSummary(result.summary ?? "Details filled in from the photo.");
      setBankMatch(result.bankMatch ?? null);
    } catch {
      setError("Couldn't read that photo — you can still fill the fields in yourself.");
    }
  };

  const submit = async () => {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    setSaving(true);
    let receiptPath: string | undefined;
    if (receiptFile) {
      const uploaded = await uploadReceiptFile(receiptFile);
      if (!uploaded) {
        setSaving(false);
        setError("Couldn't save the receipt photo. Please try again.");
        return;
      }
      receiptPath = uploaded;
    }
    create.mutate(
      {
        data: {
          amount: amountNum,
          vendor: vendor.trim() || undefined,
          category: category.trim() || undefined,
          propertyId: (fixedPropertyId ?? propertyId) || undefined,
          jobId: fixedJobId || undefined,
          paymentStatus: isBill ? "open" : undefined,
          dueDate: isBill && dueDate ? dueDate : undefined,
          spentOn: spentOn || undefined,
          receiptPath,
          bankTxnId: bankMatch?.txnId,
          bankTxnLabel: bankMatch?.label,
        },
      },
      {
        onSuccess: (created) => {
          queryClient.invalidateQueries({ queryKey: getListExpensesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
          queryClient.invalidateQueries({ queryKey: ["/accounting"] });
          if (propertyId) {
            queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId) });
          }
          onOpenChange(false);
          if (created.approvalStatus === "pending") {
            toast({
              title: "Waiting for approval",
              description: "This expense is over your approval limit — approve it in the Expenses tab.",
            });
          } else {
            toast({ title: isBill ? "Bill logged — it shows as unpaid" : "Expense logged" });
          }
        },
        onError: (err: unknown) => {
          setError(
            (err as { data?: { error?: string } })?.data?.error ||
              "Couldn't log expense.",
          );
        },
        onSettled: () => setSaving(false),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{billMode ? "Upload a bill" : "Log expense"}</DialogTitle>
          <DialogDescription>
            {billMode
              ? "Snap or upload the vendor bill — AI reads the amount and due date."
              : "Record a cost against the business."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={onReceiptPicked}
            data-testid="input-receipt-file"
          />
          {!receiptFile ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full rounded-xl border-2 border-dashed border-[var(--gold)]/40 bg-[var(--gold)]/[0.06] hover:bg-[var(--gold)]/[0.12] transition-colors p-4 flex items-center gap-3 text-left"
              data-testid="button-scan-receipt"
            >
              <div className="w-10 h-10 rounded-lg bg-[var(--gold)]/15 flex items-center justify-center shrink-0">
                <ScanLine className="w-5 h-5 text-[var(--gold-dark,#8f6a1f)]" />
              </div>
              <div>
                <div className="font-semibold text-sm text-[var(--ink)]">
                  {billMode ? "Upload the bill photo" : "Scan a receipt"}
                </div>
                <div className="text-xs text-muted-foreground">
                  AI fills in the vendor, amount, and date for you.
                </div>
              </div>
            </button>
          ) : (
            <div className="rounded-xl border border-border bg-black/[0.02] p-3 space-y-2">
              <div className="flex items-center gap-3">
                {receiptPreview ? (
                  <img
                    src={receiptPreview}
                    alt="Receipt"
                    className="w-12 h-12 rounded-lg object-cover border border-border shrink-0"
                  />
                ) : (
                  <FileImage className="w-10 h-10 text-muted-foreground shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  {extract.isPending ? (
                    <div className="flex items-center gap-2 text-sm font-medium text-[var(--gold-dark,#8f6a1f)]">
                      <Sparkles className="w-4 h-4 animate-pulse" /> Reading the photo…
                    </div>
                  ) : scanSummary ? (
                    <div className="flex items-start gap-2 text-sm text-[var(--ink)]">
                      <Sparkles className="w-4 h-4 mt-0.5 text-[var(--gold-dark,#8f6a1f)] shrink-0" />
                      <span>{scanSummary}</span>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground truncate">{receiptFile.name}</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={clearReceipt}
                  className="p-1.5 rounded-md hover:bg-black/5 shrink-0"
                  aria-label="Remove receipt"
                  data-testid="button-remove-receipt"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
              {bankMatch && (
                <div className="flex items-center gap-2 rounded-lg bg-emerald-600/10 text-emerald-800 px-3 py-2 text-xs font-medium">
                  <Landmark className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Matched to your bank: {bankMatch.label} · {fmtShortDate(bankMatch.date)}</span>
                </div>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="exp-vendor">Vendor</Label>
            <Input
              id="exp-vendor"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="Home Depot"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="exp-category">Category</Label>
              <Input
                id="exp-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Materials"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exp-amount">Amount</Label>
              <Input
                id="exp-amount"
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-spent-on">Date (optional)</Label>
            <Input
              id="exp-spent-on"
              type="date"
              value={spentOn}
              onChange={(e) => setSpentOn(e.target.value)}
              data-testid="input-spent-on"
            />
          </div>
          {fixedPropertyId ? (
            <div className="space-y-1.5">
              <Label>Property</Label>
              <div className="text-sm font-medium py-2 px-3 rounded-md border border-border bg-black/[0.03]">
                {(properties ?? []).find((p) => p.id === fixedPropertyId)?.name ?? "This property"}
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Property (optional)</Label>
              <Select value={propertyId} onValueChange={setPropertyId}>
                <SelectTrigger>
                  <SelectValue placeholder="No property" />
                </SelectTrigger>
                <SelectContent>
                  {(properties ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="rounded-md border border-border p-3 space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={isBill}
                onChange={(e) => setIsBill(e.target.checked)}
                className="accent-[var(--gold,#B98A2F)]"
                data-testid="checkbox-is-bill"
              />
              This is an unpaid bill (I owe the vendor)
            </label>
            {isBill && (
              <div className="space-y-1.5">
                <Label htmlFor="exp-due">Due date (optional)</Label>
                <Input
                  id="exp-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  data-testid="input-bill-due"
                />
              </div>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={create.isPending || saving || extract.isPending}>
            {create.isPending || saving ? "Saving…" : billMode || isBill ? "Save bill" : "Log expense"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AddCrewPaymentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const create = useCreateCrewPayment();
  const { data: crews } = useListCrews();
  const [crewId, setCrewId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("check");
  const [status, setStatus] = useState("pending");
  const [note, setNote] = useState("");
  const [dueOn, setDueOn] = useState(todayLocal());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCrewId("");
      setAmount("");
      setMethod("check");
      setStatus("pending");
      setNote("");
      setDueOn(todayLocal());
      setError(null);
    }
  }, [open]);

  const submit = () => {
    if (!crewId) {
      setError("Select a crew.");
      return;
    }
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    create.mutate(
      {
        data: {
          crewId,
          amount: amountNum,
          method: method || undefined,
          status,
          note: note.trim() || undefined,
          dueOn: status === "completed" ? undefined : dueOn || undefined,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCrewPaymentsQueryKey() });
          onOpenChange(false);
          toast({ title: "Crew payment recorded" });
        },
        onError: (err: unknown) => {
          setError(
            (err as { data?: { error?: string } })?.data?.error ||
              "Couldn't record crew payment.",
          );
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record crew payment</DialogTitle>
          <DialogDescription>Pay or schedule a payout to a crew.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Crew</Label>
            <Select value={crewId} onValueChange={setCrewId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a crew" />
              </SelectTrigger>
              <SelectContent>
                {(crews ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="crew-amount">Amount</Label>
              <Input
                id="crew-amount"
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="check">Check</SelectItem>
                  <SelectItem value="ach">ACH / Bank transfer</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {status !== "completed" && (
              <div className="space-y-1.5">
                <Label htmlFor="crew-due">Due on</Label>
                <Input
                  id="crew-due"
                  type="date"
                  value={dueOn}
                  onChange={(e) => setDueOn(e.target.value)}
                />
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="crew-note">Note (optional)</Label>
            <Input
              id="crew-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Job reference, etc."
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending ? "Saving…" : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
