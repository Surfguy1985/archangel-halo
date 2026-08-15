/**
 * Base44 Work App before/after photos, grouped by unit for the client board.
 *
 * Evidence rows store property/unit names, not UUIDs. Match them onto the
 * portfolio's properties. Do not invent a second photo store.
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, base44EvidenceTable } from "@workspace/db";

export type PortfolioUnitPhoto = {
  id: string;
  url: string;
  occurredAt: string | null;
  title: string | null;
};

export type PortfolioUnitPhotoPair = {
  propertyId: string | null;
  propertyName: string;
  unitNumber: string;
  before: PortfolioUnitPhoto[];
  after: PortfolioUnitPhoto[];
};

export type EvidencePhotoRow = {
  id: string;
  kind: string;
  propertyName: string | null;
  unitLabel: string | null;
  title: string | null;
  mediaUrl: string | null;
  occurredAt: Date | string | null;
};

const MAX_UNITS = 200;
const MAX_PER_SIDE = 8;

export function normalizeSiteKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/^caf\s+demo\s*[—–-]\s*/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeUnitKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/^(unit|apt|apartment|#)\s*/i, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function matchPropertyId(
  propertyName: string | null,
  properties: Array<{ id: string; name: string }>,
): string | null {
  if (!propertyName) return null;
  const key = normalizeSiteKey(propertyName);
  if (!key) return null;
  const exact = properties.find((p) => normalizeSiteKey(p.name) === key);
  if (exact) return exact.id;
  const loose = properties.filter((p) => {
    const pk = normalizeSiteKey(p.name);
    if (!pk) return false;
    return pk.includes(key) || key.includes(pk);
  });
  return loose.length === 1 ? loose[0].id : null;
}

function toPhoto(row: EvidencePhotoRow): PortfolioUnitPhoto | null {
  const url = row.mediaUrl?.trim() ?? "";
  if (!url || !isHttpUrl(url)) return null;
  const occurred =
    row.occurredAt instanceof Date
      ? row.occurredAt.toISOString()
      : typeof row.occurredAt === "string"
        ? row.occurredAt
        : null;
  return {
    id: row.id,
    url,
    occurredAt: occurred,
    title: row.title,
  };
}

export function groupUnitPhotos(
  rows: EvidencePhotoRow[],
  properties: Array<{ id: string; name: string }>,
): PortfolioUnitPhotoPair[] {
  const names = new Map(properties.map((p) => [p.id, p.name]));
  const buckets = new Map<
    string,
    { propertyId: string; unitNumber: string; before: PortfolioUnitPhoto[]; after: PortfolioUnitPhoto[] }
  >();

  for (const row of rows) {
    if (row.kind !== "before" && row.kind !== "after") continue;
    const propertyId = matchPropertyId(row.propertyName, properties);
    if (!propertyId) continue;
    const unitNumber = (row.unitLabel ?? "").trim();
    if (!unitNumber) continue;
    const unitKey = normalizeUnitKey(unitNumber);
    if (!unitKey) continue;
    const photo = toPhoto(row);
    if (!photo) continue;
    const key = `${propertyId}::${unitKey}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        propertyId,
        unitNumber,
        before: [],
        after: [],
      };
      buckets.set(key, bucket);
    }
    if (row.kind === "before") bucket.before.push(photo);
    else bucket.after.push(photo);
  }

  const newer = (a: PortfolioUnitPhoto, b: PortfolioUnitPhoto) =>
    (b.occurredAt ?? "").localeCompare(a.occurredAt ?? "");

  const units = [...buckets.values()].map((bucket) => ({
    propertyId: bucket.propertyId,
    propertyName: names.get(bucket.propertyId) ?? "Property",
    unitNumber: bucket.unitNumber,
    before: bucket.before.sort(newer).slice(0, MAX_PER_SIDE),
    after: bucket.after.sort(newer).slice(0, MAX_PER_SIDE),
  }));

  units.sort((a, b) => {
    const bySite = a.propertyName.localeCompare(b.propertyName);
    if (bySite !== 0) return bySite;
    return a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true });
  });

  return units.slice(0, MAX_UNITS);
}

export async function computePortfolioUnitPhotos(args: {
  properties: Array<{ id: string; name: string }>;
}): Promise<PortfolioUnitPhotoPair[]> {
  if (args.properties.length === 0) return [];
  const rows = await db
    .select({
      id: base44EvidenceTable.id,
      kind: base44EvidenceTable.kind,
      propertyName: base44EvidenceTable.propertyName,
      unitLabel: base44EvidenceTable.unitLabel,
      title: base44EvidenceTable.title,
      mediaUrl: base44EvidenceTable.mediaUrl,
      occurredAt: base44EvidenceTable.occurredAt,
    })
    .from(base44EvidenceTable)
    .where(
      and(
        inArray(base44EvidenceTable.kind, ["before", "after"]),
        eq(base44EvidenceTable.stale, false),
        isNotNull(base44EvidenceTable.mediaUrl),
      ),
    );
  return groupUnitPhotos(rows, args.properties);
}
