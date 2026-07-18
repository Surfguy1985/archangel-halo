// 2026 U.S. federal tax PLANNING engine (ported from HALO Tax Platform).
// Estimates only — not a tax return engine. Rules isolated per year.

export type EntityType =
  | "sole_proprietor"
  | "single_member_llc"
  | "partnership"
  | "s_corp"
  | "c_corp";

export type FilingStatus =
  | "single"
  | "married_joint"
  | "married_separate"
  | "head_household";

export const ENTITY_TYPES: EntityType[] = [
  "sole_proprietor",
  "single_member_llc",
  "partnership",
  "s_corp",
  "c_corp",
];

interface Bracket {
  cap: number;
  rate: number;
}

export const RULES_2026 = {
  standardDeduction: {
    single: 16100,
    married_joint: 32200,
    married_separate: 16100,
    head_household: 24150,
  } as Record<FilingStatus, number>,
  brackets: {
    single: [
      { cap: 12400, rate: 0.1 },
      { cap: 50400, rate: 0.12 },
      { cap: 105700, rate: 0.22 },
      { cap: 201775, rate: 0.24 },
      { cap: 256225, rate: 0.32 },
      { cap: 640600, rate: 0.35 },
      { cap: Infinity, rate: 0.37 },
    ],
    married_joint: [
      { cap: 24800, rate: 0.1 },
      { cap: 100800, rate: 0.12 },
      { cap: 211400, rate: 0.22 },
      { cap: 403550, rate: 0.24 },
      { cap: 512450, rate: 0.32 },
      { cap: 768700, rate: 0.35 },
      { cap: Infinity, rate: 0.37 },
    ],
    married_separate: [
      { cap: 12400, rate: 0.1 },
      { cap: 50400, rate: 0.12 },
      { cap: 105700, rate: 0.22 },
      { cap: 201775, rate: 0.24 },
      { cap: 256225, rate: 0.32 },
      { cap: 384350, rate: 0.35 },
      { cap: Infinity, rate: 0.37 },
    ],
    head_household: [
      { cap: 17700, rate: 0.1 },
      { cap: 67450, rate: 0.12 },
      { cap: 105700, rate: 0.22 },
      { cap: 201750, rate: 0.24 },
      { cap: 256200, rate: 0.32 },
      { cap: 640600, rate: 0.35 },
      { cap: Infinity, rate: 0.37 },
    ],
  } as Record<FilingStatus, Bracket[]>,
  socialSecurityWageBase: 184500,
  socialSecurityCombinedRate: 0.124,
  socialSecurityEmployeeRate: 0.062,
  medicareCombinedRate: 0.029,
  medicareEmployeeRate: 0.0145,
  additionalMedicareRate: 0.009,
  additionalMedicareThreshold: {
    single: 200000,
    married_joint: 250000,
    married_separate: 125000,
    head_household: 200000,
  } as Record<FilingStatus, number>,
  selfEmploymentNetFactor: 0.9235,
  corporateRate: 0.21,
  quarterlyDueDates: ["2026-04-15", "2026-06-15", "2026-09-15", "2027-01-15"],
} as const;

export interface PlannerInput {
  entityType: EntityType;
  filingStatus: FilingStatus;
  grossRevenue: number;
  ordinaryExpenses: number;
  ownershipPercent: number;
  ownerW2Wages: number;
  otherW2Wages: number;
  otherTaxableIncome: number;
  aboveLineAdjustments: number;
  itemizedDeductions: number;
  qbiDeduction: number;
  taxCredits: number;
  federalWithholding: number;
  estimatedPaymentsMade: number;
  stateEffectiveRate: number;
  partnershipSEIncomePercent: number;
  reserveBufferRate: number;
}

export interface TaxComponent {
  key: string;
  label: string;
  amount: number;
  note?: string;
}

export interface QuarterlyPayment {
  label: string;
  dueDate: string;
  suggestedPayment: number;
}

