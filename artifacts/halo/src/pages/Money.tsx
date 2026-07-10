import { useState } from "react";
import {
  useGetMoneySummary,
  useListInvoices,
  useListExpenses,
  useSendInvoice,
  useRemindInvoice,
  getListInvoicesQueryKey,
  getGetMoneySummaryQueryKey,
  type Invoice,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { AddInvoiceSheet } from "@/components/AddInvoiceSheet";
import { AddExpenseSheet } from "@/components/AddExpenseSheet";
import { RecordPaymentSheet } from "@/components/RecordPaymentSheet";

type Tab = "overview" | "invoices" | "expenses";

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
  const [payInvoice, setPayInvoice] = useState<Invoice | null>(null);
  const send = useSendInvoice();
  const remind = useRemindInvoice();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey() });
  };

  return (
    <div className="animate-in fade-in duration-200">
      <button
        onClick={() => setAddOpen(true)}
        className="w-full mb-[12px] flex items-center justify-center gap-[7px] rounded-[13px] py-[12px] font-display font-bold text-[14px] bg-card border border-border shadow-[var(--shadow)] transition-transform active:scale-[0.98]"
      >
        <Plus className="w-[17px] h-[17px]" /> New invoice
      </button>
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
    </div>
  );
}

function Expenses() {
  const { data: expenses, isLoading } = useListExpenses();
  const [addOpen, setAddOpen] = useState(false);
  return (
    <div className="animate-in fade-in duration-200">
      <button
        onClick={() => setAddOpen(true)}
        className="w-full mb-[12px] flex items-center justify-center gap-[7px] rounded-[13px] py-[12px] font-display font-bold text-[14px] bg-card border border-border shadow-[var(--shadow)] transition-transform active:scale-[0.98]"
      >
        <Plus className="w-[17px] h-[17px]" /> Log expense
      </button>
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
    </div>
  );
}

export default function Money() {
  const [tab, setTab] = useState<Tab>("overview");
  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "invoices", label: "Invoices" },
    { key: "expenses", label: "Expenses" },
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
    </div>
  );
}
