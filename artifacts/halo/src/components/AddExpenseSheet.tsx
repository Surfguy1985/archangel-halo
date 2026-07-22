import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateExpense,
  useExtractReceipt,
  useListProperties,
  useListJobs,
  getListExpensesQueryKey,
  getGetMoneySummaryQueryKey,
  getGetPropertyQueryKey,
  getGetTodayQueryKey,
  type ReceiptBankMatch,
} from "@workspace/api-client-react";
import { Camera, Sparkles, Landmark, X } from "lucide-react";

const fieldCls =
  "w-full bg-card border border-border rounded-[13px] py-[11px] px-[14px] text-[14.5px] shadow-[var(--shadow)] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]";

import { prepareScanImage } from "@/lib/scanImage";

async function uploadReceiptFile(file: File): Promise<string | null> {
  try {
    const resp = await fetch("/api/storage/uploads/request-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: file.name || "receipt.jpg",
        size: Math.max(file.size, 1),
        contentType: file.type || "image/jpeg",
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
      headers: { "Content-Type": file.type || "image/jpeg" },
    });
    return put.ok ? objectPath : null;
  } catch {
    return null;
  }
}

export function AddExpenseSheet({
  open,
  onOpenChange,
  propertyId: fixedPropertyId,
  jobId: fixedJobId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId?: string;
  jobId?: string;
}) {
  const queryClient = useQueryClient();
  const { data: properties } = useListProperties();
  const [propertyId, setPropertyId] = useState(fixedPropertyId ?? "");
  const { data: jobs } = useListJobs(propertyId ? { propertyId } : undefined);
  const [jobId, setJobId] = useState(fixedJobId ?? "");
  const [amount, setAmount] = useState("");
  const [vendor, setVendor] = useState("");
  const [category, setCategory] = useState("");
  const [isBill, setIsBill] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [spentOn, setSpentOn] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [scanSummary, setScanSummary] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [bankMatch, setBankMatch] = useState<ReceiptBankMatch | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const create = useCreateExpense();
  const extract = useExtractReceipt();

  const reset = () => {
    setPropertyId(fixedPropertyId ?? "");
    setJobId(fixedJobId ?? "");
    setAmount("");
    setVendor("");
    setCategory("");
    setIsBill(false);
    setDueDate("");
    setSpentOn("");
    setReceiptFile(null);
    setReceiptPreview(null);
    setScanSummary(null);
    setScanError(null);
    setBankMatch(null);
    setSaving(false);
  };

  const clearReceipt = () => {
    setReceiptFile(null);
    setReceiptPreview(null);
    setScanSummary(null);
    setScanError(null);
    setBankMatch(null);
  };

  const onReceiptPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setScanError("Please use a photo (JPG or PNG).");
      return;
    }
    setScanError(null);
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
          kind: "receipt",
        },
      });
      if (!result.found) {
        setScanError("Couldn't read that photo — fill in the fields yourself.");
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
      setScanError("Couldn't read that photo — fill in the fields yourself.");
    }
  };

  const submit = async () => {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum)) return;
    setSaving(true);
    let receiptPath: string | undefined;
    if (receiptFile) {
      const uploaded = await uploadReceiptFile(receiptFile);
      if (!uploaded) {
        setSaving(false);
        setScanError("Couldn't save the receipt photo. Try again.");
        return;
      }
      receiptPath = uploaded;
    }
    create.mutate(
      {
        data: {
          amount: amountNum,
          propertyId: propertyId || undefined,
          jobId: jobId || undefined,
          vendor: vendor.trim() || undefined,
          category: category.trim() || undefined,
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
          if (propertyId) {
            queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId) });
          }
          if (created.approvalStatus === "pending") {
            setSavedNote("Saved — waiting for approval (over your limit).");
            setTimeout(() => setSavedNote(null), 3500);
          }
          reset();
          onOpenChange(false);
        },
        onSettled: () => setSaving(false),
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
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">Log expense</SheetTitle>
            <div className="text-[13px] text-muted-foreground">Snap the receipt — AI fills it in.</div>
          </SheetHeader>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={onReceiptPicked}
            data-testid="input-receipt-file"
          />
          {!receiptFile ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full mb-[12px] rounded-[15px] border-2 border-dashed border-[var(--gold)]/45 bg-[var(--gold)]/[0.07] active:bg-[var(--gold)]/[0.14] p-[14px] flex items-center gap-[12px] text-left"
              data-testid="button-scan-receipt"
            >
              <div className="w-[42px] h-[42px] rounded-[12px] bg-[var(--gold)]/15 flex items-center justify-center shrink-0">
                <Camera className="w-[22px] h-[22px] text-[var(--gold-dark)]" />
              </div>
              <div>
                <div className="font-display font-bold text-[14.5px] text-[var(--ink)]">Scan receipt</div>
                <div className="text-[12.5px] text-muted-foreground">Take a photo — vendor & amount auto-fill</div>
              </div>
            </button>
          ) : (
            <div className="mb-[12px] rounded-[15px] border border-border bg-card p-[12px] space-y-[8px] shadow-[var(--shadow)]">
              <div className="flex items-center gap-[10px]">
                {receiptPreview && (
                  <img
                    src={receiptPreview}
                    alt="Receipt"
                    className="w-[46px] h-[46px] rounded-[10px] object-cover border border-border shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0 text-[13px]">
                  {extract.isPending ? (
                    <span className="flex items-center gap-[6px] font-medium text-[var(--gold-dark)]">
                      <Sparkles className="w-[15px] h-[15px] animate-pulse" /> Reading receipt…
                    </span>
                  ) : scanSummary ? (
                    <span className="flex items-start gap-[6px] text-[var(--ink)]">
                      <Sparkles className="w-[15px] h-[15px] mt-[1px] text-[var(--gold-dark)] shrink-0" />
                      {scanSummary}
                    </span>
                  ) : (
                    <span className="text-muted-foreground truncate">{receiptFile.name}</span>
                  )}
                </div>
                <button type="button" onClick={clearReceipt} className="p-[6px] shrink-0" aria-label="Remove receipt">
                  <X className="w-[16px] h-[16px] text-muted-foreground" />
                </button>
              </div>
              {bankMatch && (
                <div className="flex items-center gap-[6px] rounded-[10px] bg-emerald-600/10 text-emerald-800 px-[10px] py-[7px] text-[12px] font-medium">
                  <Landmark className="w-[13px] h-[13px] shrink-0" />
                  <span className="truncate">Matched to bank: {bankMatch.label}</span>
                </div>
              )}
            </div>
          )}
          <div className="flex flex-col gap-[10px]">
            <input className={fieldCls} placeholder="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <input className={fieldCls} placeholder="Vendor (optional)" value={vendor} onChange={(e) => setVendor(e.target.value)} />
            <input className={fieldCls} placeholder="Category (e.g. Materials, Labor)" value={category} onChange={(e) => setCategory(e.target.value)} />
            {!fixedPropertyId && (
              <select className={fieldCls} value={propertyId} onChange={(e) => { setPropertyId(e.target.value); setJobId(""); }}>
                <option value="">No property</option>
                {properties?.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
            {!fixedJobId && propertyId && (
              <select className={fieldCls} value={jobId} onChange={(e) => setJobId(e.target.value)}>
                <option value="">No linked job</option>
                {jobs?.map((j) => (
                  <option key={j.id} value={j.id}>{j.jobNo} · {j.category || j.description}</option>
                ))}
              </select>
            )}
            <label className="flex items-center gap-[10px] text-[13.5px] font-medium py-[4px]">
              <input
                type="checkbox"
                checked={isBill}
                onChange={(e) => setIsBill(e.target.checked)}
                className="w-[17px] h-[17px] accent-[var(--gold)]"
                data-testid="checkbox-is-bill"
              />
              Unpaid bill — I owe the vendor
            </label>
            {isBill && (
              <input
                className={fieldCls}
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                data-testid="input-bill-due"
              />
            )}
          </div>
          <button
            className="w-full mt-[18px] rounded-[13px] py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_6px_20px_rgba(143,106,31,0.34)] disabled:opacity-50 transition-transform active:scale-[0.98]"
            onClick={submit}
            disabled={!amount.trim() || create.isPending || saving || extract.isPending}
          >
            {create.isPending || saving ? "Saving…" : "Log expense"}
          </button>
          {scanError && (
            <div className="text-[12.5px] text-destructive text-center mt-[10px]">{scanError}</div>
          )}
          {create.isError && (
            <div className="text-[12.5px] text-destructive text-center mt-[10px]">Couldn't save. Try again.</div>
          )}
          {savedNote && (
            <div className="text-[12.5px] text-[var(--gold-dark)] text-center mt-[10px]">{savedNote}</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