export interface EstimateResult {
  version: string;
  taxYear: number;
  entityType: EntityType;
  businessProfitBeforeOwnerComp: number;
  ownerPassThroughIncome: number;
  ownerW2Wages: number;
  adjustedGrossIncomeEstimate: number;
  deductionUsed: number;
  taxableIncomeEstimate: number;
  components: TaxComponent[];
  federalTaxEstimate: number;
  stateTaxEstimate: number;
  totalProjectedTax: number;
  creditsAndPrepayments: number;
  projectedBalanceDue: number;
  effectiveRateOnBusinessProfit: number;
  reserveRecommendation: number;
  quarterlyPayments: QuarterlyPayment[];
  assumptions: string[];
  warnings: string[];
  disclaimer: string;
}

const money = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
const nonnegative = (n: number) => Math.max(0, n);

export function progressiveTax(taxableIncome: number, filingStatus: FilingStatus): number {
  let tax = 0;
  let floor = 0;
  const income = nonnegative(taxableIncome);
  for (const bracket of RULES_2026.brackets[filingStatus]) {
    const taxableInBracket = Math.min(income, bracket.cap) - floor;
    if (taxableInBracket > 0) tax += taxableInBracket * bracket.rate;
    if (income <= bracket.cap) break;
    floor = bracket.cap;
  }
  return money(tax);
}

function payrollTaxes(wages: number, otherWages: number, status: FilingStatus) {
  const ssRemainingBase = nonnegative(RULES_2026.socialSecurityWageBase - otherWages);
  const ssWages = Math.min(nonnegative(wages), ssRemainingBase);
  const employeeSS = ssWages * RULES_2026.socialSecurityEmployeeRate;
  const employerSS = ssWages * RULES_2026.socialSecurityEmployeeRate;
  const employeeMedicare = wages * RULES_2026.medicareEmployeeRate;
  const employerMedicare = wages * RULES_2026.medicareEmployeeRate;
  const additionalBase = nonnegative(
    otherWages + wages - RULES_2026.additionalMedicareThreshold[status],
  );
  const additionalMedicare = Math.min(wages, additionalBase) * RULES_2026.additionalMedicareRate;
  return { employeeSS, employerSS, employeeMedicare, employerMedicare, additionalMedicare };
}

function selfEmploymentTax(seIncome: number, otherWages: number, status: FilingStatus) {
  const netEarnings = nonnegative(seIncome) * RULES_2026.selfEmploymentNetFactor;
  const ssBaseRemaining = nonnegative(RULES_2026.socialSecurityWageBase - otherWages);
  const ssTax = Math.min(netEarnings, ssBaseRemaining) * RULES_2026.socialSecurityCombinedRate;
  const medicareTax = netEarnings * RULES_2026.medicareCombinedRate;
  const additionalBase = nonnegative(
    otherWages + netEarnings - RULES_2026.additionalMedicareThreshold[status],
  );
  const additionalMedicare =
    Math.min(netEarnings, additionalBase) * RULES_2026.additionalMedicareRate;
  return { netEarnings, ssTax, medicareTax, additionalMedicare, deductibleHalf: (ssTax + medicareTax) / 2 };
}

