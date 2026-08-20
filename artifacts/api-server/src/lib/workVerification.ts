/**
 * Always-on post–Log Work verification: pricing, missing services, crew assignment for payout.
 */
import { and, eq, inArray, desc } from "drizzle-orm";
import {
  db, jobsTable, invoicesTable, invoiceLineItemsTable,
  masterPriceListTable, crewPayoutMasterTable, jobLineItemsTable, crewsTable,
} from "@workspace/db";
import { normalizeServiceCode, dollars } from "./financialReconciliationCore";
import { reconcileJob, listOpenDiscrepanciesForJob } from "./financialReconciliation";
import { logger } from "./logger";

export type VerificationLine = {
  serviceCode: string; label: string;
  actualInvoiceCents: number | null; expectedInvoiceCents: number | null;
  actualCrewCents: number | null; expectedCrewCents: number | null;
  assignedCrewId: string | null; assignedCrewName: string | null;
  status: "ok" | "missing" | "zero" | "variance" | "bid" | "no_master" | "unassigned_crew" | "wrong_crew";
  suggestion: string | null; suggestedInvoiceCents: number | null; suggestedCrewCents: number | null;
};

export type WorkVerification = {
  jobId: string; jobNo: string | null; unitNo: string | null;
  status: "clean" | "needs_attention"; title: string; summary: string; showModal: true;
  invoicePresent: boolean; invoiceId: string | null;
  invoiceTotalCents: number | null; crewPayTotalCents: number | null;
  crewLeaderId: string | null; crewLeaderName: string | null;
  missingServices: Array<{ label: string; serviceCode: string; suggestedInvoiceCents: number | null; suggestedCrewCents: number | null }>;
  crewAssignmentIssues: Array<{ label: string; issue: string; suggestion: string }>;
  lines: VerificationLine[];
  suggestions: Array<{
    id: string; severity: string; title: string; body: string;
    action: "create_invoice" | "set_invoice_line" | "set_crew_payout" | "add_missing_service" | "assign_crew" | "open_punchlist" | "confirm_clean";
    discrepancyId?: string; serviceCode?: string;
    suggestedInvoiceCents?: number | null; suggestedCrewCents?: number | null; suggestedCrewId?: string | null;
  }>;
  discrepancies: Array<Record<string, unknown>>;
  punchlistUrl: string;
};

function asServiceList(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((s) => {
      if (typeof s === "string") return s.trim();
      if (s && typeof s === "object") { const o = s as any; return String(o.name || o.service || o.label || o.typeOfWork || "").trim(); }
      return "";
    }).filter(Boolean);
  }
  if (typeof raw === "string") {
    try { return asServiceList(JSON.parse(raw)); } catch { return raw.split(/[,;|]/).map((s) => s.trim()).filter(Boolean); }
  }
  return [];
}

async function getMaster(serviceCode: string, unitType = "2br") {
  const rows = await db.select().from(masterPriceListTable).where(and(eq(masterPriceListTable.serviceCode, serviceCode), eq(masterPriceListTable.isActive, true)));
  return rows.find((r) => r.unitType === unitType) || rows.find((r) => r.unitType === "flat") || rows.find((r) => r.unitType === "bid") || null;
}
async function getCrewRate(serviceCode: string, unitType = "2br") {
  const rows = await db.select().from(crewPayoutMasterTable).where(and(eq(crewPayoutMasterTable.serviceCode, serviceCode), eq(crewPayoutMasterTable.isActive, true)));
  return rows.find((r) => r.unitType === unitType) || rows.find((r) => r.unitType === "flat") || null;
}
function tradeForService(label: string): string | null {
  const s = label.toLowerCase();
  if (/paint|kilz|primer|cabinet|color/.test(s)) return "paint";
  if (/clean|housekeep|janitor|turn clean|vacant/.test(s)) return "cleaning";
  if (/carpet|floor|stretch/.test(s)) return "carpet";
  if (/drywall|patch|sheetrock/.test(s)) return "drywall";
  if (/tub|shower|reglaze|counter|resurface/.test(s)) return "resurfacing";
  if (/toilet|plumb|faucet/.test(s)) return "plumbing";
  if (/make.?ready|punch/.test(s)) return "make_ready";
  return null;
}
function crewMatchesTrade(crew: { trade?: string | null; services?: unknown; name?: string | null }, serviceLabel: string): boolean {
  const need = tradeForService(serviceLabel);
  if (!need) return true;
  const trade = (crew.trade || "").toLowerCase();
  if (trade && (trade.includes(need) || need.includes(trade))) return true;
  const crewServices = asServiceList(crew.services).map((x) => x.toLowerCase());
  if (crewServices.some((cs) => cs.includes(need) || serviceLabel.toLowerCase().includes(cs))) return true;
  return !trade && crewServices.length === 0;
}

