import {
  db,
  invoicesTable,
  expensesTable,
  jobsTable,
  propertiesTable,
  crewPaymentsTable,
  crewInvoicesTable,
} from "@workspace/db";

/** All marginPct values in this report are FRACTIONS (0.25 = 25%). */

export interface ReportJobRow {
  jobId: string;
  jobNo: string;
  propertyName: string;
  description: string | null;
  status: string;
  grossProfit: number | null;
  marginPct: number | null;
}

export interface PropertyReportRow {
  propertyId: string | null;
  propertyName: string;
  revenue: number;
  collected: number;
  outstanding: number;
  suppliesExpenses: number;
  laborExpenses: number;
  totalExpenses: number;
  netProfit: number;
  marginPct: number | null;
  jobsCompleted: number;
  jobsActive: number;
  supplyCategories: { category: string; amount: number }[];
}

export interface ReportTotals {
  revenue: number;
  collected: number;
  outstanding: number;
  suppliesExpenses: number;
  laborExpenses: number;
  totalExpenses: number;
  netProfit: number;
  marginPct: number | null;
  jobsCompleted: number;
  jobsActive: number;
}

export interface BusinessReport {
  generatedAt: string;
  totals: ReportTotals;
  properties: PropertyReportRow[];
  topJobs: ReportJobRow[];
  weakJobs: ReportJobRow[];
}

const UNASSIGNED = "__unassigned__";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Generic tokens that don't identify a property on their own. */
const TRIVIAL_TOKENS = new Set([
  "apt", "apartment", "apartments", "unit", "units", "suite", "ste", "bldg",
  "building", "st", "street", "rd", "road", "dr", "drive", "ave", "avenue",
  "ln", "lane", "blvd", "ct", "court", "way", "pkwy", "hwy", "the", "at",
  "of", "and", "tx", "texas", "n", "s", "e", "w", "north", "south", "east",
  "west",
]);

function significantTokens(s: string): Set<string> {
  return new Set(
    norm(s)
      .split(" ")
      .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !TRIVIAL_TOKENS.has(t)),
  );
}

/**
 * Match a free-text property address (from crew invoices) to a known
 * property. Scores each property by significant-token overlap against
 * its name and street address; requires an exact normalized match OR at
 * least 2 overlapping significant tokens (1 suffices only when the
 * property side has a single significant token and it matches fully).
 * Ambiguous ties and low-confidence matches return null (→ Unassigned).
 */
function matchProperty(
  freeText: string,
  props: { id: string; name: string; address: string | null }[],
): string | null {
  const t = norm(freeText);
  if (!t) return null;
  const textTokens = significantTokens(freeText);
  if (textTokens.size === 0) return null;

  let bestId: string | null = null;
  let bestScore = 0;
  let tie = false;
  for (const p of props) {
    const nName = norm(p.name);
    const nAddr = p.address ? norm(p.address) : "";
    // Exact normalized equality is a definitive match.
    if (t === nName || (nAddr && t === nAddr)) return p.id;

    const propTokens = new Set([
      ...significantTokens(p.name),
      ...(p.address ? significantTokens(p.address) : []),
    ]);
    if (propTokens.size === 0) continue;
    let overlap = 0;
    for (const tok of propTokens) if (textTokens.has(tok)) overlap++;
    const enough =
      overlap >= 2 || (overlap === 1 && propTokens.size === 1);
    if (!enough) continue;
    if (overlap > bestScore) {
      bestScore = overlap;
      bestId = p.id;
      tie = false;
    } else if (overlap === bestScore) {
      tie = true;
    }
  }
  return tie ? null : bestId;
}

