import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListLedgerAccounts,
  useGetTaxPlanner,
  useRunTaxPlannerEstimate,
  useCompareTaxPlannerEntities,
  useSaveTaxPlannerSettings,
  type TaxEstimate,
  type TaxEntityComparison,
  useListJournalEntries,
  useCreateJournalEntry,
  useGetProfitAndLoss,
  useGetBalanceSheetReport,
  useGetCashFlowReport,
  getListLedgerAccountsQueryKey,
  getListJournalEntriesQueryKey,
  getGetProfitAndLossQueryKey,
  getGetBalanceSheetReportQueryKey,
  getGetCashFlowReportQueryKey,
  useGetTaxReport,
  type LedgerAccount,
  type JournalEntryFull,
} from "@workspace/api-client-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const fmtDate = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
};

function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-[14px] shadow-[var(--shadow)] p-[14px] mb-[12px]">
      <div className="text-[11px] font-display font-bold uppercase tracking-wide text-muted-foreground mb-[8px]">
        {title}
      </div>
      {children}
    </div>
  );
}

function Rows({
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
        <div className="text-[12.5px] text-muted-foreground py-[4px]">Nothing yet.</div>
      )}
      {rows.map((r) => (
        <div key={r.code} className="flex justify-between py-[5px] text-[13px]">
          <span>{r.name}</span>
          <span className="font-display font-semibold tabular-nums">{money(r.amount)}</span>
        </div>
      ))}
      <div className="flex justify-between pt-[7px] mt-[3px] border-t border-border text-[13px] font-display font-bold">
        <span>{totalLabel}</span>
        <span className="tabular-nums">{money(total)}</span>
      </div>
    </div>
  );
}

const SOURCE_COLOR: Record<string, string> = {
  system: "bg-black/[0.05] text-muted-foreground",
  manual: "bg-amber-500/15 text-amber-700",
  voice: "bg-blue-500/10 text-blue-600",
};