export async function buildWorkVerification(jobId: string): Promise<WorkVerification | null> {
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId)).limit(1);
  if (!job) return null;
  try { await reconcileJob(jobId); } catch (err) { logger.warn({ err, jobId }, "buildWorkVerification recon failed"); }

  const invoices = await db.select().from(invoicesTable).where(eq(invoicesTable.jobId, jobId));
  const invoice = invoices[0] ?? null;
  const invLines = invoice ? await db.select().from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, invoice.id)) : [];
  const jobLines = await db.select().from(jobLineItemsTable).where(eq(jobLineItemsTable.jobId, jobId));

  const expectedServiceLabels = Array.from(new Set([...asServiceList(job.services), ...jobLines.map((jl) => jl.service).filter(Boolean)]));

  const crewIds = new Set<string>();
  if (job.crewLeaderId) crewIds.add(job.crewLeaderId);
  for (const jl of jobLines) {
    if (jl.assignedCrewId) crewIds.add(jl.assignedCrewId);
    if (jl.completedByCrewId) crewIds.add(jl.completedByCrewId);
  }
  const crews = crewIds.size > 0 ? await db.select().from(crewsTable).where(inArray(crewsTable.id, Array.from(crewIds))) : [];
  const crewById = new Map(crews.map((c) => [c.id, c]));
  const leader = job.crewLeaderId ? crewById.get(job.crewLeaderId) : null;

  const crewPay = Array.isArray(job.crewPay) ? (job.crewPay as any[]) : [];
  const crewPayTotalCents = Math.round((typeof job.crewRate === "number" ? job.crewRate : crewPay.reduce((s, c) => s + (Number(c?.amount) || 0), 0)) * 100);
  const unitType = "2br";
  const verificationLines: VerificationLine[] = [];
  const suggestions: WorkVerification["suggestions"] = [];
  const missingServices: WorkVerification["missingServices"] = [];
  const crewAssignmentIssues: WorkVerification["crewAssignmentIssues"] = [];
  const base = process.env.PUBLIC_APP_URL || "https://archangel-halo.replit.app";

  if (!invoice) {
    suggestions.push({ id: `missing-inv-${jobId}`, severity: "high", title: "Create invoice",
      body: "No invoice exists for this completed work. Create one and price each service from the master rate sheet.", action: "create_invoice" });
  }

  const invByCode = new Map<string, (typeof invLines)[0]>();
  for (const line of invLines) invByCode.set(normalizeServiceCode(line.typeOfWork || line.description || ""), line);
  const jobLineByCode = new Map<string, (typeof jobLines)[0]>();
  for (const jl of jobLines) jobLineByCode.set(normalizeServiceCode(jl.service), jl);

  for (const label of expectedServiceLabels) {
    const code = normalizeServiceCode(label);
    const onInvoice = invByCode.has(code) || invLines.some((l) => (l.typeOfWork || "").toLowerCase().includes(label.toLowerCase()) || label.toLowerCase().includes((l.typeOfWork || "").toLowerCase()));
    if (!onInvoice && invoice) {
      const master = await getMaster(code, unitType);
      const crewMaster = await getCrewRate(code, unitType);
      missingServices.push({ label, serviceCode: code, suggestedInvoiceCents: master?.rateCents ?? null, suggestedCrewCents: crewMaster?.rateCents ?? null });
      suggestions.push({
        id: `missing-svc-${code}`, severity: "high", title: `Missing service: ${label}`,
        body: master?.rateCents != null ? `On the job but not on the invoice. Suggest add at ${dollars(master.rateCents)}.` : `On the job but not on the invoice. Add and price it.`,
        action: "add_missing_service", serviceCode: code, suggestedInvoiceCents: master?.rateCents ?? null, suggestedCrewCents: crewMaster?.rateCents ?? null,
      });
    }
  }
  if (!invoice && expectedServiceLabels.length) {
    for (const label of expectedServiceLabels) {
      const code = normalizeServiceCode(label);
      const master = await getMaster(code, unitType);
      const crewMaster = await getCrewRate(code, unitType);
      if (!missingServices.some((m) => m.serviceCode === code)) {
        missingServices.push({ label, serviceCode: code, suggestedInvoiceCents: master?.rateCents ?? null, suggestedCrewCents: crewMaster?.rateCents ?? null });
      }
    }
  }

  for (const line of invLines) {
    const serviceCode = normalizeServiceCode(line.typeOfWork || line.description || "UNKNOWN");
    const label = line.typeOfWork || line.description || serviceCode;
    const actualInvoiceCents = Math.round((Number(line.unitPrice) || 0) * 100);
    const master = await getMaster(serviceCode, unitType);
    const crewMaster = await getCrewRate(serviceCode, unitType);
    const expectedInvoiceCents = master?.rateCents ?? null;
    const expectedCrewCents = crewMaster?.rateCents ?? null;
    const jl = jobLineByCode.get(serviceCode);
    const assignedCrewId = jl?.assignedCrewId ?? job.crewLeaderId ?? null;
    const assignedCrew = assignedCrewId ? crewById.get(assignedCrewId) : null;

    let status: VerificationLine["status"] = "ok";
    let suggestion: string | null = null;
    let suggestedInvoiceCents: number | null = null;
    const suggestedCrewCents: number | null = expectedCrewCents;

    if (!master) { status = "no_master"; suggestion = `No master rate for "${label}".`; }
    else if (master.rateCents == null || master.unitType === "bid") { status = "bid"; suggestion = `"${master.name}" is BID — enter a quote.`; }
    else if (actualInvoiceCents === 0) { status = "zero"; suggestedInvoiceCents = master.rateCents; suggestion = `Invoiced $0. Suggest ${dollars(master.rateCents)}.`; }
    else if (Math.abs(actualInvoiceCents - master.rateCents) > 50) { status = "variance"; suggestedInvoiceCents = master.rateCents; suggestion = `Invoiced ${dollars(actualInvoiceCents)}; master expects ${dollars(master.rateCents)}.`; }

    if (!assignedCrewId) {
      status = status === "ok" ? "unassigned_crew" : status;
      const msg = `No crew on "${label}" — cannot route payout. Assign a crew member.`;
      crewAssignmentIssues.push({ label, issue: "unassigned", suggestion: msg });
      suggestions.push({ id: `crew-unassigned-${serviceCode}`, severity: "high", title: `Assign crew: ${label}`, body: msg, action: "assign_crew", serviceCode, suggestedCrewCents: expectedCrewCents, suggestedCrewId: job.crewLeaderId });
      if (!suggestion) suggestion = msg;
    } else if (assignedCrew && !crewMatchesTrade(assignedCrew, label)) {
      status = status === "ok" ? "wrong_crew" : status;
      const need = tradeForService(label) || "this trade";
      const msg = `"${assignedCrew.name}" (${assignedCrew.trade || "no trade"}) may be wrong for ${need} on "${label}".`;
      crewAssignmentIssues.push({ label, issue: "wrong_trade", suggestion: msg });
      suggestions.push({ id: `crew-wrong-${serviceCode}`, severity: "medium", title: `Wrong crew for ${label}?`, body: msg, action: "assign_crew", serviceCode, suggestedCrewCents: expectedCrewCents });
      if (!suggestion) suggestion = msg;
    }

    if (assignedCrewId && expectedCrewCents && expectedCrewCents > 0) {
      const payEntry = crewPay.find((c) => c?.crewId === assignedCrewId || c?.id === assignedCrewId || (assignedCrew && String(c?.name || "").toLowerCase() === assignedCrew.name.toLowerCase()));
      if (!payEntry && crewPay.length > 0) {
        suggestions.push({ id: `crew-pay-missing-${serviceCode}`, severity: "medium", title: `Payout missing for ${assignedCrew?.name || "crew"}`,
          body: `Service "${label}" assigned but crew_pay has no line. Suggest ${dollars(expectedCrewCents)}.`, action: "set_crew_payout", serviceCode, suggestedCrewCents: expectedCrewCents, suggestedCrewId: assignedCrewId });
      }
    }

    verificationLines.push({ serviceCode, label, actualInvoiceCents, expectedInvoiceCents, actualCrewCents: null, expectedCrewCents, assignedCrewId, assignedCrewName: assignedCrew?.name ?? null, status, suggestion, suggestedInvoiceCents, suggestedCrewCents });

    if (status !== "ok" && status !== "unassigned_crew" && status !== "wrong_crew") {
      suggestions.push({ id: `line-${line.id}`, severity: status === "bid" || status === "zero" ? "high" : "medium",
        title: status === "zero" ? `Set price for ${label}` : status === "variance" ? `Correct price for ${label}` : status === "bid" ? `Enter bid for ${label}` : `Review ${label}`,
        body: suggestion || "", action: "set_invoice_line", serviceCode, suggestedInvoiceCents, suggestedCrewCents });
    }
  }

  for (const jl of jobLines) {
    if (!jl.assignedCrewId && !job.crewLeaderId) {
      const label = jl.service;
      if (!crewAssignmentIssues.some((c) => c.label === label && c.issue === "unassigned")) {
        crewAssignmentIssues.push({ label, issue: "unassigned", suggestion: `Job service "${label}" has no assigned crew.` });
        suggestions.push({ id: `jl-crew-${jl.id}`, severity: "high", title: `Assign crew: ${label}`, body: `No crew on job line "${label}".`, action: "assign_crew", serviceCode: normalizeServiceCode(label), suggestedCrewId: job.crewLeaderId });
      }
    }
  }

  if (!job.crewLeaderId && jobLines.every((j) => !j.assignedCrewId)) {
    suggestions.push({ id: `no-crew-job-${jobId}`, severity: "high", title: "No crew on job", body: "Assign a crew leader and per-service crews for correct payout.", action: "assign_crew" });
  }
  if (invoice && invLines.length === 0) {
    suggestions.push({ id: `empty-lines-${jobId}`, severity: "high", title: "Invoice has no line items", body: "Add every logged service and price from the master sheet.", action: "create_invoice" });
  }

  const expectedCrewSum = verificationLines.reduce((s, l) => s + (l.expectedCrewCents || 0), 0) + missingServices.reduce((s, m) => s + (m.suggestedCrewCents || 0), 0);
  if (expectedCrewSum > 0 && crewPayTotalCents === 0) {
    suggestions.push({ id: `crew-zero-${jobId}`, severity: "medium", title: "Crew payout is $0", body: `Suggest crew total ${dollars(expectedCrewSum)} from crew payout master.`, action: "set_crew_payout", suggestedCrewCents: expectedCrewSum, suggestedCrewId: job.crewLeaderId });
  }

  const openDisc = await listOpenDiscrepanciesForJob(jobId);
  for (const d of openDisc) {
    if (suggestions.some((s) => s.discrepancyId === d.id)) continue;
    suggestions.push({ id: `disc-${d.id}`, severity: d.severity, title: d.type === "missing_invoice" ? "Missing invoice" : d.type === "zero_or_missing" ? "Price required ($0)" : "Price issue",
      body: d.explanation, action: d.type === "missing_invoice" ? "create_invoice" : "set_invoice_line", discrepancyId: d.id, serviceCode: d.serviceCode ?? undefined,
      suggestedInvoiceCents: (d.suggestedFix as any)?.recommendedInvoiceCents ?? d.expectedCents });
  }

  const seen = new Set<string>();
  const uniqueSuggestions = suggestions.filter((s) => { if (seen.has(s.id)) return false; seen.add(s.id); return true; });
  const needsAttention = uniqueSuggestions.some((s) => s.action !== "confirm_clean") || verificationLines.some((l) => l.status !== "ok") || missingServices.length > 0 || crewAssignmentIssues.length > 0;
  if (!needsAttention) {
    uniqueSuggestions.push({ id: `clean-${jobId}`, severity: "info", title: "All clear", body: "Invoice, services, and crew assignments match. Confirm to close.", action: "confirm_clean" });
  }

  const invoiceTotalCents = invoice ? Math.round((Number(invoice.amount) || invLines.reduce((s, l) => s + (Number(l.amount) || 0), 0)) * 100) : null;
  const issueBits = [
    missingServices.length ? `${missingServices.length} missing service(s)` : null,
    crewAssignmentIssues.length ? `${crewAssignmentIssues.length} crew assignment issue(s)` : null,
    uniqueSuggestions.filter((s) => s.action !== "confirm_clean").length ? `${uniqueSuggestions.filter((s) => s.action !== "confirm_clean").length} correction(s)` : null,
  ].filter(Boolean);

  return {
    jobId, jobNo: (job as any).jobNo ?? null, unitNo: (job as any).unitNo ?? (job as any).unit ?? null,
    status: needsAttention ? "needs_attention" : "clean",
    title: needsAttention ? "Verify work — fix services, pricing & crew" : "Verify work — looks good",
    summary: needsAttention ? issueBits.join(" · ") + " before payout/billing is final." : "Services complete, invoice matches master rates, crew assigned for correct payout.",
    showModal: true, invoicePresent: !!invoice, invoiceId: invoice?.id ?? null, invoiceTotalCents, crewPayTotalCents,
    crewLeaderId: job.crewLeaderId ?? null, crewLeaderName: leader?.name ?? null,
    missingServices, crewAssignmentIssues, lines: verificationLines, suggestions: uniqueSuggestions,
    discrepancies: openDisc as any, punchlistUrl: `${base}/punchlist`,
  };
}

export async function verifyAfterLogWork(jobId: string) {
  const verification = await buildWorkVerification(jobId);
  return { found: (verification?.discrepancies || []).length, cards: verification?.discrepancies || [], verification };
}
