import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMoneySummary,
  useListInvoices,
  useListExpenses,
  useListCrewPayments,
  useRemindInvoice,
  useUpdateCrewPayment,
  usePayExpenseBill,
  useApproveExpense,
  useRejectExpense,
  getListExpensesQueryKey,
  getListInvoicesQueryKey,
  getGetMoneySummaryQueryKey,
  getListCrewPaymentsQueryKey,
  type Invoice,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowUpRight,
  ArrowDownRight,
  AlertCircle,
  Plus,
  Download,
  ChevronRight,
  Send,
  BellRing,
  CreditCard,
  Check,
  Building2,
  Smartphone,
  FileUp,
  Paperclip,
  Landmark,
  ThumbsUp,
  ThumbsDown,
  ScanLine,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { exportCsv } from "@/lib/exportCsv";
import {
  RecordPaymentDialog,
  AddExpenseDialog,
  AddCrewPaymentDialog,
} from "@/components/MoneyDialogs";
import { SendInvoiceDialog } from "@/components/SendInvoiceDialog";
import { ScanCheckDialog } from "@/components/ScanCheckDialog";
import { BankTab } from "@/components/BankTab";
import { ZellePayDialog } from "@/components/ZellePayDialog";
import { BusinessInfoDialog } from "@/components/BusinessInfoDialog";
import { BusinessReportTab } from "@/components/BusinessReportTab";
import { BooksTab } from "@/components/BooksTab";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const todayLocal = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const fmtDate = (s?: string | null) => {
  if (!s) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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

type InvoiceFilter = "all" | "sent" | "past_due" | "paid" | "draft";

const invoiceFilters: { key: InvoiceFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "sent", label: "Pending" },
  { key: "past_due", label: "Overdue" },
  { key: "paid", label: "Paid" },
  { key: "draft", label: "Drafts" },
];

