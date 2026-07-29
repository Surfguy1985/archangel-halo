import { useState, useEffect} from "react";
import { useQueryClient} from "@tanstack/react-query";
import {
  useGetBankAnalysis,
  getGetBankAnalysisQueryKey,
  useApplyBankAnalysis,
  getListExpensesQueryKey,
  getListCrewPaymentsQueryKey,
  getListInvoicesQueryKey,
  getGetMoneySummaryQueryKey,
  type BankAnalysisItem,
} from "@workspace/api-client-react";
import { Button} from "@/components/ui/button";
import { Skeleton} from "@/components/ui/skeleton";
import {
  Sparkles,
  RefreshCw,
  Receipt,
  HardHat,
  FileCheck2,
  CircleDollarSign,
  CopyPlus,
} from "lucide-react";
import { useToast} from "@/hooks/use-toast";
import { CategorizeTxnDialog} from "./CategorizeTxnDialog";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD"});

const fmtDate = (s?: string | null) => {
  if (!s) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric"});
};

function Column({
  icon,
  title,
  items,
  total,
  tone,
  empty,
  render,
  onItemClick,
}: {
  icon: React.ReactNode;
  title: string;
  items: BankAnalysisItem[];
  total: number;
  tone: "in" | "out";
  empty: string;
  render: (item: BankAnalysisItem) => { primary: string; secondary: string};
  onItemClick: (item: BankAnalysisItem) => void;
}) {
  return (
    <div className="bg-card rounded-xl border border-border shadow-sm flex flex-col min-w-0">
      <div className="flex items-center gap-2 p-4 pb-3 border-b border-border">
        <span className="text-muted-foreground shrink-0">{icon}</span>
        <span className="font-display font-bold text-sm text-[var(--ink)] flex-1 min-w-0 truncate">
          {title} <span className="font-normal text-muted-foreground">· {items.length}</span>
        </span>
        <span
          className={`font-display font-bold tabular-nums text-sm shrink-0 ${
            tone === "in" ? "text-[#3c7a4e]" : "text-[var(--ink)]"
         }`}
        >
          {tone === "in" ? "+" : "-"}
          {money(total)}
        </span>
      </div>
      <div className="divide-y divide-border overflow-y-auto max-h-[340px]">
        {items.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground">{empty}</div>
        ) : (
          items.map((item) => {
            const r = render(item);
            return (
              <button
                key={item.transactionId}
                onClick={() => onItemClick(item)}
                className="flex items-center gap-3 p-3.5 w-full text-left hover:bg-muted/40 transition-colors cursor-pointer"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[13px] text-[var(--ink)] truncate">
                    {r.primary}
                  </div>
                  <div className="text-[11.5px] text-muted-foreground truncate mt-0.5">
                    {r.secondary}
                  </div>
                </div>
                <div
                  className={`font-display font-semibold tabular-nums text-[13px] shrink-0 ${
                    tone === "in" ? "text-[#3c7a4e]" : "text-[var(--ink)]"
                 }`}
                >
                  {tone === "in" ?`+${money(item.amount)}` :`-${money(item.amount)}`}
                </div>
              </button>
            );
         })
        )}
      </div>
    </div>
  );
}

