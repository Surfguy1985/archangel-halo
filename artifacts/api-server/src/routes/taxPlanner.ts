import { Router, type IRouter } from "express";
import { inArray } from "drizzle-orm";
import {
  db,
  taxPlannerSettingsTable,
  ledgerAccountsTable,
  journalEntriesTable,
  journalLinesTable,
  type TaxPlannerSettings,
} from "@workspace/db";
import {
  GetTaxPlannerResponse,
  SaveTaxPlannerSettingsBody,
  SaveTaxPlannerSettingsResponse,
  RunTaxPlannerEstimateBody,
  RunTaxPlannerEstimateResponse,
  CompareTaxPlannerEntitiesBody,
  CompareTaxPlannerEntitiesResponse,
} from "@workspace/api-zod";
import {
  calculateEstimate,
  compareEntities,
  type PlannerInput,
  type EntityType,
  type FilingStatus,
} from "../lib/taxPlanner";
import { localToday } from "../lib/localDate";

const router: IRouter = Router();

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

async function loadSettings(): Promise<TaxPlannerSettings> {
  const [existing] = await db.select().from(taxPlannerSettingsTable).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(taxPlannerSettingsTable).values({}).returning();
  return created!;
}

function serializeSettings(s: TaxPlannerSettings) {
  return {
    entityType: s.entityType as EntityType,
    filingStatus: s.filingStatus as FilingStatus,
    ownershipPercent: s.ownershipPercent,
    ownerW2Wages: s.ownerW2Wages,
    otherW2Wages: s.otherW2Wages,
    otherTaxableIncome: s.otherTaxableIncome,
    aboveLineAdjustments: s.aboveLineAdjustments,
    itemizedDeductions: s.itemizedDeductions,
    qbiDeduction: s.qbiDeduction,
    taxCredits: s.taxCredits,
    federalWithholding: s.federalWithholding,
    estimatedPaymentsMade: s.estimatedPaymentsMade,
    stateEffectiveRatePct: s.stateEffectiveRatePct,
    partnershipSEIncomePercent: s.partnershipSEIncomePercent,
    reserveBufferRatePct: s.reserveBufferRatePct,
  };
}

type SettingsPatch = Partial<ReturnType<typeof serializeSettings>>;

function sanitizePatch(patch: SettingsPatch): SettingsPatch {
  const out: SettingsPatch = { ...patch };
  const nonneg: Array<keyof SettingsPatch> = [
    "ownerW2Wages",
    "otherW2Wages",
    "aboveLineAdjustments",
    "itemizedDeductions",
    "qbiDeduction",
    "taxCredits",
    "federalWithholding",
    "estimatedPaymentsMade",
  ];
  for (const k of nonneg) {
    const v = out[k];
    if (typeof v === "number") (out as Record<string, unknown>)[k] = Math.max(0, v);
  }
  if (typeof out.ownershipPercent === "number")
    out.ownershipPercent = clamp(out.ownershipPercent, 0, 100);
  if (typeof out.partnershipSEIncomePercent === "number")
    out.partnershipSEIncomePercent = clamp(out.partnershipSEIncomePercent, 0, 100);
  if (typeof out.stateEffectiveRatePct === "number")
    out.stateEffectiveRatePct = clamp(out.stateEffectiveRatePct, 0, 20);
  if (typeof out.reserveBufferRatePct === "number")
    out.reserveBufferRatePct = clamp(out.reserveBufferRatePct, 0, 25);
  return out;
}

