import { useState } from "react";
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
  getListCrewPaymentsQueryKey,
  type Invoice,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Check, History, Download } from "lucide-react";
import { AddInvoiceSheet } from "@/components/AddInvoiceSheet";
import { AddExpenseSheet } from "@/components/AddExpenseSheet";
import { RecordPaymentSheet } from "@/components/RecordPaymentSheet";
import { AddCrewPaymentSheet } from "@/components/AddCrewPaymentSheet";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { exportCsv } from "@/lib/exportCsv";

type Tab = "overview" | "invoices" | "expenses" | "crew";

type HistoryRow = {
  id: string;
  primary: string;
  secondary: string;
  amount: number;
  badge?: { label: string; color: string };
};

function SecondaryActions({
  onHistory,
  onExport,
  disabled,
}: {
  onHistory: () => void;
  onExport: () => void;
  disabled?: boolean;
}) {
  const cls =
    "flex-1 flex items-center justify-center gap-[6px] rounded-[11px] py-[9px] text-[13px] font-display font-bold bg-card border border-border shadow-[var(--shadow)] disabled:opacity-40 transition-transform active:scale-[0.98]";
  return (
    <div className="flex gap-[8px] mb-[12px]">
      <button onClick={onHistory} disabled={disabled} className={cls}>
        <History className="w-[15px] h-[15px]" /> History
      </button>
      <button onClick={onExport} disabled={disabled} className={cls}>
        <Download className="w-[15px] h-[15px]" /> Export
      </button>
    </div>
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
        className="rounded-t-[26px] bg-[var(--paper)] p-0 flex flex-col max-h-[86vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]"
      >
        <div className="w-[40px] h-[4.5px] rounded-[3px] bg-[rgba(23,24,28,0.16)] mx-auto mt-[10px] mb-[4px] shrink-0" />
        <div className="p-[8px_20px_26px] overflow-y-auto">
          <SheetHeader className="text-left mb-[14px]">
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px]">
              {title}
            </SheetTitle>
            <div className="text-[13px] text-muted-foreground">
              {rows.length} record{rows.length === 1 ? "" : "s"}, newest first.
            </div>
          </SheetHeader>
          {rows.length === 0 ? (
            <div className="text-center text-[13px] text-muted-foreground py-[30px]">
              Nothing here yet.
            </div>
          ) : (
            <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[6px_14px]">
              {rows.map((r, idx) => (
                <div
                  key={r.id}
                  className={`flex items-center gap-[10px] py-[11px] text-[14px] ${idx !== 0 ? "border-t border-border" : ""}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-[7px]">
                      <span className="font-semibold truncate">{r.primary}</span>
                      {r.badge && (
                        <span
                          className="text-[10px] font-bold uppercase tracking-[0.06em] px-[7px] py-[2px] rounded-full text-white shrink-0"
                          style={{ backgroundColor: r.badge.color }}
                        >
                          {r.badge.label}
                        </span>
                      )}
                    </div>
                    <div className="text-[12px] text-muted-foreground truncate mt-[2px]">
                      {r.secondary}
                    </div>
                  </div>
                  <div className="font-display font-semibold tabular-nums shrink-0">
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

function Overview() {
  const { data: money, isLoading } = useGetMoneySummary();
  if (isLoading || !money) {
    return (
      <div className="animate-pulse space-y-4 pt-4">
        <div className="h-48 bg-card rounded-[16px]"></div>
      </div>
    );
  }
  return (
    <div className="animate-in fade-in duration-200">
      <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[18px_16px] mb-[10px]">
        <div className="font-display font-bold text-[38px] tracking-[-0.02em] tabular-nums leading-none">
          ${money.landing.toLocaleString()}
        </div>
        <div className="text-[12.5px] text-muted-foreground mt-[5px]">Landing this week</div>
        <div className="mt-[20px] pt-[16px] border-t border-border flex gap-[20px]">
          <div>
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.1em]">At Risk</div>
            <div className="font-display font-bold text-[18px] text-destructive tabular-nums mt-[2px]">${money.atRisk.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.1em]">MTD Rev</div>
            <div className="font-display font-bold text-[18px] tabular-nums mt-[2px]">${money.mtd.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.1em]">Margin</div>
            <div className="font-display font-bold text-[18px] tabular-nums mt-[2px]">{money.marginPct}%</div>
          </div>
        </div>
      </div>
      <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[16px]">
        <div className="font-display font-semibold text-[13px] tracking-[0.15em] uppercase text-muted-foreground mb-[12px]">Aging Accounts</div>
        <div className="flex gap-[5px]">
          {money.aging.map((b, i) => (
            <div key={i} className="flex-1 text-center">
              <div className="h-[8px] rounded-[4px] mb-[5px]" style={{ backgroundColor: b.color || "var(--muted)" }} />
              <span className="text-[10.5px] text-muted-foreground">{b.label}</span>
              <b className="block text-[12.5px] font-display tabular-nums mt-[2px]">${b.value.toLocaleString()}</b>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Invoices() {
  const queryClient = useQueryClient();
  const { data: invoices, isLoading } = useListInvoices();
  const [addOpen, setAddOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [payInvoice, setPayInvoice] = useState<Invoice | null>(null);
  const send = useSendInvoice();
  const remind = useRemindInvoice();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey() });
  };

  const sorted = [...(invoices ?? [])].sort(
    (a, b) =>
      new Date(b.sentAt || b.dueAt || 0).getTime() -
      new Date(a.sentAt || a.dueAt || 0).getTime(),
  );

  const historyRows: HistoryRow[] = sorted.map((inv) => ({
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
  }));

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
    <div className="animate-in fade-in duration-200">
      <button
        onClick={() => setAddOpen(true)}
        className="w-full mb-[12px] flex items-center justify-center gap-[7px] rounded-[13px] py-[12px] font-display font-bold text-[14px] bg-card border border-border shadow-[var(--shadow)] transition-transform active:scale-[0.98]"
      >
        <Plus className="w-[17px] h-[17px]" /> New invoice
      </button>
      <SecondaryActions
        onHistory={() => setHistoryOpen(true)}
        onExport={onExport}
        disabled={!invoices || invoices.length === 0}
      />
      {isLoading ? (
        <div className="animate-pulse h-32 bg-card rounded-[16px]" />
      ) : !invoices || invoices.length === 0 ? (
        <div className="text-center text-[13px] text-muted-foreground py-[40px]">No invoices yet.</div>
      ) : (
        <div className="flex flex-col gap-[10px]">
          {invoices.map((inv) => (
            <div key={inv.id} className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[14px]">
              <div className="flex items-start gap-[10px]">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-[8px]">
                    <span className="font-mono text-[12.5px] text-muted-foreground">{inv.invoiceNo}</span>
                    <span
                      className="text-[10.5px] font-bold uppercase tracking-[0.06em] px-[7px] py-[2px] rounded-full text-white"
                      style={{ backgroundColor: statusColor[inv.status] || "#8B8577" }}
                    >
                      {statusLabel[inv.status] || inv.status}
                      {inv.status === "past_due" && inv.daysLate ? ` · ${inv.daysLate}d` : ""}
                    </span>
                  </div>
                  <div className="font-semibold text-[14.5px] truncate mt-[3px]">{inv.propertyName || "—"}</div>
                </div>
                <div className="font-display font-bold text-[19px] tabular-nums shrink-0">${inv.amount.toLocaleString()}</div>
              </div>
              <div className="flex gap-[8px] mt-[12px]">
                {inv.status === "draft" && (
                  <button
                    className="flex-1 rounded-[11px] py-[9px] text-[13px] font-display font-bold text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_4px_14px_rgba(143,106,31,0.3)] disabled:opacity-50 transition-transform active:scale-[0.98]"
                    onClick={() => send.mutate({ id: inv.id }, { onSuccess: invalidate })}
                    disabled={send.isPending}
                  >
                    Send
                  </button>
                )}
                {inv.status === "past_due" && (
                  <button
                    className="flex-1 rounded-[11px] py-[9px] text-[13px] font-display font-bold bg-card border border-border shadow-[var(--shadow)] disabled:opacity-50 transition-transform active:scale-[0.98]"
                    onClick={() => remind.mutate({ id: inv.id }, { onSuccess: invalidate })}
                    disabled={remind.isPending}
                  >
                    Send reminder
                  </button>
                )}
                {inv.status !== "paid" && inv.status !== "draft" && (
                  <button
                    className="flex-1 rounded-[11px] py-[9px] text-[13px] font-display font-bold text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_4px_14px_rgba(143,106,31,0.3)] transition-transform active:scale-[0.98]"
                    onClick={() => setPayInvoice(inv)}
                  >
                    Record payment
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <AddInvoiceSheet open={addOpen} onOpenChange={setAddOpen} />
      <RecordPaymentSheet open={!!payInvoice} onOpenChange={(o) => !o && setPayInvoice(null)} invoice={payInvoice} />
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
  const { data: expenses, isLoading } = useListExpenses();
  const [addOpen, setAddOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const sorted = [...(expenses ?? [])].sort(
    (a, b) =>
      new Date(b.spentOn || 0).getTime() - new Date(a.spentOn || 0).getTime(),
  );

  const historyRows: HistoryRow[] = sorted.map((e) => ({
    id: e.id,
    primary: e.vendor || e.category || "Expense",
    secondary: [e.category, fmtDate(e.spentOn)].filter(Boolean).join(" · "),
    amount: e.amount,
  }));

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
    <div className="animate-in fade-in duration-200">
      <button
        onClick={() => setAddOpen(true)}
        className="w-full mb-[12px] flex items-center justify-center gap-[7px] rounded-[13px] py-[12px] font-display font-bold text-[14px] bg-card border border-border shadow-[var(--shadow)] transition-transform active:scale-[0.98]"
      >
        <Plus className="w-[17px] h-[17px]" /> Log expense
      </button>
      <SecondaryActions
        onHistory={() => setHistoryOpen(true)}
        onExport={onExport}
        disabled={!expenses || expenses.length === 0}
      />
      {isLoading ? (
        <div className="animate-pulse h-32 bg-card rounded-[16px]" />
      ) : !expenses || expenses.length === 0 ? (
        <div className="text-center text-[13px] text-muted-foreground py-[40px]">No expenses logged.</div>
      ) : (
        <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[6px_14px]">
          {expenses.map((e, idx) => (
            <div key={e.id} className={`flex items-center gap-[10px] py-[11px] text-[14px] ${idx !== 0 ? "border-t border-border" : ""}`}>
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{e.vendor || e.category || "Expense"}</div>
                <div className="text-[12px] text-muted-foreground truncate">
                  {[e.category, e.spentOn ? new Date(e.spentOn).toLocaleDateString() : null].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div className="font-display font-semibold tabular-nums shrink-0">${e.amount.toLocaleString()}</div>
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
  const { data: payments, isLoading } = useListCrewPayments();
  const [addOpen, setAddOpen] = useState(false);
  const markPaid = useUpdateCrewPayment();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListCrewPaymentsQueryKey() });

  type Payment = NonNullable<typeof payments>[number];

  const groups = (() => {
    const map = new Map<string, { name: string; items: Payment[] }>();
    for (const p of payments ?? []) {
      const key = p.crewId ?? p.crewName ?? "unknown";
      const name = p.crewName || "Unassigned crew";
      if (!map.has(key)) map.set(key, { name, items: [] });
      map.get(key)!.items.push(p);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  })();

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
        className={`flex items-center gap-[10px] py-[12px] ${idx !== len - 1 ? "border-t border-border" : ""}`}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-[7px]">
            <span className="font-display font-bold text-[15px] tabular-nums">
              ${p.amount.toLocaleString()}
            </span>
            <span
              className={`text-[10px] font-bold uppercase tracking-[0.06em] px-[7px] py-[2px] rounded-full ${
                isDone
                  ? "bg-[rgba(60,122,78,0.14)] text-[var(--green,#3c7a4e)]"
                  : "bg-[rgba(190,60,60,0.12)] text-destructive"
              }`}
            >
              {isDone ? "Completed" : "Pending"}
            </span>
          </div>
          <div className="text-[12px] text-muted-foreground truncate mt-[2px]">
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
                { onSuccess: invalidate },
              )
            }
            disabled={markPaid.isPending}
            className="shrink-0 inline-flex items-center gap-[4px] text-[11.5px] font-bold text-[var(--blue)] disabled:opacity-50"
          >
            <Check className="w-[12px] h-[12px]" /> Mark paid
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="animate-in fade-in duration-200">
      <button
        onClick={() => setAddOpen(true)}
        className="w-full mb-[12px] flex items-center justify-center gap-[7px] rounded-[13px] py-[12px] font-display font-bold text-[14px] bg-card border border-border shadow-[var(--shadow)] transition-transform active:scale-[0.98]"
      >
        <Plus className="w-[17px] h-[17px]" /> Record crew payment
      </button>
      {isLoading ? (
        <div className="animate-pulse h-32 bg-card rounded-[16px]" />
      ) : !payments || payments.length === 0 ? (
        <div className="text-center text-[13px] text-muted-foreground py-[40px]">
          No crew payments yet.
        </div>
      ) : (
        <div className="flex flex-col gap-[12px]">
          {groups.map((g) => {
            const pendingTotal = g.items
              .filter((p) => p.status !== "completed")
              .reduce((s, p) => s + p.amount, 0);
            return (
              <div
                key={g.name}
                className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[6px_14px]"
              >
                <div className="flex items-center justify-between pt-[10px] pb-[2px]">
                  <span className="font-display font-bold text-[14px] truncate">
                    {g.name}
                  </span>
                  {pendingTotal > 0 && (
                    <span className="font-display font-bold text-[12px] tabular-nums text-destructive shrink-0">
                      ${pendingTotal.toLocaleString()} due
                    </span>
                  )}
                </div>
                {g.items.map((p, i) => row(p, i, g.items.length))}
              </div>
            );
          })}
        </div>
      )}
      <AddCrewPaymentSheet open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

export default function Money() {
  const [tab, setTab] = useState<Tab>("overview");
  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "invoices", label: "Invoices" },
    { key: "expenses", label: "Expenses" },
    { key: "crew", label: "Crew Pay" },
  ];
  return (
    <div className="pt-2 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="text-[13px] text-muted-foreground mb-[14px]">Cash radar. Computed live, never typed.</div>
      <div className="flex gap-[4px] bg-card rounded-[13px] p-[4px] shadow-[var(--shadow)] mb-[16px]">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-[10px] py-[8px] text-[13px] font-display font-bold transition-colors ${
              tab === t.key ? "bg-[var(--ink)] text-white" : "text-muted-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "overview" && <Overview />}
      {tab === "invoices" && <Invoices />}
      {tab === "expenses" && <Expenses />}
      {tab === "crew" && <CrewPay />}
    </div>
  );
}