export function BankAnalysisSection() {
  const queryClient = useQueryClient();
  const { toast} = useToast();
  const [force, setForce] = useState(false);
  const [editing, setEditing] = useState<{
    item: BankAnalysisItem;
    kind: "expense" | "crew" | "invoice" | "other";
 } | null>(null);
  const apply = useApplyBankAnalysis();

  const copyToTabs = () => {
    apply.mutate(
      { params: { days: 30}},
      {
        onSuccess: (r) => {
          queryClient.invalidateQueries({ queryKey: getListExpensesQueryKey()});
          queryClient.invalidateQueries({ queryKey: getListCrewPaymentsQueryKey()});
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey()});
          queryClient.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey()});
          const created = r.expensesCreated + r.crewPaymentsCreated + r.invoicesPaid;
          toast({
            title: created > 0 ? "Copied to your tabs" : "Nothing new to copy",
            description:
              created > 0
                ? [
                    r.expensesCreated > 0 ?`${r.expensesCreated} expenses` : null,
                    r.crewPaymentsCreated > 0
                      ?`${r.crewPaymentsCreated} crew payments`
                      : null,
                    r.invoicesPaid > 0 ?`${r.invoicesPaid} invoices marked paid` : null,
                  ]
                    .filter(Boolean)
                    .join(", ")
                : "Everything here was already in your books.",
         });
       },
        onError: () =>
          toast({
            title: "Couldn't copy items",
            description: "Please try again in a moment.",
            variant: "destructive",
         }),
     },
    );
 };
  const analysis = useGetBankAnalysis(force ? { days: 30, refresh: true} : { days: 30});

  // One-shot refresh: once the forced analysis lands, seed the normal query
  // and go back to cached behavior so we don't bypass the server cache forever.
  useEffect(() => {
    if (force && analysis.isSuccess && analysis.data) {
      queryClient.setQueryData(getGetBankAnalysisQueryKey({ days: 30}), analysis.data);
      setForce(false);
   }
 }, [force, analysis.isSuccess, analysis.data, queryClient]);

  const refresh = () => {
    if (force) {
      analysis.refetch();
   } else {
      queryClient.removeQueries({ queryKey: getGetBankAnalysisQueryKey({ days: 30})});
      setForce(true);
   }
 };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[var(--gold-dark,#8f6a1f)]" />
          <span className="font-display font-bold text-[var(--ink)]">
            Smart breakdown{" "}
            <span className="text-muted-foreground font-normal text-sm">(30 days)</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={copyToTabs}
            disabled={apply.isPending || analysis.isFetching || !analysis.data}
          >
            <CopyPlus
              className={`w-4 h-4 mr-1.5 ${apply.isPending ? "animate-pulse" : ""}`}
            />
            {apply.isPending ? "Copying…" : "Copy to tabs"}
          </Button>
          <Button variant="outline" size="sm" onClick={refresh} disabled={analysis.isFetching}>
            <RefreshCw
              className={`w-4 h-4 mr-1.5 ${analysis.isFetching ? "animate-spin" : ""}`}
            />
            Re-analyze
          </Button>
        </div>
      </div>

      {analysis.isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3}).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      ) : analysis.isError ? (
        <div className="p-6 border border-destructive/40 bg-destructive/5 rounded-xl text-sm text-destructive">
          Couldn't analyze transactions right now. Click Re-analyze to try again.
        </div>
      ) : analysis.data ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Column
              icon={<FileCheck2 className="w-4 h-4" />}
              title="Paid invoices"
              items={analysis.data.paidInvoices}
              total={analysis.data.totals.paidInvoices}
              tone="in"
              empty="No deposits in this period."
              onItemClick={(item) => setEditing({ item, kind: "invoice"})}
              render={(item) => ({
                primary: item.invoiceNo
                  ?`Invoice ${item.invoiceNo}${item.propertyName ?` — ${item.propertyName}` : ""}`
                  : item.name,
                secondary: [fmtDate(item.date), item.note].filter(Boolean).join(" · "),
             })}
            />
            <Column
              icon={<HardHat className="w-4 h-4" />}
              title="Crew payments"
              items={analysis.data.crewPayments}
              total={analysis.data.totals.crewPayments}
              tone="out"
              empty="No payments to people found."
              onItemClick={(item) => setEditing({ item, kind: "crew"})}
              render={(item) => ({
                primary: item.personName || item.name,
                secondary: [
                  fmtDate(item.date),
                  item.crewName ? "On your crew list" : item.note,
                ]
                  .filter(Boolean)
                  .join(" · "),
             })}
            />
            <Column
              icon={<Receipt className="w-4 h-4" />}
              title="Expenses"
              items={analysis.data.expenses}
              total={analysis.data.totals.expenses}
              tone="out"
              empty="No expenses found."
              onItemClick={(item) => setEditing({ item, kind: "expense"})}
              render={(item) => ({
                primary: item.name,
                secondary: [fmtDate(item.date), item.category].filter(Boolean).join(" · "),
             })}
            />
          </div>
          {analysis.data.other.length > 0 && (
            <Column
              icon={<CircleDollarSign className="w-4 h-4" />}
              title="Transfers & other"
              items={analysis.data.other}
              total={analysis.data.totals.other}
              tone="out"
              empty=""
              onItemClick={(item) => setEditing({ item, kind: "other"})}
              render={(item) => ({
                primary: item.name,
                secondary: [fmtDate(item.date), item.category].filter(Boolean).join(" · "),
             })}
            />
          )}
        </>
      ) : null}
      <CategorizeTxnDialog
        item={editing?.item ?? null}
        initialKind={editing?.kind ?? "expense"}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
       }}
      />
    </div>
  );
}
