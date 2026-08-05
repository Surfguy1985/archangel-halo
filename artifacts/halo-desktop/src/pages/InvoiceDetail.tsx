import {
  useGetInvoice,
  useGetBusinessSettings,
  useRemindInvoice,
  useDeleteInvoice,
  useRecordPayment,
  getGetInvoiceQueryKey,
  getListInvoicesQueryKey,
  getGetMoneySummaryQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient} from "@tanstack/react-query";
import { useParams, Link, useLocation} from "wouter";
import { ChevronLeft, Send, Download, Trash2, BellRing, CreditCard, MessageSquareShare, Pencil, Camera} from "lucide-react";
import { ScanCheckDialog} from "@/components/ScanCheckDialog";
import { PushCardDialog } from "@/components/PushCardDialog";
import { useState} from "react";
import { Skeleton} from "@/components/ui/skeleton";
import { useToast} from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SendInvoiceDialog} from "@/components/SendInvoiceDialog";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD"});

const fmtDate = (s?: string | null) => {
  if (!s) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric"});
};

const fieldCls =
  "w-full bg-background border border-border rounded-md py-2.5 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring";

const statusChip: Record<string, string> = {
  paid: "bg-[var(--primary)] text-black",
  past_due: "bg-rose-100 text-rose-900",
  sent: "bg-[var(--secondary)] text-white",
  draft: "bg-gray-100 text-gray-800",
};
const statusLabel: Record<string, string> = {
  paid: "Paid",
  past_due: "Past due",
  sent: "Sent",
  draft: "Draft",
};

