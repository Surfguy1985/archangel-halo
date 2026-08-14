/**
 * Pure Jarvis matching for HALO Command.
 * Resolves people, units, relative dates, and material vendors from live records.
 * No I/O — keep this testable without a database.
 */

export interface NamedRecord {
  id: string;
  name: string;
}

export interface UnitJobCandidate {
  id: string;
  jobNo: string;
  unitNo: string | null;
  propertyId: string;
  propertyName: string;
  status: string;
  scheduledOn: string | null;
}

export interface MaterialCandidate {
  id: string;
  name: string;
  kind: "catalog" | "inventory" | "price";
  qty?: number | null;
  unit?: string | null;
  rate?: number | null;
  preferredVendor?: string | null;
}

export interface VendorCandidate {
  id: string;
  name: string;
  trade: string | null;
  phone: string | null;
  city?: string | null;
}

export interface PersonMatch<T extends NamedRecord> {
  record: T;
  score: number;
}

export function localYmd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Tomorrow / today / weekday from operator language. Uses local date parts. */
export function resolveRelativeDate(text: string, now = new Date()): string | null {
  const lower = text.toLowerCase();
  const ymd = (offsetDays: number) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
    return localYmd(d);
  };
  if (/\btoday\b/.test(lower)) return ymd(0);
  if (/\btomorrow\b/.test(lower)) return ymd(1);
  if (/\bday after tomorrow\b/.test(lower)) return ymd(2);
  const iso = lower.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const md = lower.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (md) {
    const month = Number(md[1]);
    const day = Number(md[2]);
    const year = md[3] ? (md[3].length === 2 ? 2000 + Number(md[3]) : Number(md[3])) : now.getFullYear();
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return localYmd(new Date(year, month - 1, day));
    }
  }
  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  for (let i = 0; i < weekdays.length; i++) {
    if (new RegExp(`\\b${weekdays[i]}\\b`).test(lower)) {
      const delta = (i - now.getDay() + 7) % 7 || 7;
      return ymd(delta);
    }
  }
  return null;
}

