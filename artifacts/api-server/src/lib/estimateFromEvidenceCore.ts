/**
 * estimate.from_evidence — deterministic line extraction + catalog match.
 * Drafts only. Never creates invoices.
 */

import { matchCatalogItem, type CatalogCandidate, type CatalogMatch } from "./catalogMatchCore";

export interface ExtractedLine {
  description: string;
  amount: number | null;
  qty: number;
  unit: string | null;
}

export interface DraftEstimateLine extends ExtractedLine {
  match: CatalogMatch | null;
  suggestedRate: number | null;
}

const MONEY_RE = /\$?\s?([0-9]{1,3}(?:[,0-9]*)(?:\.[0-9]{1,2})?)\s*$/;
const TOTAL_RE = /^(grand\s*total|total|amount\s*due|sub\s*total|subtotal|tax|sales\s*tax)\b/i;
const SKIP_RE =
  /^(date|bid\s*date|valid|good\s*through|proposal|estimate|quote|page\s+\d+|ph(one)?[:\s]|email[:\s]|address[:\s]|thank|signed|signature)\b/i;
const QTY_RE = /^(.*?)[\s\u00A0]+(\d+(?:\.\d+)?)\s*(sf|lf|sq\s*ft|ft|ea|hr|hrs|ton|cy|day|days|lot|each)\s*$/i;

function parseMoney(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function heuristicExtractLines(text: string): ExtractedLine[] {
  const lines = text
    .replace(/^---\s*[A-Z ]+\s*---\s*$/gm, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: ExtractedLine[] = [];
  for (const line of lines) {
    if (TOTAL_RE.test(line) || SKIP_RE.test(line)) continue;
    const money = MONEY_RE.exec(line);
    if (!money || line.length <= money[0].length + 3) continue;
    const amount = parseMoney(money[1]);
    if (amount == null || amount <= 0 || amount >= 10_000_000) continue;
    let description = line.slice(0, line.length - money[0].length).trim();
    if (!description || /^(price|amount|total|qty|description)\b/i.test(description)) continue;
    let qty = 1;
    let unit: string | null = null;
    const tail = QTY_RE.exec(description);
    if (tail) {
      description = tail[1]!.trim();
      qty = Number(tail[2]) || 1;
      unit = tail[3]!.toLowerCase().replace(/\s+/g, "");
    }
    out.push({ description, amount, qty, unit });
  }
  return out.slice(0, 80);
}

/** Walk captures → draft lines when there is no bid text. */
export function linesFromWalkCaptures(
  captures: { service: string | null; qty: number | null; unitPrice: number | null; note: string | null }[],
): ExtractedLine[] {
  const byService = new Map<string, ExtractedLine>();
  for (const c of captures) {
    const description = (c.service ?? c.note ?? "").trim();
    if (!description) continue;
    const qty = c.qty && c.qty > 0 ? c.qty : 1;
    const cur = byService.get(description);
    if (cur) {
      cur.qty += qty;
      if (cur.amount == null && c.unitPrice != null) cur.amount = c.unitPrice;
    } else {
      byService.set(description, {
        description,
        amount: c.unitPrice,
        qty,
        unit: null,
      });
    }
  }
  return [...byService.values()];
}

export function draftEstimateFromLines(
  lines: ExtractedLine[],
  catalog: readonly CatalogCandidate[],
): DraftEstimateLine[] {
  return lines.map((line) => {
    const match = matchCatalogItem(line.description, catalog);
    return {
      ...line,
      match,
      suggestedRate: match?.rate ?? line.amount,
    };
  });
}

export function estimateHeadline(lines: DraftEstimateLine[]): string {
  if (lines.length === 0) return "No billable lines found in the evidence.";
  const matched = lines.filter((l) => l.match).length;
  return `${lines.length} draft line${lines.length === 1 ? "" : "s"} (${matched} catalog match${matched === 1 ? "" : "es"}). Not an invoice.`;
}
