import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useParseIngest,
  useCommitIngest,
  getListPropertiesQueryKey,
  getListJobsQueryKey,
  getListInvoicesQueryKey,
  getListExpensesQueryKey,
  getListInventoryQueryKey,
  getGetMoneySummaryQueryKey,
  type IngestRecord,
} from "@workspace/api-client-react";
import { ChevronLeft, FileUp, Sparkles, Check } from "lucide-react";
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
  const commit = useCommitIngest();

  const [filename, setFilename] = useState<string | null>(null);
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

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const onCommit = async () => {
    const chosen = records.filter((_, i) => selected.has(i));
    if (chosen.length === 0) return;
    try {
      const result = await commit.mutateAsync({ data: { records: chosen } });
      for (const key of [
        getListPropertiesQueryKey(),
        getListJobsQueryKey(),
        getListInvoicesQueryKey(),
        getListExpensesQueryKey(),
        getListInventoryQueryKey(),
        getGetMoneySummaryQueryKey(),
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

  const busy = reading || parse.isPending;

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
        Drop in a CSV, PDF, or any document. HALO reads it and files each record
        where it belongs. Works best with CSV, text, and text-based PDFs.
      </div>

      <label className="w-full mb-[14px] flex items-center justify-center gap-[8px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_4px_16px_rgba(143,106,31,0.34)] cursor-pointer transition-transform active:scale-[0.98]">
        <FileUp className="w-[18px] h-[18px]" />
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
    </div>
  );
}
