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
  const [invoiceIds, setInvoiceIds] = useState<string[]>([]);
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

  const selectedInvoices = openInvoices.filter((i) => invoiceIds.includes(i.id));
  const selectedTotal =
    Math.round(selectedInvoices.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  const checkAmountNum = parseFloat(amount);

  const toggleInvoice = (id: string) =>
    setInvoiceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const reset = () => {
    setPropertyId("");
    setJobId("");
    setInvoiceIds([]);
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
      if (result.suggestedInvoiceId) setInvoiceIds([result.suggestedInvoiceId]);
    } catch {
      setError("Couldn't read that photo — try again.");
    }
  };

  const submit = async () => {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || selectedInvoices.length === 0) return;
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
    // One invoice selected: the entered check amount goes to it (allows partial
    // payments). Multiple selected: each invoice is paid its own full amount.
    const applied: string[] = [];
    try {
      for (const inv of selectedInvoices) {
        await record.mutateAsync({
          data: {
            invoiceId: inv.id,
            amount: selectedInvoices.length === 1 ? amountNum : inv.amount,
            method: "check",
            payerName: scan?.payerName ?? undefined,
            checkNumber: scan?.checkNumber ?? undefined,
            checkImagePath,
          },
        });
        applied.push(inv.id);
      }
    } catch {
      setError(
        applied.length > 0
          ? `Applied ${applied.length} of ${selectedInvoices.length} payments — one failed. Check the Money tab and try the rest again.`
          : "Couldn't apply the payment. Try again.",
      );
    } finally {
      queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey() });
      for (const id of applied) {
        queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(id) });
      }
      queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
      if (propertyId) {
        queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId) });
      }
      setSaving(false);
      if (applied.length === selectedInvoices.length) close(false);
    }
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
              className="w-full mb-[12px] rounded-[15px] border-2 border-dashed border-[var(--gold)]/45 bg-[var(--gold-light)]/[0.07] active:bg-[var(--gold-light)]/[0.14] p-[14px] flex items-center gap-[12px] text-left"
              data-testid="button-scan-check"
            >
              <div className="w-[42px] h-[42px] rounded-[12px] bg-[var(--gold-light)]/15 flex items-center justify-center shrink-0">
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
                setInvoiceIds([]);
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
                  setInvoiceIds([]);
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
            {propertyId && openInvoices.length > 0 && (
              <div className="space-y-[6px]">
                <div className="text-[12.5px] font-semibold text-muted-foreground">
                  Which invoice(s) does it pay? Tap all that apply.
                </div>
                <div className="max-h-[180px] overflow-y-auto space-y-[6px]">
                  {openInvoices.map((i) => {
                    const checked = invoiceIds.includes(i.id);
                    return (
                      <button
                        key={i.id}
                        type="button"
                        onClick={() => toggleInvoice(i.id)}
                        className={`w-full flex items-center gap-[10px] rounded-[13px] border py-[10px] px-[12px] text-left text-[13.5px] transition-colors ${checked ? "border-[var(--gold)] bg-[rgba(198,151,58,0.10)]" : "border-border bg-card"}`}
                        data-testid={`option-check-invoice-${i.id}`}
                      >
                        <span
                          className={`w-[18px] h-[18px] rounded-[5px] border flex items-center justify-center shrink-0 ${checked ? "bg-[var(--gold-light)] border-[var(--gold)] text-black" : "border-border"}`}
                        >
                          {checked ? "✓" : ""}
                        </span>
                        <span className="flex-1">
                          {i.invoiceNo} — ${i.amount.toLocaleString()}
                          {i.status === "paid" ? " (already paid)" : i.status === "draft" ? " (draft)" : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {selectedInvoices.length > 1 && (
                  <div
                    className="text-[12.5px] text-muted-foreground"
                    data-testid="text-check-split-summary"
                  >
                    {selectedInvoices.length} invoices selected — ${selectedTotal.toLocaleString()} total
                    {!isNaN(checkAmountNum) && Math.abs(selectedTotal - checkAmountNum) > 0.005
                      ? ` (check is $${checkAmountNum.toLocaleString()} — each invoice will be marked paid in full)`
                      : ""}
                  </div>
                )}
              </div>
            )}
            {propertyId && openInvoices.length === 0 && (
              <div className="text-[12.5px] text-muted-foreground">
                No invoices for this selection — create the invoice first, then apply the check.
              </div>
            )}
          </div>

          <button
            className="w-full mt-[18px] rounded-[13px] py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_6px_20px_rgba(180,255,68,0.35)] disabled:opacity-50 transition-transform active:scale-[0.98]"
            onClick={submit}
            disabled={!checkFile || !scan || !amount.trim() || !propertyId || invoiceIds.length === 0 || saving || record.isPending}
            data-testid="button-apply-check"
          >
            {saving || record.isPending
              ? "Applying…"
              : invoiceIds.length > 1
                ? `Apply payment to ${invoiceIds.length} invoices`
                : "Apply payment to books"}
          </button>
          {error && (
            <div className="text-[12.5px] text-destructive text-center mt-[10px]">{error}</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
