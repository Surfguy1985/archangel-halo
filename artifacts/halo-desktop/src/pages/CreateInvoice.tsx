import { useEffect, useMemo, useRef, useState} from "react";
import { Link, useLocation, useSearch} from "wouter";
import { useQueryClient} from "@tanstack/react-query";
import {
  useCreateInvoice,
  useUpdateInvoice,
  useGetInvoice,
  getGetInvoiceQueryKey,
  useListProperties,
  useGetBusinessSettings,
  useGetJob,
  useListJobs,
  getListJobsQueryKey,
  useGetProperty,
  useGetPropertySopRule,
  useListCatalogItems,
  getGetPropertySopRuleQueryKey,
  getGetJobQueryKey,
  getListInvoicesQueryKey,
  getGetMoneySummaryQueryKey,
  getGetPropertyQueryKey,
  getGetTodayQueryKey,
  getListCatalogItemsQueryKey,
  type InvoiceLineItemInput,
  type CatalogItem,
} from "@workspace/api-client-react";
import { AlertTriangle, ChevronLeft, ChevronRight, Pencil, Plus, Save, Send, ShieldCheck, Trash2, Zap} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast} from "@/hooks/use-toast";
import { Button} from "@/components/ui/button";
import { Input} from "@/components/ui/input";
import { Textarea} from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BusinessInfoDialog} from "@/components/BusinessInfoDialog";
import { SendInvoiceDialog} from "@/components/SendInvoiceDialog";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD"});

const todayLocal = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

type ItemDraft = {
  dateOfWork: string;
  unitNo: string;
  typeOfWork: string;
  description: string;
  qty: string;
  unitPrice: string;
  customWork?: boolean;
};

const emptyItem = (): ItemDraft => ({
  dateOfWork: "",
  unitNo: "",
  typeOfWork: "",
  description: "",
  qty: "1",
  unitPrice: "",
});

const itemAmount = (it: ItemDraft) => {
  const qty = parseFloat(it.qty) || 0;
  const price = parseFloat(it.unitPrice) || 0;
  return Math.round(qty * price * 100) / 100;
};

const labelCls =
  "text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--gold-dark)]";

const TERM_OPTIONS = [
  { label: "On receipt", value: "Due on receipt", days: 0},
  { label: "Net 15", value: "Net 15", days: 15},
  { label: "Net 30", value: "Net 30", days: 30},
  { label: "Net 45", value: "Net 45", days: 45},
  { label: "Net 60", value: "Net 60", days: 60},
];

