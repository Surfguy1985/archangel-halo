import { useEffect, useMemo, useState} from "react";
import { useQueryClient} from "@tanstack/react-query";
import {
  useGetTaxPlanner,
  useSaveTaxPlannerSettings,
  useRunTaxPlannerEstimate,
  useCompareTaxPlannerEntities,
  getGetTaxPlannerQueryKey,
  type TaxPlannerSettingsData,
  type TaxEstimate,
  type TaxEntityComparison,
} from "@workspace/api-client-react";
import { Card, CardContent} from "@/components/ui/card";
import { Button} from "@/components/ui/button";
import { Badge} from "@/components/ui/badge";
import { Skeleton} from "@/components/ui/skeleton";
import { Input} from "@/components/ui/input";
import { Label} from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calculator, Scale, Sparkles, AlertTriangle} from "lucide-react";
import { useToast} from "@/hooks/use-toast";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD"});

const ENTITY_LABELS: Record<string, string> = {
  sole_proprietor: "Sole proprietor",
  single_member_llc: "Single-member LLC",
  partnership: "Partnership",
  s_corp: "S-corporation",
  c_corp: "C-corporation",
};

const FILING_LABELS: Record<string, string> = {
  single: "Single",
  married_joint: "Married filing jointly",
  married_separate: "Married filing separately",
  head_household: "Head of household",
};

type NumField = {
  key: keyof TaxPlannerSettingsData;
  label: string;
  hint?: string;
};

const NUM_FIELDS: NumField[] = [
  { key: "ownerW2Wages", label: "Your W-2 salary from the business", hint: "S-corp / C-corp owner salary"},
  { key: "otherW2Wages", label: "Other W-2 wages (outside job)"},
  { key: "otherTaxableIncome", label: "Other taxable income"},
  { key: "aboveLineAdjustments", label: "Above-the-line adjustments"},
  { key: "itemizedDeductions", label: "Itemized deductions", hint: "Standard deduction used if larger"},
  { key: "qbiDeduction", label: "QBI deduction (CPA-reviewed)"},
  { key: "taxCredits", label: "Tax credits"},
  { key: "federalWithholding", label: "Federal withholding so far"},
  { key: "estimatedPaymentsMade", label: "Estimated payments already made"},
  { key: "stateEffectiveRatePct", label: "State effective rate %", hint: "Texas: 0"},
  { key: "reserveBufferRatePct", label: "Safety buffer % on reserve"},
];