export function calculateEstimate(input: PlannerInput): EstimateResult {
  const ownership = input.ownershipPercent / 100;
  const businessProfitBeforeOwnerComp = input.grossRevenue - input.ordinaryExpenses;
  let ownerPassThroughIncome = 0;
  let seIncome = 0;
  let corporateTax = 0;
  let employerPayrollTax = 0;
  let employeePayrollTax = 0;
  const assumptions: string[] = [];
  const warnings: string[] = [];
  const components: TaxComponent[] = [];

  if (input.entityType === "sole_proprietor" || input.entityType === "single_member_llc") {
    ownerPassThroughIncome = businessProfitBeforeOwnerComp;
    seIncome = ownerPassThroughIncome;
    assumptions.push(
      "The LLC is treated as a disregarded single-member entity for federal planning purposes.",
    );
  } else if (input.entityType === "partnership") {
    ownerPassThroughIncome = businessProfitBeforeOwnerComp * ownership;
    seIncome = ownerPassThroughIncome * (input.partnershipSEIncomePercent / 100);
    assumptions.push("Partnership profit is allocated using the ownership percentage entered.");
    warnings.push(
      "Limited-partner, guaranteed-payment, passive-activity and special-allocation rules are not modeled.",
    );
  } else if (input.entityType === "s_corp") {
    const payroll = payrollTaxes(input.ownerW2Wages, input.otherW2Wages, input.filingStatus);
    employerPayrollTax = payroll.employerSS + payroll.employerMedicare;
    employeePayrollTax = payroll.employeeSS + payroll.employeeMedicare + payroll.additionalMedicare;
    ownerPassThroughIncome =
      nonnegative(businessProfitBeforeOwnerComp - input.ownerW2Wages - employerPayrollTax) *
      ownership;
    assumptions.push(
      "Owner wages are treated as separate from ordinary expenses and reduce S-corporation profit.",
    );
    warnings.push(
      "HALO does not determine reasonable compensation. The salary must be supportable for services performed.",
    );
  } else if (input.entityType === "c_corp") {
    const payroll = payrollTaxes(input.ownerW2Wages, input.otherW2Wages, input.filingStatus);
    employerPayrollTax = payroll.employerSS + payroll.employerMedicare;
    employeePayrollTax = payroll.employeeSS + payroll.employeeMedicare + payroll.additionalMedicare;
    // Owner salary and employer payroll taxes are deductible corporate expenses,
    // so they reduce the profit subject to the 21% corporate rate.
    corporateTax =
      nonnegative(businessProfitBeforeOwnerComp - input.ownerW2Wages - employerPayrollTax) *
      RULES_2026.corporateRate;
    assumptions.push(
      "Federal C-corporation tax is estimated at 21% of profit after deducting owner salary and employer payroll taxes.",
    );
    warnings.push(
      "Shareholder dividends, accumulated earnings tax, CAMT, credits and state franchise taxes are not modeled.",
    );
  }

  let se = { netEarnings: 0, ssTax: 0, medicareTax: 0, additionalMedicare: 0, deductibleHalf: 0 };
  if (seIncome > 0) se = selfEmploymentTax(seIncome, input.otherW2Wages, input.filingStatus);

  const personalIncomeIncluded =
    input.otherTaxableIncome + input.otherW2Wages + input.ownerW2Wages + ownerPassThroughIncome;
  const adjustedGrossIncomeEstimate = nonnegative(
    personalIncomeIncluded - input.aboveLineAdjustments - se.deductibleHalf,
  );
  const deductionUsed = Math.max(
    RULES_2026.standardDeduction[input.filingStatus],
    input.itemizedDeductions,
  );
  const taxableIncomeEstimate = nonnegative(
    adjustedGrossIncomeEstimate - deductionUsed - input.qbiDeduction,
  );
  const individualIncomeTax = progressiveTax(taxableIncomeEstimate, input.filingStatus);

  if (individualIncomeTax)
    components.push({
      key: "individual_income_tax",
      label: "Federal individual income tax",
      amount: money(individualIncomeTax),
    });
  if (se.ssTax + se.medicareTax + se.additionalMedicare)
    components.push({
      key: "self_employment_tax",
      label: "Self-employment tax",
      amount: money(se.ssTax + se.medicareTax + se.additionalMedicare),
      note: "Includes Social Security, Medicare and any modeled Additional Medicare Tax.",
    });
  if (employeePayrollTax)
    components.push({
      key: "employee_payroll_tax",
      label: "Owner employee payroll tax",
      amount: money(employeePayrollTax),
    });
  if (employerPayrollTax)
    components.push({
      key: "employer_payroll_tax",
      label: "Business employer payroll tax",
      amount: money(employerPayrollTax),
    });
  if (corporateTax)
    components.push({
      key: "corporate_income_tax",
      label: "C-corporation federal income tax",
      amount: money(corporateTax),
    });

  const federalTaxEstimate = components.reduce((sum, c) => sum + c.amount, 0);
  const stateBase =
    input.entityType === "c_corp"
      ? nonnegative(businessProfitBeforeOwnerComp)
      : nonnegative(adjustedGrossIncomeEstimate);
  const stateTaxEstimate = stateBase * input.stateEffectiveRate;
  if (stateTaxEstimate)
    components.push({
      key: "state_planning_reserve",
      label: "State planning reserve",
      amount: money(stateTaxEstimate),
      note: "Uses the effective state rate supplied by the user; it is not a state return calculation.",
    });

  const totalProjectedTax = federalTaxEstimate + stateTaxEstimate;
  const creditsAndPrepayments =
    input.taxCredits + input.federalWithholding + input.estimatedPaymentsMade;
  const projectedBalanceDue = Math.max(0, totalProjectedTax - creditsAndPrepayments);
  const reserveRecommendation = projectedBalanceDue * (1 + input.reserveBufferRate);
  const quarterlyPayments: QuarterlyPayment[] = RULES_2026.quarterlyDueDates.map((dueDate, i) => ({
    label: `Quarter ${i + 1}`,
    dueDate,
    suggestedPayment: money(projectedBalanceDue / 4),
  }));

  if (
    input.qbiDeduction === 0 &&
    ["sole_proprietor", "single_member_llc", "partnership", "s_corp"].includes(input.entityType)
  ) {
    warnings.push(
      "No qualified business income deduction was included. Enter a CPA-reviewed amount when appropriate.",
    );
  }
  if (businessProfitBeforeOwnerComp < 0)
    warnings.push(
      "A business loss was entered. Basis, at-risk, passive-loss and carryforward limitations are not modeled.",
    );

  return {
    version: "2026.1-planning",
    taxYear: 2026,
    entityType: input.entityType,
    businessProfitBeforeOwnerComp: money(businessProfitBeforeOwnerComp),
    ownerPassThroughIncome: money(ownerPassThroughIncome),
    ownerW2Wages: money(input.ownerW2Wages),
    adjustedGrossIncomeEstimate: money(adjustedGrossIncomeEstimate),
    deductionUsed: money(deductionUsed),
    taxableIncomeEstimate: money(taxableIncomeEstimate),
    components,
    federalTaxEstimate: money(federalTaxEstimate),
    stateTaxEstimate: money(stateTaxEstimate),
    totalProjectedTax: money(totalProjectedTax),
    creditsAndPrepayments: money(creditsAndPrepayments),
    projectedBalanceDue: money(projectedBalanceDue),
    effectiveRateOnBusinessProfit:
      businessProfitBeforeOwnerComp > 0 ? money(totalProjectedTax / businessProfitBeforeOwnerComp) : 0,
    reserveRecommendation: money(reserveRecommendation),
    quarterlyPayments,
    assumptions,
    warnings,
    disclaimer:
      "Planning estimate only. Not a tax return, filing determination, legal opinion, or substitute for a CPA or tax attorney. Federal and state rules may produce materially different results.",
  };
}

export interface EntityComparison {
  scenarios: EstimateResult[];
  lowestProjectedTaxEntity: EntityType;
  spread: number;
  warning: string;
}

export function compareEntities(input: PlannerInput): EntityComparison {
  const profit = Math.max(0, input.grossRevenue - input.ordinaryExpenses);
  const results = ENTITY_TYPES.map((entityType) =>
    calculateEstimate({
      ...input,
      entityType,
      ownerW2Wages:
        entityType === "s_corp" && input.ownerW2Wages === 0
          ? Math.min(profit * 0.45, 150000)
          : input.ownerW2Wages,
    }),
  );
  const sorted = [...results].sort((a, b) => a.totalProjectedTax - b.totalProjectedTax);
  return {
    scenarios: results,
    lowestProjectedTaxEntity: sorted[0]!.entityType,
    spread: Math.round((sorted.at(-1)!.totalProjectedTax - sorted[0]!.totalProjectedTax) * 100) / 100,
    warning:
      "The lowest modeled tax is not automatically the best legal entity. Formation, payroll, legal liability, benefits, basis, distributions, state law, compliance cost and exit plans must also be evaluated.",
  };
}
