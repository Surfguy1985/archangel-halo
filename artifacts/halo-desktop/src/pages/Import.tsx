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
import { FileUp, Sparkles, Check, FileText, ExternalLink } from "lucide-react";
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
    return /\.(heic|heif|jpg|jpeg|png|webp|gif|bmp|tiff)$/i.test(file.name);
  };

  const looksReadable = (text: string): boolean => {
    const trimmed = text.trim();
    if (!trimmed) return false;
    const sample = trimmed.slice(0, 4000);
    let printable = 0;
    for (let i = 0; i < sample.length; i++) {
      const code = sample.charCodeAt(i);
      if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) {
        printable++;
      }
    }
    return printable / sample.length >= 0.85;
  };

  const finishParse = (result: { summary?: string | null; records: IngestRecord[] }) => {
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

      // Images (incl. HEIC) → prepare + vision OCR scan
      if (isImageFile(file)) {
        let prepared;
        try {
          prepared = await prepareScanImage(file);
        } catch {
          toast({
            title: "Couldn't read that photo format",
            description:
              "Couldn't read that photo format — try taking the photo again or export it as JPEG.",
            variant: "destructive",
          });
          return;
        }
        const { blob, base64, mediaType } = prepared;
        setFileObj(new File([blob], file.name, { type: mediaType }));
        const result = await scan.mutateAsync({
          data: { image: base64, mediaType, filename: file.name },
        });
        finishParse(result);
        return;
      }

      // Excel spreadsheets → CSV per sheet
      if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const parts: string[] = [];
        for (const sheetName of wb.SheetNames) {
          const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]);
          if (csv.trim()) parts.push(`# ${sheetName}\n${csv}`);
        }
        const content = parts.join("\n\n");
        if (!content.trim()) {
          toast({
            title: "Couldn't read that file",
            description: "No readable content found in the spreadsheet.",
            variant: "destructive",
          });
          return;
        }
        const result = await parse.mutateAsync({
          data: { filename: file.name, content, mimeType: "text/plain", target: "auto" },
        });
        finishParse(result);
        return;
      }

      // Word documents → raw text
      if (lowerName.endsWith(".docx")) {
        const mammoth = await import("mammoth");
        const arrayBuffer = await file.arrayBuffer();
        const { value } = await mammoth.extractRawText({ arrayBuffer });
        if (!value.trim()) {
          toast({
            title: "Couldn't read that file",
            description: "No readable text found in the document.",
            variant: "destructive",
          });
          return;
        }
        const result = await parse.mutateAsync({
          data: { filename: file.name, content: value, mimeType: "text/plain", target: "auto" },
        });
        finishParse(result);
        return;
      }

      const { content, mimeType, isPdf } = await extractFileText(file);

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
        finishParse({ summary: summaries[0] ?? null, records: merged });
        return;
      }

      if (!content.trim() || (!isPdf && !looksReadable(content))) {
        toast({
          title: "Couldn't read that file",
          description:
            "That file format isn't readable. Try a photo, PDF, CSV, text, Excel (.xlsx/.xls), or Word (.docx) file.",
          variant: "destructive",
        });
        return;
      }

      const result = await parse.mutateAsync({
        data: { filename: file.name, content, mimeType, target: "auto" },
      });
      finishParse(result);
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
    <div className="p-8 max-w-4xl mx-auto space-y-6 animate-in fade-in duration-500">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-[var(--ink)] tracking-tight">Import Data</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Drop in almost anything — a photo of handwritten field notes or a receipt,
            an Excel or CSV spreadsheet, a Word doc, a PDF, or plain text. HALO reads
            it and files each record where it belongs.
          </p>
        </div>
      </header>

      <label className="w-full flex items-center justify-center gap-2 rounded-xl py-8 border-2 border-dashed border-border hover:border-[var(--gold)] hover:bg-[var(--gold-tint)] text-lg font-display font-bold text-[var(--ink)] cursor-pointer transition-colors">
        <FileUp className="w-6 h-6 text-[var(--gold-dark)]" />
        {busy ? "Reading file…" : "Choose a file to import"}
        <input
          type="file"
          accept="image/*,.heic,.heif,.pdf,.csv,.txt,.tsv,.xlsx,.xls,.docx,.json"
          className="hidden"
          onChange={onFilePicked}
          disabled={busy}
        />
      </label>

      {filename && (
        <div className="text-sm text-muted-foreground truncate">
          {busy ? "Reading" : "Read"}: <span className="font-medium text-[var(--ink)]">{filename}</span>
        </div>
      )}

      {done && (
        <div className="bg-card rounded-xl shadow-sm p-4 text-sm flex items-center gap-3 border border-border">
          <div className="w-8 h-8 rounded-full bg-[var(--green)]/10 flex items-center justify-center shrink-0">
            <Check className="w-4 h-4 text-[var(--green)]" />
          </div>
          <span className="font-medium">{done}</span>
        </div>
      )}

      {summary && records.length > 0 && (
        <div className="flex items-start gap-2 text-sm text-muted-foreground bg-[var(--gold-tint)]/50 p-4 rounded-xl border border-[var(--gold)]/20">
          <Sparkles className="w-5 h-5 text-[var(--gold-dark)] shrink-0" />
          <span className="leading-relaxed">{summary}</span>
        </div>
      )}

      {records.length > 0 && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-bold text-lg">Detected Records</h2>
            <span className="text-sm text-muted-foreground">{selected.size} of {records.length} selected</span>
          </div>
          
          <div className="grid gap-3">
            {records.map((r, i) => {
              const isSel = selected.has(i);
              return (
                <button
                  key={i}
                  onClick={() => toggle(i)}
                  className={`text-left bg-card rounded-xl shadow-sm p-4 border transition-colors flex items-start gap-4 ${
                    isSel ? "border-[var(--gold)] bg-[var(--gold-tint)]/10" : "border-border hover:border-border/80 opacity-70"
                  }`}
                >
                  <div className={`mt-0.5 w-5 h-5 rounded flex items-center justify-center shrink-0 border ${
                      isSel ? "bg-[var(--gold-light)] border-[var(--gold)]" : "border-input bg-background"
                    }`}
                  >
                    {isSel && <Check className="w-3.5 h-3.5 text-black" />}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--paper)] border border-border text-[var(--ink)]">
                        {targetLabels[r.target] || r.target}
                      </span>
                      {r.label && (
                        <span className="font-semibold text-base truncate text-[var(--ink)]">
                          {r.label}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground break-words">
                      {fieldPreview(r.fields)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          
          <button
            onClick={onCommit}
            disabled={commit.isPending || selected.size === 0}
            className="w-full py-4 rounded-xl font-display font-bold text-lg text-black bg-[var(--primary)] shadow-md disabled:opacity-50 transition-transform active:scale-[0.98]"
          >
            {commit.isPending
              ? "Importing…"
              : `Import ${selected.size} record${selected.size === 1 ? "" : "s"}`}
          </button>
        </div>
      )}

      <section className="space-y-3 pt-4">
        <h2 className="font-display font-bold text-lg text-[var(--ink)]">Upload History</h2>
        {(history.data?.uploads ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No imports yet. Your uploaded documents will appear here.
          </p>
        ) : (
          <div className="grid gap-3">
            {history.data!.uploads.map((u) => (
              <div
                key={u.id}
                className="bg-card rounded-xl shadow-sm p-4 border border-border flex items-start gap-4"
              >
                <div className="w-10 h-10 rounded-lg bg-[var(--gold-tint)] flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5 text-[var(--gold-dark)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-semibold text-[var(--ink)] truncate">{u.filename}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(u.createdAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground mt-0.5">
                    {u.committed} imported
                    {u.skipped ? ` · ${u.skipped} skipped` : ""}
                    {u.summary ? ` — ${u.summary}` : ""}
                  </div>
                  {u.messages && u.messages.length > 0 && (
                    <ul className="text-xs text-muted-foreground mt-1 list-disc list-inside space-y-0.5">
                      {u.messages.slice(0, 4).map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  )}
                </div>
                {u.objectPath && (
                  <a
                    href={`/api/storage${u.objectPath}`}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--gold-dark)] hover:underline"
                  >
                    View document <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
