import {
  useGetInvoice,
  useSendInvoice,
  useRemindInvoice,
  useDeleteInvoice,
  getGetInvoiceQueryKey,
  getListInvoicesQueryKey,
  getGetMoneySummaryQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useParams, Link, useLocation } from "wouter";
import {
  ChevronLeft,
  Pencil,
  Send,
  Download,
  Trash2,
  BellRing,
  CreditCard,
} from "lucide-react";
import { useState } from "react";
import { InvoiceEditor } from "@/components/InvoiceEditor";
import { RecordPaymentSheet } from "@/components/RecordPaymentSheet";
import { useToast } from "@/hooks/use-toast";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

// Build a display date from LOCAL parts to avoid UTC day-shift for date-only.
const fmtDate = (s?: string | null) => {
  if (!s) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const d = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date(s);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const statusColor: Record<string, string> = {
  paid: "#3c7a4e",
  past_due: "#be3c3c",
  sent: "#8f6a1f",
  draft: "#8B8577",
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
  const { toast } = useToast();
  const { data: inv, isLoading } = useGetInvoice(id, {
    query: { enabled: !!id, queryKey: getGetInvoiceQueryKey(id) },
  });
  const [editOpen, setEditOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [recipient, setRecipient] = useState("");
  const send = useSendInvoice();
  const remind = useRemindInvoice();
  const del = useDeleteInvoice();

  const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey() });
  };

  if (isLoading || !inv) {
    return (
      <div className="animate-pulse space-y-4 pt-4">
        <div className="h-8 bg-muted rounded w-1/3" />
        <div className="h-64 bg-card rounded-[16px]" />
      </div>
    );
  }

  const status = inv.status;
  const timeline: { label: string; date?: string | null; done: boolean }[] = [
    { label: "Created", date: inv.issuedOn, done: true },
    { label: "Sent to client", date: inv.sentAt, done: !!inv.sentAt },
    {
      label: status === "past_due" ? "Past due" : "Due",
      date: inv.dueAt,
      done: status === "past_due" || status === "paid",
    },
    { label: "Paid", date: inv.paidAt, done: !!inv.paidAt },
  ];

  const openSend = () => {
    setRecipient(inv.recipientEmail ?? "");
    setSendOpen(true);
  };

  const onSend = () => {
    const to = recipient.trim();
    send.mutate(
      { id, data: { recipientEmail: to || undefined } },
      {
        onSuccess: () => {
          setSendOpen(false);
          invalidate();
          toast({
            title: "Invoice sent",
            description: `${inv.invoiceNo} emailed to ${to} with PDF attached.`,
          });
        },
        onError: (e) =>
          toast({
            title: "Couldn't send",
            description: e.message,
            variant: "destructive",
          }),
      },
    );
  };

  const onRemind = () =>
    remind.mutate(
      { id },
      {
        onSuccess: () => {
          invalidate();
          toast({
            title: "Reminder sent",
            description: `Past-due notice emailed for ${inv.invoiceNo}.`,
          });
        },
        onError: (e) =>
          toast({
            title: "Couldn't send reminder",
            description: e.message,
            variant: "destructive",
          }),
      },
    );

  const onDelete = () =>
    del.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getListInvoicesQueryKey(),
          });
          queryClient.invalidateQueries({
            queryKey: getGetMoneySummaryQueryKey(),
          });
          toast({ title: "Invoice deleted" });
          navigate("/money");
        },
        onError: (e) =>
          toast({
            title: "Couldn't delete",
            description: e.message,
            variant: "destructive",
          }),
      },
    );

  const subtotal = inv.lineItems.reduce((s, it) => s + it.amount, 0);

  return (
    <div className="pt-2 pb-[30px] animate-in fade-in slide-in-from-bottom-4 duration-300">
      <Link
        href="/money"
        className="flex items-center gap-[6px] text-muted-foreground text-[13.5px] font-semibold mb-[10px] w-fit"
      >
        <ChevronLeft className="w-[16px] h-[16px]" /> Money
      </Link>

      {/* Branded invoice preview */}
      <div className="bg-card rounded-[18px] shadow-[var(--shadow)] overflow-hidden">
        <div className="h-[6px] bg-[var(--primary)]" />
        <div className="p-[18px]">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-display font-bold text-[18px] leading-tight">
                ArchAngel Contractors
              </div>
              <div className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-[var(--gold-dark)] mt-[2px]">
                Restoration & Make-Ready
              </div>
            </div>
            <div className="text-right">
              <div className="font-display font-bold text-[20px] text-[var(--gold-dark)] leading-none">
                INVOICE
              </div>
              <div className="font-mono text-[12px] text-muted-foreground mt-[3px]">
                {inv.invoiceNo}
              </div>
            </div>
          </div>

          <div className="mt-[8px]">
            <span
              className="inline-block text-[10.5px] font-bold uppercase tracking-[0.06em] px-[8px] py-[2px] rounded-full text-white"
              style={{ backgroundColor: statusColor[status] || "#8B8577" }}
            >
              {statusLabel[status] || status}
              {status === "past_due" && inv.daysLate
                ? ` · ${inv.daysLate}d`
                : ""}
            </span>
          </div>

          <div className="flex gap-[16px] mt-[16px] pt-[14px] border-t border-border">
            <div className="flex-1 min-w-0">
              <div className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-[var(--gold-dark)] mb-[4px]">
                Bill To
              </div>
              <div className="font-semibold text-[13.5px] truncate">
                {inv.billToName || inv.propertyName || "Client"}
              </div>
              <div className="text-[12px] text-muted-foreground">
                {inv.propertyAddress || inv.propertyName || "—"}
              </div>
            </div>
            <div className="w-[42%] shrink-0 text-[12px]">
              {[
                ["PO Number", inv.poNumber || "—"],
                ["Invoice Date", fmtDate(inv.issuedOn)],
                ["Terms", inv.terms || "Net 30"],
                ["Due Date", fmtDate(inv.dueAt)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between py-[1px]">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-semibold">{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Line items */}
          <div className="mt-[14px] pt-[12px] border-t border-border">
            {inv.lineItems.length === 0 ? (
              <div className="text-[12.5px] text-muted-foreground py-[8px]">
                No line items.
              </div>
            ) : (
              inv.lineItems.map((it) => (
                <div
                  key={it.id}
                  className="flex items-start gap-[10px] py-[8px] border-b border-border last:border-b-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-[13.5px]">
                      {it.unitNo ? (
                        <span className="text-muted-foreground font-normal">
                          #{it.unitNo} ·{" "}
                        </span>
                      ) : null}
                      {it.typeOfWork}
                    </div>
                    {it.description && (
                      <div className="text-[11.5px] text-muted-foreground">
                        {it.description}
                      </div>
                    )}
                    <div className="text-[11px] text-muted-foreground mt-[1px]">
                      {[
                        it.dateOfWork ? fmtDate(it.dateOfWork) : null,
                        `${it.qty} × ${money(it.unitPrice)}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <div className="font-display font-semibold tabular-nums text-[14px] shrink-0">
                    {money(it.amount)}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-[12px] pt-[10px] border-t-2 border-[var(--ink)] flex items-center justify-between">
            <span className="font-display font-bold text-[12px] uppercase tracking-[0.08em]">
              Total Due
            </span>
            <span className="font-display font-bold text-[22px] tabular-nums text-[var(--gold-dark)]">
              {money(inv.amount || subtotal)}
            </span>
          </div>

          {inv.notes && (
            <div className="mt-[12px] text-[12px] text-muted-foreground">
              <span className="font-semibold text-foreground">Notes: </span>
              {inv.notes}
            </div>
          )}
        </div>
      </div>

      {/* Status timeline */}
      <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[16px] mt-[12px]">
        <div className="font-display font-semibold text-[12px] tracking-[0.14em] uppercase text-muted-foreground mb-[12px]">
          Tracking
        </div>
        <div className="flex flex-col gap-0">
          {timeline.map((t, i) => (
            <div key={t.label} className="flex gap-[12px]">
              <div className="flex flex-col items-center">
                <div
                  className="w-[12px] h-[12px] rounded-full border-2 shrink-0"
                  style={{
                    backgroundColor: t.done ? "var(--gold)" : "transparent",
                    borderColor: t.done ? "var(--gold)" : "var(--border)",
                  }}
                />
                {i < timeline.length - 1 && (
                  <div
                    className="w-[2px] flex-1 min-h-[22px]"
                    style={{
                      backgroundColor: t.done
                        ? "var(--gold)"
                        : "var(--border)",
                    }}
                  />
                )}
              </div>
              <div className="pb-[14px] -mt-[2px]">
                <div
                  className={`text-[13.5px] font-semibold ${t.done ? "" : "text-muted-foreground"}`}
                >
                  {t.label}
                </div>
                {t.date && (
                  <div className="text-[11.5px] text-muted-foreground">
                    {fmtDate(t.date)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="mt-[14px] flex flex-col gap-[8px]">
        {status === "draft" && (
          <button
            onClick={openSend}
            disabled={send.isPending}
            className="w-full flex items-center justify-center gap-[7px] rounded-[13px] py-[12px] font-display font-bold text-[14.5px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_6px_20px_rgba(180,255,68,0.35)] disabled:opacity-50 active:scale-[0.98]"
          >
            <Send className="w-[16px] h-[16px]" />
            {send.isPending ? "Sending…" : "Send invoice"}
          </button>
        )}
        {status === "past_due" && (
          <button
            onClick={onRemind}
            disabled={remind.isPending}
            className="w-full flex items-center justify-center gap-[7px] rounded-[13px] py-[12px] font-display font-bold text-[14.5px] bg-card border border-border shadow-[var(--shadow)] disabled:opacity-50 active:scale-[0.98]"
          >
            <BellRing className="w-[16px] h-[16px]" />
            {remind.isPending ? "Sending…" : "Send reminder"}
          </button>
        )}
        {status !== "paid" && status !== "draft" && (
          <button
            onClick={() => setPayOpen(true)}
            className="w-full flex items-center justify-center gap-[7px] rounded-[13px] py-[12px] font-display font-bold text-[14.5px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_6px_20px_rgba(180,255,68,0.35)] active:scale-[0.98]"
          >
            <CreditCard className="w-[16px] h-[16px]" /> Record payment
          </button>
        )}
        <div className="flex gap-[8px]">
          <a
            href={`${apiBase}/api/invoices/${inv.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="flex-1 flex items-center justify-center gap-[6px] rounded-[12px] py-[10px] text-[13px] font-display font-bold bg-card border border-border shadow-[var(--shadow)] active:scale-[0.98]"
          >
            <Download className="w-[15px] h-[15px]" /> PDF
          </a>
          <button
            onClick={() => setEditOpen(true)}
            className="flex-1 flex items-center justify-center gap-[6px] rounded-[12px] py-[10px] text-[13px] font-display font-bold bg-card border border-border shadow-[var(--shadow)] active:scale-[0.98]"
          >
            <Pencil className="w-[15px] h-[15px]" /> Edit
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            className="flex-1 flex items-center justify-center gap-[6px] rounded-[12px] py-[10px] text-[13px] font-display font-bold bg-card border border-border shadow-[var(--shadow)] text-destructive active:scale-[0.98]"
          >
            <Trash2 className="w-[15px] h-[15px]" /> Delete
          </button>
        </div>
      </div>

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent className="rounded-[18px]">
          <DialogHeader>
            <DialogTitle className="font-display">
              Send {inv.invoiceNo}
            </DialogTitle>
            <DialogDescription>
              The invoice PDF will be emailed to this address. Edit it if you
              need to send it somewhere else.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-[6px]">
            <Label
              htmlFor="recipient"
              className="text-[11.5px] uppercase tracking-wide text-muted-foreground"
            >
              Send to
            </Label>
            <Input
              id="recipient"
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="client@email.com"
              autoComplete="email"
            />
            {!inv.recipientEmail && (
              <p className="text-[12px] text-muted-foreground">
                No contact email is saved for this property — enter one to send.
              </p>
            )}
          </div>
          <DialogFooter className="gap-[8px]">
            <button
              onClick={() => setSendOpen(false)}
              className="flex-1 rounded-[12px] py-[10px] text-[13px] font-display font-bold bg-card border border-border shadow-[var(--shadow)] active:scale-[0.98]"
            >
              Cancel
            </button>
            <button
              onClick={onSend}
              disabled={send.isPending || !recipient.trim()}
              className="flex-1 flex items-center justify-center gap-[6px] rounded-[12px] py-[10px] text-[13px] font-display font-bold text-[var(--ink)] bg-[var(--primary)] shadow-[0_6px_20px_rgba(180,255,68,0.35)] disabled:opacity-50 active:scale-[0.98]"
            >
              <Send className="w-[15px] h-[15px]" />
              {send.isPending ? "Sending…" : "Send invoice"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <InvoiceEditor open={editOpen} onOpenChange={setEditOpen} invoice={inv} />
      <RecordPaymentSheet
        open={payOpen}
        onOpenChange={setPayOpen}
        invoice={inv}
      />
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {inv.invoiceNo}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the invoice, its line items, and any
              recorded payments. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
