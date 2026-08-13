import { useState, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Trash2,
  Plus,
  FileText,
} from "lucide-react";

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

// ─── types ───────────────────────────────────────────────────────────────────

interface ScanLineItem {
  dateOfWork: string;
  unitNo: string;
  typeOfWork: string;
  qty: number;
  unitPrice: number;
  amount: number;
  confidence: number; // 0-1
}

interface ScanExtraction {
  payee: string | null;
  invoiceNo: string | null;
  invoiceDate: string | null;
  propertyAddress: string | null;
  subtotal: number | null;
  total: number | null;
  items: ScanLineItem[];
  confidence: number; // overall
}

interface CrewMatch {
  id: string;
  name: string;
  score: number;
}

interface ScanResult {
  extraction: ScanExtraction;
  crewMatches: CrewMatch[];
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // strip the "data:...;base64," prefix
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const ACCEPTED = "image/jpeg,image/png,image/webp,application/pdf";

function confidenceClass(c: number) {
  return c < 0.7 ? "border-amber-400 bg-amber-50 focus-visible:ring-amber-400" : "";
}

// ─── Phase 1: Upload drop zone ────────────────────────────────────────────────

function UploadZone({ onFile }: { onFile: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  return (
    <div
      className={`flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-12 transition-colors cursor-pointer ${
        dragging ? "border-[var(--secondary)] bg-[var(--secondary)]/5" : "border-border bg-white"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
      aria-label="Upload invoice file"
    >
      <div className="w-14 h-14 rounded-full bg-[var(--secondary)]/10 flex items-center justify-center">
        <Upload className="w-7 h-7 text-[var(--secondary)]" />
      </div>
      <div className="text-center">
        <p className="font-semibold text-[var(--secondary)]">Drop a PDF or photo here</p>
        <p className="text-sm text-muted-foreground mt-1">or click to browse</p>
        <p className="text-xs text-muted-foreground mt-2">Supports PDF, JPG, PNG, WebP</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
        }}
      />
    </div>
  );
}

// ─── Phase 3: Review card ─────────────────────────────────────────────────────

interface ReviewFormProps {
  file: File;
  result: ScanResult;
  onSave: (crewId: string, fields: InvoiceFields) => void;
  saving: boolean;
}

interface InvoiceFields {
  fromCompany: string;
  invoiceNo: string;
  invoiceDate: string;
  propertyAddress: string;
  signatureName: string;
  items: ScanLineItem[];
  /** Approved total including any tax/fees/discounts not captured as line items */
  invoiceTotal: number;
}

function ReviewForm({ file, result, onSave, saving }: ReviewFormProps) {
  const { extraction, crewMatches } = result;

  const bestMatch = crewMatches[0];
  const [crewId, setCrewId] = useState(
    bestMatch && bestMatch.score >= 0.7 ? bestMatch.id : "",
  );
  const [fromCompany, setFromCompany] = useState(extraction.payee ?? "");
  const [invoiceNo, setInvoiceNo] = useState(extraction.invoiceNo ?? "");
  const [invoiceDate, setInvoiceDate] = useState(
    extraction.invoiceDate ?? new Date().toISOString().slice(0, 10),
  );
  const [propertyAddress, setPropertyAddress] = useState(
    extraction.propertyAddress ?? "",
  );
  const [signatureName, setSignatureName] = useState(extraction.payee ?? "");
  const [items, setItems] = useState<ScanLineItem[]>(
    extraction.items.length > 0
      ? extraction.items
      : [
          {
            dateOfWork: invoiceDate,
            unitNo: "",
            typeOfWork: "",
            qty: 1,
            unitPrice: extraction.total ?? 0,
            amount: extraction.total ?? 0,
            confidence: 0.5,
          },
        ],
  );
  const [showPreview, setShowPreview] = useState(false);
  const [previewUrl] = useState(() => URL.createObjectURL(file));

  const updateItem = (idx: number, patch: Partial<ScanLineItem>) => {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const next = { ...it, ...patch };
        if ("qty" in patch || "unitPrice" in patch) {
          next.amount = Math.round(next.qty * next.unitPrice * 100) / 100;
        }
        return next;
      }),
    );
  };

  const removeItem = (idx: number) =>
    setItems((prev) => prev.filter((_, i) => i !== idx));

  const addItem = () =>
    setItems((prev) => [
      ...prev,
      {
        dateOfWork: invoiceDate,
        unitNo: "",
        typeOfWork: "",
        qty: 1,
        unitPrice: 0,
        amount: 0,
        confidence: 1,
      },
    ]);

  const lineSum = items.reduce((s, it) => s + it.amount, 0);
  // Extracted total from OCR (may include tax/fees not in line items)
  const extractedTotal = extraction.total ?? extraction.subtotal ?? null;
  // Allow the user to override the total; default to extracted value if present, else line sum
  const [invoiceTotal, setInvoiceTotal] = useState<number>(
    extractedTotal !== null ? extractedTotal : lineSum,
  );
  // Track whether the user has manually overridden the total
  const [totalOverridden, setTotalOverridden] = useState(false);

  // Keep invoice total in sync with line sum unless user has overridden it
  const prevLineSum = useRef(lineSum);
  if (prevLineSum.current !== lineSum && !totalOverridden && extractedTotal === null) {
    prevLineSum.current = lineSum;
    setInvoiceTotal(lineSum);
  }

  const discrepancy =
    extractedTotal !== null && Math.abs(lineSum - extractedTotal) > 0.005;

  const canSave = crewId && fromCompany.trim() && invoiceDate && propertyAddress.trim();
  const lowConf = extraction.confidence < 0.7;

  const handleSubmit = () => {
    if (!crewId) return;
    onSave(crewId, { fromCompany, invoiceNo, invoiceDate, propertyAddress, signatureName, items, invoiceTotal });
  };

  return (
    <div className="flex flex-col gap-6 max-h-[70vh] overflow-y-auto pr-1">
      {/* Low-confidence banner */}
      {lowConf && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Some fields had low OCR confidence — amber fields need your review.
          </span>
        </div>
      )}

      {/* File preview toggle */}
      <button
        type="button"
        onClick={() => setShowPreview((s) => !s)}
        className="flex items-center gap-2 text-sm text-[var(--secondary)] font-medium hover:opacity-80 transition-opacity"
      >
        <FileText className="w-4 h-4" />
        {showPreview ? "Hide" : "Show"} document preview
        {showPreview ? (
          <ChevronUp className="w-3.5 h-3.5" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5" />
        )}
      </button>
      {showPreview && (
        <div className="rounded-xl overflow-hidden border border-border max-h-80 overflow-y-auto">
          {file.type === "application/pdf" ? (
            <iframe src={previewUrl} className="w-full h-72 border-none" title="Invoice PDF" />
          ) : (
            <img src={previewUrl} alt="Invoice" className="w-full object-contain max-h-80" />
          )}
        </div>
      )}

      {/* Crew selector */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Crew *
        </Label>
        {crewMatches.length > 0 ? (
          <select
            value={crewId}
            onChange={(e) => setCrewId(e.target.value)}
            className={`w-full h-10 rounded-xl border px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--secondary)] ${
              !crewId ? "border-amber-400 bg-amber-50" : "border-border"
            }`}
          >
            <option value="">Select crew…</option>
            {crewMatches.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.score >= 0.9 ? " ✓" : m.score >= 0.7 ? " ~" : ""}
              </option>
            ))}
          </select>
        ) : (
          <div className="text-sm text-muted-foreground italic bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            No crew matched "{extraction.payee}". Select manually:
          </div>
        )}
      </div>

      {/* Core fields */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Company / Name *
          </Label>
          <Input
            value={fromCompany}
            onChange={(e) => setFromCompany(e.target.value)}
            placeholder="Payee company or name"
            className={`rounded-xl h-10 border-border bg-white ${confidenceClass(extraction.confidence)}`}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Invoice #
          </Label>
          <Input
            value={invoiceNo}
            onChange={(e) => setInvoiceNo(e.target.value)}
            placeholder="Optional"
            className="rounded-xl h-10 border-border bg-white"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Invoice Date *
          </Label>
          <Input
            type="date"
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
            className={`rounded-xl h-10 border-border bg-white ${
              !extraction.invoiceDate ? confidenceClass(0.5) : ""
            }`}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Signature Name
          </Label>
          <Input
            value={signatureName}
            onChange={(e) => setSignatureName(e.target.value)}
            placeholder="Signer's name"
            className="rounded-xl h-10 border-border bg-white"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Property / Job Site *
        </Label>
        <Input
          value={propertyAddress}
          onChange={(e) => setPropertyAddress(e.target.value)}
          placeholder="Property name or address"
          className={`rounded-xl h-10 border-border bg-white ${
            !extraction.propertyAddress ? confidenceClass(0.5) : ""
          }`}
        />
      </div>

      {/* Line items */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Line Items
          </Label>
          <button
            type="button"
            onClick={addItem}
            className="flex items-center gap-1 text-xs font-bold text-[var(--secondary)] hover:opacity-80"
          >
            <Plus className="w-3.5 h-3.5" /> Add row
          </button>
        </div>
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-[var(--background)]">
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
                <th className="text-left px-2 py-2 font-medium text-muted-foreground">Description</th>
                <th className="text-right px-2 py-2 font-medium text-muted-foreground">Qty</th>
                <th className="text-right px-2 py-2 font-medium text-muted-foreground">Rate</th>
                <th className="text-right px-2 py-2 font-medium text-muted-foreground">Amt</th>
                <th className="w-6 px-1" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-white">
              {items.map((it, idx) => (
                <tr key={idx} className={it.confidence < 0.7 ? "bg-amber-50" : ""}>
                  <td className="px-2 py-1.5">
                    <input
                      type="date"
                      value={it.dateOfWork}
                      onChange={(e) => updateItem(idx, { dateOfWork: e.target.value })}
                      className="w-28 border border-border rounded-lg px-2 py-1 text-xs bg-white"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      value={it.typeOfWork}
                      onChange={(e) => updateItem(idx, { typeOfWork: e.target.value })}
                      placeholder="Description"
                      className="w-full border border-border rounded-lg px-2 py-1 text-xs bg-white"
                    />
                  </td>
                  <td className="px-2 py-1.5 w-12">
                    <input
                      type="number"
                      value={it.qty}
                      onChange={(e) => updateItem(idx, { qty: parseFloat(e.target.value) || 0 })}
                      className="w-12 border border-border rounded-lg px-2 py-1 text-xs text-right tabular-nums bg-white"
                    />
                  </td>
                  <td className="px-2 py-1.5 w-20">
                    <input
                      type="number"
                      value={it.unitPrice}
                      onChange={(e) =>
                        updateItem(idx, { unitPrice: parseFloat(e.target.value) || 0 })
                      }
                      className="w-20 border border-border rounded-lg px-2 py-1 text-xs text-right tabular-nums bg-white"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold">
                    {money(it.amount)}
                  </td>
                  <td className="px-1 py-1.5">
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItem(idx)}
                        className="text-muted-foreground hover:text-red-600 transition-colors"
                        aria-label="Remove row"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-[var(--background)] text-muted-foreground">
                <td colSpan={4} className="px-3 py-2 text-right text-xs">
                  Line sum
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-xs">{money(lineSum)}</td>
                <td />
              </tr>
              {extractedTotal !== null && (
                <tr className="bg-[var(--background)] text-muted-foreground">
                  <td colSpan={4} className="px-3 py-1.5 text-right text-xs">
                    Extracted total
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-xs">{money(extractedTotal)}</td>
                  <td />
                </tr>
              )}
              <tr className="border-t border-border bg-[var(--background)] font-bold text-[var(--secondary)]">
                <td colSpan={4} className="px-3 py-2 text-right text-xs">
                  Approved total
                </td>
                <td className="px-2 py-2 text-right">
                  <input
                    type="number"
                    step="0.01"
                    value={invoiceTotal}
                    onChange={(e) => {
                      setInvoiceTotal(parseFloat(e.target.value) || 0);
                      setTotalOverridden(true);
                    }}
                    className="w-24 border border-[var(--secondary)] rounded-lg px-2 py-1 text-xs text-right tabular-nums font-bold bg-white focus:outline-none focus:ring-1 focus:ring-[var(--secondary)]"
                    aria-label="Approved invoice total"
                  />
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Discrepancy warning */}
        {discrepancy && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Line-item sum ({money(lineSum)}) differs from extracted invoice total ({money(extractedTotal!)}).
              This often means tax or fees aren't broken out as line items.
              The <strong>Approved total</strong> is what will be saved — edit it if needed.
            </span>
          </div>
        )}
      </div>

      {/* Save footer */}
      <div className="flex justify-end gap-3 pt-2 border-t border-border sticky bottom-0 bg-white pb-2">
        <span className="text-sm text-muted-foreground self-center">
          Will be saved as <strong>Needs Review</strong>
        </span>
        <Button
          onClick={handleSubmit}
          disabled={!canSave || saving}
          className="rounded-full bg-[var(--secondary)] text-white font-bold hover:opacity-90 px-6"
          data-testid="btn-save-scan"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…
            </>
          ) : (
            "Save invoice"
          )}
        </Button>
      </div>
    </div>
  );
}

// ─── Main dialog ──────────────────────────────────────────────────────────────

type Phase = "upload" | "scanning" | "review";

export function ScanInvoiceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>("upload");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const reset = () => {
    setPhase("upload");
    setScanResult(null);
    setFile(null);
    setError(null);
    setSaving(false);
  };

  const handleClose = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const handleFile = async (f: File) => {
    setFile(f);
    setError(null);
    setPhase("scanning");

    try {
      const image = await toBase64(f);
      const mediaType = f.type as
        | "image/jpeg"
        | "image/png"
        | "image/webp"
        | "application/pdf";

      const result = await apiFetch<ScanResult>(`/api/crew-invoices/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, mediaType, filename: f.name }),
      });
      setScanResult(result);
      setPhase("review");
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Could not read the file. Try again.";
      setError(msg);
      setPhase("upload");
    }
  };

  const handleSave = async (crewId: string, fields: {
    fromCompany: string;
    invoiceNo: string;
    invoiceDate: string;
    propertyAddress: string;
    signatureName: string;
    items: { dateOfWork: string; unitNo: string; typeOfWork: string; qty: number; unitPrice: number; amount: number }[];
    invoiceTotal: number;
  }) => {
    setSaving(true);
    try {
      await apiFetch(`/api/crew-invoices/office-create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crewId, ...fields }),
      });
      qc.invalidateQueries({ queryKey: ["/api/crew-invoice-queue"] });
      toast({ title: "Invoice saved — ready for review in the A/P queue" });
      handleClose(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not save invoice.";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const title =
    phase === "upload"
      ? "Scan invoice"
      : phase === "scanning"
        ? "Reading invoice…"
        : "Review extracted invoice";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[700px] border-none shadow-2xl rounded-3xl bg-[var(--background)] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-2xl font-display font-bold text-[var(--secondary)] flex items-center gap-2">
            <FileText className="w-6 h-6" /> {title}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-2">
          {phase === "upload" && (
            <div className="space-y-4">
              {error && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-800">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  {error}
                </div>
              )}
              <UploadZone onFile={handleFile} />
            </div>
          )}

          {phase === "scanning" && (
            <div className="flex flex-col items-center justify-center gap-4 py-20">
              <Loader2 className="w-10 h-10 animate-spin text-[var(--secondary)]" />
              <p className="font-medium text-[var(--secondary)]">Reading invoice…</p>
              <p className="text-sm text-muted-foreground">
                Extracting line items, amounts and crew name
              </p>
            </div>
          )}

          {phase === "review" && scanResult && file && (
            <ReviewForm
              file={file}
              result={scanResult}
              onSave={handleSave}
              saving={saving}
            />
          )}
        </div>

        {phase === "upload" && (
          <DialogFooter className="shrink-0 pt-2">
            <Button
              variant="ghost"
              onClick={() => handleClose(false)}
              className="rounded-full px-6"
            >
              Cancel
            </Button>
          </DialogFooter>
        )}
        {phase === "review" && (
          <DialogFooter className="shrink-0 pt-2">
            <Button
              variant="ghost"
              onClick={() => {
                setPhase("upload");
                setScanResult(null);
                setFile(null);
              }}
              className="rounded-full px-6 text-muted-foreground"
            >
              ← Try different file
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