function NewEntrySheet({
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
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [debitCode, setDebitCode] = useState("");
  const [creditCode, setCreditCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const inputCls =
    "w-full rounded-[11px] border border-border bg-background px-[12px] py-[10px] text-[14px]";

  const submit = () => {
    setError(null);
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return setError("Enter a valid amount.");
    if (!debitCode || !creditCode || debitCode === creditCode)
      return setError("Pick two different accounts.");
    create.mutate(
      {
        data: {
          entryDate: localToday(),
          memo: memo.trim() || null,
          lines: [
            { accountCode: debitCode, debit: amt },
            { accountCode: creditCode, credit: amt },
          ],
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListLedgerAccountsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListJournalEntriesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetProfitAndLossQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetBalanceSheetReportQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetCashFlowReportQueryKey() });
          onOpenChange(false);
          setAmount("");
          setMemo("");
          toast({ title: "Journal entry posted" });
        },
        onError: (err: unknown) =>
          setError(
            (err as { data?: { error?: string } })?.data?.error || "Couldn't post the entry.",
          ),
      },
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-[20px]">
        <SheetHeader>
          <SheetTitle>New journal entry</SheetTitle>
        </SheetHeader>
        <div className="space-y-[10px] mt-[10px] pb-[8px]">
          <input
            className={inputCls}
            type="number"
            inputMode="decimal"
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            data-testid="input-je-amount"
          />
          <select
            className={inputCls}
            value={debitCode}
            onChange={(e) => setDebitCode(e.target.value)}
            data-testid="select-je-debit"
          >
            <option value="">Debit — money goes to…</option>
            {accounts.map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
          <select
            className={inputCls}
            value={creditCode}
            onChange={(e) => setCreditCode(e.target.value)}
            data-testid="select-je-credit"
          >
            <option value="">Credit — money comes from…</option>
            {accounts.map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
          <input
            className={inputCls}
            placeholder="Memo (optional)"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
          {error && <div className="text-[12.5px] text-destructive">{error}</div>}
          <button
            className="w-full rounded-[12px] bg-[var(--ink)] text-white py-[12px] text-[14px] font-display font-bold disabled:opacity-50"
            onClick={submit}
            disabled={create.isPending}
            data-testid="button-je-post"
          >
            {create.isPending ? "Posting…" : "Post entry"}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function BooksTab() {
  const [view, setView] = useState<"pnl" | "balance" | "cash" | "journal" | "tax" | "plan">("pnl");
  const [entryOpen, setEntryOpen] = useState(false);
  const from = `${new Date().getFullYear()}-01-01`;
  const to = localToday();

  const { data: acctData } = useListLedgerAccounts();
  const { data: journalData } = useListJournalEntries({ limit: 50 });
  const { data: pnl } = useGetProfitAndLoss({ from, to });
  const { data: bs } = useGetBalanceSheetReport({ asOf: to });
  const { data: cf } = useGetCashFlowReport({ from, to });

  const accounts = useMemo(() => acctData?.accounts ?? [], [acctData]);
  const entries: JournalEntryFull[] = journalData?.entries ?? [];

  const views = [
    { key: "pnl", label: "P&L" },
    { key: "balance", label: "Balance" },
    { key: "cash", label: "Cash" },
    { key: "journal", label: "Journal" },
    { key: "tax", label: "Tax" },
    { key: "plan", label: "Plan" },
  ] as const;

  return (
    <div>
      <div className="flex gap-[6px] mb-[12px]">
        {views.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`flex-1 rounded-[10px] py-[7px] text-[12px] font-display font-bold border ${
              view === v.key
                ? "bg-[var(--ink)] text-white border-transparent"
                : "bg-card border-border text-muted-foreground"
            }`}
            data-testid={`books-view-${v.key}`}
          >
            {v.label}
          </button>
        ))}
        <button
          onClick={() => setEntryOpen(true)}
          className="rounded-[10px] px-[11px] bg-card border border-border"
          data-testid="button-new-entry"
        >
          <Plus className="w-[16px] h-[16px]" />
        </button>
      </div>

      {view === "pnl" && (
        <>
          <Section title="Income (this year)">
            <Rows rows={pnl?.income ?? []} totalLabel="Total income" total={pnl?.totalIncome ?? 0} />
          </Section>
          <Section title="Expenses">
            <Rows
              rows={pnl?.expenses ?? []}
              totalLabel="Total expenses"
              total={pnl?.totalExpenses ?? 0}
            />
          </Section>
          <div className="bg-card rounded-[14px] shadow-[var(--shadow)] p-[14px] flex justify-between items-center">
            <span className="font-display font-bold text-[14px]">Net profit</span>
            <span
              className={`font-display font-bold text-[20px] tabular-nums ${
                (pnl?.netProfit ?? 0) >= 0 ? "text-emerald-600" : "text-destructive"
              }`}
              data-testid="text-net-profit"
            >
              {money(pnl?.netProfit ?? 0)}
            </span>
          </div>
        </>
      )}

      {view === "balance" && (
        <>
          <Section title="Assets">
            <Rows rows={bs?.assets ?? []} totalLabel="Total assets" total={bs?.totalAssets ?? 0} />
          </Section>
          <Section title="Liabilities">
            <Rows
              rows={bs?.liabilities ?? []}
              totalLabel="Total liabilities"
              total={bs?.totalLiabilities ?? 0}
            />
          </Section>
          <Section title="Equity">
            <Rows rows={bs?.equity ?? []} totalLabel="Total equity" total={bs?.totalEquity ?? 0} />
          </Section>
        </>
      )}

      {view === "cash" && (
        <>
          <Section title="Cash in (this year)">
            <Rows
              rows={cf?.inflows ?? []}
              totalLabel="Total in"
              total={(cf?.inflows ?? []).reduce((s, r) => s + r.amount, 0)}
            />
          </Section>
          <Section title="Cash out">
            <Rows
              rows={cf?.outflows ?? []}
              totalLabel="Total out"
              total={(cf?.outflows ?? []).reduce((s, r) => s + r.amount, 0)}
            />
          </Section>
          <div className="bg-card rounded-[14px] shadow-[var(--shadow)] p-[14px] grid grid-cols-3 text-center">
            {[
              { label: "Opening", value: cf?.openingCash ?? 0 },
              { label: "Change", value: cf?.netChange ?? 0 },
              { label: "Closing", value: cf?.closingCash ?? 0 },
            ].map((c) => (
              <div key={c.label}>
                <div className="text-[10.5px] uppercase font-bold text-muted-foreground">{c.label}</div>
                <div className="font-display font-bold text-[15px] tabular-nums">{money(c.value)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {view === "journal" && (
        <div className="space-y-[10px]">
          {entries.length === 0 && (
            <div className="text-[13px] text-muted-foreground py-[8px]">
              No journal entries yet — they appear automatically as you invoice and spend.
            </div>
          )}
          {entries.map((e) => (
            <div
              key={e.id}
              className="bg-card rounded-[14px] shadow-[var(--shadow)] p-[12px]"
              data-testid={`journal-entry-${e.entryNo}`}
            >
              <div className="flex items-center gap-[8px] mb-[4px]">
                <span className="font-display font-bold text-[13px] tabular-nums">{e.entryNo}</span>
                <span className="text-[11.5px] text-muted-foreground">{fmtDate(e.entryDate)}</span>
                <span
                  className={`text-[10px] font-bold px-[7px] py-[2px] rounded-full ${
                    SOURCE_COLOR[e.source] ?? ""
                  }`}
                >
                  {e.source}
                </span>
              </div>
              {e.memo && <div className="text-[12.5px] text-muted-foreground mb-[4px]">{e.memo}</div>}
              <div className="text-[11.5px] space-y-[2px]">
                {e.lines.map((l) => (
                  <div key={l.id} className="flex justify-between tabular-nums">
                    <span className={l.debit > 0 ? "" : "pl-[16px] text-muted-foreground"}>
                      {l.accountName}
                    </span>
                    <span>{l.debit > 0 ? `${money(l.debit)} DR` : `${money(l.credit)} CR`}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === "tax" && <TaxView />}
      {view === "plan" && <PlannerView />}

      <NewEntrySheet open={entryOpen} onOpenChange={setEntryOpen} accounts={accounts} />
    </div>
  );
}


const ENTITY_LABELS: Record<string, string> = {
  sole_proprietor: "Sole proprietor",
  single_member_llc: "Single-member LLC",
  partnership: "Partnership",
  s_corp: "S-corporation",
  c_corp: "C-corporation",
};

function PlannerView() {
  const { data: planner } = useGetTaxPlanner();
  const save = useSaveTaxPlannerSettings();
  const runEstimate = useRunTaxPlannerEstimate();
  const runCompare = useCompareTaxPlannerEntities();
  const [revenue, setRevenue] = useState("");
  const [expenses, setExpenses] = useState("");
  const [entityType, setEntityType] = useState<string | null>(null);
  const [filingStatus, setFilingStatus] = useState<string | null>(null);
  const [est, setEst] = useState<TaxEstimate | null>(null);
  const [cmp, setCmp] = useState<TaxEntityComparison | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!planner) return <div className="animate-pulse h-32 bg-card rounded-[14px]" />;
  const s = planner.settings;
  const pf = planner.prefill;
  const et = entityType ?? s.entityType;
  const fs = filingStatus ?? s.filingStatus;
  const ready = revenue !== "" && expenses !== "";
  const busy = save.isPending || runEstimate.isPending || runCompare.isPending;

  const run = async () => {
    setErr(null);
    try {
      const settings = { ...s, entityType: et as typeof s.entityType, filingStatus: fs as typeof s.filingStatus };
      await save.mutateAsync({ data: settings });
      const payload = { grossRevenue: Number(revenue) || 0, ordinaryExpenses: Number(expenses) || 0, settings };
      const [e, c] = await Promise.all([
        runEstimate.mutateAsync({ data: payload }),
        runCompare.mutateAsync({ data: payload }),
      ]);
      setEst(e);
      setCmp(c);
    } catch {
      setErr("Could not run the estimate. Try again.");
    }
  };

  const inputCls =
    "w-full rounded-[10px] border border-border bg-card px-[10px] py-[8px] text-[14px]";

  return (
    <>
      <Section title={`From your books — ${pf.year}`}>
        <div className="text-[12.5px] mb-[8px]">
          So far: <b>{money(pf.ytdRevenue)}</b> revenue, <b>{money(pf.ytdExpenses)}</b> expenses.
          Full-year pace: <b>{money(pf.annualizedRevenue)}</b> / <b>{money(pf.annualizedExpenses)}</b>.
        </div>
        <div className="flex gap-[8px]">
          <button
            className="flex-1 rounded-[10px] py-[8px] text-[12px] font-display font-bold bg-card border border-border"
            onClick={() => { setRevenue(String(pf.ytdRevenue)); setExpenses(String(pf.ytdExpenses)); }}
            data-testid="button-plan-ytd"
          >
            Use year-to-date
          </button>
          <button
            className="flex-1 rounded-[10px] py-[8px] text-[12px] font-display font-bold bg-[var(--ink)] text-white"
            onClick={() => { setRevenue(String(pf.annualizedRevenue)); setExpenses(String(pf.annualizedExpenses)); }}
            data-testid="button-plan-pace"
          >
            Use full-year pace
          </button>
        </div>
      </Section>
      <Section title="Your numbers">
        <div className="grid grid-cols-2 gap-[8px] mb-[8px]">
          <div>
            <div className="text-[11px] text-muted-foreground mb-[3px]">Revenue (year)</div>
            <input type="number" inputMode="decimal" className={inputCls} value={revenue}
              onChange={(e) => setRevenue(e.target.value)} placeholder="0" data-testid="input-plan-revenue" />
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground mb-[3px]">Expenses (year)</div>
            <input type="number" inputMode="decimal" className={inputCls} value={expenses}
              onChange={(e) => setExpenses(e.target.value)} placeholder="0" data-testid="input-plan-expenses" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-[8px] mb-[10px]">
          <div>
            <div className="text-[11px] text-muted-foreground mb-[3px]">Entity type</div>
            <select className={inputCls} value={et} onChange={(e) => setEntityType(e.target.value)} data-testid="select-plan-entity">
              {Object.entries(ENTITY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground mb-[3px]">Filing status</div>
            <select className={inputCls} value={fs} onChange={(e) => setFilingStatus(e.target.value)} data-testid="select-plan-filing">
              <option value="single">Single</option>
              <option value="married_joint">Married joint</option>
              <option value="married_separate">Married separate</option>
              <option value="head_household">Head of household</option>
            </select>
          </div>
        </div>
        <button
          className="w-full rounded-[10px] py-[10px] text-[13px] font-display font-bold bg-[var(--ink)] text-white disabled:opacity-50"
          disabled={!ready || busy}
          onClick={run}
          data-testid="button-plan-run"
        >
          {busy ? "Calculating…" : "Calculate my taxes"}
        </button>
        {err && <div className="text-[12px] text-destructive mt-[6px]">{err}</div>}
        <div className="text-[11px] text-muted-foreground mt-[6px]">
          More detail (wages, deductions, credits) is on the desktop Tax Planner.
        </div>
      </Section>
      {est && (
        <Section title="Projection">
          {[
            { label: "Projected total tax", value: est.totalProjectedTax },
            { label: "Balance still due", value: est.projectedBalanceDue },
            { label: "Set aside (with buffer)", value: est.reserveRecommendation },
          ].map((r) => (
            <div key={r.label} className="flex justify-between py-[5px] text-[13px]">
              <span>{r.label}</span>
              <span className="font-display font-bold tabular-nums" data-testid={`plan-${r.label.replaceAll(" ", "-").toLowerCase()}`}>{money(r.value)}</span>
            </div>
          ))}
          <div className="mt-[6px] pt-[6px] border-t border-border">
            {est.quarterlyPayments.map((q) => (
              <div key={q.label} className="flex justify-between py-[4px] text-[12.5px]">
                <span className="text-muted-foreground">{q.label} — due {q.dueDate}</span>
                <span className="font-display font-semibold tabular-nums">{money(q.suggestedPayment)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
      {cmp && (
        <Section title="Entity comparison">
          {cmp.scenarios.map((sc) => {
            const best = sc.entityType === cmp.lowestProjectedTaxEntity;
            return (
              <div key={sc.entityType} className="flex justify-between py-[5px] text-[13px]">
                <span>
                  {ENTITY_LABELS[sc.entityType]}
                  {best && <span className="ml-[6px] text-[10px] font-display font-bold text-emerald-600 uppercase">Best</span>}
                </span>
                <span className={`font-display font-semibold tabular-nums ${best ? "text-emerald-600" : ""}`}>
                  {money(sc.totalProjectedTax)}
                </span>
              </div>
            );
          })}
          <div className="text-[11px] text-muted-foreground mt-[6px]">
            Potential savings: {money(cmp.spread)}. {cmp.warning}
          </div>
        </Section>
      )}
      {est && (
        <div className="text-[11px] text-muted-foreground px-[2px] mb-[10px]">{est.disclaimer}</div>
      )}
    </>
  );
}

function TaxView() {
  const year = new Date().getFullYear();
  const { data: tax } = useGetTaxReport({ year });

  if (!tax) return <div className="animate-pulse h-32 bg-card rounded-[14px]" />;

  return (
    <>
      <Section title={`Tax summary — ${tax.year}`}>
        {[
          { label: "Gross receipts", value: tax.grossReceipts },
          { label: "Sales tax collected", value: tax.salesTaxCollected },
          { label: "Sales tax still owed", value: tax.salesTaxBalance },
        ].map((r) => (
          <div key={r.label} className="flex justify-between py-[5px] text-[13px]">
            <span>{r.label}</span>
            <span className="font-display font-semibold tabular-nums">{money(r.value)}</span>
          </div>
        ))}
      </Section>
      <Section title="Schedule C deductions">
        {tax.scheduleC.length === 0 && (
          <div className="text-[12.5px] text-muted-foreground py-[4px]">No deductible expenses yet.</div>
        )}
        {tax.scheduleC.map((r) => (
          <div key={r.line + r.label} className="flex justify-between py-[5px] text-[13px]">
            <span>
              <span className="text-muted-foreground mr-[6px]">Line {r.line}</span>
              {r.label}
            </span>
            <span className="font-display font-semibold tabular-nums">{money(r.amount)}</span>
          </div>
        ))}
        <div className="flex justify-between pt-[7px] mt-[3px] border-t border-border text-[13px] font-display font-bold">
          <span>Net profit</span>
          <span className={`tabular-nums ${tax.netProfit >= 0 ? "text-emerald-600" : "text-destructive"}`}>
            {money(tax.netProfit)}
          </span>
        </div>
      </Section>
      <div className="text-[11.5px] text-muted-foreground px-[2px]">
        Full report with CSV export is on the desktop app under Books → Taxes.
      </div>
    </>
  );
}
