import { useRef, useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPropertySopRule,
  useUploadPropertySopDocument,
  useDeletePropertySopRule,
  getGetPropertySopRuleQueryKey,
  useListJobs,
  getListJobsQueryKey,
  useBuildInvoiceJobDraft,
  useCreateInvoice,
  useGetProperty,
  getGetPropertyQueryKey,
  getListInvoicesQueryKey,
  useListCatalogItems,
  getListCatalogItemsQueryKey,
  type SopRuleDetail,
  type InvoiceJobDraft,
  type CatalogItem,
} from "@workspace/api-client-react";
import {
  CheckCircle2,
  ChevronDown,
  FileText,
  Loader2,
  ShieldCheck,
  Sparkles,
  Plus,
  Trash2,
  Upload,
  Wand2,
  AlertTriangle,
  Zap,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { prepareScanImage } from "@/lib/scanImage";

export const SOP_ACCEPT =
  "application/pdf,text/csv,.csv,text/plain,.txt,image/png,image/jpeg,image/webp,image/gif";
const ACCEPT = SOP_ACCEPT;

export function sopFileToBase64(file: File): Promise<string> {
  return fileToBase64(file);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? "");
      resolve(s.includes(",") ? s.slice(s.indexOf(",") + 1) : s);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function RuleSheet({ rule }: { rule: SopRuleDetail }) {
  const r = rule.rules;
  const f = r.format ?? {};
  const p = r.property ?? {};
  const row = (label: string, value: string | null | undefined) =>
    value ? (
      <div>
        <div className="text-[11px] font-bold text-muted-foreground">{label}</div>
        <div className="text-sm text-foreground mt-0.5">{value}</div>
      </div>
    ) : null;
  const formatLine = [
    f.invoice_number_format && `Invoice # ${f.invoice_number_format}`,
    f.date_format,
    f.currency,
    f.tax_rate_percent != null && f.tax_rate_percent > 0 && `Tax ${f.tax_rate_percent}%`,
    f.due_days != null && `Due in ${f.due_days} days`,
    f.po_required && "PO required",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl bg-[var(--ink)] text-white p-4">
        <ShieldCheck className="w-5 h-5 text-[var(--gold-light,#B4FF44)] shrink-0 mt-0.5" />
        <div>
          <div className="font-bold">Rule is live</div>
          <div className="text-sm text-white/70 mt-0.5">
            Every invoice created for this property — from any job or invoice
            button — follows this rule automatically.
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {row(
          "Property / aliases",
          [p.name, ...(p.aliases ?? [])].filter(Boolean).join(" · "),
        )}
        {row("Bill to", [p.client_company, p.billing_address].filter(Boolean).join(" — "))}
        {row("Format", formatLine)}
        {row("Payment terms", f.payment_terms)}
        {row("Remit to", f.remit_to)}
        {row(
          "Delivery",
          [f.delivery_method, f.send_to].filter(Boolean).join(" · "),
        )}
      </div>
      {(r.required_fields?.length ?? 0) > 0 && (
        <div>
          <div className="text-[11px] font-bold text-muted-foreground">Required on every invoice</div>
          <div className="text-sm mt-0.5">{(r.required_fields ?? []).join(", ")}</div>
        </div>
      )}
      {(r.line_item_rules?.length ?? 0) > 0 && (
        <div>
          <div className="text-[11px] font-bold text-muted-foreground">Line item rules</div>
          <div className="space-y-1 mt-1">
            {(r.line_item_rules ?? []).map((l, i) => (
              <div key={i} className="text-sm">
                • <span className="font-semibold">{l.category || "General"}</span>
                {l.description_rule ? ` — ${l.description_rule}` : ""}
                {l.default_rate != null ? ` (${l.rate_type || "flat"} $${l.default_rate})` : ""}
              </div>
            ))}
          </div>
        </div>
      )}
      {(r.special_instructions?.length ?? 0) > 0 && (
        <div>
          <div className="text-[11px] font-bold text-muted-foreground">Special instructions</div>
          <div className="space-y-1 mt-1">
            {(r.special_instructions ?? []).map((s, i) => (
              <div key={i} className="text-sm">• {s}</div>
            ))}
          </div>
        </div>
      )}
      <div className="text-xs text-muted-foreground">
        Extracted from <span className="font-semibold">{rule.fileName}</span> ·
        updated {new Date(rule.updatedAt).toLocaleDateString()}
      </div>
    </div>
  );
}

function money(n: number | null | undefined): string {
  return `$${(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function JobInvoiceBuilder({
  propertyId,
  poRequired,
  onCreated,
}: {
  propertyId: string;
  poRequired: boolean;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState("");
  const [po, setPo] = useState("");
  const [draft, setDraft] = useState<InvoiceJobDraft | null>(null);
  const [items, setItems] = useState<InvoiceJobDraft["lineItems"]>([]);
  const [notes, setNotes] = useState("");
  const [created, setCreated] = useState<{ id: string; invoiceNo: string; amount: number } | null>(null);

  const { data: jobs } = useListJobs(
    { propertyId },
    { query: { queryKey: getListJobsQueryKey({ propertyId }) } },
  );
  const active = (jobs ?? []).filter(
    (j) => j.status !== "cancelled" && (j as { boardStatus?: string }).boardStatus !== "cleared",
  );
  const build = useBuildInvoiceJobDraft();
  const create = useCreateInvoice();

  const { data: propertyDetail } = useGetProperty(propertyId, {
    query: { enabled: !!propertyId, queryKey: getGetPropertyQueryKey(propertyId) },
  });
  const priceItems = propertyDetail?.priceItems ?? [];

  // Master catalog — all services across all properties.
  const { data: catalogItems } = useListCatalogItems({
    query: { queryKey: getListCatalogItemsQueryKey() },
  });
  const [catalogSearch, setCatalogSearch] = useState("");
  const [showCatalog, setShowCatalog] = useState(false);

  const catalogGroups = useMemo(() => {
    if (!catalogItems) return [];
    const q = catalogSearch.toLowerCase();
    const filtered = q
      ? catalogItems.filter(
          (c: CatalogItem) =>
            c.service.toLowerCase().includes(q) ||
            (c.category ?? "").toLowerCase().includes(q),
        )
      : catalogItems;
    const map = new Map<string, CatalogItem[]>();
    for (const c of filtered as CatalogItem[]) {
      const cat = c.category?.trim() || "General";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(c);
    }
    return Array.from(map.entries()).sort(([a], [b]) =>
      /make[\s-]?ready/i.test(a) ? -1 : /make[\s-]?ready/i.test(b) ? 1 : a.localeCompare(b),
    );
  }, [catalogItems, catalogSearch]);

  const addFromCatalog = (item: CatalogItem) => {
    setItems((p) => {
      const existing = p.find(
        (l) => l.typeOfWork === item.service && l.unitPrice === (item.rate ?? 0),
      );
      if (existing) {
        return p.map((l) =>
          l === existing ? { ...l, qty: (l.qty ?? 1) + 1 } : l,
        );
      }
      return [...p, { typeOfWork: item.service, qty: 1, unitPrice: item.rate ?? 0 }];
    });
    setShowCatalog(false);
  };

  const runBuild = () => {
    setDraft(null);
    setCreated(null);
    build.mutate(
      { data: { jobId, poNumber: po || null } },
      {
        onSuccess: (d) => {
          setDraft(d);
          setItems(d.lineItems.map((l) => ({ ...l })));
          setNotes(d.notes ?? "");
        },
        onError: (e) =>
          toast({ title: "Couldn't build the invoice", description: e.message, variant: "destructive" }),
      },
    );
  };

  const runCreate = () => {
    if (!draft) return;
    const cleanItems = items
      .map((l) => ({ ...l, typeOfWork: l.typeOfWork.trim() }))
      .filter((l) => l.typeOfWork.length > 0);
    if (cleanItems.length === 0) {
      toast({ title: "Add at least one line item", variant: "destructive" });
      return;
    }
    create.mutate(
      {
        data: {
          propertyId: draft.propertyId,
          jobId: draft.jobId,
          issuedOn: draft.issuedOn,
          poNumber: draft.poNumber ?? undefined,
          notes: notes.trim() ? notes : undefined,
          lineItems: cleanItems,
        },
      },
      {
        onSuccess: (inv) => {
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
          if (propertyId)
            queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId) });
          toast({
            title: `Invoice ${inv.invoiceNo} created`,
            description: `${money(inv.amount)} · draft, SOP-compliant — ready to review and send.`,
          });
          setCreated({ id: inv.id, invoiceNo: inv.invoiceNo, amount: inv.amount });
        },
        onError: (e) =>
          toast({ title: "Couldn't create the invoice", description: e.message, variant: "destructive" }),
      },
    );
  };

  const statusIcon = (status: string) =>
    status === "pass" ? (
      <CheckCircle2 className="w-4 h-4 text-[var(--gold-dark,#5a7a00)] shrink-0 mt-0.5" />
    ) : status === "fixed" ? (
      <Sparkles className="w-4 h-4 text-[var(--gold-dark,#5a7a00)] shrink-0 mt-0.5" />
    ) : (
      <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
    );

  return (
    <div className="rounded-2xl border border-border bg-white p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Wand2 className="w-4 h-4 text-[var(--gold-dark,#5a7a00)]" />
        <div className="font-bold text-[15px]">Create an invoice from a job</div>
      </div>
      <p className="text-[12.5px] text-muted-foreground -mt-2">
        Pick a job — the wizard breaks it out exactly the way this property's
        SOP demands, then audits its own work against the rule before anything
        is created.
      </p>
      <div className="flex flex-wrap gap-2">
        <select
          value={jobId}
          onChange={(e) => { setJobId(e.target.value); setDraft(null); }}
          className="flex-1 min-w-[220px] border border-border rounded-[10px] px-3 py-2 text-[13.5px] bg-white"
          data-testid="select-invoice-job"
        >
          <option value="">Choose an active job…</option>
          {active.map((j) => (
            <option key={j.id} value={j.id}>
              #{j.jobNo}
              {j.unitNo ? ` · Unit ${j.unitNo}` : ""}
              {j.category ? ` — ${j.category}` : ""} ({j.status})
            </option>
          ))}
        </select>
        {poRequired && (
          <input
            value={po}
            onChange={(e) => setPo(e.target.value)}
            placeholder="PO # (required by SOP)"
            className="w-[170px] border border-border rounded-[10px] px-3 py-2 text-[13.5px]"
            data-testid="input-invoice-po"
          />
        )}
        <Button
          onClick={runBuild}
          disabled={!jobId || build.isPending || (poRequired && !po.trim())}
          className="rounded-full bg-[var(--ink)] text-white font-bold hover:opacity-90"
          data-testid="button-build-invoice"
        >
          {build.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wand2 className="w-4 h-4 mr-2" />}
          {build.isPending ? "Measuring twice…" : "Build invoice"}
        </Button>
      </div>

      {active.length === 0 && (
        <div className="text-[12.5px] text-muted-foreground">No active jobs on this property yet.</div>
      )}

      {draft && (
        <div className="space-y-4" data-testid="panel-invoice-draft">
          <div className="space-y-1.5 rounded-xl bg-[var(--paper)] p-3">
            {draft.compliance.map((c, i) => (
              <div key={i} className="flex items-start gap-2">
                {statusIcon(c.status)}
                <div>
                  <span className="text-[12.5px] font-bold">{c.stage}.</span>{" "}
                  <span className="text-[12.5px] text-muted-foreground">{c.detail}</span>
                </div>
              </div>
            ))}
          </div>

          {!created && priceItems.length > 0 && (
            <div className="p-3 rounded-2xl bg-[var(--gold-tint)] border border-[var(--primary)]/40">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                Click to add from this property's price book
              </div>
              <div className="flex flex-wrap gap-2">
                {priceItems.map((pi) => (
                  <button
                    key={pi.id}
                    type="button"
                    onClick={() =>
                      setItems((p) => {
                        const existing = p.find(
                          (l) => l.typeOfWork === pi.service && l.unitPrice === pi.rate,
                        );
                        if (existing) {
                          return p.map((l) =>
                            l === existing ? { ...l, qty: (l.qty ?? 1) + 1 } : l,
                          );
                        }
                        return [...p, { typeOfWork: pi.service, qty: 1, unitPrice: pi.rate }];
                      })
                    }
                    className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-full bg-white border border-border shadow-sm text-[12.5px] font-semibold hover:border-[var(--secondary)] active:scale-95 transition-all"
                    data-testid={`button-wizard-pricebook-${pi.id}`}
                  >
                    {pi.service}
                    <span className="text-xs font-bold text-[var(--secondary)] tabular-nums">
                      {money(pi.rate)}
                    </span>
                    <span className="w-4 h-4 rounded-full bg-[var(--primary)] grid place-items-center">
                      <Plus className="w-2.5 h-2.5 text-black" strokeWidth={3} />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Master catalog picker */}
          {!created && (
            <div>
              <button
                type="button"
                onClick={() => setShowCatalog((v) => !v)}
                className="inline-flex items-center gap-1.5 pl-3 pr-2.5 py-1.5 rounded-full bg-secondary/10 border border-secondary/30 text-[12.5px] font-semibold text-[var(--secondary)] hover:bg-secondary/20 active:scale-95 transition-all w-full justify-center"
                data-testid="button-toggle-master-catalog"
              >
                <Zap className="w-3.5 h-3.5" />
                {showCatalog ? "Close master service list" : "Add from master service list"}
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showCatalog ? "rotate-180" : ""}`} />
              </button>
              {showCatalog && (
                <div className="mt-2 rounded-xl border border-border overflow-hidden shadow-sm" data-testid="panel-master-catalog">
                  <div className="px-3 pt-3 pb-2 border-b border-border bg-muted/30">
                    <input
                      type="text"
                      placeholder="Search all services…"
                      value={catalogSearch}
                      onChange={(e) => setCatalogSearch(e.target.value)}
                      className="w-full bg-white border border-border rounded-[8px] py-1.5 px-3 text-[12.5px] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--secondary)]/40"
                      autoFocus
                    />
                  </div>
                  <div className="max-h-[260px] overflow-y-auto divide-y divide-border">
                    {catalogGroups.length === 0 ? (
                      <div className="px-4 py-5 text-center text-[12.5px] text-muted-foreground">
                        {catalogSearch ? "No services match." : "Loading master list…"}
                      </div>
                    ) : (
                      catalogGroups.map(([cat, catItems]) => (
                        <div key={cat}>
                          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground bg-muted/40 sticky top-0">
                            {cat}
                          </div>
                          {catItems.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => addFromCatalog(item)}
                              className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-secondary/5 active:bg-secondary/10 transition-colors"
                              data-testid={`button-catalog-${item.id}`}
                            >
                              <span className="text-[12.5px] font-semibold text-foreground flex-1 mr-2 truncate">
                                {item.service}
                              </span>
                              <span className="text-[12px] font-bold text-[var(--secondary)] tabular-nums shrink-0">
                                {item.rate != null ? money(item.rate) : "—"}
                              </span>
                            </button>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <datalist id="wizard-price-book-options">
            {priceItems.map((pi) => (
              <option key={pi.id} value={pi.service}>
                {`$${pi.rate}${pi.detail ? ` — ${pi.detail}` : ""}`}
              </option>
            ))}
          </datalist>
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="px-3 py-2 bg-[var(--ink)] text-white flex items-center justify-between">
              <div className="text-[12.5px] font-bold">
                {draft.invoiceNoPreview ? `Invoice ${draft.invoiceNoPreview}` : "Invoice (number assigned on create)"}
              </div>
              <div className="text-[12px] text-white/70">
                {draft.billToName ? `Bill to ${draft.billToName}` : ""}
                {draft.dueOnPreview ? ` · due ${draft.dueOnPreview}` : ""}
              </div>
            </div>
            <table className="w-full text-[12.5px]">
              <tbody>
                {items.map((l, i) => (
                  <tr key={i} className="border-t border-border align-top">
                    <td className="px-3 py-2">
                      <input
                        value={l.typeOfWork}
                        disabled={!!created}
                        list="wizard-price-book-options"
                        onChange={(e) => {
                          const v = e.target.value;
                          const hit = priceItems.find((pi) => pi.service === v);
                          setItems((p) =>
                            p.map((x, xi) =>
                              xi === i
                                ? hit
                                  ? { ...x, typeOfWork: v, unitPrice: hit.rate }
                                  : { ...x, typeOfWork: v }
                                : x,
                            ),
                          );
                        }}
                        className="w-full font-semibold bg-transparent border-b border-transparent focus:border-border outline-none"
                        placeholder="Type of work"
                        data-testid={`input-line-work-${i}`}
                      />
                      <input
                        value={l.description ?? ""}
                        disabled={!!created}
                        onChange={(e) => setItems((p) => p.map((x, xi) => (xi === i ? { ...x, description: e.target.value || undefined } : x)))}
                        className="w-full text-muted-foreground bg-transparent border-b border-transparent focus:border-border outline-none mt-0.5"
                        placeholder="Description"
                        data-testid={`input-line-desc-${i}`}
                      />
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      <input
                        value={l.unitNo ?? ""}
                        disabled={!!created}
                        onChange={(e) => setItems((p) => p.map((x, xi) => (xi === i ? { ...x, unitNo: e.target.value || undefined } : x)))}
                        className="w-[64px] text-muted-foreground bg-transparent border-b border-transparent focus:border-border outline-none"
                        placeholder="Unit"
                        data-testid={`input-line-unit-${i}`}
                      />
                    </td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={l.qty ?? 1}
                        disabled={!!created}
                        onChange={(e) => setItems((p) => p.map((x, xi) => (xi === i ? { ...x, qty: Number(e.target.value) || 0 } : x)))}
                        className="w-[52px] text-right bg-transparent border-b border-border/60 outline-none"
                        data-testid={`input-line-qty-${i}`}
                      />
                      <span className="mx-1 text-muted-foreground">×</span>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={l.unitPrice ?? 0}
                        disabled={!!created}
                        onChange={(e) => setItems((p) => p.map((x, xi) => (xi === i ? { ...x, unitPrice: Number(e.target.value) || 0 } : x)))}
                        className="w-[84px] text-right bg-transparent border-b border-border/60 outline-none"
                        data-testid={`input-line-price-${i}`}
                      />
                    </td>
                    <td className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                      {money((l.qty ?? 1) * (l.unitPrice ?? 0))}
                      {!created && (
                        <button
                          type="button"
                          onClick={() => setItems((p) => p.filter((_, xi) => xi !== i))}
                          className="ml-2 text-muted-foreground hover:text-destructive align-middle"
                          title="Remove line"
                          data-testid={`button-line-remove-${i}`}
                        >
                          <Trash2 className="w-3.5 h-3.5 inline" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-[var(--ink)]">
                  <td className="px-3 py-2 font-bold" colSpan={3}>
                    Total{draft.taxPreview != null ? ` (tax recalculated per SOP on create)` : ""}
                  </td>
                  <td className="px-3 py-2 text-right font-display font-bold">
                    {money(items.reduce((s, l) => s + (l.qty ?? 1) * (l.unitPrice ?? 0), 0))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {!created && (
            <button
              type="button"
              onClick={() =>
                setItems((p) => [
                  ...p,
                  { typeOfWork: "", qty: 1, unitPrice: 0 },
                ])
              }
              className="text-[12.5px] font-bold text-[var(--gold-dark,#5a7a00)] hover:underline"
              data-testid="button-line-add"
            >
              + Add a custom line — anything not on the price list
            </button>
          )}
          <textarea
            value={notes}
            disabled={!!created}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Invoice notes (optional)"
            rows={2}
            className="w-full text-[12px] border border-border rounded-[10px] px-3 py-2 bg-white outline-none"
            data-testid="input-invoice-notes"
          />
          {(() => {
            // Client's stated budget carried from the work request onto the
            // job: warn (don't block) when the draft total exceeds it.
            const job = (jobs ?? []).find((j) => j.id === draft.jobId);
            const budget = typeof job?.clientBudget === "number" ? job.clientBudget : null;
            const editedTotal = items.reduce((s, l) => s + (l.qty ?? 1) * (l.unitPrice ?? 0), 0);
            if (budget == null || editedTotal <= budget) return null;
            return (
              <div
                className="rounded-lg border border-[rgba(190,140,20,0.35)] bg-[rgba(255,196,66,0.12)] p-3 flex items-start gap-2"
                data-testid="banner-over-budget"
              >
                <AlertTriangle className="w-4 h-4 text-[#8f6a1f] shrink-0 mt-0.5" />
                <div className="text-[12.5px]">
                  <span className="font-semibold">Over the client's budget.</span>{" "}
                  <span className="text-muted-foreground">
                    This total ({money(editedTotal)}) exceeds the {money(budget)} budget the client gave
                    on their work request. You can still send it — just expect questions.
                  </span>
                </div>
              </div>
            );
          })()}

          {!created ? (
            <Button
              onClick={runCreate}
              disabled={create.isPending}
              className="w-full rounded-full bg-[var(--gold-light,#B4FF44)] text-black font-bold hover:opacity-90"
              data-testid="button-create-sop-invoice"
            >
              {create.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
              Create this invoice
            </Button>
          ) : (
            <div className="rounded-2xl bg-[var(--ink)] text-white p-4 space-y-3" data-testid="panel-invoice-created">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-[var(--gold-light,#B4FF44)] shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">Invoice {created.invoiceNo} created — {money(created.amount)}</div>
                  <div className="text-sm text-white/70 mt-0.5">
                    Saved as a draft, SOP-compliant. Grab it as a PDF or a CSV formatted to the property's SOP, or open it to keep editing.
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => window.open(`/api/invoices/${created.id}/pdf`, "_blank")}
                  className="rounded-full bg-[var(--gold-light,#B4FF44)] text-black font-bold hover:opacity-90"
                  data-testid="button-download-invoice-pdf"
                >
                  <FileText className="w-4 h-4 mr-2" /> Download PDF
                </Button>
                <Button
                  onClick={() => window.open(`/api/invoices/${created.id}/csv`, "_blank")}
                  variant="outline"
                  className="rounded-full font-bold bg-transparent text-white border-white/30 hover:bg-white/10 hover:text-white"
                  data-testid="button-download-invoice-csv"
                >
                  <FileText className="w-4 h-4 mr-2" /> Download CSV
                </Button>
                <Button
                  variant="outline"
                  className="rounded-full font-bold bg-transparent text-white border-white/30 hover:bg-white/10 hover:text-white"
                  onClick={() => { setDraft(null); setItems([]); setNotes(""); setCreated(null); setJobId(""); setPo(""); }}
                  data-testid="button-build-another"
                >
                  Build another
                </Button>
                <Button
                  variant="outline"
                  className="rounded-full font-bold bg-transparent text-white border-white/30 hover:bg-white/10 hover:text-white ml-auto"
                  onClick={onCreated}
                  data-testid="button-wizard-done"
                >
                  Done
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function InvoiceWizardDialog({
  open,
  onOpenChange,
  propertyId,
  propertyName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  propertyName: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const { data: rule, isLoading } = useGetPropertySopRule(propertyId, {
    query: {
      enabled: open && !!propertyId,
      queryKey: getGetPropertySopRuleQueryKey(propertyId),
      retry: false,
    },
  });
  const upload = useUploadPropertySopDocument();
  const remove = useDeletePropertySopRule();

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: getGetPropertySopRuleQueryKey(propertyId),
    });

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const isPdf = file.type === "application/pdf";
    const isImg = /^image\/(png|jpeg|webp|gif)$/.test(file.type);
    const isCsv = file.type === "text/csv" || /\.csv$/i.test(file.name);
    const isTxt = !isCsv && (file.type === "text/plain" || /\.txt$/i.test(file.name));
    if (!isPdf && !isImg && !isCsv && !isTxt) {
      toast({ title: "Upload a PDF, CSV, or image (PNG/JPG) of the SOP", variant: "destructive" });
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      toast({ title: "File is over 6 MB — export a smaller PDF or a page image", variant: "destructive" });
      return;
    }
    try {
      let data: string;
      let mediaType: string;
      if (isPdf || isCsv || isTxt) {
        data = await fileToBase64(file);
        mediaType = isPdf ? "application/pdf" : isCsv ? "text/csv" : "text/plain";
      } else {
        const prepared = await prepareScanImage(file);
        data = prepared.base64;
        mediaType = prepared.mediaType;
      }
      upload.mutate(
        {
          id: propertyId,
          data: {
            fileName: file.name,
            mediaType: mediaType as "application/pdf",
            data,
          },
        },
        {
          onSuccess: (detail) => {
            invalidate();
            toast({
              title: `Rule created for ${detail.rules.property?.name || propertyName}`,
              description: "All invoices for this property now follow it.",
            });
          },
          onError: (err) =>
            toast({
              title: "Couldn't read the SOP",
              description: err.message,
              variant: "destructive",
            }),
        },
      );
    } catch {
      toast({ title: "Could not read the file", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl bg-[var(--paper)] border-0 rounded-3xl p-8 max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display font-bold text-[24px] text-[var(--ink)]">
            Invoice wizard
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2">
          Upload {propertyName}'s SOP or billing guideline. The wizard extracts
          a fixed rule, and every invoice for this property must follow it.
        </p>

        {isLoading && (
          <div className="py-10 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && upload.isPending && (
          <div className="rounded-2xl border-2 border-dashed border-border bg-white p-10 text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-[var(--gold-dark,#5a7a00)]" />
            <div className="font-bold mt-3">Reading the SOP…</div>
            <div className="text-sm text-muted-foreground mt-1">
              Extracting the billing rule — this takes a few seconds.
            </div>
          </div>
        )}

        {!isLoading && !upload.isPending && rule && (
          <>
            <JobInvoiceBuilder
              propertyId={propertyId}
              poRequired={rule.rules.format?.po_required === true}
              onCreated={() => onOpenChange(false)}
            />
            <RuleSheet rule={rule} />
          </>
        )}

        {!isLoading && !upload.isPending && !rule && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full rounded-2xl border-2 border-dashed border-border bg-white p-10 text-center hover:border-[var(--ink)] transition-colors"
            data-testid="button-sop-upload-zone"
          >
            <Upload className="w-8 h-8 mx-auto text-muted-foreground" />
            <div className="font-bold mt-3">Drop in the SOP guideline document</div>
            <div className="text-sm text-muted-foreground mt-1">
              PDF, CSV, or image (PNG/JPG), up to 6 MB
            </div>
          </button>
        )}

        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        {rule && !upload.isPending && (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button
              onClick={() => fileRef.current?.click()}
              className="rounded-full bg-[var(--gold-light,#B4FF44)] text-black font-bold hover:opacity-90"
              data-testid="button-sop-replace"
            >
              <Upload className="w-4 h-4 mr-2" /> Replace document
            </Button>
            <Button
              variant="outline"
              className="rounded-full font-bold"
              onClick={() => window.open(`/api/properties/${propertyId}/sop-rule/source`, "_blank")}
              data-testid="button-sop-source"
            >
              <FileText className="w-4 h-4 mr-2" /> Source doc
            </Button>
            <Button
              variant="outline"
              className="rounded-full font-bold text-destructive border-destructive/40 hover:bg-destructive/5 ml-auto"
              disabled={remove.isPending}
              onClick={() => {
                if (!confirmingDelete) {
                  setConfirmingDelete(true);
                  return;
                }
                remove.mutate(
                  { id: propertyId },
                  {
                    onSuccess: () => {
                      queryClient.removeQueries({
                        queryKey: getGetPropertySopRuleQueryKey(propertyId),
                      });
                      setConfirmingDelete(false);
                      toast({ title: "SOP rule removed" });
                    },
                    onError: (err) =>
                      toast({ title: "Couldn't remove the rule", description: err.message, variant: "destructive" }),
                  },
                );
              }}
              data-testid="button-sop-delete"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {confirmingDelete ? "Confirm remove" : "Remove rule"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
