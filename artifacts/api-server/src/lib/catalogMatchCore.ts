/**
 * HALO catalog.lookup — token Jaccard with size-token boost.
 * Matches against HALO catalog_items / price_items. Does not import CrewBase cost_items.
 */

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "for",
  "with",
  "to",
  "in",
  "on",
  "at",
  "per",
  "each",
  "lf",
  "sf",
  "sq",
  "ft",
  "ea",
  "by",
  "x",
]);

const SIZE_RE = /\b(\d+(?:[\/.]\d+)?(?:x\d+(?:[\/.]\d+)?){1,2})\b/gi;

export const CATALOG_MATCH_THRESHOLD = 0.4;

export interface CatalogCandidate {
  id: string;
  name: string;
  unit: string | null;
  rate: number | null;
  source: "price_item" | "catalog_item";
  aliases?: readonly string[];
}

export interface CatalogMatch {
  id: string;
  name: string;
  unit: string | null;
  rate: number | null;
  source: "price_item" | "catalog_item";
  score: number;
}

export function normalizeCatalogText(s: string): string {
  return s
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/[^a-z0-9\/.\-x ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s: string): string[] {
  return normalizeCatalogText(s)
    .split(" ")
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function sizeTokens(s: string): string[] {
  const out: string[] = [];
  const re = new RegExp(SIZE_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(s.toLowerCase())) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

export function catalogMatchScore(query: string, candidate: { name: string; aliases?: readonly string[] }): number {
  const qTokens = new Set(tokenize(query));
  if (qTokens.size === 0) return 0;
  const cTokens = new Set([...tokenize(candidate.name), ...(candidate.aliases ?? []).flatMap(tokenize)]);
  if (cTokens.size === 0) return 0;
  let overlap = 0;
  for (const t of qTokens) if (cTokens.has(t)) overlap++;
  const union = new Set([...qTokens, ...cTokens]).size;
  const jaccard = union === 0 ? 0 : overlap / union;

  const qSizes = new Set(sizeTokens(query));
  const cSizes = new Set([...sizeTokens(candidate.name), ...(candidate.aliases ?? []).flatMap(sizeTokens)]);
  let sizeBoost = 0;
  if (qSizes.size > 0 && cSizes.size > 0) {
    let sizeOverlap = 0;
    for (const t of qSizes) if (cSizes.has(t)) sizeOverlap++;
    sizeBoost = sizeOverlap > 0 ? 0.25 * (sizeOverlap / qSizes.size) : -0.2;
  }
  return Math.max(0, Math.min(1, jaccard + sizeBoost));
}

export function matchCatalogItem(
  description: string,
  catalog: readonly CatalogCandidate[],
  threshold = CATALOG_MATCH_THRESHOLD,
): CatalogMatch | null {
  if (!description.trim() || catalog.length === 0) return null;
  let best: CatalogMatch | null = null;
  for (const c of catalog) {
    const score = catalogMatchScore(description, { name: c.name, aliases: c.aliases });
    if (score < threshold) continue;
    if (!best || score > best.score) {
      best = {
        id: c.id,
        name: c.name,
        unit: c.unit,
        rate: c.rate,
        source: c.source,
        score,
      };
    }
  }
  return best;
}

export function matchCatalogTop(
  description: string,
  catalog: readonly CatalogCandidate[],
  limit = 5,
): CatalogMatch[] {
  const scored = catalog
    .map((c) => {
      const score = catalogMatchScore(description, { name: c.name, aliases: c.aliases });
      return {
        id: c.id,
        name: c.name,
        unit: c.unit,
        rate: c.rate,
        source: c.source,
        score,
      };
    })
    .filter((m) => m.score >= CATALOG_MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
