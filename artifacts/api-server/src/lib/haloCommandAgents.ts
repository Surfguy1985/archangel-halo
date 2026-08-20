import { inArray, desc } from "drizzle-orm";
import { db, discrepanciesTable } from "@workspace/db";
import { logger } from "./logger";
import { runReconciliation } from "./financialReconciliation";

export type AgentSuggestion = {
  id: string;
  agent: string;
  severity: string;
  title: string;
  body: string;
  action?: { type: string; refId?: string };
  createdAt: string;
};

let lastSuggestions: AgentSuggestion[] = [];
let lastRunAt = 0;

export function getLatestSuggestions() {
  return lastSuggestions;
}

export function getAgentsMeta() {
  return { lastRunAt, count: lastSuggestions.length };
}

export async function runContinuousAgents(triggeredBy = "scheduler") {
  const suggestions: AgentSuggestion[] = [];
  const now = new Date().toISOString();

  try {
    const result = await runReconciliation(triggeredBy);
    if (result.discrepanciesFound > 0) {
      suggestions.push({
        id: `recon-${Date.now()}`,
        agent: "ReconciliationAgent",
        severity: "critical",
        title: `${result.discrepanciesFound} new pricing issues found`,
        body: `Scanned ${result.jobsScanned} jobs. Open the Punchlist map to resolve.`,
        action: { type: "run_recon" },
        createdAt: now,
      });
    }
  } catch (err) {
    logger.warn({ err }, "ReconciliationAgent failed");
  }

  try {
    const open = await db
      .select()
      .from(discrepanciesTable)
      .where(inArray(discrepanciesTable.status, ["open", "pending_review"]))
      .orderBy(desc(discrepanciesTable.createdAt))
      .limit(50);

    const critical = open.filter((x) => x.severity === "critical");
    const high = open.filter((x) => x.severity === "high");
    const missingInv = open.filter((x) => x.type === "missing_invoice");
    const zeroPrice = open.filter((x) => x.type === "zero_or_missing" || x.type === "bid_needs_price");

    if (open.length > 0) {
      suggestions.push({
        id: `open-count-${Date.now()}`,
        agent: "InvoiceAccuracyAgent",
        severity: critical.length > 0 ? "critical" : "high",
        title: `${open.length} open pricing issue${open.length === 1 ? "" : "s"}`,
        body: [
          missingInv.length ? `${missingInv.length} missing invoice` : null,
          zeroPrice.length ? `${zeroPrice.length} $0 / bid needs price` : null,
          high.length ? `${high.length} high severity` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "Review on Punchlist",
        action: { type: "open_discrepancy", refId: open[0]?.id },
        createdAt: now,
      });
    }

    for (const d of [...critical, ...high].slice(0, 4)) {
      suggestions.push({
        id: `disc-${d.id}`,
        agent: "InvoiceAccuracyAgent",
        severity: d.severity,
        title:
          d.type === "missing_invoice"
            ? "Missing invoice"
            : d.type === "zero_or_missing"
              ? "Price required ($0)"
              : d.type === "bid_needs_price"
                ? "Bid needs a price"
                : "Price variance",
        body: d.explanation,
        action: { type: "open_discrepancy", refId: d.id },
        createdAt: now,
      });
    }
  } catch (err) {
    logger.warn({ err }, "InvoiceAccuracyAgent failed");
  }

  lastSuggestions = suggestions;
  lastRunAt = Date.now();
  return suggestions;
}
