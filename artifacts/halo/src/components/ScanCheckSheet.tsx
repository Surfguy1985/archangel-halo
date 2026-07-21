import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useScanCheck,
  useRecordPayment,
  useListProperties,
  useListJobs,
  useListInvoices,
  getListInvoicesQueryKey,
  getGetMoneySummaryQueryKey,
  getGetInvoiceQueryKey,
  getGetPropertyQueryKey,
  getGetTodayQueryKey,
  type CheckScanResult,
} from "@workspace/api-client-react";
import { Camera, Sparkles, X } from "lucide-react";

const fieldCls =
  "w-full bg-card border border-border rounded-[13px] py-[11px] px-[14px] text-[14.5px] shadow-[var(--shadow)] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]";

const CHECK_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function fileToBase64(file: File): Promise<string> {
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

async function uploadCheckFile(file: File): Promise<string | null> {
  try {
    const resp = await fetch("/api/storage/uploads/request-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: file.name || "check.jpg",
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

export function ScanCheckSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data: properties } = useListProperties();
  const [propertyId, setPropertyId] = useState("");
  const { data: jobs } = useListJobs(propertyId ? { propertyId } : undefined);
  const [jobId, setJobId] = useState("");
  const { data: invoices } = useListInvoices();
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [scan, setScan] = useState<CheckScanResult | null>(null);
  const [checkFile, setCheckFile] = useState<File | null>(null);
  const [checkPreview, setCheckPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const scanCheck = useScanCheck();
  const record = useRecordPayment();

  const openInvoices = (invoices ?? []).filter(
    (i) =>
      i.status !== "paid" &&
      i.status !== "draft" &&
      (!propertyId || i.propertyId === propertyId) &&
      (!jobId || i.jobId === jobId),
  );

  const reset = () => {
    setPropertyId("");
    setJobId("");
    setInvoiceId("");
    setAmount("");
    setScan(null);
    setCheckFile(null);
    setCheckPreview(null);
    setError(null);
    setSaving(false);
  };

  const close = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const onPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!CHECK_MEDIA_TYPES.includes(file.type)) {
      setError("Please use a photo (JPG or PNG).");
      return;
    }
    setError(null);
    setCheckFile(file);
    setCheckPreview(URL.createObjectURL(file));
    try {
      const base64 = await fileToBase64(file);
      const result = await scanCheck.mutateAsync({
        data: {
          image: base64,
          mediaType: file.type as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
        },
      });
      if (!result.found) {
        setError("Couldn't read that photo as a check — try a clearer shot.");
        return;
      }
      setScan(result);
      if (result.amount != null) setAmount(String(result.amount));
      if (result.suggestedPropertyId) setPropertyId(result.suggestedPropertyId);
      if (result.suggestedJobId) setJobId(result.suggestedJobId);
      if (result.suggestedInvoiceId) setInvoiceId(result.suggestedInvoiceId);
    } catch {
      setError("Couldn't read that photo — try again.");
    }
  };

  const submit = async () => {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || !invoiceId) return;
    setSaving(true);
    let checkImagePath: string | undefined;
    if (checkFile) {
      const uploaded = await uploadCheckFile(checkFile);
      if (!uploaded) {
        setSaving(false);
        setError("Couldn't save the check photo. Try again.");
        return;
      }
      checkImagePath = uploaded;
    }
    record.mutate(
      {
        data: {
          invoiceId,
          amount: amountNum,
          method: "check",
          payerName: scan?.payerName ?? undefined,
          checkNumber: scan?.checkNumber ?? undefined,
          checkImagePath,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(invoiceId) });
          queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
          if (propertyId) {
            queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId) });
          }
          close(false);
        },
        onError: () => setError("Couldn't apply the payment. Try again."),
        onSettled: () => setSaving(false),
      },
    );
  };

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent
        side="bottom"
        className="rounded-t-[26px] bg-[var(--paper)] p-0 flex flex-col max-h-[86vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]"
      >
        <div className="w-[40px] h-[4.5px] rounded-[3px] bg-[rgba(23,24,28,0.16)] mx-auto mt-[10px] mb-[4px] shrink-0" />
        <div className="p-[8px_20px_26px] overflow-y-auto">
          <SheetHeader className="text-left mb-[16px]">
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">Scan a check</SheetTitle>
            <div className="text-[13px] text-muted-foreground">
              Snap the check — AI reads it, you confirm where it goes.
            </div>
          </SheetHeader>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={onPicked}
            data-testid="input-check-file"
          />
          {!checkFile ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full mb-[12px] rounded-[15px] border-2 border-dashed border-[var(--gold)]/45 bg-[var(--gold)]/[0.07] active:bg-[var(--gold)]/[0.14] p-[14px] flex items-center gap-[12px] text-left"
              data-testid="button-scan-check"
            >
              <div className="w-[42px] h-[42px] rounded-[12px] bg-[var(--gold)]/15 flex items-center justify-center shrink-0">
                <Camera className="w-[22px] h-[22px] text-[var(--gold-dark)]" />
              </div>
              <div>
                <div className="font-display font-bold text-[14.5px] text-[var(--ink)]">Photograph the check</div>
                <div className="text-[12.5px] text-muted-foreground">Amount, payer & check # auto-fill</div>
              </div>
            </button>
          ) : (
            <div className="mb-[12px] rounded-[15px] border border-border bg-card p-[12px] space-y-[8px] shadow-[var(--shadow)]">
              <div className="flex items-center gap-[10px]">
                {checkPreview && (
                  <img
                    src={checkPreview}
                    alt="Check"
                    className="w-[64px] h-[42px] rounded-[8px] object-cover border border-border shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0 text-[13px]">
                  {scanCheck.isPending ? (
                    <span className="flex items-center gap-[6px] font-medium text-[var(--gold-dark)]">
                      <Sparkles className="w-[15px] h-[15px] animate-pulse" /> Reading check…
                    </span>
                  ) : scan?.summary ? (
                    <span className="flex items-start gap-[6px] text-[var(--ink)]">
                      <Sparkles className="w-[15px] h-[15px] mt-[1px] text-[var(--gold-dark)] shrink-0" />
                      {scan.summary}
                    </span>
                  ) : (
                    <span className="text-muted-foreground truncate">{checkFile.name}</span>
                  )}
                </div>
                <button type="button" onClick={reset} className="shrink-0 p-[6px]">
                  <X className="w-[16px] h-[16px] text-muted-foreground" />
                </button>
              </div>
              {scan && (
                <div className="text-[12.5px] text-muted-foreground">
                  {[
                    scan.payerName ? `From ${scan.payerName}` : null,
                    scan.checkNumber ? `Check #${scan.checkNumber}` : null,
                    scan.checkDate ? `Dated ${scan.checkDate}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-[10px]">
            <input
              className={fieldCls}
              placeholder="Amount received"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              data-testid="input-check-amount"
            />
            <select
              className={fieldCls}
              value={propertyId}
              onChange={(e) => {
                setPropertyId(e.target.value);
                setJobId("");
                setInvoiceId("");
              }}
              data-testid="select-check-property"
            >
              <option value="">Which property is this payment for?</option>
              {(properties ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {propertyId && (
              <select
                className={fieldCls}
                value={jobId}
                onChange={(e) => {
                  setJobId(e.target.value);
                  setInvoiceId("");
                }}
                data-testid="select-check-job"
              >
                <option value="">Which job? (optional)</option>
                {(jobs ?? []).map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.jobNo} — {j.category ?? j.description ?? "Job"}
                  </option>
                ))}
              </select>
            )}
            {propertyId && (
              <select
                className={fieldCls}
                value={invoiceId}
                onChange={(e) => setInvoiceId(e.target.value)}
                data-testid="select-check-invoice"
              >
                <option value="">Which invoice does it pay?</option>
                {openInvoices.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.invoiceNo} — ${i.amount.toLocaleString()}
                  </option>
                ))}
              </select>
            )}
            {propertyId && openInvoices.length === 0 && (
              <div className="text-[12.5px] text-muted-foreground">
                No open invoices for this selection — send the invoice first, then apply the check.
              </div>
            )}
          </div>

          <button
            className="w-full mt-[18px] rounded-[13px] py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_6px_20px_rgba(143,106,31,0.34)] disabled:opacity-50 transition-transform active:scale-[0.98]"
            onClick={submit}
            disabled={!checkFile || !scan || !amount.trim() || !propertyId || !invoiceId || saving || record.isPending}
            data-testid="button-apply-check"
          >
            {saving || record.isPending ? "Applying…" : "Apply payment to books"}
          </button>
          {error && (
            <div className="text-[12.5px] text-destructive text-center mt-[10px]">{error}</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
