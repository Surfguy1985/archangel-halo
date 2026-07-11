import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateInvoice,
  useListProperties,
  useGetBusinessSettings,
  getListInvoicesQueryKey,
  getGetMoneySummaryQueryKey,
  getGetPropertyQueryKey,
  type InvoiceLineItemInput,
} from "@workspace/api-client-react";
import { ChevronLeft, Pencil, Plus, Save, Send, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BusinessInfoDialog } from "@/components/BusinessInfoDialog";
import { SendInvoiceDialog } from "@/components/SendInvoiceDialog";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const todayLocal = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

type ItemDraft = {
  dateOfWork: string;
  unitNo: string;
  typeOfWork: string;
  description: string;
  qty: string;
  unitPrice: string;
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
  "text-[10px] font-bold uppercase tracking-wide text-[var(--gold-dark)]";

export default function CreateInvoice() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: properties } = useListProperties();
  const { data: settings } = useGetBusinessSettings();
  const create = useCreateInvoice();

  const [propertyId, setPropertyId] = useState("");
  const [billToName, setBillToName] = useState("");
  const [propertyAddress, setPropertyAddress] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [terms, setTerms] = useState("Net 30");
  const [issuedOn, setIssuedOn] = useState(todayLocal());
  const [dueOn, setDueOn] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentInstructions, setPaymentInstructions] = useState("");
  const [instructionsTouched, setInstructionsTouched] = useState(false);
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);
  const [editBusiness, setEditBusiness] = useState(false);
  const [sendFor, setSendFor] = useState<{
    id: string;
    invoiceNo: string;
    amount: number;
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
    const prop = properties?.find((p) => p.id === id);
    if (prop) {
      setBillToName(prop.pmcName || prop.name);
      setPropertyAddress([prop.name, prop.city].filter(Boolean).join(", "));
    }
  };

  const total = useMemo(
    () => Math.round(items.reduce((s, it) => s + itemAmount(it), 0) * 100) / 100,
    [items],
  );

  const validItems = items.filter((it) => it.typeOfWork.trim());
  const canSave = !!propertyId && validItems.length > 0 && !create.isPending;

  const setItem = (idx: number, patch: Partial<ItemDraft>) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const buildLineItems = (): InvoiceLineItemInput[] =>
    validItems.map((it) => ({
      typeOfWork: it.typeOfWork.trim(),
      ...(it.dateOfWork ? { dateOfWork: it.dateOfWork } : {}),
      ...(it.unitNo.trim() ? { unitNo: it.unitNo.trim() } : {}),
      ...(it.description.trim() ? { description: it.description.trim() } : {}),
      qty: parseFloat(it.qty) || 1,
      unitPrice: parseFloat(it.unitPrice) || 0,
    }));

  const save = (thenSend: boolean) => {
    if (!canSave) return;
    create.mutate(
      {
        data: {
          propertyId,
          issuedOn,
          ...(dueOn ? { dueOn } : {}),
          ...(poNumber.trim() ? { poNumber: poNumber.trim() } : {}),
          terms,
          ...(billToName.trim() ? { billToName: billToName.trim() } : {}),
          ...(propertyAddress.trim() ? { propertyAddress: propertyAddress.trim() } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          ...(paymentInstructions.trim() &&
          paymentInstructions.trim() !== (settings?.paymentInstructions ?? "").trim()
            ? { paymentInstructions: paymentInstructions.trim() }
            : {}),
          lineItems: buildLineItems(),
        },
      },
      {
        onSuccess: (inv) => {
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId) });
          if (thenSend) {
            setSendFor({
              id: inv.id,
              invoiceNo: inv.invoiceNo,
              amount: inv.amount,
              billToName: billToName || null,
              propertyAddress: propertyAddress || null,
            });
          } else {
            toast({ title: "Invoice saved", description: `${inv.invoiceNo} created as a draft.` });
            navigate(`/invoices/${inv.id}`);
          }
        },
        onError: (e) =>
          toast({ title: "Couldn't create invoice", description: e.message, variant: "destructive" }),
      },
    );
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
            <Save className="w-4 h-4 mr-1.5" /> Save draft
          </Button>
          <Button
            disabled={!canSave}
            onClick={() => save(true)}
            className="bg-[var(--gold)] hover:bg-[var(--gold-dark)] text-white"
          >
            <Send className="w-4 h-4 mr-1.5" /> {create.isPending ? "Saving…" : "Save & send"}
          </Button>
        </div>
      </div>

      {/* Branded editable template */}
      <div className="bg-card rounded-xl shadow-sm border border-border overflow-hidden">
        <div className="h-1.5 bg-[linear-gradient(90deg,var(--gold-light),var(--gold),var(--gold-dark))]" />
        <div className="p-8 space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <div className="font-display font-bold text-xl leading-tight">
                {settings?.companyName ?? "ArchAngel Contractors"}
              </div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--gold-dark)] mt-0.5">
                {settings?.tagline ?? "Restoration & Make-Ready"}
              </div>
            </div>
            <div className="text-right">
              <div className="font-display font-bold text-2xl text-[var(--gold-dark)] leading-none">INVOICE</div>
              <div className="font-mono text-sm text-muted-foreground mt-1">Number assigned on save</div>
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
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Invoice date</div>
                  <Input type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Due date</div>
                  <Input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Terms</div>
                  <Select value={terms} onValueChange={setTerms}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["Due on receipt", "Net 15", "Net 30", "Net 45", "Net 60"].map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">PO number</div>
                  <Input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="Optional" />
                </div>
              </div>
              {!dueOn && (
                <p className="text-xs text-muted-foreground">No due date set — defaults to 30 days out.</p>
              )}
            </div>
          </div>

          {/* Line items */}
          <div className="pt-4 border-t border-border">
            <div className="hidden md:grid grid-cols-[110px_70px_1fr_64px_96px_96px_32px] gap-2 px-1 pb-2">
              {["Date", "Unit #", "Type of work / description", "Qty", "Unit price", "Amount", ""].map((h) => (
                <span key={h} className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  {h}
                </span>
              ))}
            </div>
            <div className="space-y-2">
              {items.map((it, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-2 md:grid-cols-[110px_70px_1fr_64px_96px_96px_32px] gap-2 items-start bg-background/60 md:bg-transparent rounded-lg md:rounded-none p-2 md:p-0"
                >
                  <Input
                    type="date"
                    value={it.dateOfWork}
                    onChange={(e) => setItem(idx, { dateOfWork: e.target.value })}
                  />
                  <Input
                    value={it.unitNo}
                    onChange={(e) => setItem(idx, { unitNo: e.target.value })}
                    placeholder="Unit"
                  />
                  <div className="col-span-2 md:col-span-1 space-y-1.5">
                    <Input
                      value={it.typeOfWork}
                      onChange={(e) => setItem(idx, { typeOfWork: e.target.value })}
                      placeholder="Type of work (required)"
                    />
                    <Input
                      value={it.description}
                      onChange={(e) => setItem(idx, { description: e.target.value })}
                      placeholder="Description (optional)"
                    />
                  </div>
                  <Input
                    inputMode="decimal"
                    value={it.qty}
                    onChange={(e) => setItem(idx, { qty: e.target.value })}
                    placeholder="1"
                  />
                  <Input
                    inputMode="decimal"
                    value={it.unitPrice}
                    onChange={(e) => setItem(idx, { unitPrice: e.target.value })}
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
            <span className="font-display font-bold text-sm uppercase tracking-wide">Total Due</span>
            <span className="font-display font-bold text-2xl font-mono text-[var(--gold-dark)]">{money(total)}</span>
          </div>

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