export function TaxPlannerSection() {
  const { toast} = useToast();
  const qc = useQueryClient();
  const { data: planner, isLoading} = useGetTaxPlanner();
  const save = useSaveTaxPlannerSettings();
  const runEstimate = useRunTaxPlannerEstimate();
  const runCompare = useCompareTaxPlannerEntities();

  const [form, setForm] = useState<TaxPlannerSettingsData | null>(null);
  const [grossRevenue, setGrossRevenue] = useState("");
  const [ordinaryExpenses, setOrdinaryExpenses] = useState("");
  const [estimate, setEstimate] = useState<TaxEstimate | null>(null);
  const [comparison, setComparison] = useState<TaxEntityComparison | null>(null);

  useEffect(() => {
    if (planner && !form) setForm(planner.settings);
 }, [planner, form]);

  const prefill = planner?.prefill;

  const usePrefill = (kind: "ytd" | "annualized") => {
    if (!prefill) return;
    if (kind === "ytd") {
      setGrossRevenue(String(prefill.ytdRevenue));
      setOrdinaryExpenses(String(prefill.ytdExpenses));
   } else {
      setGrossRevenue(String(prefill.annualizedRevenue));
      setOrdinaryExpenses(String(prefill.annualizedExpenses));
   }
 };

  const numbersReady = grossRevenue !== "" && ordinaryExpenses !== "";

  const runBoth = async () => {
    if (!form || !numbersReady) return;
    try {
      await save.mutateAsync({ data: form});
      qc.invalidateQueries({ queryKey: getGetTaxPlannerQueryKey()});
      const payload = {
        grossRevenue: Number(grossRevenue) || 0,
        ordinaryExpenses: Number(ordinaryExpenses) || 0,
        settings: form,
     };
      const [est, cmp] = await Promise.all([
        runEstimate.mutateAsync({ data: payload}),
        runCompare.mutateAsync({ data: payload}),
      ]);
      setEstimate(est);
      setComparison(cmp);
   } catch {
      toast({ title: "Could not run the estimate", variant: "destructive"});
   }
 };

  const running = save.isPending || runEstimate.isPending || runCompare.isPending;

  const setNum = (key: keyof TaxPlannerSettingsData, v: string) =>
    setForm((f) => (f ? { ...f, [key]: v === "" ? 0 : Number(v)} : f));

  const bestLabel = useMemo(
    () => (comparison ? ENTITY_LABELS[comparison.lowestProjectedTaxEntity] : ""),
    [comparison],
  );

  if (isLoading || !form) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      {prefill && (
        <Card className="border-primary/30 bg-primary/[0.03]">
          <CardContent className="pt-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="text-xs text-muted-foreground font-semibold flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" /> From your Books — {prefill.year}
                </p>
                <p className="text-sm mt-1">
                  So far this year: <b>{money(prefill.ytdRevenue)}</b> revenue,{" "}
                  <b>{money(prefill.ytdExpenses)}</b> expenses. At this pace the full year looks
                  like <b>{money(prefill.annualizedRevenue)}</b> revenue and{" "}
                  <b>{money(prefill.annualizedExpenses)}</b> expenses.
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => usePrefill("ytd")} data-testid="button-prefill-ytd">
                  Use year-to-date
                </Button>
                <Button size="sm" onClick={() => usePrefill("annualized")} data-testid="button-prefill-annualized">
                  Use full-year pace
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-5 space-y-3">
            <h3 className="font-display font-bold">Business numbers</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="tp-revenue">Gross revenue (full year)</Label>
                <Input
                  id="tp-revenue"
                  type="number"
                  min="0"
                  value={grossRevenue}
                  onChange={(e) => setGrossRevenue(e.target.value)}
                  placeholder="0"
                  data-testid="input-planner-revenue"
                />
              </div>
              <div>
                <Label htmlFor="tp-expenses">Business expenses (full year)</Label>
                <Input
                  id="tp-expenses"
                  type="number"
                  min="0"
                  value={ordinaryExpenses}
                  onChange={(e) => setOrdinaryExpenses(e.target.value)}
                  placeholder="0"
                  data-testid="input-planner-expenses"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Business entity type</Label>
                <Select
                  value={form.entityType}
                  onValueChange={(v) => setForm({ ...form, entityType: v as TaxPlannerSettingsData["entityType"]})}
                >
                  <SelectTrigger data-testid="select-planner-entity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ENTITY_LABELS).map(([k, label]) => (
                      <SelectItem key={k} value={k}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Filing status</Label>
                <Select
                  value={form.filingStatus}
                  onValueChange={(v) => setForm({ ...form, filingStatus: v as TaxPlannerSettingsData["filingStatus"]})}
                >
                  <SelectTrigger data-testid="select-planner-filing">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(FILING_LABELS).map(([k, label]) => (
                      <SelectItem key={k} value={k}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 space-y-3">
            <h3 className="font-display font-bold">Personal details</h3>
            <div className="grid grid-cols-2 gap-3 max-h-64 overflow-y-auto pr-1">
              {NUM_FIELDS.map((f) => (
                <div key={f.key}>
                  <Label htmlFor={`tp-${f.key}`} className="text-xs">{f.label}</Label>
                  <Input
                    id={`tp-${f.key}`}
                    type="number"
                    min="0"
                    value={String(form[f.key] ?? 0)}
                    onChange={(e) => setNum(f.key, e.target.value)}
                    data-testid={`input-planner-${f.key}`}
                  />
                  {f.hint && <p className="text-[11px] text-muted-foreground mt-0.5">{f.hint}</p>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Button onClick={runBoth} disabled={!numbersReady || running} data-testid="button-planner-run">
        <Calculator className="w-4 h-4 mr-1.5" />
        {running ? "Calculating…" : "Calculate my taxes"}
      </Button>
      {!numbersReady && (
        <p className="text-xs text-muted-foreground">
          Enter revenue and expenses (or use the buttons above to pull them from your Books).
        </p>
      )}

      {estimate && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "Projected total tax", value: estimate.totalProjectedTax},
              { label: "Balance still due", value: estimate.projectedBalanceDue},
              { label: "Set aside (with buffer)", value: estimate.reserveRecommendation},
              { label: "Taxable income", value: estimate.taxableIncomeEstimate},
            ].map((c) => (
              <Card key={c.label}>
                <CardContent className="pt-5">
                  <p className="text-xs text-muted-foreground font-semibold">{c.label}</p>
                  <p className="font-display font-bold text-2xl tabular-nums" data-testid={`planner-${c.label.replaceAll(" ", "-").toLowerCase()}`}>
                    {money(c.value)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardContent className="pt-5">
                <h3 className="font-display font-bold mb-2">Where the tax comes from</h3>
                {estimate.components.map((c) => (
                  <div key={c.key} className="flex items-center justify-between py-2 border-b border-border/60 last:border-0">
                    <div>
                      <span className="text-sm">{c.label}</span>
                      {c.note && <p className="text-[11px] text-muted-foreground">{c.note}</p>}
                    </div>
                    <span className="text-sm font-semibold tabular-nums">{money(c.amount)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2 mt-1">
                  <span className="text-sm font-bold">Total projected tax</span>
                  <span className="text-sm font-bold tabular-nums">{money(estimate.totalProjectedTax)}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-5">
                <h3 className="font-display font-bold mb-2">Quarterly payment plan</h3>
                {estimate.quarterlyPayments.map((q) => (
                  <div key={q.label} className="flex items-center justify-between py-2 border-b border-border/60 last:border-0">
                    <span className="text-sm">{q.label} — due {q.dueDate}</span>
                    <span className="text-sm font-semibold tabular-nums">{money(q.suggestedPayment)}</span>
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground mt-2">
                  Effective rate on business profit:{" "}
                  {(estimate.effectiveRateOnBusinessProfit * 100).toFixed(1)}%
                </p>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {comparison && (
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <h3 className="font-display font-bold flex items-center gap-1.5">
                <Scale className="w-4 h-4" /> Entity comparison
              </h3>
              <Badge data-testid="badge-best-entity">
                Lowest tax: {bestLabel} — saves up to {money(comparison.spread)}
              </Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3">Entity</th>
                    <th className="py-2 pr-3 text-right">Total tax</th>
                    <th className="py-2 pr-3 text-right">Balance due</th>
                    <th className="py-2 pr-3 text-right">Effective rate</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.scenarios.map((s) => {
                    const best = s.entityType === comparison.lowestProjectedTaxEntity;
                    return (
                      <tr key={s.entityType} className={`border-t border-border/60 ${best ? "bg-primary/[0.05]" : ""}`}>
                        <td className="py-2 pr-3 font-medium">
                          {ENTITY_LABELS[s.entityType]} {best && <Badge className="ml-1.5">Best</Badge>}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums" data-testid={`compare-${s.entityType}`}>
                          {money(s.totalProjectedTax)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{money(s.projectedBalanceDue)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {(s.effectiveRateOnBusinessProfit * 100).toFixed(1)}%
                        </td>
                      </tr>
                    );
                 })}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">{comparison.warning}</p>
          </CardContent>
        </Card>
      )}

      {estimate && (
        <Card className="border-amber-300/60 bg-amber-50/50">
          <CardContent className="pt-5">
            <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> Planning estimate only
            </p>
            <ul className="mt-1.5 space-y-1">
              {[...estimate.assumptions, ...estimate.warnings].map((w) => (
                <li key={w} className="text-xs text-amber-900/90">• {w}</li>
              ))}
            </ul>
            <p className="text-[11px] text-amber-900/70 mt-2">{estimate.disclaimer}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
