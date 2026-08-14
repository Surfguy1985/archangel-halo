import { useState, useMemo } from "react";
import {
  useGetMoneySummary,
  useListInvoices,
  useListExpenses,
  useSendInvoice,
  useRemindInvoice,
  useListCrewPayments,
  useUpdateCrewPayment,
  getListInvoicesQueryKey,
  getGetMoneySummaryQueryKey,
  usePayExpenseBill,
  getListExpensesQueryKey,
  getListCrewPaymentsQueryKey,
  type Invoice,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import {
  Plus,
  Check,
  History,
  Download,
  ChevronRight,
  ChevronLeft,
  FileText,
  Receipt,
  Users,
  Landmark,
  BarChart3,
  BookOpen,
  Wallet,
  ScanLine,
  MoreHorizontal,
  FileCheck2,
} from "lucide-react";
import { InvoiceEditor } from "@/components/InvoiceEditor";
import { AddExpenseSheet } from "@/components/AddExpenseSheet";
import { RecordPaymentSheet } from "@/components/RecordPaymentSheet";
import { ScanCheckSheet } from "@/components/ScanCheckSheet";
import { AddCrewPaymentSheet } from "@/components/AddCrewPaymentSheet";
import { BankTab } from "@/components/BankTab";
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exportCsv } from "@/lib/exportCsv";
import { BusinessReportTab } from "@/components/BusinessReportTab";
import { BooksTab } from "@/components/BooksTab";
import { CheckFiles } from "@/components/CheckFiles";

type HistoryRow = {
  id: string;
  primary: string;
  secondary: string;
  amount: number;
  badge?: { label: string; color: string };
};

