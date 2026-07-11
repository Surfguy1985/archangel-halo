import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import {
  useCreateInvoice,
  useUpdateInvoice,
  useListProperties,
  useListJobs,
  useGetJob,
  getGetJobQueryKey,
  getListInvoicesQueryKey,
  getGetMoneySummaryQueryKey,
  getGetTodayQueryKey,
  getGetInvoiceQueryKey,
  type InvoiceDetail,
} from "@workspace/api-client-react";

const fieldCls =
  "w-full bg-card border border-border rounded-[13px] py-[11px] px-[14px] text-[14.5px] shadow-[var(--shadow)] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]";
const smallField =
  "w-full bg-card border border-border rounded-[10px] py-[8px] px-[10px] text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]";
const labelCls =
  "text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.08em] mb-[5px] block";

type LineRow = {
  key: string;
  dateOfWork: string;
  unitNo: string;
  typeOfWork: string;
  description: string;
  qty: string;
  unitPrice: string;
};

let rowSeq = 0;
const blankRow = (): LineRow => ({
  key: `r${rowSeq++}`,
  dateOfWork: "",
  unitNo: "",
  typeOfWork: "",
  description: "",
  qty: "1",
  unitPrice: "",
});

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function InvoiceEditor({
  open,
  onOpenChange,
  invoice,
  initialJobId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, the editor is in edit mode. */
  invoice?: InvoiceDetail | null;
  /** Preselect this job (and its property) when creating a new invoice. */
  initialJobId?: string | null;
}) {
  const queryClient = useQueryClient();
  const { data: properties } = useListProperties();
  const [propertyId, setPropertyId] = useState("");
  const { data: jobs } = useListJobs(propertyId ? { propertyId } : undefined);
  const { data: initialJobDetail } = useGetJob(initialJobId ?? "", {
    query: {
      enabled: open && !invoice && !!initialJobId,
      queryKey: getGetJobQueryKey(initialJobId ?? ""),
    },
  });
  const [jobId, setJobId] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [terms, setTerms] = useState("Net 30");
  const [issuedOn, setIssuedOn] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [billToName, setBillToName] = useState("");
  const [propertyAddress, setPropertyAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<LineRow[]>([blankRow()]);

  const create = useCreateInvoice();
  const update = useUpdateInvoice();
  const isEdit = !!invoice;
  const pending = create.isPending || update.isPending;
  const isError = create.isError || update.isError;

  const localStr = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const todayStr = () => localStr(new Date());
  const addDaysStr = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return localStr(d);
  };

  // Hydrate form from existing invoice (edit) or reset defaults (create).
  useEffect(() => {
    if (!open) return;
    if (invoice) {
      setPropertyId(invoice.propertyId ?? "");
      setJobId(invoice.jobId ?? "");
      setPoNumber(invoice.poNumber ?? "");
      setTerms(invoice.terms ?? "Net 30");
      setIssuedOn(invoice.issuedOn ?? todayStr());
      setDueOn(invoice.dueAt ? invoice.dueAt.slice(0, 10) : "");
      setBillToName(invoice.billToName ?? "");
      setPropertyAddress(invoice.propertyAddress ?? "");
      setNotes(invoice.notes ?? "");
      setRows(
        invoice.lineItems.length
          ? invoice.lineItems.map((it) => ({
              key: `r${rowSeq++}`,
              dateOfWork: it.dateOfWork ?? "",
              unitNo: it.unitNo ?? "",
              typeOfWork: it.typeOfWork,
              description: it.description ?? "",
              qty: String(it.qty),
              unitPrice: String(it.unitPrice),
            }))
          : [blankRow()],
      );
    } else {
      setPropertyId("");
      setJobId("");
      setPoNumber("");
      setTerms("Net 30");
      setIssuedOn(todayStr());
      setDueOn(addDaysStr(30));
      setBillToName("");
      setPropertyAddress("");
      setNotes("");
      setRows([blankRow()]);
    }
  }, [open, invoice]);

  // Preselect the job (and its property) when opened from a "Create invoice" action.
  useEffect(() => {
    if (!open || invoice || !initialJobId) return;
    const job = initialJobDetail?.job;
    if (!job) return;
    setPropertyId(job.propertyId ?? "");
    setJobId(job.id);
  }, [open, invoice, initialJobId, initialJobDetail]);

  const setRow = (key: string, patch: Partial<LineRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key: string) =>
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));

  const rowAmount = (r: LineRow) =>
    (parseFloat(r.qty) || 0) * (parseFloat(r.unitPrice) || 0);
  const total = rows.reduce((s, r) => s + rowAmount(r), 0);

  const validRows = rows.filter((r) => r.typeOfWork.trim());
  const canSubmit = !!propertyId && validRows.length > 0 && !pending;

  const submit = () => {
    if (!canSubmit) return;
    const data = {
      propertyId,
      jobId: jobId || undefined,
      poNumber: poNumber.trim() || undefined,
      terms: terms.trim() || undefined,
      issuedOn: issuedOn || undefined,
      dueOn: dueOn || undefined,
      billToName: billToName.trim() || undefined,
      propertyAddress: propertyAddress.trim() || undefined,
      notes: notes.trim() || undefined,
      lineItems: validRows.map((r) => ({
        dateOfWork: r.dateOfWork || undefined,
        unitNo: r.unitNo.trim() || undefined,
        typeOfWork: r.typeOfWork.trim(),
        description: r.description.trim() || undefined,
        qty: parseFloat(r.qty) || 1,
        unitPrice: parseFloat(r.unitPrice) || 0,
      })),
    };
    const onSuccess = () => {
      queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() });
      if (invoice)
        queryClient.invalidateQueries({
          queryKey: getGetInvoiceQueryKey(invoice.id),
        });
      onOpenChange(false);
    };
    if (invoice) {
      update.mutate({ id: invoice.id, data }, { onSuccess });
    } else {
      create.mutate({ data }, { onSuccess });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[26px] bg-[var(--paper)] p-0 flex flex-col max-h-[92vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]"
      >
        <div className="w-[40px] h-[4.5px] rounded-[3px] bg-[rgba(23,24,28,0.16)] mx-auto mt-[10px] mb-[4px] shrink-0" />
        <div className="p-[8px_20px_26px] overflow-y-auto">
          <SheetHeader className="text-left mb-[16px]">
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">
              {isEdit ? `Edit ${invoice?.invoiceNo}` : "New invoice"}
            </SheetTitle>
            <div className="text-[13px] text-muted-foreground">
              {isEdit
                ? "Amounts recompute from line items."
                : "Number auto-assigns. Total sums the line items."}
            </div>
          </SheetHeader>

          <div className="flex flex-col gap-[10px]">
            <div>
              <span className={labelCls}>Property (Bill To)</span>
              <select
                className={fieldCls}
                value={propertyId}
                onChange={(e) => {
                  setPropertyId(e.target.value);
                  setJobId("");
                }}
              >
                <option value="">Select property…</option>
                {properties?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            {propertyId && (
              <div>
                <span className={labelCls}>Linked job (optional)</span>
                <select
                  className={fieldCls}
                  value={jobId}
                  onChange={(e) => setJobId(e.target.value)}
                >
                  <option value="">No linked job</option>
                  {jobs?.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.jobNo} · {j.category || j.description}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex gap-[10px]">
              <div className="flex-1">
                <span className={labelCls}>PO number</span>
                <input
                  className={fieldCls}
                  placeholder="PO-…"
                  value={poNumber}
                  onChange={(e) => setPoNumber(e.target.value)}
                />
              </div>
              <div className="w-[130px]">
                <span className={labelCls}>Terms</span>
                <input
                  className={fieldCls}
                  placeholder="Net 30"
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-[10px]">
              <div className="flex-1">
                <span className={labelCls}>Invoice date</span>
                <input
                  type="date"
                  className={fieldCls}
                  value={issuedOn}
                  onChange={(e) => setIssuedOn(e.target.value)}
                />
              </div>
              <div className="flex-1">
                <span className={labelCls}>Due date</span>
                <input
                  type="date"
                  className={fieldCls}
                  value={dueOn}
                  onChange={(e) => setDueOn(e.target.value)}
                />
              </div>
            </div>
            <div>
              <span className={labelCls}>Bill-to name (override)</span>
              <input
                className={fieldCls}
                placeholder="Defaults to property PMC / name"
                value={billToName}
                onChange={(e) => setBillToName(e.target.value)}
              />
            </div>
            <div>
              <span className={labelCls}>Property address (override)</span>
              <input
                className={fieldCls}
                placeholder="Defaults to property address"
                value={propertyAddress}
                onChange={(e) => setPropertyAddress(e.target.value)}
              />
            </div>
          </div>

          {/* Line items */}
          <div className="mt-[18px]">
            <div className="flex items-center justify-between mb-[8px]">
              <span className="font-display font-bold text-[14px]">
                Line items
              </span>
              <span className="font-display font-bold text-[15px] tabular-nums text-[var(--gold-dark)]">
                {money(total)}
              </span>
            </div>
            <div className="flex flex-col gap-[10px]">
              {rows.map((r) => (
                <div
                  key={r.key}
                  className="bg-card rounded-[14px] border border-border shadow-[var(--shadow)] p-[10px]"
                >
                  <div className="flex items-center gap-[8px] mb-[8px]">
                    <input
                      className={`${smallField} flex-1`}
                      placeholder="Type of work *"
                      value={r.typeOfWork}
                      onChange={(e) =>
                        setRow(r.key, { typeOfWork: e.target.value })
                      }
                    />
                    <button
                      onClick={() => removeRow(r.key)}
                      disabled={rows.length === 1}
                      className="shrink-0 w-[34px] h-[34px] flex items-center justify-center rounded-[10px] text-muted-foreground disabled:opacity-30 active:scale-95"
                      aria-label="Remove line"
                    >
                      <Trash2 className="w-[16px] h-[16px]" />
                    </button>
                  </div>
                  <div className="flex gap-[8px] mb-[8px]">
                    <input
                      type="date"
                      className={`${smallField} flex-1`}
                      value={r.dateOfWork}
                      onChange={(e) =>
                        setRow(r.key, { dateOfWork: e.target.value })
                      }
                    />
                    <input
                      className={`${smallField} w-[86px]`}
                      placeholder="Unit #"
                      value={r.unitNo}
                      onChange={(e) => setRow(r.key, { unitNo: e.target.value })}
                    />
                  </div>
                  <input
                    className={`${smallField} mb-[8px]`}
                    placeholder="Description (optional)"
                    value={r.description}
                    onChange={(e) =>
                      setRow(r.key, { description: e.target.value })
                    }
                  />
                  <div className="flex items-center gap-[8px]">
                    <div className="w-[70px]">
                      <input
                        className={smallField}
                        placeholder="Qty"
                        inputMode="decimal"
                        value={r.qty}
                        onChange={(e) => setRow(r.key, { qty: e.target.value })}
                      />
                    </div>
                    <span className="text-muted-foreground text-[13px]">×</span>
                    <div className="flex-1">
                      <input
                        className={smallField}
                        placeholder="Unit price"
                        inputMode="decimal"
                        value={r.unitPrice}
                        onChange={(e) =>
                          setRow(r.key, { unitPrice: e.target.value })
                        }
                      />
                    </div>
                    <div className="w-[92px] text-right font-display font-semibold tabular-nums text-[14px]">
                      {money(rowAmount(r))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() => setRows((rs) => [...rs, blankRow()])}
              className="w-full mt-[10px] flex items-center justify-center gap-[6px] rounded-[11px] py-[10px] text-[13px] font-display font-bold bg-card border border-dashed border-border text-muted-foreground active:scale-[0.98]"
            >
              <Plus className="w-[15px] h-[15px]" /> Add line
            </button>
          </div>

          <div className="mt-[14px]">
            <span className={labelCls}>Notes</span>
            <textarea
              className={`${fieldCls} min-h-[64px] resize-none`}
              placeholder="Payment instructions, thank-you note…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <button
            className="w-full mt-[18px] rounded-[13px] py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_6px_20px_rgba(143,106,31,0.34)] disabled:opacity-50 transition-transform active:scale-[0.98]"
            onClick={submit}
            disabled={!canSubmit}
          >
            {pending
              ? "Saving…"
              : isEdit
                ? "Save changes"
                : `Create invoice · ${money(total)}`}
          </button>
          {isError && (
            <div className="text-[12.5px] text-destructive text-center mt-[10px]">
              Couldn't save. Try again.
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
