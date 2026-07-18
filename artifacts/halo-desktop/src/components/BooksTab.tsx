import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListLedgerAccounts,
  useListJournalEntries,
  useCreateJournalEntry,
  useDeleteJournalEntry,
  useGetProfitAndLoss,
  useGetBalanceSheetReport,
  useGetCashFlowReport,
  useRebuildLedgerEntries,
  useGetTaxReport,
  useGetBankReconciliation,
  useImportBankTransaction,
  getGetTaxReportQueryKey,
  getGetBankReconciliationQueryKey,
  getListLedgerAccountsQueryKey,
  getListJournalEntriesQueryKey,
  getGetProfitAndLossQueryKey,
  getGetBalanceSheetReportQueryKey,
  getGetCashFlowReportQueryKey,
  type LedgerAccount,
  type JournalEntryFull,
  type BankTxnMatch,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, RefreshCw, Trash2, Landmark, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const fmtDate = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric", year: "numeric" },
  );
};

function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function yearStart(): string {
  return `${new Date().getFullYear()}-01-01`;
}

type SubTab = "pnl" | "balance" | "cash" | "journal" | "accounts" | "tax" | "bank";

function ReportRows({
  rows,
  totalLabel,
  total,
}: {
  rows: Array<{ code: string; name: string; amount: number }>;
  totalLabel: string;
  total: number;
}) {
  return (
    <div>
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground py-2">Nothing recorded yet.</p>
      )}
      {rows.map((r) => (
        <div
          key={r.code}
          className="flex items-center justify-between py-2 border-b border-border/60 last:border-0"
          data-testid={`report-row-${r.code}`}
        >
          <span className="text-sm">
            <span className="text-muted-foreground mr-2 tabular-nums">{r.code}</span>
            {r.name}
          </span>
          <span className="text-sm font-semibold tabular-nums">{money(r.amount)}</span>
        </div>
      ))}
      <div className="flex items-center justify-between pt-3 mt-1 border-t border-border">
        <span className="text-sm font-bold">{totalLabel}</span>
        <span className="text-sm font-bold tabular-nums">{money(total)}</span>
      </div>
    </div>
  );
}

