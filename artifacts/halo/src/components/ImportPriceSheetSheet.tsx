import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useExtractPriceSheet,
  useSavePriceSheetItems,
  getGetPropertyQueryKey,
} from "@workspace/api-client-react";
import { FileUp, Sparkles, AlertTriangle } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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

const smallField =
  "w-full bg-card border border-[var(--hairline)] rounded-[10px] py-[8px] px-[10px] text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]";

export function ImportPriceSheetSheet({
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
        description: "Supported: PDF, CSV, TXT, or a photo of the price sheet.",
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
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[26px] bg-[var(--paper)] p-0 flex flex-col max-h-[92vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]"
      >
        <div className="w-[40px] h-[4.5px] rounded-[3px] bg-[rgba(23,24,28,0.16)] mx-auto mt-[10px] mb-[4px] shrink-0" />
        <div className="p-[8px_20px_26px] overflow-y-auto flex flex-col min-h-0">
          <SheetHeader className="text-left mb-[12px]">
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">
              Import price list
            </SheetTitle>
            <div className="text-[13px] text-muted-foreground">
              Upload this property's price sheet — review the rates, then save.
            </div>
          </SheetHeader>

          {rows.length === 0 ? (
            <div className="py-[8px]">
              <input
                ref={fileRef}
                type="file"
                accept="image/*,.heic,.heif,.pdf,.csv,.txt,.tsv"
                className="hidden"
                onChange={onFilePicked}
                data-testid="input-price-sheet-file"
              />
              <button
                disabled={reading}
                onClick={() => fileRef.current?.click()}
                className="w-full flex flex-col items-center gap-[10px] border-2 border-dashed border-[var(--hairline)] rounded-[18px] p-[32px_16px] text-muted-foreground active:scale-[0.98] transition-transform disabled:opacity-60"
                data-testid="button-pick-price-sheet"
              >
                {reading ? (
                  <>
                    <Sparkles className="w-[28px] h-[28px] animate-pulse text-[var(--gold-dark)]" />
                    <div className="text-[14px] font-semibold">Reading {filename ?? "file"}…</div>
                  </>
                ) : (
                  <>
                    <FileUp className="w-[28px] h-[28px]" />
                    <div className="text-[14px] font-semibold text-[var(--ink)]">
                      Upload price sheet
                    </div>
                    <div className="text-[12px]">PDF, CSV, or a photo</div>
                  </>
                )}
              </button>
            </div>
          ) : (
            <>
              {summary && (
                <div className="text-[12.5px] text-muted-foreground mb-[10px]">{summary}</div>
              )}
              <div className="bg-card rounded-[16px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] divide-y divide-border mb-[14px]">
                {rows.map((r) => (
                  <div key={r.key} className={`p-[10px_12px] ${r.include ? "" : "opacity-50"}`}>
                    <div className="flex items-center gap-[8px]">
                      <input
                        type="checkbox"
                        checked={r.include}
                        onChange={(e) => setRow(r.key, { include: e.target.checked })}
                        className="w-[17px] h-[17px] accent-[var(--gold-dark)] shrink-0"
                        data-testid={`checkbox-price-row-${r.key}`}
                      />
                      <input
                        value={r.service}
                        onChange={(e) => setRow(r.key, { service: e.target.value })}
                        placeholder="Service"
                        className={`${smallField} flex-1`}
                      />
                      <input
                        value={r.rate}
                        onChange={(e) => setRow(r.key, { rate: e.target.value })}
                        inputMode="decimal"
                        placeholder={r.bidOnly ? "BID" : "$"}
                        className={`${smallField} !w-[76px] tabular-nums shrink-0`}
                      />
                    </div>
                    {(r.bidOnly || r.detail) && (
                      <div className="flex items-center gap-[6px] mt-[6px] pl-[25px]">
                        {r.bidOnly && (
                          <span className="inline-flex items-center gap-[3px] text-[10px] font-bold uppercase tracking-wider rounded-full px-[8px] py-[2px] bg-amber-50 text-amber-700 border border-amber-200 shrink-0">
                            <AlertTriangle className="w-[10px] h-[10px]" /> Bid/quote
                          </span>
                        )}
                        {r.detail && (
                          <span className="text-[11.5px] text-muted-foreground truncate">{r.detail}</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-[10px]">
                <button
                  onClick={reset}
                  className="px-[14px] py-[12px] rounded-[13px] text-[13.5px] font-semibold text-muted-foreground"
                >
                  Pick another
                </button>
                <button
                  disabled={validIncluded.length === 0 || save.isPending}
                  onClick={submit}
                  className="flex-1 rounded-[13px] py-[12px] text-[14.5px] font-display font-bold bg-[var(--gold-light)] text-black disabled:opacity-40 active:scale-[0.98] transition-transform"
                  data-testid="button-save-price-sheet"
                >
                  {save.isPending ? "Saving…" : `Save ${validIncluded.length} to price book`}
                </button>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
