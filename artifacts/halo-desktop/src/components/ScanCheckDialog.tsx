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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Camera, Sparkles, X } from "lucide-react";

const selectCls =
  "w-full h-9 bg-background border border-input rounded-md px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

import { prepareScanImage } from "@/lib/scanImage";

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

export function ScanCheckDialog({
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
    if (!file.type.startsWith("image/")) {
      setError("Please use a photo (JPG or PNG).");
      return;
    }
    setError(null);
    setCheckFile(file);
    setCheckPreview(URL.createObjectURL(file));
    try {
      const { base64, mediaType, blob } = await prepareScanImage(file);
      setCheckFile(new File([blob], file.name || "check.jpg", { type: mediaType }));
      const result = await scanCheck.mutateAsync({
        data: {
          image: base64,
          mediaType,
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
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Scan a check</DialogTitle>
          <DialogDescription>
            Upload a photo of the check — AI reads it, you confirm where it goes.
          </DialogDescription>
        </DialogHeader>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onPicked}
          data-testid="input-check-file"
        />
        <div className="space-y-3">
          {!checkFile ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full rounded-lg border-2 border-dashed border-[var(--gold)]/45 bg-[var(--gold)]/[0.07] hover:bg-[var(--gold)]/[0.12] p-4 flex items-center gap-3 text-left transition-colors"
              data-testid="button-scan-check"
            >
              <div className="w-10 h-10 rounded-lg bg-[var(--gold)]/15 flex items-center justify-center shrink-0">
                <Camera className="w-5 h-5 text-[var(--gold-dark)]" />
              </div>
              <div>
                <div className="font-semibold text-sm text-[var(--ink)]">Upload a check photo</div>
                <div className="text-xs text-muted-foreground">Amount, payer & check # auto-fill</div>
              </div>
            </button>
          ) : (
            <div className="rounded-lg border border-border bg-card p-3 space-y-2">
              <div className="flex items-center gap-2.5">
                {checkPreview && (
                  <img
                    src={checkPreview}
                    alt="Check"
                    className="w-16 h-10 rounded-md object-cover border border-border shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0 text-[13px]">
                  {scanCheck.isPending ? (
                    <span className="flex items-center gap-1.5 font-medium text-[var(--gold-dark)]">
                      <Sparkles className="w-4 h-4 animate-pulse" /> Reading check…
                    </span>
                  ) : scan?.summary ? (
                    <span className="flex items-start gap-1.5 text-[var(--ink)]">
                      <Sparkles className="w-4 h-4 mt-0.5 text-[var(--gold-dark)] shrink-0" />
                      {scan.summary}
                    </span>
                  ) : (
                    <span className="text-muted-foreground truncate">{checkFile.name}</span>
                  )}
                </div>
                <button type="button" onClick={reset} className="shrink-0 p-1">
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
              {scan && (
                <div className="text-xs text-muted-foreground">
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

          <Input
            placeholder="Amount received"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            data-testid="input-check-amount"
          />
          <select
            className={selectCls}
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
              className={selectCls}
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
              className={selectCls}
              value={invoiceId}
              onChange={(e) => setInvoiceId(e.target.value)}
              data-testid="select-check-invoice"
            >
              <option value="">Which invoice does it pay?</option>
              {openInvoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.invoiceNo} — ${i.amount.toLocaleString()}
                  {i.status === "paid" ? " (already paid)" : i.status === "draft" ? " (draft)" : ""}
                </option>
              ))}
            </select>
          )}
          {propertyId && openInvoices.length === 0 && (
            <div className="text-xs text-muted-foreground">
              No invoices for this selection — create the invoice first, then apply the check.
            </div>
          )}
          <Button
            className="w-full"
            onClick={submit}
            disabled={!checkFile || !scan || !amount.trim() || !propertyId || !invoiceId || saving || record.isPending}
            data-testid="button-apply-check"
          >
            {saving || record.isPending ? "Applying…" : "Apply payment to books"}
          </Button>
          {error && <div className="text-xs text-destructive text-center">{error}</div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
