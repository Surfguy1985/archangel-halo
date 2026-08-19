import { inArray, desc } from "drizzle-orm";
import { db, discrepanciesTable } from "@workspace/db";
import { logger } from "./logger";
import { runReconciliation } from "./financialReconciliation";
export type AgentSuggestion = { id: string; agent: string; severity: string; title: string; body: string; action?: { type: string; refId?: string }; createdAt: string };
let lastSuggestions: AgentSuggestion[] = [];
let lastRunAt = 0;
export function getLatestSuggestions() { return lastSuggestions; }
export function getAgentsMeta() { return { lastRunAt, count: lastSuggestions.length }; }
export async function runContinuousAgents(triggeredBy = "scheduler") {
  const suggestions: AgentSuggestion[] = [];
  const now = new Date().toISOString();
  try {
    const result = await runReconciliation(triggeredBy);
    if (result.discrepanciesFound > 0) suggestions.push({ id: `recon-${Date.now()}`, agent: "ReconciliationAgent", severity: "critical", title: `${result.discrepanciesFound} pricing issues found`, body: `Scanned ${result.jobsScanned} jobs.`, action: { type: "run_recon" }, createdAt: now });
  } catch (err) { logger.warn({ err }, "ReconciliationAgent failed"); }
  try {
    const open = await db.select().from(discrepanciesTable).where(inArray(discrepanciesTable.status, ["open", "pending_review"])).orderBy(desc(discrepanciesTable.createdAt)).limit(10);
    for (const d of open.filter((x) => x.severity === "critical").slice(0, 3)) {
      suggestions.push({ id: `disc-${d.id}`, agent: "InvoiceAccuracyAgent", severity: "critical", title: "Price required", body: d.explanation, action: { type: "open_discrepancy", refId: d.id }, createdAt: now });
    }
  } catch (err) { logger.warn({ err }, "InvoiceAccuracyAgent failed"); }
  lastSuggestions = suggestions; lastRunAt = Date.now();
  return suggestions;
}