export function normalizePerson(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Token overlap + prefix/contains. "Kyann" matches "Kyann Brooks". */
export function personScore(query: string, name: string): number {
  const q = normalizePerson(query);
  const n = normalizePerson(name);
  if (!q || !n) return 0;
  if (q === n) return 1;
  const qTokens = q.split(" ").filter(Boolean);
  const nTokens = n.split(" ").filter(Boolean);
  if (qTokens.length === 1) {
    const t = qTokens[0]!;
    if (nTokens.some((nt) => nt === t)) return 0.95;
    if (nTokens.some((nt) => nt.startsWith(t) && t.length >= 3)) return 0.82;
    if (n.includes(t) && t.length >= 4) return 0.7;
    return 0;
  }
  const hits = qTokens.filter((t) => nTokens.some((nt) => nt === t || (t.length >= 3 && nt.startsWith(t))));
  return hits.length / qTokens.length;
}

export function matchPerson<T extends NamedRecord>(
  query: string,
  records: readonly T[],
  minScore = 0.7,
): PersonMatch<T> | null {
  let best: PersonMatch<T> | null = null;
  for (const record of records) {
    const score = personScore(query, record.name);
    if (score >= minScore && (!best || score > best.score)) best = { record, score };
  }
  return best;
}

export function extractUnitLabel(text: string): string | null {
  const m = text.match(/\bunit\s*#?\s*([A-Za-z0-9-]{1,12})\b/i);
  if (m) return m[1]!.toUpperCase();
  const hash = text.match(/\b#\s*([A-Za-z0-9-]{1,12})\b/);
  return hash ? hash[1]!.toUpperCase() : null;
}

export function matchUnitJob(
  unitLabel: string,
  jobs: readonly UnitJobCandidate[],
): UnitJobCandidate | null {
  const want = unitLabel.replace(/^#/, "").toUpperCase();
  const open = jobs.filter((j) => !["complete", "paid", "cancelled"].includes(j.status));
  const pool = open.length ? open : jobs;
  const exact = pool.find((j) => (j.unitNo ?? "").replace(/^#/, "").toUpperCase() === want);
  if (exact) return exact;
  return pool.find((j) => (j.unitNo ?? "").toUpperCase().includes(want)) ?? null;
}

function materialTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 2 && !["the", "and", "for", "with", "order"].includes(t));
}

export function materialScore(query: string, name: string): number {
  const q = materialTokens(query);
  const n = new Set(materialTokens(name));
  if (q.length === 0 || n.size === 0) return 0;
  const hits = q.filter((t) => [...n].some((nt) => nt === t || nt.includes(t) || t.includes(nt)));
  return hits.length / q.length;
}

export function sourceMaterials(
  query: string,
  catalog: readonly MaterialCandidate[],
  limit = 5,
): MaterialCandidate[] {
  return catalog
    .map((c) => ({ c, score: materialScore(query, c.name) }))
    .filter((x) => x.score >= 0.34)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.c);
}

const TRADE_HINTS: Record<string, string[]> = {
  drywall: ["drywall", "sheetrock", "gypsum", "building supply", "lumber", "materials"],
  paint: ["paint", "coating", "benjamin", "sherwin"],
  plumbing: ["plumb", "pipe", "supply house"],
  electrical: ["electr", "lighting"],
  flooring: ["floor", "carpet", "lvp"],
  hvac: ["hvac", "mechanical"],
};

export function sourceVendors(
  materialQuery: string,
  vendors: readonly VendorCandidate[],
  propertyCity?: string | null,
  limit = 4,
): VendorCandidate[] {
  const q = materialQuery.toLowerCase();
  let hints: string[] = [];
  for (const [key, words] of Object.entries(TRADE_HINTS)) {
    if (q.includes(key) || words.some((w) => q.includes(w))) hints = words;
  }
  const scored = vendors.map((v) => {
    const blob = `${v.name} ${v.trade ?? ""} ${v.city ?? ""}`.toLowerCase();
    let score = 0;
    if (hints.some((h) => blob.includes(h))) score += 0.7;
    if (materialScore(materialQuery, `${v.name} ${v.trade ?? ""}`) >= 0.34) score += 0.4;
    if (propertyCity && (v.city ?? "").toLowerCase().includes(propertyCity.toLowerCase())) score += 0.2;
    return { v, score };
  });
  return scored
    .filter((x) => x.score >= 0.4)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.v);
}

export function formatOrderPacket(opts: {
  material: string;
  unitNo: string | null;
  propertyName: string | null;
  city: string | null;
  neededBy: string | null;
  materials: MaterialCandidate[];
  vendors: VendorCandidate[];
}): string {
  const where = [opts.propertyName, opts.unitNo ? `Unit ${opts.unitNo}` : null].filter(Boolean).join(" · ");
  const lines: string[] = [
    `ORDER REQUEST — ${opts.material.toUpperCase()}`,
    where || "Property TBD",
    opts.city ? `Near ${opts.city}` : "",
    opts.neededBy ? `Needed by ${opts.neededBy}` : "",
    "",
    "Sourced from HALO catalog / inventory:",
    ...(opts.materials.length
      ? opts.materials.map((m) => {
          const qty = m.qty != null ? ` · on hand ${m.qty}` : "";
          const rate = m.rate != null ? ` · $${m.rate}` : "";
          return `• ${m.name}${qty}${rate}`;
        })
      : ["• No catalog match — flag for purchasing"]),
    "",
    "Nearby / preferred vendors:",
    ...(opts.vendors.length
      ? opts.vendors.map((v) => `• ${v.name}${v.trade ? ` (${v.trade})` : ""}${v.phone ? ` · ${v.phone}` : ""}`)
      : ["• No vendor match — office to source"]),
  ];
  return lines.filter((l) => l.length > 0 || l === "").join("\n");
}
