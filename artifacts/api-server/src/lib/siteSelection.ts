/**
 * Shared live selection — MapKit ↔ Unity ↔ web twin.
 * In-memory per property; SSE clients get updates.
 */
export type SiteSelection = {
  propertyId: string;
  building: number | null;
  unitNo: string | null;
  jobId: string | null;
  crewId: string | null;
  source: string;
  at: string;
};

const byProperty = new Map<string, SiteSelection>();
const listeners = new Map<string, Set<(s: SiteSelection) => void>>();

export function getSelection(propertyId: string): SiteSelection | null {
  return byProperty.get(propertyId) || null;
}

export function setSelection(
  propertyId: string,
  partial: Partial<Omit<SiteSelection, "propertyId" | "at">> & { source?: string },
): SiteSelection {
  const next: SiteSelection = {
    propertyId,
    building: partial.building ?? null,
    unitNo: partial.unitNo ?? null,
    jobId: partial.jobId ?? null,
    crewId: partial.crewId ?? null,
    source: partial.source || "api",
    at: new Date().toISOString(),
  };
  byProperty.set(propertyId, next);
  const set = listeners.get(propertyId);
  if (set) for (const fn of set) try { fn(next); } catch { /* */ }
  return next;
}

export function subscribeSelection(propertyId: string, fn: (s: SiteSelection) => void): () => void {
  if (!listeners.has(propertyId)) listeners.set(propertyId, new Set());
  listeners.get(propertyId)!.add(fn);
  return () => listeners.get(propertyId)?.delete(fn);
}
