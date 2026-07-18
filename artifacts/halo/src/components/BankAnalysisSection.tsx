import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBankAnalysis,
  getGetBankAnalysisQueryKey,
  type BankAnalysisItem,
} from "@workspace/api-client-react";
import {
  Sparkles,
  RefreshCw,
  Receipt,
  HardHat,
  FileCheck2,
  CircleDollarSign,
  ChevronDown,
} from "lucide-react";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const fmtDate = (s?: string | null) => {
  if (!s) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

function Section({
  icon,
  title,
  items,
  total,
  tone,
  empty,
  render,
}: {
  icon: React.ReactNode;
  title: string;
  items: BankAnalysisItem[];
  total: number;
  tone: "in" | "out";
  empty: string;
  render: (item: BankAnalysisItem) => React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-card rounded-[16px] shadow-[var(--shadow)] overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-[9px] p-[13px_15px] text-left"
      >
        <span className="shrink-0 text-muted-foreground">{icon}</span>
        <span className="font-display font-bold text-[14.5px] flex-1 min-w-0 truncate">
          {title}
          <span className="font-normal text-muted-foreground text-[12.5px]">
            {" "}
            · {items.length}
          </span>
        </span>
        <span
          className={`font-display font-bold tabular-nums text-[14.5px] shrink-0 ${
            tone === "in" ? "text-[#3c7a4e]" : "text-[var(--ink)]"
          }`}
        >
          {tone === "in" ? "+" : "-"}
          {money(total)}
        </span>
        <ChevronDown
          className={`w-[15px] h-[15px] text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="px-[15px] pb-[6px]">
          {items.length === 0 ? (
            <div className="text-[12.5px] text-muted-foreground pb-[12px]">{empty}</div>
          ) : (
            items.map((item, idx) => (
              <div
                key={item.transactionId}
                className={`py-[10px] ${idx !== 0 ? "border-t border-border" : ""}`}
              >
                {render(item)}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  primary,
  secondary,
  amount,
  tone,
}: {
  primary: string;
  secondary: string;
  amount: number;
  tone: "in" | "out";
}) {
  return (
    <div className="flex items-center gap-[10px] text-[13.5px]">
      <div className="flex-1 min-w-0">
        <div className="font-semibold truncate">{primary}</div>
        <div className="text-[11.5px] text-muted-foreground truncate mt-[1px]">
          {secondary}
        </div>
      </div>
      <div
        className={`font-display font-semibold tabular-nums shrink-0 ${
          tone === "in" ? "text-[#3c7a4e]" : "text-[var(--ink)]"
        }`}
      >
        {tone === "in" ? `+${money(amount)}` : `-${money(amount)}`}
      </div>
    </div>
  );
}

export function BankAnalysisSection() {
  const queryClient = useQueryClient();
  const [force, setForce] = useState(false);
  const analysis = useGetBankAnalysis(force ? { days: 30, refresh: true } : { days: 30 });

  // One-shot refresh: once the forced analysis lands, seed the normal query
  // and go back to cached behavior so we don't bypass the server cache forever.
  useEffect(() => {
    if (force && analysis.isSuccess && analysis.data) {
      queryClient.setQueryData(getGetBankAnalysisQueryKey({ days: 30 }), analysis.data);
      setForce(false);
    }
  }, [force, analysis.isSuccess, analysis.data, queryClient]);

  const refresh = () => {
    if (force) {
      analysis.refetch();
    } else {
      queryClient.removeQueries({ queryKey: getGetBankAnalysisQueryKey({ days: 30 }) });
      setForce(true);
    }
  };

  return (
    <div className="flex flex-col gap-[10px]">
      <div className="flex items-center gap-[8px] mt-[4px]">
        <div className="flex-1 min-w-0 flex items-center gap-[6px]">
          <Sparkles className="w-[14px] h-[14px] text-[var(--gold-dark,#8f6a1f)] shrink-0" />
          <span className="font-display font-semibold text-[13px] tracking-[0.15em] uppercase text-muted-foreground truncate">
            Smart breakdown{" "}
            <span className="normal-case tracking-normal font-normal">(30 days)</span>
          </span>
        </div>
        <button
          onClick={refresh}
          disabled={analysis.isFetching}
          className="shrink-0 inline-flex items-center gap-[5px] rounded-[10px] px-[10px] py-[7px] text-[12px] font-display font-bold bg-card border border-border shadow-[var(--shadow)] disabled:opacity-40 transition-transform active:scale-[0.98]"
        >
          <RefreshCw
            className={`w-[13px] h-[13px] ${analysis.isFetching ? "animate-spin" : ""}`}
          />
          Re-analyze
        </button>
      </div>

      {analysis.isLoading ? (
        <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[24px] text-center">
          <Sparkles className="w-[20px] h-[20px] mx-auto text-[var(--gold-dark,#8f6a1f)] animate-pulse mb-[8px]" />
          <div className="text-[13px] text-muted-foreground">
            Reading your bank activity and sorting it into expenses, crew payments and
            paid invoices…
          </div>
        </div>
      ) : analysis.isError ? (
        <div className="rounded-[16px] border border-destructive/40 bg-destructive/5 p-[14px] text-[13px] text-destructive">
          Couldn't analyze transactions right now. Tap Re-analyze to try again.
        </div>
      ) : analysis.data ? (
        <>
          <Section
            icon={<FileCheck2 className="w-[16px] h-[16px]" />}
            title="Paid invoices"
            items={analysis.data.paidInvoices}
            total={analysis.data.totals.paidInvoices}
            tone="in"
            empty="No deposits in this period."
            render={(item) => (
              <Row
                primary={
                  item.invoiceNo
                    ? `Invoice ${item.invoiceNo}${item.propertyName ? ` — ${item.propertyName}` : ""}`
                    : item.name
                }
                secondary={[fmtDate(item.date), item.note].filter(Boolean).join(" · ")}
                amount={item.amount}
                tone="in"
              />
            )}
          />
          <Section
            icon={<HardHat className="w-[16px] h-[16px]" />}
            title="Crew payments"
            items={analysis.data.crewPayments}
            total={analysis.data.totals.crewPayments}
            tone="out"
            empty="No payments to people found."
            render={(item) => (
              <Row
                primary={item.personName || item.name}
                secondary={[
                  fmtDate(item.date),
                  item.crewName ? "On your crew list" : item.note,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                amount={item.amount}
                tone="out"
              />
            )}
          />
          <Section
            icon={<Receipt className="w-[16px] h-[16px]" />}
            title="Expenses"
            items={analysis.data.expenses}
            total={analysis.data.totals.expenses}
            tone="out"
            empty="No expenses found."
            render={(item) => (
              <Row
                primary={item.name}
                secondary={[fmtDate(item.date), item.category].filter(Boolean).join(" · ")}
                amount={item.amount}
                tone="out"
              />
            )}
          />
          {analysis.data.other.length > 0 && (
            <Section
              icon={<CircleDollarSign className="w-[16px] h-[16px]" />}
              title="Transfers & other"
              items={analysis.data.other}
              total={analysis.data.totals.other}
              tone="out"
              empty=""
              render={(item) => (
                <Row
                  primary={item.name}
                  secondary={[fmtDate(item.date), item.category]
                    .filter(Boolean)
                    .join(" · ")}
                  amount={item.amount}
                  tone="out"
                />
              )}
            />
          )}
        </>
      ) : null}
    </div>
  );
}