export async function computeBusinessReport(): Promise<BusinessReport> {
  const [props, invoices, expenses, jobs, crewPayments, crewInvoices] =
    await Promise.all([
      db.select().from(propertiesTable),
      db.select().from(invoicesTable),
      db.select().from(expensesTable),
      db.select().from(jobsTable),
      db.select().from(crewPaymentsTable),
      db.select().from(crewInvoicesTable),
    ]);

  const propNames = new Map(props.map((p) => [p.id, p.name]));
  const jobToProp = new Map(jobs.map((j) => [j.id, j.propertyId]));
  const matchable = props.map((p) => ({
    id: p.id,
    name: p.name,
    address: p.address ?? null,
  }));

  interface Acc {
    revenue: number;
    collected: number;
    outstanding: number;
    supplies: number;
    labor: number;
    categories: Map<string, number>;
    jobsCompleted: number;
    jobsActive: number;
  }
  const acc = new Map<string, Acc>();
  const bucket = (key: string): Acc => {
    let a = acc.get(key);
    if (!a) {
      a = {
        revenue: 0,
        collected: 0,
        outstanding: 0,
        supplies: 0,
        labor: 0,
        categories: new Map(),
        jobsCompleted: 0,
        jobsActive: 0,
      };
      acc.set(key, a);
    }
    return a;
  };

  // Revenue: our invoices to property managers (drafts excluded).
  for (const inv of invoices) {
    if (inv.status === "draft") continue;
    const a = bucket(inv.propertyId);
    a.revenue += inv.amount;
    if (inv.status === "paid" || inv.paidAt) a.collected += inv.amount;
    else a.outstanding += inv.amount;
  }

  // Supplies: logged expenses (materials, parts, supplies...).
  for (const e of expenses) {
    const key = e.propertyId ?? (e.jobId ? jobToProp.get(e.jobId) : null);
    const a = bucket(key ?? UNASSIGNED);
    a.supplies += e.amount;
    const cat = e.category?.trim() || "Uncategorized";
    a.categories.set(cat, (a.categories.get(cat) ?? 0) + e.amount);
  }

  // Labor / subcontractor invoices: crew payments + submitted crew invoices.
  for (const p of crewPayments) {
    const key = p.jobId ? jobToProp.get(p.jobId) : null;
    bucket(key ?? UNASSIGNED).labor += p.amount;
  }
  for (const ci of crewInvoices) {
    if (ci.status === "rejected") continue;
    const key = matchProperty(ci.propertyAddress, matchable);
    bucket(key ?? UNASSIGNED).labor += ci.total;
  }

  // Job counts per property.
  for (const j of jobs) {
    if (j.status === "cancelled") continue;
    const a = bucket(j.propertyId);
    if (j.completedAt || j.status === "complete" || j.status === "paid") {
      a.jobsCompleted += 1;
    } else {
      a.jobsActive += 1;
    }
  }

  const rows: PropertyReportRow[] = [];
  for (const [key, a] of acc) {
    const totalExpenses = round2(a.supplies + a.labor);
    const netProfit = round2(a.revenue - totalExpenses);
    rows.push({
      propertyId: key === UNASSIGNED ? null : key,
      propertyName:
        key === UNASSIGNED
          ? "Unassigned / general"
          : (propNames.get(key) ?? "Unknown property"),
      revenue: round2(a.revenue),
      collected: round2(a.collected),
      outstanding: round2(a.outstanding),
      suppliesExpenses: round2(a.supplies),
      laborExpenses: round2(a.labor),
      totalExpenses,
      netProfit,
      marginPct:
        a.revenue > 0 ? Math.round((netProfit / a.revenue) * 1000) / 1000 : null,
      jobsCompleted: a.jobsCompleted,
      jobsActive: a.jobsActive,
      supplyCategories: [...a.categories.entries()]
        .map(([category, amount]) => ({ category, amount: round2(amount) }))
        .sort((x, y) => y.amount - x.amount),
    });
  }
  rows.sort((x, y) => y.revenue - x.revenue || y.totalExpenses - x.totalExpenses);

  const totals: ReportTotals = rows.reduce(
    (t, r) => ({
      revenue: round2(t.revenue + r.revenue),
      collected: round2(t.collected + r.collected),
      outstanding: round2(t.outstanding + r.outstanding),
      suppliesExpenses: round2(t.suppliesExpenses + r.suppliesExpenses),
      laborExpenses: round2(t.laborExpenses + r.laborExpenses),
      totalExpenses: round2(t.totalExpenses + r.totalExpenses),
      netProfit: round2(t.netProfit + r.netProfit),
      marginPct: null,
      jobsCompleted: t.jobsCompleted + r.jobsCompleted,
      jobsActive: t.jobsActive + r.jobsActive,
    }),
    {
      revenue: 0,
      collected: 0,
      outstanding: 0,
      suppliesExpenses: 0,
      laborExpenses: 0,
      totalExpenses: 0,
      netProfit: 0,
      marginPct: null as number | null,
      jobsCompleted: 0,
      jobsActive: 0,
    },
  );
  totals.marginPct =
    totals.revenue > 0
      ? Math.round((totals.netProfit / totals.revenue) * 1000) / 1000
      : null;

  const toJobRow = (j: (typeof jobs)[number]): ReportJobRow => ({
    jobId: j.id,
    jobNo: j.jobNo,
    propertyName: propNames.get(j.propertyId) ?? "Unknown property",
    description: j.description ?? null,
    status: j.status,
    grossProfit: j.grossProfit ?? null,
    marginPct: j.marginPct ?? null,
  });

  const measured = jobs.filter(
    (j) => j.grossProfit != null || j.marginPct != null,
  );
  const topJobs = [...measured]
    .sort(
      (x, y) =>
        (y.grossProfit ?? 0) - (x.grossProfit ?? 0) ||
        (y.marginPct ?? 0) - (x.marginPct ?? 0),
    )
    .slice(0, 5)
    .map(toJobRow);
  // Weak = thin margin (< 25%) or losing money outright.
  const weakJobs = measured
    .filter(
      (j) =>
        (j.marginPct != null && j.marginPct < 0.25) ||
        (j.grossProfit != null && j.grossProfit < 0),
    )
    .sort(
      (x, y) =>
        (x.marginPct ?? 0) - (y.marginPct ?? 0) ||
        (x.grossProfit ?? 0) - (y.grossProfit ?? 0),
    )
    .slice(0, 5)
    .map(toJobRow);

  return {
    generatedAt: new Date().toISOString(),
    totals,
    properties: rows,
    topJobs,
    weakJobs,
  };
}