function JournalEntryDialog({
  open,
  onOpenChange,
  accounts,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accounts: LedgerAccount[];
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const create = useCreateJournalEntry();
  const [memo, setMemo] = useState("");
  const [amount, setAmount] = useState("");
  const [entryDate, setEntryDate] = useState(localToday());
  const [debitCode, setDebitCode] = useState("");
  const [creditCode, setCreditCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    if (!debitCode || !creditCode || debitCode === creditCode) {
      setError("Pick two different accounts.");
      return;
    }
    create.mutate(
      {
        data: {
          entryDate,
          memo: memo.trim() || null,
          lines: [
            { accountCode: debitCode, debit: amt },
            { accountCode: creditCode, credit: amt },
          ],
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/accounting"] });
          queryClient.invalidateQueries({ queryKey: getListLedgerAccountsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListJournalEntriesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetProfitAndLossQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetBalanceSheetReportQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetCashFlowReportQueryKey() });
          onOpenChange(false);
          setMemo("");
          setAmount("");
          toast({ title: "Journal entry posted" });
        },
        onError: (err: unknown) => {
          setError(
            (err as { data?: { error?: string } })?.data?.error ||
              "Couldn't post the entry.",
          );
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New journal entry</DialogTitle>
          <DialogDescription>
            Move money between accounts — owner draws, deposits, adjustments.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="je-amount">Amount</Label>
              <Input
                id="je-amount"
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                data-testid="input-je-amount"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="je-date">Date</Label>
              <Input
                id="je-date"
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Debit (money goes to)</Label>
            <Select value={debitCode} onValueChange={setDebitCode}>
              <SelectTrigger data-testid="select-je-debit">
                <SelectValue placeholder="Pick account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.code} value={a.code}>
                    {a.code} — {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Credit (money comes from)</Label>
            <Select value={creditCode} onValueChange={setCreditCode}>
              <SelectTrigger data-testid="select-je-credit">
                <SelectValue placeholder="Pick account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.code} value={a.code}>
                    {a.code} — {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="je-memo">Memo</Label>
            <Input
              id="je-memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Owner deposit"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={create.isPending} data-testid="button-je-post">
            {create.isPending ? "Posting…" : "Post entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SOURCE_BADGE: Record<string, string> = {
  system: "bg-black/[0.05] text-muted-foreground",
  manual: "bg-[var(--gold,#B98A2F)]/15 text-[var(--gold,#B98A2F)]",
  voice: "bg-blue-500/10 text-blue-600",
};

export function BooksTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [sub, setSub] = useState<SubTab>("pnl");
  const [entryOpen, setEntryOpen] = useState(false);
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(localToday());

  const { data: acctData, isLoading: acctLoading } = useListLedgerAccounts();
  const { data: journalData, isLoading: jLoading } = useListJournalEntries({ limit: 100 });
  const { data: pnl } = useGetProfitAndLoss({ from, to });
  const { data: bs } = useGetBalanceSheetReport({ asOf: to });
  const { data: cf } = useGetCashFlowReport({ from, to });
  const rebuild = useRebuildLedgerEntries();
  const del = useDeleteJournalEntry();

  const accounts = useMemo(() => acctData?.accounts ?? [], [acctData]);
  const entries: JournalEntryFull[] = journalData?.entries ?? [];

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getListLedgerAccountsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListJournalEntriesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetProfitAndLossQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetBalanceSheetReportQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCashFlowReportQueryKey() });
  };

  const doRebuild = () =>
    rebuild.mutate(undefined, {
      onSuccess: (r) => {
        invalidateAll();
        toast({ title: `Books rebuilt — ${r.posted} entries posted` });
      },
      onError: () => toast({ title: "Couldn't rebuild the books", variant: "destructive" }),
    });

  const subTabs: { key: SubTab; label: string }[] = [
    { key: "pnl", label: "Profit & Loss" },
    { key: "balance", label: "Balance Sheet" },
    { key: "cash", label: "Cash Flow" },
    { key: "journal", label: "Journal" },
    { key: "accounts", label: "Accounts" },
    { key: "tax", label: "Taxes" },
    { key: "bank", label: "Bank Match" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1 bg-black/[0.04] rounded-lg p-1">
          {subTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setSub(t.key)}
              className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-colors ${
                sub === t.key ? "bg-white shadow-sm" : "text-muted-foreground"
              }`}
              data-testid={`books-subtab-${t.key}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {(sub === "pnl" || sub === "cash") && (
            <>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-[150px] h-9"
              />
              <span className="text-muted-foreground text-sm">to</span>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-[150px] h-9"
              />
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={doRebuild}
            disabled={rebuild.isPending}
            data-testid="button-rebuild-books"
          >
            <RefreshCw className={`w-4 h-4 mr-1.5 ${rebuild.isPending ? "animate-spin" : ""}`} />
            Rebuild
          </Button>
          <Button size="sm" onClick={() => setEntryOpen(true)} data-testid="button-new-entry">
            <Plus className="w-4 h-4 mr-1.5" />
            Journal entry
          </Button>
        </div>
      </div>

      {sub === "pnl" && (
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardContent className="pt-5">
              <h3 className="font-display font-bold mb-2">Income</h3>
              <ReportRows
                rows={pnl?.income ?? []}
                totalLabel="Total income"
                total={pnl?.totalIncome ?? 0}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <h3 className="font-display font-bold mb-2">Expenses</h3>
              <ReportRows
                rows={pnl?.expenses ?? []}
                totalLabel="Total expenses"
                total={pnl?.totalExpenses ?? 0}
              />
            </CardContent>
          </Card>
          <Card className="col-span-2">
            <CardContent className="pt-5 flex items-center justify-between">
              <span className="font-display font-bold">Net profit</span>
              <span
                className={`font-display font-bold text-xl tabular-nums ${
                  (pnl?.netProfit ?? 0) >= 0 ? "text-emerald-600" : "text-destructive"
                }`}
                data-testid="text-net-profit"
              >
                {money(pnl?.netProfit ?? 0)}
              </span>
            </CardContent>
          </Card>
        </div>
      )}

      {sub === "balance" && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-5">
              <h3 className="font-display font-bold mb-2">Assets</h3>
              <ReportRows
                rows={bs?.assets ?? []}
                totalLabel="Total assets"
                total={bs?.totalAssets ?? 0}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <h3 className="font-display font-bold mb-2">Liabilities</h3>
              <ReportRows
                rows={bs?.liabilities ?? []}
                totalLabel="Total liabilities"
                total={bs?.totalLiabilities ?? 0}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <h3 className="font-display font-bold mb-2">Equity</h3>
              <ReportRows
                rows={bs?.equity ?? []}
                totalLabel="Total equity"
                total={bs?.totalEquity ?? 0}
              />
            </CardContent>
          </Card>
        </div>
      )}

      {sub === "cash" && (
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardContent className="pt-5">
              <h3 className="font-display font-bold mb-2">Cash in</h3>
              <ReportRows
                rows={cf?.inflows ?? []}
                totalLabel="Total in"
                total={(cf?.inflows ?? []).reduce((s, r) => s + r.amount, 0)}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <h3 className="font-display font-bold mb-2">Cash out</h3>
              <ReportRows
                rows={cf?.outflows ?? []}
                totalLabel="Total out"
                total={(cf?.outflows ?? []).reduce((s, r) => s + r.amount, 0)}
              />
            </CardContent>
          </Card>
          <Card className="col-span-2">
            <CardContent className="pt-5 grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xs text-muted-foreground uppercase font-semibold">Opening cash</p>
                <p className="font-display font-bold text-lg tabular-nums">{money(cf?.openingCash ?? 0)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase font-semibold">Net change</p>
                <p
                  className={`font-display font-bold text-lg tabular-nums ${
                    (cf?.netChange ?? 0) >= 0 ? "text-emerald-600" : "text-destructive"
                  }`}
                >
                  {money(cf?.netChange ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase font-semibold">Closing cash</p>
                <p className="font-display font-bold text-lg tabular-nums">{money(cf?.closingCash ?? 0)}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {sub === "journal" && (
        <Card>
          <CardContent className="pt-5">
            {jLoading && <Skeleton className="h-24 w-full" />}
            {!jLoading && entries.length === 0 && (
              <p className="text-sm text-muted-foreground py-4">
                No journal entries yet — they appear automatically as you invoice and spend.
              </p>
            )}
            <div className="space-y-3">
              {entries.map((e) => (
                <div
                  key={e.id}
                  className="border border-border rounded-lg p-3"
                  data-testid={`journal-entry-${e.entryNo}`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm tabular-nums">{e.entryNo}</span>
                      <span className="text-xs text-muted-foreground">{fmtDate(e.entryDate)}</span>
                      <Badge className={`text-[10px] ${SOURCE_BADGE[e.source] ?? ""}`} variant="secondary">
                        {e.source}
                      </Badge>
                    </div>
                    {e.source !== "system" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground"
                        onClick={() =>
                          del.mutate(
                            { id: e.id },
                            {
                              onSuccess: () => {
                                invalidateAll();
                                toast({ title: `${e.entryNo} deleted` });
                              },
                            },
                          )
                        }
                        data-testid={`button-delete-${e.entryNo}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                  {e.memo && <p className="text-sm text-muted-foreground mb-1.5">{e.memo}</p>}
                  <div className="text-xs space-y-0.5">
                    {e.lines.map((l) => (
                      <div key={l.id} className="flex justify-between tabular-nums">
                        <span className={l.debit > 0 ? "" : "pl-5 text-muted-foreground"}>
                          {l.accountCode} {l.accountName}
                        </span>
                        <span>
                          {l.debit > 0 ? `${money(l.debit)} DR` : `${money(l.credit)} CR`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {sub === "accounts" && (
        <Card>
          <CardContent className="pt-5">
            {acctLoading && <Skeleton className="h-24 w-full" />}
            {accounts.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between py-2.5 border-b border-border/60 last:border-0"
                data-testid={`account-row-${a.code}`}
              >
                <div>
                  <span className="text-sm font-semibold">
                    <span className="text-muted-foreground mr-2 tabular-nums">{a.code}</span>
                    {a.name}
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground capitalize">{a.type}</span>
                </div>
                <span className="text-sm font-bold tabular-nums">{money(a.balance)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {sub === "tax" && <TaxSection />}
      {sub === "bank" && <BankSection />}

      <JournalEntryDialog open={entryOpen} onOpenChange={setEntryOpen} accounts={accounts} />
    </div>
  );
}

function TaxSection() {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data: tax, isLoading } = useGetTaxReport({ year });
  const years = [0, 1, 2].map((i) => new Date().getFullYear() - i);

  const exportCsv = () => {
    if (!tax) return;
    const lines = [
      `HALO Tax Report,${tax.year}`,
      "",
      `Gross receipts,${tax.grossReceipts}`,
      `Sales tax collected,${tax.salesTaxCollected}`,
      `Sales tax still owed,${tax.salesTaxBalance}`,
      "",
      "Schedule C line,Category,Amount",
      ...tax.scheduleC.map((r) => `Line ${r.line},${r.label},${r.amount}`),
      "",
      `Total expenses,${tax.totalExpenses}`,
      `Net profit,${tax.netProfit}`,
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `halo-tax-report-${tax.year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-black/[0.04] rounded-lg p-1">
          {years.map((y) => (
            <button
              key={y}
              onClick={() => setYear(y)}
              className={`px-3 py-1.5 rounded-md text-sm font-semibold ${
                year === y ? "bg-white shadow-sm" : "text-muted-foreground"
              }`}
              data-testid={`tax-year-${y}`}
            >
              {y}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!tax} data-testid="button-tax-export">
          <Download className="w-4 h-4 mr-1.5" />
          Export CSV
        </Button>
      </div>
      {isLoading && <Skeleton className="h-40 w-full" />}
      {tax && (
        <>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Gross receipts", value: tax.grossReceipts },
              { label: "Sales tax collected", value: tax.salesTaxCollected },
              { label: "Sales tax still owed", value: tax.salesTaxBalance },
            ].map((c) => (
              <Card key={c.label}>
                <CardContent className="pt-5">
                  <p className="text-xs text-muted-foreground uppercase font-semibold">{c.label}</p>
                  <p className="font-display font-bold text-2xl tabular-nums" data-testid={`tax-${c.label.replaceAll(" ", "-").toLowerCase()}`}>
                    {money(c.value)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardContent className="pt-5">
              <h3 className="font-display font-bold mb-2">Schedule C deductions</h3>
              {tax.scheduleC.length === 0 && (
                <p className="text-sm text-muted-foreground py-2">No deductible expenses recorded for {tax.year}.</p>
              )}
              {tax.scheduleC.map((r) => (
                <div key={r.line + r.label} className="flex items-center justify-between py-2 border-b border-border/60 last:border-0">
                  <span className="text-sm">
                    <span className="text-muted-foreground mr-2">Line {r.line}</span>
                    {r.label}
                  </span>
                  <span className="text-sm font-semibold tabular-nums">{money(r.amount)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-3 mt-1 border-t border-border">
                <span className="text-sm font-bold">Total expenses</span>
                <span className="text-sm font-bold tabular-nums">{money(tax.totalExpenses)}</span>
              </div>
              <div className="flex items-center justify-between pt-2">
                <span className="text-sm font-bold">Net profit (Schedule C line 31)</span>
                <span className={`text-sm font-bold tabular-nums ${tax.netProfit >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                  {money(tax.netProfit)}
                </span>
              </div>
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">
            Set your sales tax rate in Settings to split tax out of new invoices automatically.
          </p>
        </>
      )}
    </div>
  );
}

const BANK_STATUS_BADGE: Record<string, string> = {
  matched: "bg-emerald-500/10 text-emerald-600",
  unmatched: "bg-amber-500/15 text-amber-700",
  imported: "bg-black/[0.05] text-muted-foreground",
};

function BankSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [days, setDays] = useState(30);
  const { data: rec, isLoading, error } = useGetBankReconciliation({ days });
  const importTxn = useImportBankTransaction();

  const doImport = (t: BankTxnMatch) =>
    importTxn.mutate(
      {
        data: {
          transactionId: t.transactionId,
          date: t.date,
          name: t.name,
          amount: t.amount,
          direction: t.direction as "in" | "out",
          category: t.category ?? undefined,
        },
      },
      {
        onSuccess: (r) => {
          queryClient.invalidateQueries({ queryKey: getGetBankReconciliationQueryKey() });
          queryClient.invalidateQueries({ queryKey: ["/accounting"] });
          queryClient.invalidateQueries({ queryKey: getListLedgerAccountsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListJournalEntriesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetProfitAndLossQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetCashFlowReportQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetBalanceSheetReportQueryKey() });
          queryClient.invalidateQueries({ queryKey: ["/expenses"] });
          toast({ title: r.message ?? "Imported" });
        },
        onError: () => toast({ title: "Couldn't import that transaction", variant: "destructive" }),
      },
    );

  if (error) {
    return (
      <Card>
        <CardContent className="pt-8 pb-8 text-center">
          <Landmark className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
          <p className="font-semibold mb-1">No bank connected</p>
          <p className="text-sm text-muted-foreground">
            Connect your bank in the Money tab to match bank activity against your books.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-black/[0.04] rounded-lg p-1">
          {[14, 30, 60, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 rounded-md text-sm font-semibold ${
                days === d ? "bg-white shadow-sm" : "text-muted-foreground"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
        {rec && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-emerald-600 font-semibold">{rec.matchedCount} matched</span>
            <span className="text-amber-700 font-semibold">{rec.unmatchedCount} unmatched</span>
            <span className="text-muted-foreground">Ledger cash {money(rec.ledgerCash)}</span>
          </div>
        )}
      </div>
      {isLoading && <Skeleton className="h-40 w-full" />}
      {rec?.truncated && (
        <p className="text-xs text-amber-700">
          Showing the most recent transactions only — older activity in this window was cut off.
        </p>
      )}
      {rec && rec.transactions.length === 0 && (
        <p className="text-sm text-muted-foreground py-4">No bank transactions in this window.</p>
      )}
      {rec && rec.transactions.length > 0 && (
        <Card>
          <CardContent className="pt-5">
            {rec.transactions.map((t) => (
              <div
                key={t.transactionId}
                className="flex items-center justify-between gap-3 py-2.5 border-b border-border/60 last:border-0"
                data-testid={`bank-txn-${t.transactionId}`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{t.merchantName || t.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmtDate(t.date)}
                    {t.category ? ` · ${t.category.toLowerCase()}` : ""}
                    {t.status === "matched" && t.matchedEntryNo ? ` · matches ${t.matchedEntryNo}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-sm font-bold tabular-nums ${t.direction === "in" ? "text-emerald-600" : ""}`}>
                    {t.direction === "in" ? "+" : "−"}{money(t.amount)}
                  </span>
                  <Badge className={`text-[10px] ${BANK_STATUS_BADGE[t.status] ?? ""}`} variant="secondary">
                    {t.status}
                  </Badge>
                  {t.status === "unmatched" && !t.pending && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7"
                      disabled={importTxn.isPending}
                      onClick={() => doImport(t)}
                      data-testid={`button-import-${t.transactionId}`}
                    >
                      Add to books
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
