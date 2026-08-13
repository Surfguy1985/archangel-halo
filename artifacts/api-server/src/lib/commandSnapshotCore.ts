/**
 * Command snapshot isolation (pure). Retrieval is the security boundary —
 * the system prompt is not.
 */

import { primaryRole, type HaloIdentity } from "./enforcerCore";

export type SnapshotPropertyScope =
  | { mode: "tenant" }
  | { mode: "property"; propertyIds: string[] };

export function snapshotPropertyScope(identity: HaloIdentity | undefined): SnapshotPropertyScope {
  if (!identity) return { mode: "tenant" };
  if (identity.source === "pm_live") {
    return identity.propertyId
      ? { mode: "property", propertyIds: [identity.propertyId] }
      : { mode: "property", propertyIds: [] };
  }
  const role = primaryRole(identity);
  if (role === "property_manager" || role === "vendor" || role === "crew") {
    return identity.propertyId
      ? { mode: "property", propertyIds: [identity.propertyId] }
      : { mode: "property", propertyIds: [] };
  }
  return { mode: "tenant" };
}

export function filterBySnapshotScope<T extends { propertyId?: string | null }>(
  rows: readonly T[],
  scope: SnapshotPropertyScope,
): T[] {
  if (scope.mode === "tenant") return [...rows];
  const allow = new Set(scope.propertyIds);
  return rows.filter((r) => typeof r.propertyId === "string" && allow.has(r.propertyId));
}

export function filterPropertiesByScope<T extends { id: string }>(
  rows: readonly T[],
  scope: SnapshotPropertyScope,
): T[] {
  if (scope.mode === "tenant") return [...rows];
  const allow = new Set(scope.propertyIds);
  return rows.filter((r) => allow.has(r.id));
}

export function snapshotContainsPropertyId(
  snapshot: unknown,
  foreignPropertyId: string,
): boolean {
  return JSON.stringify(snapshot).toLowerCase().includes(foreignPropertyId.toLowerCase());
}
