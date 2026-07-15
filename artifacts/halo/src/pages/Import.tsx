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
import { extractFileText } from "@/lib/extractText";

const targetLabels: Record<string, string> = {
  properties: "Properties",
  jobs: "Jobs",
  invoices: "Invoices",
  expenses: "Expenses",
  inventory: "Inventory",
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

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    reset();
    setFilename(file.name);
    setFileObj(file);
    setReading(true);
    try {
      const { content, mimeType } = await extractFileText(file);
      if (!content.trim()) {
        toast({
          title: "Couldn't read that file",
          description: "No readable text found. Try a CSV or text-based PDF.",
          variant: "destructive",
        });
        return;
      }
      const result = await parse.mutateAsync({
        data: { filename: file.name, content, mimeType, target: "auto" },
      });
      setSummary(result.summary ?? null);
      setRecords(result.records);
      setSelected(new Set(result.records.map((_, i) => i)));
      if (result.records.length === 0) {
        toast({
          title: "Nothing to import",
          description: "The file was read but no records were detected.",
        });
      }
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

  const downscalePhoto = (file: File): Promise<{ blob: Blob; base64: string }> =>
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const maxEdge = 1800;
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("no canvas"));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            if (!blob) return reject(new Error("no blob"));
            const reader = new FileReader();
            reader.onload = () => {
              const dataUrl = String(reader.result);
              resolve({ blob, base64: dataUrl.slice(dataUrl.indexOf(",") + 1) });
            };
            reader.onerror = () => reject(new Error("read failed"));
            reader.readAsDataURL(blob);
          },
          "image/jpeg",
          0.85,
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("bad image"));
      };
      img.src = url;
    });

  const onPhotoPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    reset();
    const photoName = `receipt-${new Date().toISOString().slice(0, 10)}.jpg`;
    setFilename(photoName);
    setReading(true);
    try {
      const { blob, base64 } = await downscalePhoto(file);
      setFileObj(new File([blob], photoName, { type: "image/jpeg" }));
      const result = await scan.mutateAsync({
        data: { image: base64, mediaType: "image/jpeg", filename: photoName },
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
        Snap a receipt in the field or drop in a CSV, PDF, or any document. HALO
        reads it and files each record where it belongs.
      </div>

      <label className="w-full mb-[10px] flex items-center justify-center gap-[8px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_4px_16px_rgba(143,106,31,0.34)] cursor-pointer transition-transform active:scale-[0.98]">
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
                          ? "bg-[var(--gold)] border-[var(--gold)]"
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
            className="w-full mt-[14px] rounded-[13px] py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_4px_16px_rgba(143,106,31,0.34)] disabled:opacity-50 transition-transform active:scale-[0.98]"
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