function OverflowActions({
  onHistory,
  onExport,
  disabled,
}: {
  onHistory: () => void;
  onExport: () => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          disabled={disabled}
          aria-label="More actions"
          className="w-[52px] shrink-0 flex items-center justify-center rounded-[18px] bg-card border border-border shadow-[var(--shadow)] disabled:opacity-40 transition-transform active:scale-[0.95]"
          data-testid="button-money-overflow"
        >
          <MoreHorizontal className="w-[20px] h-[20px] text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={onHistory}>
          <History className="w-4 h-4 mr-2" /> History
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onExport}>
          <Download className="w-4 h-4 mr-2" /> Export CSV
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HistorySheet({
  open,
  onOpenChange,
  title,
  rows,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  rows: HistoryRow[];
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[32px] bg-[var(--paper)] p-0 flex flex-col max-h-[88vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]"
      >
        <div className="w-[40px] h-[5px] rounded-full bg-[rgba(23,24,28,0.16)] mx-auto mt-[12px] mb-[4px] shrink-0" />
        <div className="p-[12px_24px_32px] overflow-y-auto">
          <SheetHeader className="text-left mb-[16px]">
            <SheetTitle className="font-display font-bold text-[22px] tracking-[-0.01em] m-[6px_0_2px]">
              {title}
            </SheetTitle>
            <div className="text-[14px] text-muted-foreground">
              {rows.length} record{rows.length === 1 ? "" : "s"}, newest first.
            </div>
          </SheetHeader>
          {rows.length === 0 ? (
            <div className="text-center text-[14px] text-muted-foreground py-[40px]">
              Nothing here yet.
            </div>
          ) : (
            <div className="bg-card border border-border rounded-[20px] shadow-[0_2px_6px_rgba(0,0,0,0.04)] p-[8px_16px]">
              {rows.map((r, idx) => (
                <div
                  key={r.id}
                  className={`flex items-center gap-[12px] py-[14px] text-[15px] ${
                    idx !== 0 ? "border-t border-border/60" : ""
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-[8px]">
                      <span className="font-semibold truncate text-[15px]">{r.primary}</span>
                      {r.badge && (
                        <span
                          className="text-[10px] font-bold uppercase tracking-[0.06em] px-[8px] py-[3px] rounded-full text-white shrink-0"
                          style={{ backgroundColor: r.badge.color }}
                        >
                          {r.badge.label}
                        </span>
                      )}
                    </div>
                    <div className="text-[13px] text-muted-foreground truncate mt-[2px]">
                      {r.secondary}
                    </div>
                  </div>
                  <div className="font-display font-semibold tabular-nums shrink-0 text-[16px]">
                    ${r.amount.toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString() : "";

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

function OverviewHero() {
  const { data: money, isLoading } = useGetMoneySummary({ query: { queryKey: getGetMoneySummaryQueryKey(), refetchInterval: 30000 } });
  if (isLoading || !money) {
    return <div className="animate-pulse h-[260px] bg-card shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] rounded-[20px] border border-[var(--hairline)]" />;
  }
  return (
    <div className="bg-card shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] rounded-[24px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] p-[24px] relative overflow-hidden">
      <div className="relative z-10">
        <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.15em] mb-[8px]">
          Landing this week
        </div>
        <div className="font-display font-bold text-[56px] tracking-tight tabular-nums leading-none mb-[32px] text-[var(--ink)]">
          ${money.landing.toLocaleString()}
        </div>

        <div className="grid grid-cols-3 gap-[16px] pt-[20px] border-t border-[var(--hairline)]">
          <div>
            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.15em]">At Risk</div>
            <div className="font-display font-bold text-[20px] text-destructive tabular-nums mt-[4px]">
              ${money.atRisk.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.15em]">MTD Rev</div>
            <div className="font-display font-bold text-[20px] tabular-nums mt-[4px] text-[var(--ink)]">
              ${money.mtd.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.15em]">Margin</div>
            <div className="font-display font-bold text-[20px] tabular-nums mt-[4px] text-[var(--gold-dark)]">
              {money.marginPct}%
            </div>
          </div>
        </div>

        <div className="mt-[24px] pt-[20px] border-t border-[var(--hairline)]">
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.15em] mb-[16px]">
            Aging Accounts
          </div>
          <div className="flex gap-[8px]">
            {money.aging.map((b, i) => (
              <div key={i} className="flex-1 text-center">
                <div
                  className="h-[4px] rounded-full mb-[10px] opacity-80"
                  style={{ backgroundColor: b.color || "var(--muted)" }}
                />
                <span className="block text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
                  {b.label}
                </span>
                <b className="block text-[14px] font-display tabular-nums mt-[4px] text-[var(--ink)]">
                  ${b.value.toLocaleString()}
                </b>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Invoices() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { data: invoices, isLoading } = useListInvoices(undefined, { query: { queryKey: getListInvoicesQueryKey(), refetchInterval: 30000 } });
  const [addOpen, setAddOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [payInvoice, setPayInvoice] = useState<Invoice | null>(null);
  const send = useSendInvoice();
  const remind = useRemindInvoice();
  const { toast } = useToast();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey() });
  };

  const sorted = useMemo(() => {
    return [...(invoices ?? [])].sort(
      (a, b) =>
        new Date(b.sentAt || b.dueAt || 0).getTime() -
        new Date(a.sentAt || a.dueAt || 0).getTime()
    );
  }, [invoices]);

  const historyRows: HistoryRow[] = useMemo(() => sorted.map((inv) => ({
    id: inv.id,
    primary: inv.propertyName || inv.invoiceNo,
    secondary: [
      inv.invoiceNo,
      inv.sentAt ? `Sent ${fmtDate(inv.sentAt)}` : null,
      inv.paidAt ? `Paid ${fmtDate(inv.paidAt)}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    amount: inv.amount,
    badge: {
      label: statusLabel[inv.status] || inv.status,
      color: statusColor[inv.status] || "#8B8577",
    },
  })), [sorted]);

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
      }))
    );
  };

  return (
    <div className="animate-in fade-in duration-200">
      <div className="flex gap-[10px] mb-[16px]">
        <button
          onClick={() => setAddOpen(true)}
          className="flex-1 flex items-center justify-center gap-[8px] rounded-[18px] py-[16px] font-display font-bold text-[15px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_8px_24px_rgba(143,106,31,0.25)] transition-transform active:scale-[0.98]"
        >
          <Plus className="w-[19px] h-[19px]" /> New invoice
        </button>
        <button
          onClick={() => setScanOpen(true)}
          className="flex-1 flex items-center justify-center gap-[8px] rounded-[18px] py-[16px] font-display font-bold text-[15px] bg-card border border-[var(--gold)]/40 text-[var(--gold-dark)] shadow-[var(--shadow)] transition-transform active:scale-[0.98]"
          data-testid="button-open-scan-check"
        >
          <ScanLine className="w-[19px] h-[19px]" /> Scan check
        </button>
        <OverflowActions
          onHistory={() => setHistoryOpen(true)}
          onExport={onExport}
          disabled={!invoices || invoices.length === 0}
        />
      </div>
      {isLoading ? (
        <div className="animate-pulse h-32 bg-card border border-border rounded-[20px]" />
      ) : !invoices || invoices.length === 0 ? (
        <div className="text-center text-[15px] text-muted-foreground py-[50px]">
          No invoices yet.
        </div>
      ) : (
        <div className="flex flex-col gap-[12px]">
          {sorted.map((inv) => (
            <div
              key={inv.id}
              onClick={() => navigate(`/invoices/${inv.id}`)}
              className="bg-card shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] rounded-[20px] border border-border p-[18px] cursor-pointer transition-transform active:scale-[0.98] hover:bg-card"
            >
              <div className="flex items-start gap-[12px]">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-[10px]">
                    <span className="font-mono text-[13px] text-muted-foreground">
                      {inv.invoiceNo}
                    </span>
                    <span
                      className="text-[10px] font-bold uppercase tracking-[0.06em] px-[8px] py-[3px] rounded-full text-white"
                      style={{ backgroundColor: statusColor[inv.status] || "#8B8577" }}
                    >
                      {statusLabel[inv.status] || inv.status}
                      {inv.status === "past_due" && inv.daysLate
                        ? ` · ${inv.daysLate}d`
                        : ""}
                    </span>
                  </div>
                  <div className="font-semibold text-[16px] truncate mt-[6px]">
                    {inv.propertyName || "—"}
                  </div>
                </div>
                <div className="flex items-center gap-[6px] shrink-0 pt-[2px]">
                  <span className="font-display font-bold text-[22px] tabular-nums text-[var(--ink)]">
                    ${inv.amount.toLocaleString()}
                  </span>
                  <ChevronRight className="w-[20px] h-[20px] text-muted-foreground/50" />
                </div>
              </div>
              <div className="flex gap-[10px] mt-[16px]">
                {inv.status === "draft" && (
                  <button
                    className="flex-1 rounded-[14px] py-[12px] text-[14px] font-display font-bold text-[var(--ink)] bg-[var(--primary)] shadow-[0_2px_8px_rgba(143,106,31,0.2)] disabled:opacity-50 transition-transform active:scale-[0.98]"
                    onClick={(e) => {
                      e.stopPropagation();
                      send.mutate(
                        { id: inv.id },
                        {
                          onSuccess: () => {
                            invalidate();
                            toast({
                              title: "Invoice sent",
                              description: `${inv.invoiceNo} emailed to the client.`,
                            });
                          },
                          onError: (e) => {
                            const missingEmail = /no billing contact email/i.test(
                              e.message
                            );
                            toast({
                              title: "Couldn't send invoice",
                              description: missingEmail
                                ? "No billing email on file — add one on the invoice page."
                                : e.message,
                              variant: "destructive",
                            });
                            // Take the user straight to where they can fix it.
                            if (missingEmail) navigate(`/invoices/${inv.id}`);
                          },
                        }
                      );
                    }}
                    disabled={send.isPending}
                  >
                    Send to client
                  </button>
                )}
                {inv.status === "past_due" && (
                  <button
                    className="flex-1 rounded-[14px] py-[12px] text-[14px] font-display font-bold bg-card border border-destructive/20 text-destructive shadow-[0_2px_4px_rgba(190,60,60,0.05)] disabled:opacity-50 transition-transform active:scale-[0.98]"
                    onClick={(e) => {
                      e.stopPropagation();
                      remind.mutate(
                        { id: inv.id },
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
                        }
                      );
                    }}
                    disabled={remind.isPending}
                  >
                    Send reminder
                  </button>
                )}
                {inv.status !== "paid" && inv.status !== "draft" && (
                  <button
                    className="flex-1 rounded-[14px] py-[12px] text-[14px] font-display font-bold text-[var(--ink)] bg-[var(--primary)] shadow-[0_2px_8px_rgba(143,106,31,0.2)] transition-transform active:scale-[0.98]"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPayInvoice(inv);
                    }}
                  >
                    Record payment
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <InvoiceEditor open={addOpen} onOpenChange={setAddOpen} />
      <ScanCheckSheet open={scanOpen} onOpenChange={setScanOpen} />
      <RecordPaymentSheet
        open={!!payInvoice}
        onOpenChange={(o) => !o && setPayInvoice(null)}
        invoice={payInvoice}
      />
      <HistorySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        title="Invoice history"
        rows={historyRows}
      />
    </div>
  );
}

function Expenses() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: expenses, isLoading } = useListExpenses(undefined, { query: { queryKey: getListExpensesQueryKey(), refetchInterval: 30000 } });
  const [addOpen, setAddOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const payBill = usePayExpenseBill();

  const doPay = (id: string, vendor?: string | null) =>
    payBill.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListExpensesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey() });
          queryClient.invalidateQueries({ queryKey: ["/accounting"] });
          toast({ title: `Paid ${vendor || "bill"}` });
        },
        onError: () => toast({ title: "Couldn't mark that bill paid" }),
      }
    );

  const sorted = useMemo(() => {
    return [...(expenses ?? [])].sort(
      (a, b) =>
        new Date(b.spentOn || 0).getTime() - new Date(a.spentOn || 0).getTime()
    );
  }, [expenses]);

  const historyRows: HistoryRow[] = useMemo(() => sorted.map((e) => ({
    id: e.id,
    primary: e.vendor || e.category || "Expense",
    secondary: [e.category, fmtDate(e.spentOn)].filter(Boolean).join(" · "),
    amount: e.amount,
  })), [sorted]);

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
      }))
    );
  };

  return (
    <div className="animate-in fade-in duration-200">
      <div className="flex gap-[10px] mb-[16px]">
        <button
          onClick={() => setAddOpen(true)}
          className="flex-1 flex items-center justify-center gap-[8px] rounded-[18px] py-[16px] font-display font-bold text-[16px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_8px_24px_rgba(143,106,31,0.25)] transition-transform active:scale-[0.98]"
        >
          <Plus className="w-[20px] h-[20px]" /> Log expense
        </button>
        <OverflowActions
          onHistory={() => setHistoryOpen(true)}
          onExport={onExport}
          disabled={!expenses || expenses.length === 0}
        />
      </div>
      {isLoading ? (
        <div className="animate-pulse h-32 bg-card border border-border rounded-[20px]" />
      ) : !expenses || expenses.length === 0 ? (
        <div className="text-center text-[15px] text-muted-foreground py-[50px]">
          No expenses logged.
        </div>
      ) : (
        <div className="bg-card shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] rounded-[20px] border border-border p-[8px_16px]">
          {sorted.map((e, idx) => (
            <div
              key={e.id}
              className={`flex items-center gap-[12px] py-[16px] text-[15px] ${
                idx !== 0 ? "border-t border-border/60" : ""
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate text-[16px] text-[var(--ink)]">
                  {e.vendor || e.category || "Expense"}
                </div>
                <div className="text-[13px] text-muted-foreground truncate mt-[2px]">
                  {[
                    e.category,
                    e.spentOn ? new Date(e.spentOn).toLocaleDateString() : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              {e.paymentStatus === "open" && (
                <span className="text-[10px] font-bold uppercase px-[8px] py-[3px] rounded-full bg-amber-500/15 text-amber-700 shrink-0">
                  Unpaid
                </span>
              )}
              <div className="font-display font-semibold tabular-nums shrink-0 text-[18px] text-[var(--ink)]">
                ${e.amount.toLocaleString()}
              </div>
              {e.paymentStatus === "open" && (
                <button
                  className="text-[13px] font-display font-bold px-[12px] py-[8px] rounded-[12px] border border-border bg-background shrink-0 disabled:opacity-50 active:scale-[0.95] transition-transform shadow-sm"
                  disabled={payBill.isPending}
                  onClick={() => doPay(e.id, e.vendor)}
                  data-testid={`button-pay-bill-${e.id}`}
                >
                  Mark paid
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <AddExpenseSheet open={addOpen} onOpenChange={setAddOpen} />
      <HistorySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        title="Expense history"
        rows={historyRows}
      />
    </div>
  );
}

function CrewPay() {
  const queryClient = useQueryClient();
  const { data: payments, isLoading } = useListCrewPayments({ query: { queryKey: getListCrewPaymentsQueryKey(), refetchInterval: 30000 } });
  const [addOpen, setAddOpen] = useState(false);
  const markPaid = useUpdateCrewPayment();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListCrewPaymentsQueryKey() });

  type Payment = NonNullable<typeof payments>[number];

  const groups = useMemo(() => {
    const map = new Map<string, { name: string; items: Payment[] }>();
    for (const p of payments ?? []) {
      const key = p.crewId ?? p.crewName ?? "unknown";
      const name = p.crewName || "Unassigned crew";
      if (!map.has(key)) map.set(key, { name, items: [] });
      map.get(key)!.items.push(p);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [payments]);

  const row = (p: Payment, idx: number, len: number) => {
    const dateStr = p.paidAt
      ? new Date(p.paidAt).toLocaleDateString()
      : p.dueOn
      ? `Due ${new Date(p.dueOn).toLocaleDateString()}`
      : null;
    const isDone = p.status === "completed";
    return (
      <div
        key={p.id}
        className={`flex items-center gap-[12px] py-[16px] ${
          idx !== len - 1 ? "border-t border-border/60" : ""
        }`}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-[10px]">
            <span className="font-display font-bold text-[18px] tabular-nums text-[var(--ink)]">
              ${p.amount.toLocaleString()}
            </span>
            <span
              className={`text-[10px] font-bold uppercase tracking-[0.06em] px-[8px] py-[3px] rounded-full ${
                isDone
                  ? "bg-[rgba(60,122,78,0.12)] text-[var(--green,#3c7a4e)]"
                  : "bg-[rgba(190,60,60,0.1)] text-destructive"
              }`}
            >
              {isDone ? "Completed" : "Pending"}
            </span>
          </div>
          <div className="text-[13px] text-muted-foreground truncate mt-[4px]">
            {[p.method || "No method", dateStr, p.note]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        {!isDone && (
          <button
            onClick={() =>
              markPaid.mutate(
                {
                  id: p.id,
                  data: {
                    status: "completed",
                    paidAt: new Date().toISOString().slice(0, 10),
                  },
                },
                { onSuccess: invalidate }
              )
            }
            disabled={markPaid.isPending}
            className="shrink-0 inline-flex items-center gap-[6px] text-[13px] font-bold text-[var(--blue)] disabled:opacity-50 active:scale-95 transition-transform bg-[rgba(59,111,181,0.08)] px-[14px] py-[10px] rounded-[14px]"
          >
            <Check className="w-[16px] h-[16px]" /> Mark paid
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="animate-in fade-in duration-200">
      <button
        onClick={() => setAddOpen(true)}
        className="w-full mb-[24px] flex items-center justify-center gap-[8px] rounded-[18px] py-[16px] font-display font-bold text-[16px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_8px_24px_rgba(143,106,31,0.25)] transition-transform active:scale-[0.98]"
      >
        <Plus className="w-[20px] h-[20px]" /> Record crew payout
      </button>
      <p className="text-[12px] text-muted-foreground mb-[16px] leading-relaxed">
        Recorded payouts hit the ledger now. Bank instant-verify and Cybrid ACH are not live yet.
      </p>

      {isLoading ? (
        <div className="animate-pulse h-32 bg-card border border-border rounded-[20px]" />
      ) : groups.length === 0 ? (
        <div className="text-center text-[15px] text-muted-foreground py-[50px]">
          No crew payments logged.
        </div>
      ) : (
        <div className="flex flex-col gap-[20px]">
          {groups.map((g) => {
            const pendingTotal = g.items
              .filter((i) => i.status === "pending")
              .reduce((sum, i) => sum + i.amount, 0);

            return (
              <div key={g.name} className="bg-card shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--hairline)] rounded-[20px] border border-border overflow-hidden">
                <div className="bg-muted/5 p-[16px_20px] border-b border-border flex items-center justify-between">
                  <div className="font-display font-bold text-[17px] text-[var(--ink)]">{g.name}</div>
                  {pendingTotal > 0 && (
                    <div className="text-[13px] font-bold text-destructive">
                      Owed: ${pendingTotal.toLocaleString()}
                    </div>
                  )}
                </div>
                <div className="p-[4px_20px]">
                  {g.items.map((item, idx) => row(item, idx, g.items.length))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AddCrewPaymentSheet open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

const MENU_ITEMS = [
  { id: "invoices", label: "Invoices & Billing", icon: FileText, desc: "Create invoices, track payments" },
  { id: "payments", label: "Payments", icon: Wallet, desc: "Collect & distribute payments", route: "/money/payments" },
  { id: "checks", label: "Check Files", icon: FileCheck2, desc: "Scanned checks, searchable archive" },
  { id: "expenses", label: "Expenses", icon: Receipt, desc: "Log expenses, pay bills" },
  { id: "crew", label: "Crew Pay", icon: Users, desc: "Manage crew payouts" },
  { id: "bank", label: "Bank Account", icon: Landmark, desc: "Connected accounts & txns" },
  { id: "report", label: "Business Report", icon: BarChart3, desc: "Profit, margins, top jobs" },
  { id: "books", label: "Books & Taxes", icon: BookOpen, desc: "P&L, balance sheet, planner" },
];

export default function Money() {
  const search = useSearch();
  const VALID_TABS = ["overview", "invoices", "checks", "expenses", "crew", "bank", "report", "books"];
  const rawTab = new URLSearchParams(search).get("tab") || "overview";
  const activeTab = VALID_TABS.includes(rawTab) ? rawTab : "overview";
  const [location, navigate] = useLocation();

  const setTab = (t: string) => {
    navigate(`${location.split("?")[0]}?tab=${t}`);
  };

  if (activeTab !== "overview") {
    const titles: Record<string, string> = {
      invoices: "Invoices & Billing",
      checks: "Check Files",
      expenses: "Expenses",
      crew: "Crew Pay",
      bank: "Bank Account",
      report: "Business Report",
      books: "Books & Taxes",
    };

    return (
      <div className="animate-in slide-in-from-right-8 fade-in duration-300 pb-[100px]">
        <div className="flex items-center mb-[16px] px-[4px]">
          <button
            onClick={() => setTab("overview")}
            className="flex items-center gap-[4px] text-[var(--gold-dark)] font-semibold active:opacity-70 p-[8px] ml-[-8px] rounded-full transition-colors hover:bg-muted/10"
          >
            <ChevronLeft className="w-[24px] h-[24px]" />
            <span className="text-[16px]">Money</span>
          </button>
        </div>
        <h1 className="font-display font-bold text-[34px] tracking-[-0.02em] mb-[24px] px-[8px] text-[var(--ink)]">
          {titles[activeTab] || "Money"}
        </h1>
        <div className="px-[8px]">
          {activeTab === "invoices" && <Invoices />}
          {activeTab === "checks" && <CheckFiles />}
          {activeTab === "expenses" && <Expenses />}
          {activeTab === "crew" && <CrewPay />}
          {activeTab === "bank" && <BankTab />}
          {activeTab === "report" && <BusinessReportTab />}
          {activeTab === "books" && <BooksTab />}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-300 pb-[100px]">
      <h1 className="font-display font-bold text-[34px] tracking-[-0.02em] mb-[24px] px-[8px] text-[var(--ink)]">
        Money
      </h1>

      <div className="px-[8px]">
        <OverviewHero />
      </div>

      <div className="px-[8px] mt-[32px]">
        <h2 className="font-display font-bold text-[20px] mb-[16px] text-[var(--ink)] px-[4px] tracking-[-0.01em]">
          Management
        </h2>
        <div className="flex flex-col gap-[14px]">
          {MENU_ITEMS.map((item) => {
            const isRoute = "route" in item && item.route;
            const El = isRoute ? "a" : "button";
            const props = isRoute
              ? { href: item.route, onClick: (e: React.MouseEvent) => { e.preventDefault(); navigate(item.route!); } }
              : { onClick: () => setTab(item.id) };
            return (
              <El
                key={item.id}
                {...props}
                className="bg-card border border-border p-[20px] rounded-[24px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] flex items-center gap-[20px] active:scale-[0.98] transition-transform text-left border border-transparent active:border-[var(--gold-tint)]"
                data-testid={`button-menu-${item.id}`}
              >
                <div className="w-[56px] h-[56px] rounded-full bg-[var(--gold-tint)] text-[var(--gold-dark)] flex items-center justify-center shrink-0">
                  <item.icon className="w-[26px] h-[26px]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-display font-bold text-[18px] text-[var(--ink)]">
                    {item.label}
                  </div>
                  <div className="text-[14px] text-muted-foreground truncate mt-[4px]">
                    {item.desc}
                  </div>
                </div>
                <ChevronRight className="w-[24px] h-[24px] text-muted-foreground/40 shrink-0" />
              </El>
            );
          })}
        </div>
      </div>
    </div>
  );
}
