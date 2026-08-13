import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useExtractPriceSheet,
  useSavePriceSheetItems,
  getGetPropertyQueryKey,
} from "@workspace/api-client-react";
import { FileUp, Sparkles, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { prepareScanImage } from "@/lib/scanImage";
import { extractFileText, isPdfFile, renderPdfPages } from "@/lib/extractText";

type ReviewRow = {
  key: string;
  include: boolean;
  service: string;
  rate: string;
  unit: string;
  detail: string;
  bidOnly: boolean;
};

let seq = 0;

const isImageFile = (file: File): boolean =>
  file.type.startsWith("image/") ||
  /\.(heic|heif|jpg|jpeg|png|webp|gif|bmp|tiff|tif)$/i.test(file.name);

export function ImportPriceSheetDialog({
  open,
  onOpenChange,
  propertyId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const extract = useExtractPriceSheet();
  const save = useSavePriceSheetItems();
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);

  const reset = () => {
    setRows([]);
    setSummary(null);
    setFilename(null);
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const applyRows = (
    extracted: { service: string; rate?: number | null; unit?: string | null; detail?: string | null; bidOnly: boolean }[],
    sum: string | null,
  ) => {
    if (extracted.length === 0) {
      toast({
        title: "No price lines found",
        description: "The file was read but no services with prices were detected.",
      });
      return;
    }
    setSummary(sum);
    setRows(
      extracted.map((r) => ({
        key: `pr${seq++}`,
        include: !r.bidOnly,
        service: r.service,
        rate: r.rate != null ? String(r.rate) : "",
        unit: r.unit ?? "",
        detail: r.detail ?? "",
        bidOnly: r.bidOnly,
      })),
    );
  };

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    reset();
    setFilename(file.name);
    setReading(true);
    try {
      if (isImageFile(file)) {
        const prepared = await prepareScanImage(file);
        const result = await extract.mutateAsync({
          id: propertyId,
          data: { image: prepared.base64, mediaType: prepared.mediaType, filename: file.name },
        });
        applyRows(result.rows, result.summary ?? null);
        return;
      }
      if (isPdfFile(file)) {
        const { content } = await extractFileText(file);
        if (content.trim().length < 120) {
          // Scanned/image-only PDF — OCR the rendered pages.
          const pages = await renderPdfPages(file);
          if (pages.length === 0) throw new Error("empty pdf");
          const merged: Parameters<typeof applyRows>[0] = [];
          let sum: string | null = null;
          for (let i = 0; i < pages.length; i++) {
            const r = await extract.mutateAsync({
              id: propertyId,
              data: {
                image: pages[i],
                mediaType: "image/jpeg",
                filename: `${file.name} (page ${i + 1})`,
              },
            });
            merged.push(...r.rows);
            sum = sum ?? r.summary ?? null;
          }
          applyRows(merged, sum);
        } else {
          const result = await extract.mutateAsync({
            id: propertyId,
            data: { content, filename: file.name },
          });
          applyRows(result.rows, result.summary ?? null);
        }
        return;
      }
      // Excel spreadsheets → convert every sheet to CSV text.
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const sections = wb.SheetNames.map((name) => {
          const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
          return `# Sheet: ${name}\n${csv}`;
        });
        const content = sections.join("\n\n");
        if (!content.trim()) throw new Error("empty spreadsheet");
        const result = await extract.mutateAsync({
          id: propertyId,
          data: { content, filename: file.name },
        });
        applyRows(result.rows, result.summary ?? null);
        return;
      }
      // CSV / TSV / TXT
      const content = await file.text();
      if (!content.trim()) throw new Error("empty file");
      const result = await extract.mutateAsync({
        id: propertyId,
        data: { content, filename: file.name },
      });
      applyRows(result.rows, result.summary ?? null);
    } catch {
      toast({
        title: "Couldn't read that file",
        description: "Supported: PDF, CSV, TXT, Excel (.xlsx/.xls), or a photo of the price sheet.",
        variant: "destructive",
      });
    } finally {
      setReading(false);
    }
  };

  const setRow = (key: string, patch: Partial<ReviewRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const validIncluded = rows.filter(
    (r) => r.include && r.service.trim() && r.rate.trim() !== "" && !Number.isNaN(Number(r.rate)) && Number(r.rate) >= 0,
  );

  const submit = () => {
    if (validIncluded.length === 0) return;
    save.mutate(
      {
        id: propertyId,
        data: {
          items: validIncluded.map((r) => ({
            service: r.service.trim(),
            rate: Number(r.rate),
            unit: r.unit.trim() || null,
            detail: r.detail.trim() || null,
          })),
        },
      },
      {
        onSuccess: (res) => {
          queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId) });
          toast({
            title: "Price list imported",
            description: `${res.imported.length} added${res.updated.length ? `, ${res.updated.length} updated` : ""}.`,
          });
          handleOpenChange(false);
        },
        onError: (err) =>
          toast({ title: "Couldn't save", description: err.message, variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl border-none shadow-xl">
        <DialogHeader>
          <DialogTitle className="font-display">Import price list</DialogTitle>
        </DialogHeader>

        {rows.length === 0 ? (
          <div className="py-6">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,.heic,.heif,.pdf,.csv,.txt,.tsv,.xlsx,.xls"
              className="hidden"
              onChange={onFilePicked}
              data-testid="input-price-sheet-file"
            />
            <button
              disabled={reading}
              onClick={() => fileRef.current?.click()}
              className="w-full flex flex-col items-center gap-3 border-2 border-dashed border-border rounded-2xl p-10 text-muted-foreground hover:border-[var(--gold)] hover:text-[var(--ink)] transition-colors disabled:opacity-60"
              data-testid="button-pick-price-sheet"
            >
              {reading ? (
                <>
                  <Sparkles className="w-8 h-8 animate-pulse text-[var(--gold-dark)]" />
                  <div className="text-sm font-semibold">Reading {filename ?? "file"}…</div>
                </>
              ) : (
                <>
                  <FileUp className="w-8 h-8" />
                  <div className="text-sm font-semibold">Upload the property's price sheet</div>
                  <div className="text-xs">PDF, CSV, Excel, or a photo — HALO reads the services and rates for review.</div>
                </>
              )}
            </button>
          </div>
        ) : (
          <>
            {summary && <div className="text-sm text-muted-foreground -mt-1">{summary}</div>}
            <div className="max-h-[380px] overflow-y-auto border border-border rounded-lg divide-y divide-border">
              {rows.map((r) => (
                <div key={r.key} className={`flex items-center gap-2 p-2.5 ${r.include ? "" : "opacity-50"}`}>
                  <input
                    type="checkbox"
                    checked={r.include}
                    onChange={(e) => setRow(r.key, { include: e.target.checked })}
                    className="w-4 h-4 accent-[var(--gold-dark)] shrink-0"
                    data-testid={`checkbox-price-row-${r.key}`}
                  />
                  <div className="flex-1 min-w-0 grid grid-cols-[1fr_90px_80px] gap-2">
                    <input
                      value={r.service}
                      onChange={(e) => setRow(r.key, { service: e.target.value })}
                      placeholder="Service"
                      className="bg-white border border-border rounded-[9px] py-1.5 px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40"
                    />
                    <input
                      value={r.rate}
                      onChange={(e) => setRow(r.key, { rate: e.target.value })}
                      inputMode="decimal"
                      placeholder={r.bidOnly ? "BID" : "$"}
                      className="bg-white border border-border rounded-[9px] py-1.5 px-2.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40"
                    />
                    <input
                      value={r.unit}
                      onChange={(e) => setRow(r.key, { unit: e.target.value })}
                      placeholder="unit"
                      className="bg-white border border-border rounded-[9px] py-1.5 px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40"
                    />
                    {r.detail && (
                      <div className="col-span-3 text-xs text-muted-foreground truncate">{r.detail}</div>
                    )}
                  </div>
                  {r.bidOnly && (
                    <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200">
                      <AlertTriangle className="w-3 h-3" /> Bid/quote
                    </span>
                  )}
                </div>
              ))}
            </div>
            <DialogFooter className="gap-2">
              <button
                onClick={reset}
                className="px-4 py-2 rounded-full text-sm font-semibold text-muted-foreground hover:text-[var(--ink)] transition-colors"
              >
                Pick another file
              </button>
              <button
                disabled={validIncluded.length === 0 || save.isPending}
                onClick={submit}
                className="px-5 py-2 rounded-full text-sm font-bold bg-[var(--gold-light,#B4FF44)] text-black disabled:opacity-40 hover:opacity-90 transition-opacity"
                data-testid="button-save-price-sheet"
              >
                {save.isPending
                  ? "Saving…"
                  : `Save ${validIncluded.length} to price book`}
              </button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