const addDaysFrom = (base: string, days: number) => {
  const [y, m, dd] = base.split("-").map(Number);
  const d = new Date(y, (m ?? 1) - 1, dd ?? 1, 12);
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export default function CreateInvoice() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast} = useToast();
  const { data: properties} = useListProperties();
  const { data: settings} = useGetBusinessSettings();
  const create = useCreateInvoice();
  const update = useUpdateInvoice();

  const [propertyId, setPropertyId] = useState("");
  const [jobId, setJobId] = useState("");
  const [billToName, setBillToName] = useState("");
  const [propertyAddress, setPropertyAddress] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [terms, setTerms] = useState("Net 30");
  const [issuedOn, setIssuedOn] = useState(todayLocal());
  const [dueOn, setDueOn] = useState(() => addDaysFrom(todayLocal(), 30));
  const [dueTouched, setDueTouched] = useState(false);
  const [notes, setNotes] = useState("");
  const [paymentInstructions, setPaymentInstructions] = useState("");
  const [instructionsTouched, setInstructionsTouched] = useState(false);
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);
  const [editBusiness, setEditBusiness] = useState(false);
  const [sendFor, setSendFor] = useState<{
    id: string;
    invoiceNo: string;
    amount: number;
    propertyId?: string | null;
    billToName?: string | null;
    propertyAddress?: string | null;
    recipientEmail?: string | null;
 } | null>(null);

  useEffect(() => {
    if (settings && !instructionsTouched) {
      setPaymentInstructions(settings.paymentInstructions);
   }
 }, [settings, instructionsTouched]);

  const onPickProperty = (id: string) => {
    setPropertyId(id);
    setJobId("");
    const prop = properties?.find((p) => p.id === id);
    if (prop) {
      setBillToName(prop.pmcName || prop.name);
      setPropertyAddress([prop.name, prop.city].filter(Boolean).join(", "));
   }
 };

  // SOP rule for the selected property — the invoice must follow it.
  const { data: sopRule} = useGetPropertySopRule(propertyId, {
    query: {
      enabled: !!propertyId,
      queryKey: getGetPropertySopRuleQueryKey(propertyId),
      retry: false,
   },
 });
  const sopFormat = sopRule?.rules?.format;
  const sopPoRequired = sopFormat?.po_required === true;
  const sopAppliedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!sopRule || sopAppliedFor.current === propertyId) return;
    sopAppliedFor.current = propertyId;
    const r = sopRule.rules;
    if (r.property?.client_company) setBillToName(r.property.client_company);
    if (r.property?.billing_address) setPropertyAddress(r.property.billing_address);
    if (r.format?.payment_terms) setTerms(r.format.payment_terms);
    if (r.format?.due_days != null && !dueTouched) {
      setDueOn(addDaysFrom(issuedOn || todayLocal(), r.format.due_days));
   }
    // SOP special_instructions no longer prefill notes — notes stay blank
    // for custom text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [sopRule, propertyId]);

  // Jobs at the selected property — every invoice must be tied to one.
  const { data: propertyJobs } = useListJobs(
    { propertyId },
    { query: { enabled: !!propertyId, queryKey: getListJobsQueryKey({ propertyId }) } },
  );

  // Price book for the selected property → one-click line items.
  const { data: propertyDetail} = useGetProperty(propertyId, {
    query: { enabled: !!propertyId, queryKey: getGetPropertyQueryKey(propertyId)},
 });
  const priceItems = propertyDetail?.priceItems ?? [];

  // Group price-book items by category for the dropdown submenu.
  const priceGroups = useMemo(() => {
    const map = new Map<string, typeof priceItems>();
    for (const pi of priceItems) {
      const cat = pi.category?.trim() || "General";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(pi);
    }
    return map;
  }, [priceItems]);
  const hasCategories = priceGroups.size > 1;

  // Master catalog — all services across all properties.
  const { data: catalogItems } = useListCatalogItems({
    query: { enabled: true, queryKey: getListCatalogItemsQueryKey() },
  });
  const [catalogSearch, setCatalogSearch] = useState("");
  const [showCatalog, setShowCatalog] = useState(false);

  const catalogGroups = useMemo(() => {
    if (!catalogItems) return [];
    const q = catalogSearch.toLowerCase();
    const filtered = (q
      ? catalogItems.filter(
          (c: CatalogItem) =>
            c.service.toLowerCase().includes(q) ||
            (c.category ?? "").toLowerCase().includes(q),
        )
      : catalogItems) as CatalogItem[];
    const map = new Map<string, CatalogItem[]>();
    for (const c of filtered) {
      const cat = c.category?.trim() || "General";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(c);
    }
    return Array.from(map.entries()).sort(([a], [b]) =>
      /make[\s-]?ready/i.test(a) ? -1 : /make[\s-]?ready/i.test(b) ? 1 : a.localeCompare(b),
    );
  }, [catalogItems, catalogSearch]);

  const addCatalogService = (item: CatalogItem) => {
    quickAdd(item.service, item.rate ?? 0);
  };

  const quickAdd = (service: string, rate: number) => {
    setItems((prev) => {
      const existing = prev.find(
        (it) => it.typeOfWork === service && parseFloat(it.unitPrice) === rate,
      );
      if (existing) {
        return prev.map((it) =>
          it === existing ? { ...it, qty: String((parseFloat(it.qty) || 1) + 1)} : it,
        );
     }
      const kept = prev.filter((it) => it.typeOfWork.trim() || it.unitPrice.trim());
      return [...kept, { ...emptyItem(), typeOfWork: service, unitPrice: String(rate)}];
   });
 };

  // Terms drive the due date until the user overrides it manually.
  const pickTerms = (value: string, days: number) => {
    setTerms(value);
    if (!dueTouched) setDueOn(addDaysFrom(issuedOn || todayLocal(), days));
 };

  // Keep the auto due date in sync when the invoice date changes.
  useEffect(() => {
    if (dueTouched || !issuedOn) return;
    const opt = TERM_OPTIONS.find((t) => t.value === terms);
    if (opt) setDueOn(addDaysFrom(issuedOn, opt.days));
    // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [issuedOn]);

  // Prefill from ?jobId=&propertyId= (the "Create invoice" shortcut on a job).
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const initialJobId = params.get("jobId") ?? "";
  const initialPropertyId = params.get("propertyId") ?? "";
  const editId = params.get("editId") ?? "";
  const isEdit = !!editId;

  // Edit mode — load the existing invoice into the same template.
  const { data: editInvoice } = useGetInvoice(editId, {
    query: { enabled: !!editId, queryKey: getGetInvoiceQueryKey(editId) },
  });
  const editLoaded = useRef(false);
  useEffect(() => {
    if (!editId || editLoaded.current || !editInvoice) return;
    editLoaded.current = true;
    setPropertyId(editInvoice.propertyId ?? "");
    sopAppliedFor.current = editInvoice.propertyId ?? null; // don't let SOP prefill overwrite saved values
    setJobId(editInvoice.jobId ?? "");
    setBillToName(editInvoice.billToName ?? "");
    setPropertyAddress(editInvoice.propertyAddress ?? "");
    setPoNumber(editInvoice.poNumber ?? "");
    if (editInvoice.terms) setTerms(editInvoice.terms);
    if (editInvoice.issuedOn) setIssuedOn(editInvoice.issuedOn.slice(0, 10));
    if (editInvoice.dueAt) {
      setDueOn(editInvoice.dueAt.slice(0, 10));
      setDueTouched(true);
    }
    setNotes(editInvoice.notes ?? "");
    if (editInvoice.paymentInstructions) {
      setPaymentInstructions(editInvoice.paymentInstructions);
      setInstructionsTouched(true);
    }
    const lineItems = editInvoice.lineItems ?? [];
    if (lineItems.length) {
      setItems(
        lineItems.map((li) => ({
          dateOfWork: li.dateOfWork ? li.dateOfWork.slice(0, 10) : "",
          unitNo: li.unitNo ?? "",
          typeOfWork: li.typeOfWork,
          description: li.description ?? "",
          qty: String(li.qty),
          unitPrice: String(li.unitPrice),
        })),
      );
    }
  }, [editId, editInvoice]);
  const { data: initialJobDetail} = useGetJob(initialJobId, {
    query: { enabled: !!initialJobId, queryKey: getGetJobQueryKey(initialJobId)},
 });
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !initialJobId || !properties) return;
    const job = initialJobDetail?.job;
    if (!job) return;
    prefilled.current = true;
    onPickProperty(job.propertyId ?? initialPropertyId);
    setJobId(job.id);
    const lineItems = job.lineItems ?? [];
    // Prefer completed scope items (checked off by the crew) so the invoice
    // reflects exactly what was done. Fall back to all items if none are marked
    // complete yet (invoice created before the crew finishes).
    const completedItems = lineItems.filter((li) => li.completedAt != null);
    const itemsToUse = completedItems.length > 0 ? completedItems : lineItems;
    if (itemsToUse.length) {
      setItems(
        itemsToUse.map((li) => ({
          dateOfWork: li.completedAt ? li.completedAt.slice(0, 10) : "",
          unitNo: job.unitNo ?? "",
          typeOfWork: li.service,
          description: "",
          qty: String(li.qty),
          unitPrice: String(li.rate),
        })),
      );
    } else {
      setItems([{ ...emptyItem(), unitNo: job.unitNo ?? "", typeOfWork: [job.category, job.description].filter(Boolean).join(" — ")}]);
    }
 }, [initialJobId, initialPropertyId, initialJobDetail, properties]);

  const total = useMemo(
    () => Math.round(items.reduce((s, it) => s + itemAmount(it), 0) * 100) / 100,
    [items],
  );

  // Client's stated budget carried from the work request onto the linked job:
  // warn (don't block) when the invoice total exceeds what they expected.
  const clientBudget =
    initialJobId &&
    initialJobDetail?.job &&
    typeof initialJobDetail.job.clientBudget === "number"
      ? initialJobDetail.job.clientBudget
      : null;
  const overBudget = clientBudget != null && total > clientBudget;

  const validItems = items.filter((it) => it.typeOfWork.trim());
  const canSave =
    !!propertyId &&
    !!jobId &&
    validItems.length > 0 &&
    !create.isPending &&
    !update.isPending &&
    (!isEdit || editInvoice?.status === "draft") &&
    (!sopPoRequired || !!poNumber.trim());

  const setItem = (idx: number, patch: Partial<ItemDraft>) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch} : it)));

  const buildLineItems = (): InvoiceLineItemInput[] =>
    validItems.map((it) => ({
      typeOfWork: it.typeOfWork.trim(),
      ...(it.dateOfWork ? { dateOfWork: it.dateOfWork} : {}),
      ...(it.unitNo.trim() ? { unitNo: it.unitNo.trim()} : {}),
      ...(it.description.trim() ? { description: it.description.trim()} : {}),
      qty: parseFloat(it.qty) || 1,
      unitPrice: parseFloat(it.unitPrice) || 0,
   }));

  const save = (thenSend: boolean) => {
    if (!canSave) return;
    const data = {
      propertyId,
      jobId,
      issuedOn,
      ...(dueOn ? { dueOn} : {}),
      ...(poNumber.trim() ? { poNumber: poNumber.trim()} : {}),
      terms,
      ...(billToName.trim() ? { billToName: billToName.trim()} : {}),
      ...(propertyAddress.trim() ? { propertyAddress: propertyAddress.trim()} : {}),
      ...(notes.trim() ? { notes: notes.trim()} : {}),
      ...(paymentInstructions.trim() &&
      paymentInstructions.trim() !== (settings?.paymentInstructions ?? "").trim()
        ? { paymentInstructions: paymentInstructions.trim()}
        : {}),
      lineItems: buildLineItems(),
    };
    const onSuccess = (inv: { id: string; invoiceNo: string; amount: number; propertyId?: string | null }) => {
      queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey()});
      queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey()});
      queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId)});
      queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey()});
      if (isEdit) queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(editId)});
      if (thenSend) {
        setSendFor({
          id: inv.id,
          invoiceNo: inv.invoiceNo,
          amount: inv.amount,
          propertyId: inv.propertyId ?? propertyId ?? null,
          billToName: billToName || null,
          propertyAddress: propertyAddress || null,
       });
     } else {
        toast({
          title: isEdit ? "Invoice updated" : "Invoice saved",
          description: isEdit
            ? `${inv.invoiceNo} saved with your changes.`
            : `${inv.invoiceNo} created as a draft.`,
        });
        navigate(`/invoices/${inv.id}`);
     }
    };
    const onError = (e: Error) =>
      toast({
        title: isEdit ? "Couldn't update invoice" : "Couldn't create invoice",
        description: e.message,
        variant: "destructive",
      });
    if (isEdit) {
      update.mutate({ id: editId, data }, { onSuccess, onError });
    } else {
      create.mutate({ data }, { onSuccess, onError });
    }
 };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/money"
          className="flex items-center gap-2 text-muted-foreground text-sm font-semibold w-fit hover:text-foreground"
        >
          <ChevronLeft className="w-4 h-4" /> Money
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="outline" disabled={!canSave} onClick={() => save(false)}>
            <Save className="w-4 h-4 mr-1.5" /> {isEdit ? "Save changes" : "Save draft"}
          </Button>
          <Button
            disabled={!canSave}
            onClick={() => save(true)}
            className="bg-[var(--primary)] hover:opacity-90 text-black font-bold"
          >
            <Send className="w-4 h-4 mr-1.5" /> {create.isPending || update.isPending ? "Saving…" : "Save & send"}
          </Button>
        </div>
      </div>

      {sopRule && (
        <div className="flex items-start gap-3 rounded-2xl bg-[var(--ink)] text-white px-5 py-4" data-testid="banner-sop-active">
          <ShieldCheck className="w-5 h-5 text-[var(--gold-light,#B4FF44)] shrink-0 mt-0.5" />
          <div className="text-sm">
            <span className="font-bold">SOP rule active.</span>{" "}
            This invoice follows {sopRule.rules.property?.name || "the property"}'s
            billing guideline — number format, terms and due date are applied
            automatically on save.
            {sopPoRequired && <span className="font-bold"> A PO number is required.</span>}
          </div>
        </div>
      )}

      {/* Branded editable template */}
      <div className="bg-white rounded-3xl shadow-sm border border-border overflow-hidden">
        <div className="h-1.5 bg-[var(--primary)]" />
        <div className="p-8 space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <div className="font-display font-bold text-xl leading-tight">
                {settings?.companyName ?? "ArchAngel Contractors"}
              </div>
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--gold-dark)] mt-1">
                {settings?.tagline ?? "Restoration & Make-Ready"}
              </div>
            </div>
            <div className="text-right">
              <div className="font-display font-bold text-2xl text-[var(--secondary)] leading-none">INVOICE</div>
              <div className="font-mono text-sm text-muted-foreground mt-1">
                {isEdit ? editInvoice?.invoiceNo ?? "Loading…" : "Number assigned on save"}
              </div>
            </div>
          </div>

          {/* From / Bill To / Details */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-5 border-t border-border">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className={labelCls}>From</span>
                <button
                  onClick={() => setEditBusiness(true)}
                  className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="w-3 h-3" /> Edit
                </button>
              </div>
              <div className="text-sm">
                <div className="font-semibold">{settings?.companyName ?? "—"}</div>
                <div className="text-muted-foreground">{settings?.street}</div>
                <div className="text-muted-foreground">{settings?.city}</div>
                {settings?.phone ? <div className="text-muted-foreground">{settings.phone}</div> : null}
                <div className="text-muted-foreground">{settings?.email}</div>
              </div>
            </div>

            <div className="space-y-2">
              <span className={labelCls}>Bill To</span>
              <Select value={propertyId} onValueChange={onPickProperty}>
                <SelectTrigger>
                  <SelectValue placeholder="Select property…" />
                </SelectTrigger>
                <SelectContent>
                  {(properties ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={billToName}
                onChange={(e) => setBillToName(e.target.value)}
                placeholder="Billing name"
              />
              <Input
                value={propertyAddress}
                onChange={(e) => setPropertyAddress(e.target.value)}
                placeholder="Property address"
              />
            </div>

            <div className="space-y-2">
              <span className={labelCls}>Invoice details</span>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Job this invoice covers</div>
                <Select value={jobId} onValueChange={setJobId}>
                  <SelectTrigger data-testid="select-invoice-job">
                    <SelectValue placeholder="Select the job…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(propertyJobs ?? []).map((j) => (
                      <SelectItem key={j.id} value={j.id}>
                        {j.jobNo} · {j.category || j.description}
                        {j.unitNo ? ` · Unit ${j.unitNo}` : ""}
                      </SelectItem>
                    ))}
                    {(propertyJobs ?? []).length === 0 && (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        {propertyId ? "No jobs at this property — create the job first." : "Select a property first."}
                      </div>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Invoice date</div>
                  <Input type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Due date</div>
                  <Input
                    type="date"
                    value={dueOn}
                    onChange={(e) => {
                      setDueTouched(true);
                      setDueOn(e.target.value);
                   }}
                  />
                </div>
                <div className="col-span-2">
                  <div className="text-xs text-muted-foreground mb-1">Terms</div>
                  <div className="flex gap-1 bg-muted rounded-full p-1">
                    {TERM_OPTIONS.map((t) => (
                      <button
                        key={t.value}
                        onClick={() => pickTerms(t.value, t.days)}
                        className={`flex-1 py-1.5 px-1 rounded-full text-[11px] font-bold transition-colors ${
                          terms === t.value
                            ? "bg-[var(--secondary)] text-white"
                            : "text-muted-foreground hover:text-foreground"
                       }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-xs text-muted-foreground mb-1">
                    PO number{sopPoRequired ? " — required by SOP" : ""}
                  </div>
                  <Input
                    value={poNumber}
                    onChange={(e) => setPoNumber(e.target.value)}
                    placeholder={sopPoRequired ? "Required" : "Optional"}
                    className={sopPoRequired && !poNumber.trim() ? "border-destructive" : undefined}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Line items */}
          <div className="pt-4 border-t border-border">
            {propertyId && (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                {priceItems.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="inline-flex items-center gap-1.5 pl-3 pr-2.5 py-1.5 rounded-full bg-[var(--gold-tint)] border border-[var(--primary)]/60 text-[13px] font-semibold hover:bg-[var(--primary)]/20 active:scale-95 transition-all">
                        <Zap className="w-3.5 h-3.5 text-[var(--secondary)]" />
                        Price book
                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground rotate-90" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-64 max-h-80 overflow-y-auto">
                      {hasCategories
                        ? Array.from(priceGroups.entries()).map(([cat, items]) => (
                            <DropdownMenuSub key={cat}>
                              <DropdownMenuSubTrigger className="font-semibold text-[13px]">
                                {cat}
                                <span className="ml-auto text-[11px] text-muted-foreground font-normal">
                                  {items.length}
                                </span>
                              </DropdownMenuSubTrigger>
                              <DropdownMenuSubContent className="w-60 max-h-72 overflow-y-auto">
                                {items.map((pi) => (
                                  <DropdownMenuItem
                                    key={pi.id}
                                    onClick={() => quickAdd(pi.service, pi.rate)}
                                    className="flex justify-between text-[13px] cursor-pointer"
                                  >
                                    <span className="truncate flex-1 mr-2">{pi.service}</span>
                                    <span className="font-bold text-[var(--secondary)] tabular-nums shrink-0">
                                      {money(pi.rate)}
                                    </span>
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                          ))
                        : (
                          <>
                            <DropdownMenuLabel className="text-[11px] text-muted-foreground font-bold uppercase tracking-wide">
                              Price book
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {priceItems.map((pi) => (
                              <DropdownMenuItem
                                key={pi.id}
                                onClick={() => quickAdd(pi.service, pi.rate)}
                                className="flex justify-between text-[13px] cursor-pointer"
                              >
                                <span className="truncate flex-1 mr-2">{pi.service}</span>
                                <span className="font-bold text-[var(--secondary)] tabular-nums shrink-0">
                                  {money(pi.rate)}
                                </span>
                              </DropdownMenuItem>
                            ))}
                          </>
                        )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                {/* Master catalog button + inline picker */}
                <button
                  onClick={() => setShowCatalog((v) => !v)}
                  className="inline-flex items-center gap-1.5 pl-3 pr-2.5 py-1.5 rounded-full bg-secondary/10 border border-secondary/30 text-[13px] font-semibold text-[var(--secondary)] hover:bg-secondary/20 active:scale-95 transition-all"
                >
                  <Zap className="w-3.5 h-3.5" />
                  Master service list
                  <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${showCatalog ? "rotate-90" : ""}`} />
                </button>
              </div>
            )}

            {/* Inline master catalog picker (shown below the toolbar) */}
            {propertyId && showCatalog && (
              <div className="mb-4 rounded-2xl border border-border overflow-hidden shadow-sm">
                <div className="px-4 pt-3 pb-2 border-b border-border bg-muted/30">
                  <input
                    type="text"
                    placeholder="Search master service list…"
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                    className="w-full bg-background border border-input rounded-lg py-2 px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    autoFocus
                  />
                </div>
                <div className="max-h-64 overflow-y-auto divide-y divide-border">
                  {catalogGroups.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                      {catalogSearch ? "No services match." : "Loading…"}
                    </div>
                  ) : (
                    catalogGroups.map(([cat, items]) => (
                      <div key={cat}>
                        <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/40 sticky top-0">
                          {cat}
                        </div>
                        {items.map((item: CatalogItem) => (
                          <button
                            key={item.id}
                            onClick={() => { void addCatalogService(item); setShowCatalog(false); }}
                            className="w-full flex items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-accent transition-colors"
                          >
                            <span className="font-medium flex-1 mr-3">{item.service}</span>
                            <span className="font-bold text-[var(--secondary)] tabular-nums shrink-0 text-[13px]">
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
            <div className="hidden md:grid grid-cols-[110px_70px_1fr_64px_96px_96px_32px] gap-2 px-1 pb-2">
              {["Date", "Unit #", "Type of work / description", "Qty", "Unit price", "Amount", ""].map((h) => (
                <span key={h} className="text-[10px] font-bold text-muted-foreground">
                  {h}
                </span>
              ))}
            </div>
            <datalist id="create-price-book-options">
              {priceItems.map((pi) => (
                <option key={pi.id} value={pi.service}>
                  {`$${pi.rate}${pi.detail ? ` — ${pi.detail}` : ""}`}
                </option>
              ))}
            </datalist>
            <div className="space-y-2">
              {items.map((it, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-2 md:grid-cols-[110px_70px_1fr_64px_96px_96px_32px] gap-2 items-start bg-background/60 md:bg-transparent rounded-lg md:rounded-none p-2 md:p-0"
                >
                  <Input
                    type="date"
                    value={it.dateOfWork}
                    onChange={(e) => setItem(idx, { dateOfWork: e.target.value})}
                  />
                  <Input
                    value={it.unitNo}
                    onChange={(e) => setItem(idx, { unitNo: e.target.value})}
                    placeholder="Unit"
                  />
                  <div className="col-span-2 md:col-span-1 space-y-1.5">
                    {priceItems.length > 0 && (() => {
                      const inList = priceItems.some((pi) => pi.service === it.typeOfWork);
                      const isCustom = it.customWork || (it.typeOfWork.trim() !== "" && !inList);
                      return (
                        <>
                          <select
                            value={isCustom ? "__custom__" : it.typeOfWork}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === "__custom__") {
                                setItem(idx, { customWork: true, typeOfWork: inList ? "" : it.typeOfWork });
                                return;
                              }
                              const hit = priceItems.find((pi) => pi.service === v);
                              setItem(
                                idx,
                                hit
                                  ? { typeOfWork: v, unitPrice: String(hit.rate), customWork: false }
                                  : { typeOfWork: v, customWork: false },
                              );
                            }}
                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          >
                            <option value="">Type of work (required)</option>
                            {priceItems.map((pi) => (
                              <option key={pi.id} value={pi.service}>
                                {pi.service} — ${pi.rate}
                              </option>
                            ))}
                            <option value="__custom__">Custom…</option>
                          </select>
                          {isCustom && (
                            <Input
                              value={it.typeOfWork}
                              onChange={(e) => setItem(idx, { typeOfWork: e.target.value, customWork: true })}
                              placeholder="Custom type of work (required)"
                              autoFocus={it.typeOfWork === ""}
                            />
                          )}
                        </>
                      );
                    })()}
                    {priceItems.length === 0 && (
                      <Input
                        value={it.typeOfWork}
                        onChange={(e) => setItem(idx, { typeOfWork: e.target.value })}
                        placeholder="Type of work (required)"
                      />
                    )}
                    <Input
                      value={it.description}
                      onChange={(e) => setItem(idx, { description: e.target.value})}
                      placeholder="Description (optional)"
                    />
                  </div>
                  <Input
                    inputMode="decimal"
                    value={it.qty}
                    onChange={(e) => setItem(idx, { qty: e.target.value})}
                    placeholder="1"
                  />
                  <Input
                    inputMode="decimal"
                    value={it.unitPrice}
                    onChange={(e) => setItem(idx, { unitPrice: e.target.value})}
                    placeholder="0.00"
                  />
                  <div className="font-mono font-semibold text-sm py-2.5 text-right tabular-nums">
                    {money(itemAmount(it))}
                  </div>
                  <button
                    onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                    disabled={items.length === 1}
                    className="p-2 text-muted-foreground hover:text-destructive disabled:opacity-30"
                    aria-label="Remove line item"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => setItems((prev) => [...prev, emptyItem()])}
            >
              <Plus className="w-4 h-4 mr-1.5" /> Add line item
            </Button>
          </div>

          {/* Total */}
          <div className="pt-3 border-t-2 border-[var(--ink)] flex items-center justify-between">
            <span className="font-display font-bold text-sm">Total Due</span>
            <span className="font-display font-bold text-2xl font-mono text-[var(--secondary)]">{money(total)}</span>
          </div>
          {overBudget && (
            <div
              className="rounded-lg border border-[rgba(190,140,20,0.35)] bg-[rgba(255,196,66,0.12)] p-3 flex items-start gap-2"
              data-testid="banner-over-budget"
            >
              <AlertTriangle className="w-4 h-4 text-[#8f6a1f] shrink-0 mt-0.5" />
              <div className="text-sm">
                <span className="font-semibold">Over the client's budget.</span>{" "}
                <span className="text-muted-foreground">
                  This total ({money(total)}) exceeds the {money(clientBudget!)} budget the client gave on
                  their work request. You can still send it — just expect questions.
                </span>
              </div>
            </div>
          )}

          {/* Payment instructions + notes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-border">
            <div className="space-y-1.5">
              <span className={labelCls}>Payment terms &amp; details</span>
              <Textarea
                rows={4}
                value={paymentInstructions}
                onChange={(e) => {
                  setInstructionsTouched(true);
                  setPaymentInstructions(e.target.value);
               }}
                placeholder="How the client should pay…"
              />
              <p className="text-xs text-muted-foreground">
                Prefilled from your business info — edits here apply to this invoice only.
              </p>
            </div>
            <div className="space-y-1.5">
              <span className={labelCls}>Notes</span>
              <Textarea
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes shown on the invoice…"
              />
            </div>
          </div>
        </div>
      </div>

      <BusinessInfoDialog open={editBusiness} onOpenChange={setEditBusiness} />
      <SendInvoiceDialog
        open={!!sendFor}
        onOpenChange={(o) => {
          if (!o && sendFor) {
            const id = sendFor.id;
            setSendFor(null);
            navigate(`/invoices/${id}`);
         }
       }}
        invoice={sendFor}
        onSent={() => {
          if (sendFor) navigate(`/invoices/${sendFor.id}`);
       }}
      />
    </div>
  );
}
