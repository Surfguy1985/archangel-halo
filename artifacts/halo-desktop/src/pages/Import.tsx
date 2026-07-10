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
import { FileUp, Sparkles, Check } from "lucide-react";
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
    <div className="p-8 max-w-4xl mx-auto space-y-6 animate-in fade-in duration-500">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-[var(--ink)] tracking-tight">Import Data</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Drop in a CSV, PDF, or any document. HALO reads it and files each record
            where it belongs. Works best with CSV, text, and text-based PDFs.
          </p>
        </div>
      </header>

      <label className="w-full flex items-center justify-center gap-2 rounded-xl py-8 border-2 border-dashed border-border hover:border-[var(--gold)] hover:bg-[var(--gold-tint)] text-lg font-display font-bold text-[var(--ink)] cursor-pointer transition-colors">
        <FileUp className="w-6 h-6 text-[var(--gold-dark)]" />
        {busy ? "Reading file…" : "Choose a file to import"}
        <input
          type="file"
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
                      isSel ? "bg-[var(--gold)] border-[var(--gold)]" : "border-input bg-background"
                    }`}
                  >
                    {isSel && <Check className="w-3.5 h-3.5 text-white" />}
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
            className="w-full py-4 rounded-xl font-display font-bold text-lg text-white bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-md disabled:opacity-50 transition-transform active:scale-[0.98]"
          >
            {commit.isPending
              ? "Importing…"
              : `Import ${selected.size} record${selected.size === 1 ? "" : "s"}`}
          </button>
        </div>
      )}
    </div>
  );
}