export default function InvoiceDetail() {
  const params = useParams();
  const id = params.id as string;
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast} = useToast();
  const { data: inv, isLoading} = useGetInvoice(id, {
    query: { enabled: !!id, queryKey: getGetInvoiceQueryKey(id)},
 });
  const [payOpen, setPayOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("check");
  const { data: settings} = useGetBusinessSettings();

  const remind = useRemindInvoice();
  const del = useDeleteInvoice();
  const record = useRecordPayment();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(id)});
    queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey()});
    queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey()});
 };

  if (isLoading || !inv) {
    return (
      <div className="p-8 max-w-4xl mx-auto space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
 }

  const status = inv.status;
  const subtotal = inv.lineItems.reduce((s, it) => s + it.amount, 0);
  const timeline: { label: string; date?: string | null; done: boolean}[] = [
    { label: "Created", date: inv.issuedOn, done: true},
    { label: "Sent to client", date: inv.sentAt, done: !!inv.sentAt},
    { label: status === "past_due" ? "Past due" : "Due", date: inv.dueAt, done: status === "past_due" || status === "paid"},
    { label: "Paid", date: inv.paidAt, done: !!inv.paidAt},
  ];

  const openSend = () => setSendOpen(true);

  const onRemind = () =>
    remind.mutate(
      { id},
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Reminder sent", description:`Past-due notice emailed for ${inv.invoiceNo}.`});
       },
        onError: (e) => toast({ title: "Couldn't send reminder", description: e.message, variant: "destructive"}),
     },
    );

  const openPay = () => {
    setAmount(String(inv.amount));
    setPayOpen(true);
 };

  const onRecord = () => {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum)) return;
    record.mutate(
      { data: { invoiceId: inv.id, amount: amountNum, method: method || undefined}},
      {
        onSuccess: () => {
          invalidate();
          setPayOpen(false);
          toast({ title: "Payment recorded"});
       },
        onError: (e) => toast({ title: "Couldn't record", description: e.message, variant: "destructive"}),
     },
    );
 };

  const onDelete = () =>
    del.mutate(
      { id},
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey()});
          queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey()});
          toast({ title: "Invoice deleted"});
          navigate("/money");
       },
        onError: (e) => toast({ title: "Couldn't delete", description: e.message, variant: "destructive"}),
     },
    );

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6 animate-in fade-in duration-500">
      <Link href="/money" className="flex items-center gap-2 text-muted-foreground text-sm font-semibold w-fit hover:text-foreground">
        <ChevronLeft className="w-4 h-4" /> Money
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Branded invoice */}
        <div className="lg:col-span-2 bg-white rounded-3xl shadow-sm border border-border overflow-hidden">
          <div className="h-1.5 bg-[var(--primary)]" />
          <div className="p-8">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-display font-bold text-xl leading-tight">{settings?.companyName ?? "ArchAngel Contractors"}</div>
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--gold-dark)] mt-1">
                  {settings?.tagline ?? "Restoration & Make-Ready"}
                </div>
                {settings && (
                  <div className="text-xs text-muted-foreground mt-2 leading-relaxed">
                    <div>{settings.street}</div>
                    <div>{settings.city}</div>
                    {settings.phone ? <div>{settings.phone}</div> : null}
                    <div>{settings.email}</div>
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="font-display font-bold text-2xl text-[var(--secondary)] leading-none">INVOICE</div>
                <div className="font-mono text-sm text-muted-foreground mt-1">{inv.invoiceNo}</div>
              </div>
            </div>

            <div className="mt-3">
              <span
                className={`inline-block text-xs font-bold px-3 py-1 rounded-full ${statusChip[status] || statusChip.draft}`}
              >
                {statusLabel[status] || status}
                {status === "past_due" && inv.daysLate ?` · ${inv.daysLate}d` : ""}
              </span>
            </div>

            <div className="flex gap-8 mt-6 pt-5 border-t border-border">
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--gold-dark)] mb-1.5">Bill To</div>
                <div className="font-semibold text-sm">{inv.billToName || inv.propertyName || "Client"}</div>
                <div className="text-sm text-muted-foreground">{inv.propertyAddress || inv.propertyName || "—"}</div>
              </div>
              <div className="w-1/2 shrink-0 text-sm">
                {[
                  ["PO Number", inv.poNumber || "—"],
                  ["Invoice Date", fmtDate(inv.issuedOn)],
                  ["Terms", inv.terms || "Net 30"],
                  ["Due Date", fmtDate(inv.dueAt)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between py-0.5">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="font-semibold">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-border">
              {inv.lineItems.length === 0 ? (
                <div className="text-sm text-muted-foreground py-2">No line items.</div>
              ) : (
                inv.lineItems.map((it) => (
                  <div key={it.id} className="flex items-start gap-4 py-3 border-b border-border last:border-b-0">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm">
                        {it.unitNo ? <span className="text-muted-foreground font-normal">#{it.unitNo} · </span> : null}
                        {it.typeOfWork}
                      </div>
                      {it.description && <div className="text-xs text-muted-foreground">{it.description}</div>}
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {[it.dateOfWork ? fmtDate(it.dateOfWork) : null,`${it.qty} × ${money(it.unitPrice)}`].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <div className="font-mono font-semibold text-sm shrink-0">{money(it.amount)}</div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-4 pt-3 border-t-2 border-[var(--ink)] flex items-center justify-between">
              <span className="font-display font-bold text-sm">Total Due</span>
              <span className="font-display font-bold text-2xl font-mono text-[var(--secondary)]">{money(inv.amount || subtotal)}</span>
            </div>

            {(inv.paymentInstructions || settings?.paymentInstructions) && (
              <div className="mt-4 pt-3 border-t border-border">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--gold-dark)] mb-1.5">
                  Payment Terms &amp; Details
                </div>
                <div className="text-sm text-muted-foreground whitespace-pre-line">
                  {inv.paymentInstructions || settings?.paymentInstructions}
                </div>
              </div>
            )}

            {inv.notes && (
              <div className="mt-4 text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">Notes: </span>
                {inv.notes}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar: tracking + actions */}
        <div className="space-y-6">
          <div className="bg-white rounded-3xl shadow-sm border border-border p-6">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground mb-4">Tracking</div>
            <div className="flex flex-col">
              {timeline.map((t, i) => (
                <div key={t.label} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div
                      className="w-3 h-3 rounded-full border-2 shrink-0"
                      style={{
                        backgroundColor: t.done ? "var(--gold)" : "transparent",
                        borderColor: t.done ? "var(--gold)" : "var(--border)",
                     }}
                    />
                    {i < timeline.length - 1 && (
                      <div className="w-0.5 flex-1 min-h-[24px]" style={{ backgroundColor: t.done ? "var(--gold)" : "var(--border)"}} />
                    )}
                  </div>
                  <div className="pb-4 -mt-0.5">
                    <div className={`text-sm font-semibold ${t.done ? "" : "text-muted-foreground"}`}>{t.label}</div>
                    {t.date && <div className="text-xs text-muted-foreground">{fmtDate(t.date)}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {status === "draft" && (
              <>
                <button
                  onClick={openSend}
                  className="w-full flex items-center justify-center gap-2 rounded-full py-2.5 font-display font-bold text-sm text-black bg-[var(--primary)] hover:opacity-90 transition-opacity"
                >
                  <Send className="w-4 h-4" /> Send invoice
                </button>
                <button
                  onClick={() => navigate(`/invoices/new?editId=${inv.id}`)}
                  data-testid="button-edit-invoice"
                  className="w-full flex items-center justify-center gap-2 rounded-full py-2.5 font-display font-bold text-sm bg-white border border-border shadow-sm hover:bg-black/[0.03] transition-colors"
                >
                  <Pencil className="w-4 h-4" /> Edit invoice
                </button>
              </>
            )}
            {status === "past_due" && (
              <button
                onClick={onRemind}
                disabled={remind.isPending}
                className="w-full flex items-center justify-center gap-2 rounded-full py-2.5 font-display font-bold text-sm bg-white border border-border shadow-sm hover:bg-black/[0.03] transition-colors disabled:opacity-50"
              >
                <BellRing className="w-4 h-4" /> {remind.isPending ? "Sending…" : "Send reminder"}
              </button>
            )}
            {status !== "paid" && status !== "draft" && (
              <>
                <button
                  onClick={() => setScanOpen(true)}
                  data-testid="button-scan-check"
                  className="w-full flex items-center justify-center gap-2 rounded-full py-2.5 font-display font-bold text-sm text-black bg-[var(--primary)] hover:opacity-90 transition-opacity"
                >
                  <Camera className="w-4 h-4" /> Scan received check
                </button>
                <button
                  onClick={openPay}
                  className="w-full flex items-center justify-center gap-2 rounded-full py-2.5 font-display font-bold text-sm bg-white border border-border shadow-sm hover:bg-black/[0.03] transition-colors"
                >
                  <CreditCard className="w-4 h-4" /> Record payment
                </button>
              </>
            )}
            {status !== "draft" && inv.propertyId && (
              <button
                onClick={() => setPushOpen(true)}
                data-testid="button-push-invoice-to-board"
                className="w-full flex items-center justify-center gap-2 rounded-full py-2.5 font-display font-bold text-sm bg-white border border-border shadow-sm hover:bg-black/[0.03] transition-colors"
              >
                <MessageSquareShare className="w-4 h-4" /> Send to client board
              </button>
            )}
            <a
              href={`/api/invoices/${inv.id}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="w-full flex items-center justify-center gap-2 rounded-full py-2.5 font-display font-bold text-sm bg-white border border-border shadow-sm hover:bg-black/[0.03] transition-colors"
            >
              <Download className="w-4 h-4" /> Download PDF
            </a>
            <button
              onClick={() => setConfirmDelete(true)}
              className="w-full flex items-center justify-center gap-2 rounded-full py-2.5 font-display font-bold text-sm bg-white border border-border shadow-sm text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 className="w-4 h-4" /> Delete
            </button>
          </div>
        </div>
      </div>

      <ScanCheckDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        presetPropertyId={inv.propertyId ?? undefined}
        presetInvoiceId={inv.id}
      />
      <SendInvoiceDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        invoice={inv}
        onSent={invalidate}
      />

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Record payment</DialogTitle>
            <DialogDescription>{inv.invoiceNo} · {inv.propertyName ?? ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Amount received</div>
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={fieldCls} />
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Method</div>
              <select value={method} onChange={(e) => setMethod(e.target.value)} className={fieldCls}>
                <option value="check">Check</option>
                <option value="ach">ACH / Transfer</option>
                <option value="card">Card</option>
                <option value="cash">Cash</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <button
              onClick={onRecord}
              disabled={!amount.trim() || record.isPending}
              className="flex items-center gap-2 rounded-full py-2 px-5 text-sm font-bold text-black bg-[var(--primary)] hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {record.isPending ? "Recording…" : "Record payment"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {inv.propertyId && (
        <PushCardDialog
          propertyId={inv.propertyId}
          open={pushOpen}
          onOpenChange={(v) => { if (!v) setPushOpen(false); }}
          prefill={{
            templateId: "invoice",
            title: `Invoice ${inv.invoiceNo}`,
            amount: inv.amount,
            dueDate: inv.dueAt ? String(inv.dueAt).slice(0, 10) : null,
            source: { type: "invoice", id: inv.id },
          }}
        />
      )}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {inv.invoiceNo}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the invoice, its line items, and any recorded payments. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
