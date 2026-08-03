import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Minus, ChevronDown, Check, Building2, Zap, AlertTriangle } from "lucide-react";
import {
  useCreateInvoice,
  useUpdateInvoice,
  useCreateContact,
  useListProperties,
  useListJobs,
  useGetJob,
  useGetProperty,
  getGetJobQueryKey,
  getGetPropertyQueryKey,
  getListInvoicesQueryKey,
  getGetMoneySummaryQueryKey,
  getGetTodayQueryKey,
  getGetInvoiceQueryKey,
  type InvoiceDetail,
} from "@workspace/api-client-react";

const fieldCls =
  "w-full bg-card border border-[var(--hairline)] rounded-[18px] py-[14px] px-[16px] text-[15px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-[var(--ink)] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40 focus:border-[var(--gold)]";
const smallField =
  "w-full bg-card border border-[var(--hairline)] rounded-[10px] py-[8px] px-[10px] text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]";
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

const TERM_OPTIONS = [
  { label: "On receipt", value: "Due on receipt", days: 0 },
  { label: "Net 15", value: "Net 15", days: 15 },
  { label: "Net 30", value: "Net 30", days: 30 },
  { label: "Net 45", value: "Net 45", days: 45 },
];

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
  const { data: propertyDetail } = useGetProperty(propertyId, {
    query: { enabled: open && !!propertyId, queryKey: getGetPropertyQueryKey(propertyId) },
  });
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
  const [dueTouched, setDueTouched] = useState(false);
  const [billToName, setBillToName] = useState("");
  const [propertyAddress, setPropertyAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<LineRow[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const create = useCreateInvoice();
  const update = useUpdateInvoice();
  const createContact = useCreateContact();
  const [billingEmailDraft, setBillingEmailDraft] = useState("");

  // Warn up front when the selected property has no billing email —
  // otherwise sending the invoice dead-ends with a 422 at the last step.
  const missingBillingEmail =
    !!propertyId &&
    !!propertyDetail &&
    !propertyDetail.contacts.some((c) => c.email);

  const saveBillingEmail = () => {
    const email = billingEmailDraft.trim();
    if (!email || !propertyId) return;
    createContact.mutate(
      {
        data: {
          propertyId,
          name:
            propertyDetail?.property.pmcName ||
            propertyDetail?.property.name ||
            "Billing contact",
          role: "Billing",
          email,
        },
      },
      {
        onSuccess: () => {
          setBillingEmailDraft("");
          queryClient.invalidateQueries({
            queryKey: getGetPropertyQueryKey(propertyId),
          });
        },
      },
    );
  };
  const isEdit = !!invoice;
  const pending = create.isPending || update.isPending;
  const isError = create.isError || update.isError;

  const localStr = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const todayStr = () => localStr(new Date());
  const addDaysFrom = (base: string, days: number) => {
    const [y, m, dd] = base.split("-").map(Number);
    const d = new Date(y, (m ?? 1) - 1, dd ?? 1, 12);
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
      setDueTouched(true);
      setBillToName(invoice.billToName ?? "");
      setPropertyAddress(invoice.propertyAddress ?? "");
      setNotes(invoice.notes ?? "");
      setDetailsOpen(true);
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
      setDueOn(addDaysFrom(todayStr(), 30));
      setDueTouched(false);
      setBillToName("");
      setPropertyAddress("");
      setNotes("");
      setRows([]);
      setDetailsOpen(false);
    }
  }, [open, invoice]);

  // Terms drive the due date until the user overrides it manually.
  const pickTerms = (value: string, days: number) => {
    setTerms(value);
    if (!dueTouched) setDueOn(addDaysFrom(issuedOn || todayStr(), days));
  };

  // Keep the auto due date in sync when the invoice date changes.
  useEffect(() => {
    if (!open || dueTouched || !issuedOn) return;
    const opt = TERM_OPTIONS.find((t) => t.value === terms);
    if (opt) setDueOn(addDaysFrom(issuedOn, opt.days));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issuedOn]);

  // Preselect the job (and its property) when opened from a "Create invoice" action.
  useEffect(() => {
    if (!open || invoice || !initialJobId) return;
    const job = initialJobDetail?.job;
    if (!job) return;
    setPropertyId(job.propertyId ?? "");
    setJobId(job.id);
  }, [open, invoice, initialJobId, initialJobDetail]);

  const priceItems = propertyDetail?.priceItems ?? [];

  const setRow = (key: string, patch: Partial<LineRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key: string) =>
    setRows((rs) => rs.filter((r) => r.key !== key));

  const bumpQty = (key: string, delta: number) =>
    setRows((rs) =>
      rs.map((r) => {
        if (r.key !== key) return r;
        const next = Math.max(1, (parseFloat(r.qty) || 1) + delta);
        return { ...r, qty: String(next) };
      }),
    );

  // Tap a price-book service: add it, or bump qty if it's already on the invoice.
  const quickAdd = (service: string, rate: number) => {
    setRows((rs) => {
      const existing = rs.find(
        (r) => r.typeOfWork === service && parseFloat(r.unitPrice) === rate,
      );
      if (existing) {
        return rs.map((r) =>
          r.key === existing.key
            ? { ...r, qty: String((parseFloat(r.qty) || 1) + 1) }
            : r,
        );
      }
      return [
        ...rs,
        { ...blankRow(), typeOfWork: service, unitPrice: String(rate) },
      ];
    });
  };

  const rowAmount = (r: LineRow) =>
    (parseFloat(r.qty) || 0) * (parseFloat(r.unitPrice) || 0);
  const total = rows.reduce((s, r) => s + rowAmount(r), 0);

  // Client's stated budget carried from the work request onto the linked job:
  // warn (don't block) when the invoice total exceeds what they expected.
  const linkedJob =
    jobs?.find((j) => j.id === jobId) ??
    (initialJobDetail?.job?.id === jobId ? initialJobDetail.job : undefined);
  const clientBudget =
    typeof linkedJob?.clientBudget === "number" ? linkedJob.clientBudget : null;
  const overBudget = clientBudget != null && total > clientBudget;

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
      if (propertyId)
        queryClient.invalidateQueries({
          queryKey: getGetPropertyQueryKey(propertyId),
        });
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

  const selectedProperty = properties?.find((p) => p.id === propertyId);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[26px] bg-[var(--paper)] p-0 flex flex-col max-h-[92vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]"
      >
        <div className="w-[40px] h-[4.5px] rounded-[3px] bg-[rgba(23,24,28,0.16)] mx-auto mt-[10px] mb-[4px] shrink-0" />
        <div className="p-[8px_20px_26px] overflow-y-auto">
          <SheetHeader className="text-left mb-[14px]">
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">
              {isEdit ? `Edit ${invoice?.invoiceNo}` : "New invoice"}
            </SheetTitle>
            <div className="text-[13px] text-muted-foreground">
              {isEdit
                ? "Amounts recompute from line items."
                : "Pick the property, tap services, done."}
            </div>
          </SheetHeader>

          {/* STEP 1 — Property tiles */}
          <div className="mb-[16px]">
            <span className={labelCls}>Who's this for?</span>
            {selectedProperty && !isEdit ? (
              <button
                onClick={() => {
                  setPropertyId("");
                  setJobId("");
                }}
                className="w-full flex items-center gap-[12px] bg-card rounded-[16px] border-2 border-[var(--gold)] p-[12px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] active:scale-[0.98] transition-transform"
              >
                {selectedProperty.imagePath ? (
                  <img
                    src={`/api/storage${selectedProperty.imagePath}`}
                    alt=""
                    className="w-[44px] h-[44px] rounded-[12px] object-cover shrink-0"
                  />
                ) : (
                  <div className="w-[44px] h-[44px] rounded-[12px] bg-[rgba(185,138,47,0.12)] grid place-items-center shrink-0">
                    <Building2 className="w-[20px] h-[20px] text-[var(--gold-dark)]" />
                  </div>
                )}
                <div className="flex-1 text-left min-w-0">
                  <div className="font-semibold text-[15px] text-[var(--ink)] truncate">
                    {selectedProperty.name}
                  </div>
                  <div className="text-[12px] text-muted-foreground truncate">
                    {selectedProperty.pmcName || selectedProperty.city || "Tap to change"}
                  </div>
                </div>
                <div className="w-[24px] h-[24px] rounded-full bg-[var(--gold-light)] grid place-items-center shrink-0">
                  <Check className="w-[14px] h-[14px] text-black" strokeWidth={3} />
                </div>
              </button>
            ) : isEdit ? (
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
            ) : (
              <div className="grid grid-cols-2 gap-[8px]">
                {properties?.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPropertyId(p.id)}
                    className="relative overflow-hidden rounded-[16px] bg-card border border-[var(--hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-left active:scale-[0.97] transition-transform"
                  >
                    <div className="relative h-[64px] bg-[linear-gradient(135deg,#2a2b31,#17181c)]">
                      {p.imagePath && (
                        <img
                          src={`/api/storage${p.imagePath}`}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      )}
                      <div className="absolute inset-x-0 bottom-0 h-full bg-[linear-gradient(to_top,rgba(10,10,12,0.72),transparent_70%)]" />
                      <div className="absolute bottom-[6px] left-[10px] right-[8px] font-semibold text-[13px] text-white truncate drop-shadow-sm">
                        {p.name}
                      </div>
                    </div>
                  </button>
                ))}
                {(properties?.length ?? 0) === 0 && (
                  <div className="col-span-2 text-[13px] text-muted-foreground bg-card rounded-[14px] border border-[var(--hairline)] p-[14px] text-center">
                    Add a property first — invoices bill to a property.
                  </div>
                )}
              </div>
            )}
          </div>

          {propertyId && (
            <>
              {/* Heads-up: no billing email means the send will fail later. */}
              {missingBillingEmail && (
                <div className="mb-[16px] rounded-[16px] border border-[rgba(190,140,20,0.35)] bg-[rgba(255,196,66,0.12)] p-[12px]">
                  <div className="flex items-start gap-[8px]">
                    <AlertTriangle className="w-[16px] h-[16px] text-[#8f6a1f] shrink-0 mt-[2px]" />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-[13px] text-[var(--ink)]">
                        No billing email for this property
                      </div>
                      <div className="text-[12px] text-muted-foreground mt-[2px]">
                        You can create the invoice, but it can't be emailed until a
                        billing contact email is saved. Add one now:
                      </div>
                      <div className="flex gap-[6px] mt-[8px]">
                        <input
                          type="email"
                          className={`${smallField} flex-1`}
                          placeholder="billing@company.com"
                          value={billingEmailDraft}
                          onChange={(e) => setBillingEmailDraft(e.target.value)}
                          data-testid="input-billing-email"
                        />
                        <button
                          onClick={saveBillingEmail}
                          disabled={!billingEmailDraft.trim() || createContact.isPending}
                          className="shrink-0 px-[14px] rounded-[10px] text-[12.5px] font-display font-bold bg-[var(--gold-light)] text-black disabled:opacity-40 active:scale-[0.96] transition-transform"
                          data-testid="button-save-billing-email"
                        >
                          {createContact.isPending ? "Saving…" : "Save"}
                        </button>
                      </div>
                      {createContact.isError && (
                        <div className="text-[11.5px] text-destructive mt-[4px]">
                          Couldn't save. Try again.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 2 — One-tap services from the price book */}
              {!isEdit && priceItems.length > 0 && (
                <div className="mb-[16px]">
                  <span className={labelCls}>
                    <Zap className="w-[11px] h-[11px] inline mr-[3px] -mt-[1px]" />
                    Tap to add — {selectedProperty?.name ?? "property"} price book
                  </span>
                  <div className="flex flex-wrap gap-[7px]">
                    {priceItems.map((pi) => (
                      <button
                        key={pi.id}
                        onClick={() => quickAdd(pi.service, pi.rate)}
                        className="inline-flex items-center gap-[6px] pl-[12px] pr-[10px] py-[8px] rounded-full bg-card border border-[var(--hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-[13px] font-semibold text-[var(--ink)] active:scale-[0.94] transition-transform"
                      >
                        {pi.service}
                        <span className="text-[12px] font-bold text-[var(--gold-dark)] tabular-nums">
                          {money(pi.rate)}
                        </span>
                        <span className="w-[18px] h-[18px] rounded-full bg-[rgba(185,138,47,0.14)] grid place-items-center">
                          <Plus className="w-[11px] h-[11px] text-[var(--gold-dark)]" strokeWidth={3} />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* STEP 3 — Line items */}
              <div className="mb-[4px]">
                <div className="flex items-center justify-between mb-[8px]">
                  <span className="font-display font-bold text-[14px]">
                    Line items
                  </span>
                  <span className="font-display font-bold text-[15px] tabular-nums text-[var(--gold-dark)]">
                    {money(total)}
                  </span>
                </div>
                {overBudget && (
                  <div
                    className="mb-[10px] rounded-[16px] border border-[rgba(190,140,20,0.35)] bg-[rgba(255,196,66,0.12)] p-[12px]"
                    data-testid="banner-over-budget"
                  >
                    <div className="flex items-start gap-[8px]">
                      <AlertTriangle className="w-[16px] h-[16px] text-[#8f6a1f] shrink-0 mt-[2px]" />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-[13px] text-[var(--ink)]">
                          Over the client's budget
                        </div>
                        <div className="text-[12px] text-muted-foreground mt-[2px]">
                          This total ({money(total)}) exceeds the{" "}
                          {money(clientBudget!)} budget the client gave on their
                          work request. You can still send it — just expect
                          questions.
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {rows.length === 0 && (
                  <div className="text-[13px] text-muted-foreground bg-card/60 border border-dashed border-[var(--hairline)] rounded-[14px] p-[14px] text-center mb-[10px]">
                    {priceItems.length > 0
                      ? "Tap a service above, or add a custom line."
                      : "Add your first line item below."}
                  </div>
                )}
                <div className="flex flex-col gap-[10px]">
                  {rows.map((r) => (
                    <div
                      key={r.key}
                      className="bg-card rounded-[16px] border border-[var(--hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-[12px]"
                    >
                      <div className="flex items-center gap-[8px] mb-[10px]">
                        <input
                          className={`${smallField} flex-1 font-semibold`}
                          placeholder="Type of work *"
                          value={r.typeOfWork}
                          onChange={(e) =>
                            setRow(r.key, { typeOfWork: e.target.value })
                          }
                        />
                        <button
                          onClick={() => removeRow(r.key)}
                          className="shrink-0 w-[34px] h-[34px] flex items-center justify-center rounded-full bg-[rgba(23,24,28,0.04)] text-muted-foreground active:scale-90 transition-transform"
                          aria-label="Remove line"
                        >
                          <Trash2 className="w-[15px] h-[15px]" />
                        </button>
                      </div>
                      <div className="flex items-center gap-[10px]">
                        {/* Apple-style qty stepper */}
                        <div className="flex items-center bg-[rgba(23,24,28,0.05)] rounded-full p-[3px] shrink-0">
                          <button
                            onClick={() => bumpQty(r.key, -1)}
                            className="w-[30px] h-[30px] rounded-full grid place-items-center bg-card shadow-sm active:scale-90 transition-transform"
                            aria-label="Decrease quantity"
                          >
                            <Minus className="w-[13px] h-[13px]" strokeWidth={2.5} />
                          </button>
                          <span className="w-[34px] text-center font-display font-bold text-[15px] tabular-nums">
                            {parseFloat(r.qty) || 1}
                          </span>
                          <button
                            onClick={() => bumpQty(r.key, 1)}
                            className="w-[30px] h-[30px] rounded-full grid place-items-center bg-card shadow-sm active:scale-90 transition-transform"
                            aria-label="Increase quantity"
                          >
                            <Plus className="w-[13px] h-[13px]" strokeWidth={2.5} />
                          </button>
                        </div>
                        <span className="text-muted-foreground text-[13px]">×</span>
                        <div className="flex-1 relative">
                          <span className="absolute left-[10px] top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">$</span>
                          <input
                            className={`${smallField} pl-[22px]`}
                            placeholder="0.00"
                            inputMode="decimal"
                            value={r.unitPrice}
                            onChange={(e) =>
                              setRow(r.key, { unitPrice: e.target.value })
                            }
                          />
                        </div>
                        <div className="w-[86px] text-right font-display font-bold tabular-nums text-[15px]">
                          {money(rowAmount(r))}
                        </div>
                      </div>
                      {/* Optional per-line extras */}
                      <div className="flex gap-[8px] mt-[10px]">
                        <input
                          type="date"
                          className={`${smallField} w-[128px]`}
                          value={r.dateOfWork}
                          onChange={(e) =>
                            setRow(r.key, { dateOfWork: e.target.value })
                          }
                          aria-label="Date of work"
                        />
                        <input
                          className={`${smallField} w-[76px]`}
                          placeholder="Unit #"
                          value={r.unitNo}
                          onChange={(e) => setRow(r.key, { unitNo: e.target.value })}
                        />
                        <input
                          className={`${smallField} flex-1`}
                          placeholder="Note (optional)"
                          value={r.description}
                          onChange={(e) =>
                            setRow(r.key, { description: e.target.value })
                          }
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setRows((rs) => [...rs, blankRow()])}
                  className="w-full mt-[10px] flex items-center justify-center gap-[6px] rounded-full py-[11px] text-[13.5px] font-display font-bold bg-card border border-[var(--hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-[var(--ink)] active:scale-[0.98] transition-transform"
                >
                  <Plus className="w-[15px] h-[15px]" /> Custom line
                </button>
              </div>

              {/* STEP 4 — Terms as pills */}
              <div className="mt-[16px] mb-[4px]">
                <span className={labelCls}>Payment terms</span>
                <div className="grid grid-cols-4 gap-[6px] bg-[rgba(23,24,28,0.05)] rounded-full p-[4px]">
                  {TERM_OPTIONS.map((t) => (
                    <button
                      key={t.value}
                      onClick={() => pickTerms(t.value, t.days)}
                      className={`py-[8px] rounded-full text-[12px] font-bold transition-all ${
                        terms === t.value
                          ? "bg-card shadow-sm text-[var(--ink)]"
                          : "text-muted-foreground"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className="text-[12px] text-muted-foreground mt-[6px] px-[4px]">
                  Due {dueOn || "—"}
                </div>
              </div>

              {/* Collapsible details */}
              <button
                onClick={() => setDetailsOpen((o) => !o)}
                className="w-full flex items-center justify-between mt-[14px] py-[10px] px-[4px]"
              >
                <span className="font-display font-bold text-[14px]">More details</span>
                <ChevronDown
                  className={`w-[18px] h-[18px] text-muted-foreground transition-transform ${detailsOpen ? "rotate-180" : ""}`}
                />
              </button>
              {detailsOpen && (
                <div className="flex flex-col gap-[10px] animate-in fade-in slide-in-from-top-2 duration-200">
                  {(jobs?.length ?? 0) > 0 && (
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
                        onChange={(e) => {
                          setDueTouched(true);
                          setDueOn(e.target.value);
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <span className={labelCls}>PO number</span>
                    <input
                      className={fieldCls}
                      placeholder="PO-…"
                      value={poNumber}
                      onChange={(e) => setPoNumber(e.target.value)}
                    />
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
                  <div>
                    <span className={labelCls}>Notes</span>
                    <textarea
                      className={`${fieldCls} min-h-[64px] resize-none`}
                      placeholder="Payment instructions, thank-you note…"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </>
          )}

          <button
            className="w-full mt-[18px] rounded-full py-[15px] font-display font-bold text-[16px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] disabled:opacity-40 transition-transform active:scale-[0.98]"
            onClick={submit}
            disabled={!canSubmit}
          >
            {pending
              ? "Saving…"
              : isEdit
                ? "Save changes"
                : total > 0
                  ? `Create invoice · ${money(total)}`
                  : "Create invoice"}
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
