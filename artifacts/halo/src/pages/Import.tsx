import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useParseIngest,
  useCommitIngest,
  useScanIngest,
  useListImportHistory,
  getListImportHistoryQueryKey,
  getListPropertiesQueryKey,
  getListJobsQueryKey,
  getListInvoicesQueryKey,
  getListExpensesQueryKey,
  getListInventoryQueryKey,
  getGetMoneySummaryQueryKey,
  getGetTodayQueryKey,
  type IngestRecord,
} from "@workspace/api-client-react";
import { ChevronLeft, FileUp, Camera, Sparkles, Check, FileText, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { extractFileText, renderPdfPages } from "@/lib/extractText";
import { prepareScanImage } from "@/lib/scanImage";

const targetLabels: Record<string, string> = {
  properties: "Properties",
  jobs: "Jobs",
  invoices: "Invoices",
  expenses: "Expenses",
  inventory: "Inventory",
  price_items: "Price list",
};

function fieldPreview(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
}

export default function Import() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const parse = useParseIngest();
  const scan = useScanIngest();
  const commit = useCommitIngest();
  const history = useListImportHistory();

  const [filename, setFilename] = useState<string | null>(null);
  const [fileObj, setFileObj] = useState<File | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [records, setRecords] = useState<IngestRecord[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [reading, setReading] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const reset = () => {
    setRecords([]);
    setSelected(new Set());
    setSummary(null);
    setDone(null);
  };

  const isImageFile = (file: File): boolean => {
    if (file.type.startsWith("image/")) return true;
    return /\.(heic|heif|jpg|jpeg|png|webp|gif|bmp|tiff|tif)$/i.test(file.name);
  };

  const looksUnreadable = (text: string): boolean => {
    const trimmed = text.trim();
    if (!trimmed) return true;
    const sample = trimmed.slice(0, 4000);
    let nonPrintable = 0;
    for (let i = 0; i < sample.length; i++) {
      const code = sample.charCodeAt(i);
      if (code === 9 || code === 10 || code === 13) continue;
      if (code < 32 || code === 0xfffd) nonPrintable++;
    }
    return nonPrintable / sample.length > 0.15;
  };

  const applyResult = (result: {
    summary?: string | null;
    records: IngestRecord[];
  }) => {
    setSummary(result.summary ?? null);
    setRecords(result.records);
    setSelected(new Set(result.records.map((_, i) => i)));
    if (result.records.length === 0) {
      toast({
        title: "Nothing to import",
        description: "The file was read but no records were detected.",
      });
    }
  };

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    reset();
    setFilename(file.name);
    setFileObj(file);
    setReading(true);
    try {
      const lowerName = file.name.toLowerCase();

      // Images (including HEIC/HEIF) → vision OCR, same as the photo path.
      if (isImageFile(file)) {
        let prepared;
        try {
          prepared = await prepareScanImage(file);
        } catch {
          toast({
            title: "Couldn't read that photo format",
            description:
              "Try taking the photo again or export it as JPEG.",
            variant: "destructive",
          });
          return;
        }
        const jpgName = lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")
          ? file.name
          : `${file.name.replace(/\.[^.]+$/, "")}.jpg`;
        setFilename(jpgName);
        setFileObj(new File([prepared.blob], jpgName, { type: prepared.mediaType }));
        const result = await scan.mutateAsync({
          data: { image: prepared.base64, mediaType: prepared.mediaType, filename: jpgName },
        });
        applyResult(result);
        return;
      }

      // Excel spreadsheets → convert every sheet to CSV, parse as text.
      if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const sections = wb.SheetNames.map((name) => {
          const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
          return `# Sheet: ${name}\n${csv}`;
        });
        const content = sections.join("\n\n");
        if (looksUnreadable(content)) {
          toast({
            title: "Couldn't read that spreadsheet",
            description: "No readable content found in the file.",
            variant: "destructive",
          });
          return;
        }
        const result = await parse.mutateAsync({
          data: { filename: file.name, content, mimeType: "text/plain", target: "auto" },
        });
        applyResult(result);
        return;
      }

      // Word documents → extract raw text via mammoth.
      if (lowerName.endsWith(".docx")) {
        const mammoth = await import("mammoth");
        const arrayBuffer = await file.arrayBuffer();
        const { value } = await mammoth.extractRawText({ arrayBuffer });
        if (looksUnreadable(value)) {
          toast({
            title: "Couldn't read that document",
            description: "No readable text found in the file.",
            variant: "destructive",
          });
          return;
        }
        const result = await parse.mutateAsync({
          data: { filename: file.name, content: value, mimeType: "text/plain", target: "auto" },
        });
        applyResult(result);
        return;
      }

      const { content, mimeType, isPdf } = await extractFileText(file);
      let result: { summary?: string | null; records: IngestRecord[] };
      // Scanned/image-only PDFs have little or no selectable text — OCR the
      // rendered pages instead of giving up.
      if (isPdf && content.trim().length < 120) {
        const pages = await renderPdfPages(file);
        if (pages.length === 0) {
          toast({
            title: "Couldn't read that file",
            description: "No readable content found in the PDF.",
            variant: "destructive",
          });
          return;
        }
        const merged: IngestRecord[] = [];
        const summaries: string[] = [];
        for (let i = 0; i < pages.length; i++) {
          const pageResult = await scan.mutateAsync({
            data: {
              image: pages[i],
              mediaType: "image/jpeg",
              filename: `${file.name} (page ${i + 1})`,
            },
          });
          merged.push(...pageResult.records);
          if (pageResult.summary) summaries.push(pageResult.summary);
        }
        result = { summary: summaries[0] ?? null, records: merged };
      } else if (looksUnreadable(content)) {
        toast({
          title: "Couldn't read that file",
          description:
            "No readable text found. Supported formats: photos (JPEG, PNG, HEIC), PDF, CSV, TXT, Excel (.xlsx/.xls), Word (.docx), and JSON.",
          variant: "destructive",
        });
        return;
      } else {
        result = await parse.mutateAsync({
          data: { filename: file.name, content, mimeType, target: "auto" },
        });
      }
      applyResult(result);
    } catch {
      toast({
        title: "Import failed",
        description: "Could not parse that file. Please try another.",
        variant: "destructive",
      });
    } finally {
      setReading(false);
    }
  };

  const onPhotoPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    reset();
    const photoName = `receipt-${new Date().toISOString().slice(0, 10)}.jpg`;
    setFilename(photoName);
    setReading(true);
    try {
      const { blob, base64, mediaType } = await prepareScanImage(file);
      setFileObj(new File([blob], photoName, { type: mediaType }));
      const result = await scan.mutateAsync({
        data: { image: base64, mediaType, filename: photoName },
      });
      setSummary(result.summary ?? null);
      setRecords(result.records);
      setSelected(new Set(result.records.map((_, i) => i)));
      if (result.records.length === 0) {
        toast({
          title: "Couldn't read the receipt",
          description: "Try a clearer, well-lit photo taken straight-on.",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Scan failed",
        description: "Could not read that photo. Please try again.",
        variant: "destructive",
      });
    } finally {
      setReading(false);
    }
  };

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const uploadOriginal = async (file: File): Promise<string | null> => {
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
  };

  const onCommit = async () => {
    const chosen = records.filter((_, i) => selected.has(i));
    if (chosen.length === 0) return;
    try {
      const objectPath = fileObj ? await uploadOriginal(fileObj) : null;
      if (fileObj && !objectPath) {
        toast({
          title: "Couldn't save your document",
          description: "The original file could not be stored, so the import was canceled. Please try again.",
          variant: "destructive",
        });
        return;
      }
      const result = await commit.mutateAsync({
        data: {
          records: chosen,
          filename: filename ?? fileObj?.name ?? null,
          mimeType: fileObj?.type || null,
          objectPath,
          summary,
        },
      });
      for (const key of [
        getListPropertiesQueryKey(),
        getListJobsQueryKey(),
        getListInvoicesQueryKey(),
        getListExpensesQueryKey(),
        getListInventoryQueryKey(),
        getGetMoneySummaryQueryKey(),
        getGetTodayQueryKey(),
        getListImportHistoryQueryKey(),
      ]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      setDone(
        `Imported ${result.committed} record${result.committed === 1 ? "" : "s"}.` +
          (result.messages && result.messages.length
            ? ` ${result.messages.length} skipped.`
            : ""),
      );
      setRecords([]);
      setSelected(new Set());
      toast({ title: "Import complete", description: `${result.committed} added.` });
    } catch {
      toast({ title: "Import failed", variant: "destructive" });
    }
  };

  const busy = reading || parse.isPending || scan.isPending;

  return (
    <div className="pt-2 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <Link
        href="/"
        className="inline-flex items-center gap-[3px] text-[13px] text-muted-foreground mb-[10px]"
      >
        <ChevronLeft className="w-[15px] h-[15px]" /> Back
      </Link>
      <div className="font-display font-bold text-[24px] tracking-[-0.02em] leading-none">
        Import
      </div>
      <div className="text-[13px] text-muted-foreground mt-[6px] mb-[16px]">
        Snap a receipt or a photo of handwritten field notes, or drop in a
        spreadsheet, Word doc, CSV, PDF, or any document. HALO reads it and
        files each record where it belongs.
      </div>

      <label className="w-full mb-[10px] flex items-center justify-center gap-[8px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-[var(--ink)] bg-[var(--primary)] shadow-[0_4px_16px_rgba(180,255,68,0.35)] cursor-pointer transition-transform active:scale-[0.98]">
        <Camera className="w-[18px] h-[18px]" />
        {busy ? "Working…" : "Scan a receipt"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={onPhotoPicked}
          disabled={busy}
        />
      </label>

      <label className="w-full mb-[14px] flex items-center justify-center gap-[8px] rounded-[13px] py-[12px] text-[14px] font-display font-bold text-[var(--ink)] bg-card border border-border shadow-[var(--shadow)] cursor-pointer transition-transform active:scale-[0.98]">
        <FileUp className="w-[17px] h-[17px] text-[var(--gold-dark)]" />
        {busy ? "Reading…" : "Choose a file"}
        <input
          type="file"
          accept="image/*,.heic,.heif,.pdf,.csv,.txt,.tsv,.xlsx,.xls,.docx,.json"
          className="hidden"
          onChange={onFilePicked}
          disabled={busy}
        />
      </label>

      {filename && (
        <div className="text-[12.5px] text-muted-foreground mb-[12px] truncate">
          {busy ? "Reading" : "Read"}: <span className="font-medium">{filename}</span>
        </div>
      )}

      {done && (
        <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[15px] text-[13.5px] flex items-center gap-[8px]">
          <Check className="w-[16px] h-[16px] text-[var(--green,#3c7a4e)] shrink-0" />
          <span>{done}</span>
        </div>
      )}

      {summary && records.length > 0 && (
        <div className="flex items-start gap-[7px] text-[12.5px] text-muted-foreground mb-[12px]">
          <Sparkles className="w-[14px] h-[14px] text-[var(--gold-dark)] shrink-0 mt-[1px]" />
          <span>{summary}</span>
        </div>
      )}

      {records.length > 0 && (
        <>
          <div className="flex flex-col gap-[10px]">
            {records.map((r, i) => {
              const isSel = selected.has(i);
              return (
                <button
                  key={i}
                  onClick={() => toggle(i)}
                  className={`text-left bg-card rounded-[14px] shadow-[var(--shadow)] p-[13px] border transition-colors ${
                    isSel ? "border-[var(--gold)]" : "border-border opacity-60"
                  }`}
                >
                  <div className="flex items-center gap-[8px] mb-[4px]">
                    <span
                      className={`w-[18px] h-[18px] rounded-[6px] grid place-items-center shrink-0 border ${
                        isSel
                          ? "bg-[var(--gold-light)] border-[var(--gold)]"
                          : "border-border"
                      }`}
                    >
                      {isSel && <Check className="w-[12px] h-[12px] text-[var(--ink)]" />}
                    </span>
                    <span className="text-[10.5px] font-bold uppercase tracking-[0.06em] px-[7px] py-[2px] rounded-full bg-[var(--paper)] border border-border">
                      {targetLabels[r.target] || r.target}
                    </span>
                    {r.label && (
                      <span className="font-semibold text-[13.5px] truncate">
                        {r.label}
                      </span>
                    )}
                  </div>
                  <div className="text-[12px] text-muted-foreground break-words pl-[26px]">
                    {fieldPreview(r.fields)}
                  </div>
                </button>
              );
            })}
          </div>
          <button
            onClick={onCommit}
            disabled={commit.isPending || selected.size === 0}
            className="w-full mt-[14px] rounded-[13px] py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_4px_16px_rgba(180,255,68,0.35)] disabled:opacity-50 transition-transform active:scale-[0.98]"
          >
            {commit.isPending
              ? "Importing…"
              : `Import ${selected.size} record${selected.size === 1 ? "" : "s"}`}
          </button>
        </>
      )}

      <div className="mt-[22px]">
        <div className="font-display font-bold text-[16px] mb-[10px]">Upload History</div>
        {(history.data?.uploads ?? []).length === 0 ? (
          <div className="text-[12.5px] text-muted-foreground">
            No imports yet. Your uploaded documents will appear here.
          </div>
        ) : (
          <div className="flex flex-col gap-[10px]">
            {history.data!.uploads.map((u) => (
              <div
                key={u.id}
                className="bg-card rounded-[14px] shadow-[var(--shadow)] p-[13px] border border-border"
              >
                <div className="flex items-center gap-[8px]">
                  <FileText className="w-[15px] h-[15px] text-[var(--gold-dark)] shrink-0" />
                  <span className="font-semibold text-[13.5px] truncate flex-1">{u.filename}</span>
                  {u.objectPath && (
                    <a
                      href={`/api/storage${u.objectPath}`}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 inline-flex items-center gap-[4px] text-[12px] font-semibold text-[var(--gold-dark)]"
                    >
                      View <ExternalLink className="w-[12px] h-[12px]" />
                    </a>
                  )}
                </div>
                <div className="text-[12px] text-muted-foreground mt-[4px] pl-[23px]">
                  {new Date(u.createdAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}{" "}
                  · {u.committed} imported
                  {u.skipped ? ` · ${u.skipped} skipped` : ""}
                </div>
                {u.summary && (
                  <div className="text-[12px] text-muted-foreground mt-[2px] pl-[23px]">
                    {u.summary}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