function SummaryCards() {
  const { data: summary, isLoading } = useGetMoneySummary();
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
      <Card className="bg-[var(--gold)] text-white border-none shadow-md">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-4 opacity-90">
            <ArrowDownRight className="w-5 h-5" />
            <span className="font-semibold uppercase tracking-wider text-xs">Landing (Owed)</span>
          </div>
          <div className="text-3xl font-mono font-bold tracking-tight">
            {money(summary?.landing ?? 0)}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-destructive text-white border-none shadow-md">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-4 opacity-90">
            <AlertCircle className="w-5 h-5" />
            <span className="font-semibold uppercase tracking-wider text-xs">At Risk (&gt;30d)</span>
          </div>
          <div className="text-3xl font-mono font-bold tracking-tight">
            {money(summary?.atRisk ?? 0)}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-4 text-muted-foreground">
            <ArrowUpRight className="w-5 h-5" />
            <span className="font-semibold uppercase tracking-wider text-xs">MTD Revenue</span>
          </div>
          <div className="text-3xl font-mono font-bold tracking-tight text-[var(--ink)]">
            {money(summary?.mtd ?? 0)}
          </div>
          <div className="mt-2 text-sm font-medium text-[var(--gold-dark)]">
            {summary?.marginPct}% {summary?.bankConnected ? "Cash Margin" : "Margin"}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-4 text-muted-foreground">
            <CreditCard className="w-5 h-5" />
            <span className="font-semibold uppercase tracking-wider text-xs">
              {summary?.bankConnected ? "Spent MTD" : "Collected MTD"}
            </span>
          </div>
          <div className="text-3xl font-mono font-bold tracking-tight text-[var(--ink)]">
            {money(
              summary?.bankConnected
                ? summary?.spentMtd ?? 0
                : summary?.collectedMtd ?? 0,
            )}
          </div>
          {summary?.bankConnected && (
            <div className="mt-2 text-xs text-muted-foreground">
              From bank transactions
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AgingReceivables() {
  const { data: summary } = useGetMoneySummary();
  if (!summary) return null;
  return (
    <div>
      <h2 className="text-xl font-display font-bold mb-4 text-[var(--ink)]">Aging Receivables</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {summary.aging.map((bucket, i) => (
          <div key={i} className="p-4 bg-card rounded-lg border border-border">
            <div
              className="h-1.5 rounded-full mb-3"
              style={{ backgroundColor: bucket.color || "var(--muted)" }}
            />
            <span className="text-sm font-medium text-muted-foreground">{bucket.label}</span>
            <div
              className={`font-mono font-bold text-lg mt-1 ${bucket.color ? "text-destructive" : "text-[var(--ink)]"}`}
            >
              {money(bucket.value)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function InvoiceStatusBadge({ inv }: { inv: Invoice }) {
  return (
    <span
      className="text-[10.5px] font-bold uppercase tracking-[0.06em] px-2 py-0.5 rounded-full text-white shrink-0"
      style={{ backgroundColor: statusColor[inv.status] || "#8B8577" }}
    >
      {statusLabel[inv.status] || inv.status}
      {inv.status === "past_due" && inv.daysLate ? ` · ${inv.daysLate}d` : ""}
    </span>
  );
}

function Invoices() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: invoices, isLoading } = useListInvoices();
  const [filter, setFilter] = useState<InvoiceFilter>("all");
  const [payInvoice, setPayInvoice] = useState<Invoice | null>(null);
  const [sendInvoice, setSendInvoice] = useState<Invoice | null>(null);
  const [businessOpen, setBusinessOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const remind = useRemindInvoice();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey() });
  };

  const sorted = useMemo(
    () =>
      [...(invoices ?? [])].sort(
        (a, b) =>
          new Date(b.sentAt || b.dueAt || 0).getTime() -
          new Date(a.sentAt || a.dueAt || 0).getTime(),
      ),
    [invoices],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: sorted.length };
    for (const inv of sorted) c[inv.status] = (c[inv.status] ?? 0) + 1;
    return c;
  }, [sorted]);

  const filtered = filter === "all" ? sorted : sorted.filter((i) => i.status === filter);

  const onExport = () => {
    exportCsv(
      `invoices-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        { key: "invoiceNo", label: "Invoice #" },
        { key: "propertyName", label: "Property" },
        { key: "amount", label: "Amount" },
        { key: "status", label: "Status" },
        { key: "sentAt", label: "Sent" },
        { key: "dueAt", label: "Due" },
        { key: "paidAt", label: "Paid" },
      ],
      sorted.map((inv) => ({
        invoiceNo: inv.invoiceNo,
        propertyName: inv.propertyName || "",
        amount: inv.amount,
        status: statusLabel[inv.status] || inv.status,
        sentAt: fmtDate(inv.sentAt),
        dueAt: fmtDate(inv.dueAt),
        paidAt: fmtDate(inv.paidAt),
      })),
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {invoiceFilters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                filter === f.key
                  ? "bg-[var(--ink)] text-white"
                  : "bg-card border border-border text-muted-foreground hover:text-[var(--ink)]"
              }`}
            >
              {f.label}
              <span className="ml-1.5 opacity-60 tabular-nums">
                {f.key === "all" ? counts.all : counts[f.key] ?? 0}
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBusinessOpen(true)}
          >
            <Building2 className="w-4 h-4 mr-1.5" /> Business info
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onExport}
            disabled={!sorted.length}
          >
            <Download className="w-4 h-4 mr-1.5" /> Export
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setScanOpen(true)}
            data-testid="button-open-scan-check"
          >
            <ScanLine className="w-4 h-4 mr-1.5" /> Scan check
          </Button>
          <Button size="sm" onClick={() => navigate("/invoices/new")}>
            <Plus className="w-4 h-4 mr-1.5" /> New invoice
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : filtered.length === 0 ? (
        <div className="p-12 text-center border border-dashed border-border rounded-xl text-muted-foreground">
          No invoices in this view.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((inv) => (
            <div
              key={inv.id}
              onClick={() => navigate(`/invoices/${inv.id}`)}
              className="group bg-card rounded-xl border border-border shadow-sm p-4 cursor-pointer hover:border-[var(--gold)] transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-[13px] text-muted-foreground">{inv.invoiceNo}</span>
                    <InvoiceStatusBadge inv={inv} />
                  </div>
                  <div className="font-semibold text-[15px] text-[var(--ink)] truncate mt-1">
                    {inv.propertyName || "—"}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {[
                      inv.sentAt ? `Sent ${fmtDate(inv.sentAt)}` : null,
                      inv.dueAt ? `Due ${fmtDate(inv.dueAt)}` : null,
                      inv.paidAt ? `Paid ${fmtDate(inv.paidAt)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Not sent yet"}
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <span className="font-display font-bold text-xl tabular-nums text-[var(--ink)]">
                    {money(inv.amount)}
                  </span>
                  <div className="flex items-center gap-2">
                    {inv.status === "draft" && (
                      <Button
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSendInvoice(inv);
                        }}
                      >
                        <Send className="w-4 h-4 mr-1.5" /> Send
                      </Button>
                    )}
                    {inv.status === "past_due" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          remind.mutate(
                            { id: inv.id },
                            {
                              onSuccess: () => {
                                invalidate();
                                toast({ title: "Reminder sent", description: `Past-due notice emailed for ${inv.invoiceNo}.` });
                              },
                              onError: (err) =>
                                toast({ title: "Couldn't send reminder", description: err.message, variant: "destructive" }),
                            },
                          );
                        }}
                        disabled={remind.isPending}
                      >
                        <BellRing className="w-4 h-4 mr-1.5" /> Remind
                      </Button>
                    )}
                    {inv.status !== "paid" && inv.status !== "draft" && (
                      <Button
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPayInvoice(inv);
                        }}
                      >
                        <CreditCard className="w-4 h-4 mr-1.5" /> Record payment
                      </Button>
                    )}
                    <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-[var(--gold)] transition-colors" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <RecordPaymentDialog
        open={!!payInvoice}
        onOpenChange={(o) => !o && setPayInvoice(null)}
        invoice={payInvoice}
      />
      <SendInvoiceDialog
        open={!!sendInvoice}
        onOpenChange={(o) => !o && setSendInvoice(null)}
        invoice={sendInvoice}
      />
      <BusinessInfoDialog open={businessOpen} onOpenChange={setBusinessOpen} />
      <ScanCheckDialog open={scanOpen} onOpenChange={setScanOpen} />
    </div>
  );
}

function Expenses() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: expenses, isLoading } = useListExpenses();
  const [addOpen, setAddOpen] = useState(false);
  const [billOpen, setBillOpen] = useState(false);
  const payBill = usePayExpenseBill();
  const approve = useApproveExpense();
  const reject = useRejectExpense();

  const invalidateExpenseViews = () => {
    queryClient.invalidateQueries({ queryKey: getListExpensesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: ["/accounting"] });
  };

  const doPay = (id: string, vendor: string | null | undefined) =>
    payBill.mutate(
      { id },
      {
        onSuccess: () => {
          invalidateExpenseViews();
          toast({ title: `Paid ${vendor || "bill"}` });
        },
        onError: () => toast({ title: "Couldn't mark that bill paid", variant: "destructive" }),
      },
    );

  const doApprove = (id: string, vendor: string | null | undefined) =>
    approve.mutate(
      { id },
      {
        onSuccess: () => {
          invalidateExpenseViews();
          toast({ title: `Approved ${vendor || "expense"} — it's on the books now` });
        },
        onError: () => toast({ title: "Couldn't approve that expense", variant: "destructive" }),
      },
    );

  const doReject = (id: string, vendor: string | null | undefined) =>
    reject.mutate(
      { id },
      {
        onSuccess: () => {
          invalidateExpenseViews();
          toast({ title: `Rejected ${vendor || "expense"} — it won't count in your numbers` });
        },
        onError: () => toast({ title: "Couldn't reject that expense", variant: "destructive" }),
      },
    );

  const sorted = useMemo(
    () =>
      [...(expenses ?? [])].sort(
        (a, b) => new Date(b.spentOn || 0).getTime() - new Date(a.spentOn || 0).getTime(),
      ),
    [expenses],
  );

  const total = sorted
    .filter((e) => e.approvalStatus !== "rejected")
    .reduce((s, e) => s + e.amount, 0);
  const pendingCount = sorted.filter((e) => e.approvalStatus === "pending").length;

  const onExport = () => {
    exportCsv(
      `expenses-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        { key: "vendor", label: "Vendor" },
        { key: "category", label: "Category" },
        { key: "amount", label: "Amount" },
        { key: "spentOn", label: "Date" },
        { key: "source", label: "Source" },
      ],
      sorted.map((e) => ({
        vendor: e.vendor || "",
        category: e.category || "",
        amount: e.amount,
        spentOn: fmtDate(e.spentOn),
        source: e.source || "",
      })),
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm text-muted-foreground">
          {sorted.length} expense{sorted.length === 1 ? "" : "s"} ·{" "}
          <span className="font-semibold text-[var(--ink)]">{money(total)}</span> total
          {pendingCount > 0 && (
            <span className="ml-2 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-[var(--gold)]/15 text-[var(--gold-dark,#8f6a1f)]">
              {pendingCount} awaiting approval
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onExport} disabled={!sorted.length}>
            <Download className="w-4 h-4 mr-1.5" /> Export
          </Button>
          <Button variant="outline" size="sm" onClick={() => setBillOpen(true)} data-testid="button-upload-bill">
            <FileUp className="w-4 h-4 mr-1.5" /> Upload bill
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> Log expense
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : sorted.length === 0 ? (
        <div className="p-12 text-center border border-dashed border-border rounded-xl text-muted-foreground">
          No expenses logged yet.
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border shadow-sm divide-y divide-border">
          {sorted.map((e) => {
            const isPending = e.approvalStatus === "pending";
            const isRejected = e.approvalStatus === "rejected";
            return (
              <div key={e.id} className={`flex items-center gap-4 p-4 ${isRejected ? "opacity-50" : ""}`}>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[var(--ink)] truncate flex items-center gap-1.5">
                    {e.vendor || e.category || "Expense"}
                    {e.receiptPath && (
                      <a
                        href={`/api/storage${e.receiptPath}`}
                        target="_blank"
                        rel="noreferrer"
                        title="View receipt"
                        className="text-[var(--gold-dark,#8f6a1f)] hover:opacity-70 shrink-0"
                        data-testid={`link-receipt-${e.id}`}
                      >
                        <Paperclip className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    {[e.category, fmtDate(e.spentOn), e.source].filter(Boolean).join(" · ")}
                    {e.paymentStatus === "open" && e.dueDate ? ` · due ${fmtDate(e.dueDate)}` : ""}
                  </div>
                  {e.bankTxnLabel && (
                    <div className="text-[11px] text-emerald-700 truncate mt-0.5 flex items-center gap-1">
                      <Landmark className="w-3 h-3 shrink-0" /> Matched: {e.bankTxnLabel}
                    </div>
                  )}
                </div>
                {isPending && (
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-[var(--gold)]/15 text-[var(--gold-dark,#8f6a1f)] shrink-0">
                    Needs approval
                  </span>
                )}
                {isRejected && (
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-black/10 text-muted-foreground shrink-0">
                    Rejected
                  </span>
                )}
                {!isPending && !isRejected && e.paymentStatus === "open" && (
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 shrink-0">
                    Unpaid bill
                  </span>
                )}
                <div className="font-display font-semibold tabular-nums text-[var(--ink)] shrink-0">
                  {money(e.amount)}
                </div>
                {isPending ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      className="h-7"
                      disabled={approve.isPending || reject.isPending}
                      onClick={() => doApprove(e.id, e.vendor)}
                      data-testid={`button-approve-${e.id}`}
                    >
                      <ThumbsUp className="w-3.5 h-3.5 mr-1" /> Approve
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                      disabled={approve.isPending || reject.isPending}
                      onClick={() => doReject(e.id, e.vendor)}
                      data-testid={`button-reject-${e.id}`}
                    >
                      <ThumbsDown className="w-3.5 h-3.5 mr-1" /> Reject
                    </Button>
                  </div>
                ) : !isRejected && e.paymentStatus === "open" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0"
                    disabled={payBill.isPending}
                    onClick={() => doPay(e.id, e.vendor)}
                    data-testid={`button-pay-bill-${e.id}`}
                  >
                    Mark paid
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <AddExpenseDialog open={addOpen} onOpenChange={setAddOpen} />
      <AddExpenseDialog open={billOpen} onOpenChange={setBillOpen} billMode />
    </div>
  );
}

function CrewPay() {
  const queryClient = useQueryClient();
  const { data: payments, isLoading } = useListCrewPayments();
  const [addOpen, setAddOpen] = useState(false);
  const markPaid = useUpdateCrewPayment();
  const { toast } = useToast();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListCrewPaymentsQueryKey() });

  type Payment = NonNullable<typeof payments>[number];
  const [zellePayment, setZellePayment] = useState<Payment | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, { name: string; items: Payment[] }>();
    for (const p of payments ?? []) {
      const key = p.crewId ?? p.crewName ?? "unknown";
      const name = p.crewName || "Unassigned crew";
      if (!map.has(key)) map.set(key, { name, items: [] });
      map.get(key)!.items.push(p);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [payments]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="w-4 h-4 mr-1.5" /> Record crew payment
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !payments || payments.length === 0 ? (
        <div className="p-12 text-center border border-dashed border-border rounded-xl text-muted-foreground">
          No crew payments yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {groups.map((g) => {
            const pendingTotal = g.items
              .filter((p) => p.status !== "completed")
              .reduce((s, p) => s + p.amount, 0);
            return (
              <div key={g.name} className="bg-card rounded-xl border border-border shadow-sm p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-display font-bold text-[var(--ink)] truncate">{g.name}</span>
                  {pendingTotal > 0 && (
                    <span className="font-display font-bold text-sm tabular-nums text-destructive shrink-0">
                      {money(pendingTotal)} due
                    </span>
                  )}
                </div>
                <div className="divide-y divide-border">
                  {g.items.map((p) => {
                    const isDone = p.status === "completed";
                    const dateStr = p.paidAt
                      ? fmtDate(p.paidAt)
                      : p.dueOn
                        ? `Due ${fmtDate(p.dueOn)}`
                        : null;
                    return (
                      <div key={p.id} className="flex items-center gap-3 py-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-display font-bold tabular-nums text-[var(--ink)]">
                              {money(p.amount)}
                            </span>
                            <Badge
                              variant={isDone ? "secondary" : "destructive"}
                              className="text-[10px] uppercase"
                            >
                              {isDone ? "Completed" : "Pending"}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground truncate mt-0.5">
                            {[p.method || "No method", dateStr, p.note].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                        {!isDone && (
                          <Button
                            size="sm"
                            onClick={() => setZellePayment(p)}
                          >
                            <Smartphone className="w-4 h-4 mr-1.5" /> Pay via Zelle
                          </Button>
                        )}
                        {!isDone && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              markPaid.mutate(
                                {
                                  id: p.id,
                                  data: {
                                    status: "completed",
                                    paidAt: todayLocal(),
                                  },
                                },
                                {
                                  onSuccess: () => {
                                    invalidate();
                                    toast({ title: "Marked paid" });
                                  },
                                },
                              )
                            }
                            disabled={markPaid.isPending}
                          >
                            <Check className="w-4 h-4 mr-1.5" /> Mark paid
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AddCrewPaymentDialog open={addOpen} onOpenChange={setAddOpen} />
      <ZellePayDialog
        open={!!zellePayment}
        onOpenChange={(o) => {
          if (!o) setZellePayment(null);
        }}
        payment={zellePayment}
      />
    </div>
  );
}

export default function Money() {
  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
      <header>
        <h1 className="text-3xl font-display font-bold text-[var(--ink)] tracking-tight">Money</h1>
        <p className="text-muted-foreground">Cash flow, receivables &amp; payouts</p>
      </header>

      <div data-tour="money-summary">
        <SummaryCards />
      </div>

      <Tabs defaultValue="invoices" className="space-y-6">
        <TabsList data-tour="money-tabs">
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="crew">Crew Pay</TabsTrigger>
          <TabsTrigger value="bank">Bank</TabsTrigger>
          <TabsTrigger value="aging">Aging</TabsTrigger>
          <TabsTrigger value="report" data-testid="tab-report">Report</TabsTrigger>
          <TabsTrigger value="books" data-testid="tab-books">Books</TabsTrigger>
        </TabsList>

        <TabsContent value="invoices">
          <Invoices />
        </TabsContent>
        <TabsContent value="expenses">
          <Expenses />
        </TabsContent>
        <TabsContent value="crew">
          <CrewPay />
        </TabsContent>
        <TabsContent value="bank">
          <BankTab />
        </TabsContent>
        <TabsContent value="books">
          <BooksTab />
        </TabsContent>
        <TabsContent value="aging">
          <AgingReceivables />
        </TabsContent>
        <TabsContent value="report">
          <BusinessReportTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