// Books-derived YTD revenue (4000s credits net) and expenses (5000s debits net).
async function booksPrefill() {
  const today = localToday();
  const year = Number(today.slice(0, 4));
  const from = `${year}-01-01`;
  const [accounts, entries, lines] = await Promise.all([
    db.select().from(ledgerAccountsTable),
    db.select().from(journalEntriesTable),
    db.select().from(journalLinesTable),
  ]);
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const entryDates = new Map(entries.map((e) => [e.id, e.entryDate]));
  let revenue = 0;
  let expenses = 0;
  for (const l of lines) {
    const d = entryDates.get(l.entryId);
    if (!d || d < from || d > today) continue;
    const acc = accById.get(l.accountId);
    if (!acc) continue;
    if (acc.type === "revenue") revenue += (l.credit ?? 0) - (l.debit ?? 0);
    else if (acc.type === "expense") expenses += (l.debit ?? 0) - (l.credit ?? 0);
  }
  const start = new Date(`${from}T00:00:00`);
  const now = new Date(`${today}T00:00:00`);
  const daysElapsed = Math.max(
    1,
    Math.round((now.getTime() - start.getTime()) / 86_400_000) + 1,
  );
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInYear = isLeap ? 366 : 365;
  const factor = daysInYear / daysElapsed;
  return {
    year,
    daysElapsed,
    ytdRevenue: round2(revenue),
    ytdExpenses: round2(expenses),
    ytdProfit: round2(revenue - expenses),
    annualizedRevenue: round2(revenue * factor),
    annualizedExpenses: round2(expenses * factor),
    annualizedProfit: round2((revenue - expenses) * factor),
  };
}

function toEngineInput(
  settings: TaxPlannerSettings,
  override: SettingsPatch | undefined,
  grossRevenue: number,
  ordinaryExpenses: number,
): PlannerInput {
  const merged = { ...serializeSettings(settings), ...sanitizePatch(override ?? {}) };
  return {
    entityType: merged.entityType as EntityType,
    filingStatus: merged.filingStatus as FilingStatus,
    grossRevenue: Math.max(0, grossRevenue),
    ordinaryExpenses: Math.max(0, ordinaryExpenses),
    ownershipPercent: merged.ownershipPercent!,
    ownerW2Wages: merged.ownerW2Wages!,
    otherW2Wages: merged.otherW2Wages!,
    otherTaxableIncome: merged.otherTaxableIncome!,
    aboveLineAdjustments: merged.aboveLineAdjustments!,
    itemizedDeductions: merged.itemizedDeductions!,
    qbiDeduction: merged.qbiDeduction!,
    taxCredits: merged.taxCredits!,
    federalWithholding: merged.federalWithholding!,
    estimatedPaymentsMade: merged.estimatedPaymentsMade!,
    stateEffectiveRate: merged.stateEffectiveRatePct! / 100,
    partnershipSEIncomePercent: merged.partnershipSEIncomePercent!,
    reserveBufferRate: merged.reserveBufferRatePct! / 100,
  };
}

router.get("/accounting/tax-planner", async (_req, res): Promise<void> => {
  const [settings, prefill] = await Promise.all([loadSettings(), booksPrefill()]);
  res.json(
    GetTaxPlannerResponse.parse({ settings: serializeSettings(settings), prefill }),
  );
});

router.put("/accounting/tax-planner", async (req, res): Promise<void> => {
  const body = sanitizePatch(SaveTaxPlannerSettingsBody.parse(req.body));
  const existing = await loadSettings();
  const [updated] = await db
    .update(taxPlannerSettingsTable)
    .set({ ...body, updatedAt: new Date() })
    .where(inArray(taxPlannerSettingsTable.id, [existing.id]))
    .returning();
  const prefill = await booksPrefill();
  res.json(
    SaveTaxPlannerSettingsResponse.parse({
      settings: serializeSettings(updated!),
      prefill,
    }),
  );
});

router.post("/accounting/tax-planner/estimate", async (req, res): Promise<void> => {
  const body = RunTaxPlannerEstimateBody.parse(req.body);
  const settings = await loadSettings();
  const input = toEngineInput(settings, body.settings, body.grossRevenue, body.ordinaryExpenses);
  res.json(RunTaxPlannerEstimateResponse.parse(calculateEstimate(input)));
});

router.post("/accounting/tax-planner/compare", async (req, res): Promise<void> => {
  const body = CompareTaxPlannerEntitiesBody.parse(req.body);
  const settings = await loadSettings();
  const input = toEngineInput(settings, body.settings, body.grossRevenue, body.ordinaryExpenses);
  res.json(CompareTaxPlannerEntitiesResponse.parse(compareEntities(input)));
});

export default router;
