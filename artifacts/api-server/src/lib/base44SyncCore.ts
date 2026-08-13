/**
 * Pure Base44 ingest policy.
 *
 * No I/O. The live sync adapter fetches, then applies this planner, then
 * persists. Every Phase 1 acceptance case is covered here so it can be
 * proven without a database or the real Base44 host.
 */

import { createHash } from "node:crypto";

export const BASE44_RESOURCES = [
  "properties",
  "units",
  "crews",
  "calendar_slots",
  "crew_jobs",
  "invoices",
  "payment_requests",
  "price_items",
  "owners",
  "field_submissions",
  "photos",
  "approvals",
  "crew_rates",
  "reminders",
] as const;

export type Base44Resource = (typeof BASE44_RESOURCES)[number];

const RESOURCE_ALIASES: Record<string, Base44Resource> = {
  properties: "properties",
  property: "properties",
  units: "units",
  unit: "units",
  crews: "crews",
  crew: "crews",
  calendar_slots: "calendar_slots",
  calendarslots: "calendar_slots",
  calendars: "calendar_slots",
  crew_jobs: "crew_jobs",
  crewjobs: "crew_jobs",
  invoices: "invoices",
  invoice: "invoices",
  payment_requests: "payment_requests",
  paymentrequests: "payment_requests",
  price_items: "price_items",
  priceitems: "price_items",
  owners: "owners",
  owner: "owners",
  field_submissions: "field_submissions",
  fieldsubmissions: "field_submissions",
  fieldsubmission: "field_submissions",
  photos: "photos",
  field_photos: "photos",
  approvals: "approvals",
  approval: "approvals",
  crew_rates: "crew_rates",
  crewrates: "crew_rates",
  crewrate: "crew_rates",
  reminders: "reminders",
  reminder: "reminders",
};

export type CollectionPresence = "missing" | "empty" | "present";

export type Freshness = "fresh" | "delayed" | "stale" | "unavailable";

export type SyncErrorCode =
  | "token_missing"
  | "token_invalid"
  | "timeout"
  | "http_500"
  | "http_error"
  | "malformed"
  | "network"
  | null;

export type ProjectionKind =
  | "property"
  | "unit"
  | "crew"
  | "dispatch"
  | "crew_job"
  | "invoice"
  | "payment_request"
  | "price_item"
  | "owner"
  | "before"
  | "after"
  | "progress"
  | "summary"
  | "qc"
  | "rework"
  | "approval"
  | "rate"
  | "reminder"
  | "note";

export interface ProjectionRecord {
  resource: Base44Resource;
  base44Id: string;
  kind: ProjectionKind;
  propertyName: string | null;
  unitLabel: string | null;
  title: string | null;
  body: string | null;
  mediaUrl: string | null;
  occurredAt: string | null;
  sourceUpdatedAt: string | null;
  payloadHash: string;
}

export interface MapEntry {
  resource: string;
  base44Id: string;
  status: "active" | "stale";
  payloadHash: string;
  lastSeenAt: string;
  staleAt: string | null;
  sourceUpdatedAt: string | null;
}

export interface IngestState {
  maps: Map<string, MapEntry>;
}

export interface ResourceStats {
  created: number;
  updated: number;
  unchanged: number;
  stale: number;
  errors: number;
  skipped: number;
  applied: boolean;
}

export interface IngestResult {
  state: IngestState;
  records: ProjectionRecord[];
  resources: Record<string, ResourceStats>;
  totalCreated: number;
  totalUpdated: number;
  totalUnchanged: number;
  totalStale: number;
  totalErrors: number;
}

export const FRESH_MS = 2 * 60 * 1000;
export const DELAYED_MS = 15 * 60 * 1000;

export function mapKey(resource: string, base44Id: string): string {
  return `${resource}\0${base44Id}`;
}

export function canonicalResource(raw: string): Base44Resource | null {
  const key = raw.trim().toLowerCase().replace(/[\s-]/g, "_");
  return RESOURCE_ALIASES[key] ?? RESOURCE_ALIASES[key.replace(/s$/, "")] ?? null;
}

export function extractBase44Id(rec: unknown): string | null {
  if (!rec || typeof rec !== "object") return null;
  const r = rec as Record<string, unknown>;
  const id = r._id ?? r.id ?? r.base44_id ?? r.base44Id;
  if (typeof id === "string" && id.trim()) return id.trim();
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  return null;
}

export function collectionPresence(value: unknown): CollectionPresence {
  if (value === undefined || value === null) return "missing";
  if (!Array.isArray(value)) return "missing";
  return value.length === 0 ? "empty" : "present";
}

/**
 * Empty and missing collections must NEVER prune. A successful non-empty
 * collection may mark absent mapped ids as stale (not deleted).
 */
export function shouldMarkStale(presence: CollectionPresence): boolean {
  return presence === "present";
}

export function shouldApplyCollection(presence: CollectionPresence): boolean {
  return presence === "present";
}

export function classifyHttpStatus(status: number): SyncErrorCode {
  if (status === 401 || status === 403) return "token_invalid";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500) return "http_500";
  if (status >= 400) return "http_error";
  return null;
}

export function classifyFetchFailure(err: unknown): SyncErrorCode {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
  const msg = err instanceof Error ? err.message : String(err);
  if (name === "AbortError" || /timeout/i.test(msg)) return "timeout";
  if (/HALO_READ_TOKEN not set|token missing/i.test(msg)) return "token_missing";
  if (/401|403|invalid token/i.test(msg)) return "token_invalid";
  if (/malformed|not json|unexpected/i.test(msg)) return "malformed";
  if (/500|502|503/i.test(msg)) return "http_500";
  return "network";
}

export function computeFreshness(
  lastSuccessAt: Date | null,
  lastErrorCode: SyncErrorCode,
  now: Date,
): Freshness {
  if (!lastSuccessAt) return "unavailable";
  if (lastErrorCode === "token_missing" || lastErrorCode === "token_invalid") {
    return "unavailable";
  }
  const age = now.getTime() - lastSuccessAt.getTime();
  if (age <= FRESH_MS) return "fresh";
  if (age <= DELAYED_MS) return "delayed";
  return "stale";
}

export function retryDelayMs(
  attempt: number,
  opts: { baseMs?: number; factor?: number; capMs?: number; jitter?: () => number } = {},
): number {
  const baseMs = opts.baseMs ?? 200;
  const factor = opts.factor ?? 2;
  const capMs = opts.capMs ?? 5_000;
  const jitter = opts.jitter ?? Math.random;
  const exp = Math.min(capMs, baseMs * factor ** attempt);
  const j = jitter();
  return Math.round(exp * (0.5 + j * 0.5));
}

export function shouldRetry(code: SyncErrorCode, attempt: number, maxAttempts = 4): boolean {
  if (attempt >= maxAttempts) return false;
  if (code === "token_missing" || code === "token_invalid" || code === "malformed") return false;
  return code === "timeout" || code === "http_500" || code === "network" || code === "http_error";
}

export function payloadHash(fields: unknown): string {
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex").slice(0, 32);
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function iso(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function kindForResource(resource: Base44Resource, rec: Record<string, unknown>): ProjectionKind {
  if (resource === "field_submissions") {
    const raw = String(rec.kind ?? rec.type ?? rec.phase ?? rec.qc_status ?? rec.inspection_status ?? "")
      .toLowerCase();
    if (raw.includes("before")) return "before";
    if (raw.includes("after")) return "after";
    if (raw.includes("rework")) return "rework";
    if (raw.includes("qc") || raw.includes("inspect")) return "qc";
    if (raw.includes("summary") || raw.includes("note")) return "summary";
    if (rec.rework || rec.rework_notes) return "rework";
    return "summary";
  }
  if (resource === "photos") {
    const raw = String(rec.kind ?? rec.phase ?? rec.type ?? "").toLowerCase();
    if (raw.includes("before")) return "before";
    if (raw.includes("after")) return "after";
    return "progress";
  }
  const table: Record<Base44Resource, ProjectionKind> = {
    properties: "property",
    units: "unit",
    crews: "crew",
    calendar_slots: "dispatch",
    crew_jobs: "crew_job",
    invoices: "invoice",
    payment_requests: "payment_request",
    price_items: "price_item",
    owners: "owner",
    field_submissions: "summary",
    photos: "progress",
    approvals: "approval",
    crew_rates: "rate",
    reminders: "reminder",
  };
  return table[resource];
}

function mediaUrl(rec: Record<string, unknown>): string | null {
  return (
    str(rec.url) ??
    str(rec.src) ??
    str(rec.photo_url) ??
    str(rec.image_url) ??
    str(rec.file_url) ??
    str(rec.storage_url)
  );
}

export function normalizeRecord(resource: Base44Resource, rec: Record<string, unknown>): ProjectionRecord | null {
  const base44Id = extractBase44Id(rec);
  if (!base44Id) return null;
  const propertyName =
    str(rec.property) ??
    str(rec.property_name) ??
    str((rec.property as { name?: unknown } | undefined)?.name);
  const unitLabel =
    str(rec.unit_number) ??
    str(rec.unit_no) ??
    str(rec.unitNo) ??
    str(rec.label) ??
    str(rec.unit);
  const title =
    str(rec.title) ??
    str(rec.name) ??
    str(rec.invoice_number) ??
    str(rec.service) ??
    str(rec.summary);
  const body =
    str(rec.rework_notes) ??
    str(rec.notes) ??
    str(rec.summary) ??
    str(rec.body) ??
    str(rec.observations) ??
    str(rec.scope_summary) ??
    str(rec.description);
  const sourceUpdatedAt = iso(rec.updated_at ?? rec.updatedAt ?? rec.modified_at ?? rec.created_at);
  const occurredAt = iso(
    rec.submitted_at ?? rec.occurred_at ?? rec.date ?? rec.created_at ?? rec.createdAt,
  );
  const kind = kindForResource(resource, rec);
  const fields = {
    resource,
    base44Id,
    kind,
    propertyName,
    unitLabel,
    title,
    body,
    mediaUrl: mediaUrl(rec),
    occurredAt,
    sourceUpdatedAt,
  };
  return { ...fields, payloadHash: payloadHash(fields) };
}

export function expandNestedEvidence(rec: Record<string, unknown>): ProjectionRecord[] {
  const parent = normalizeRecord("field_submissions", rec);
  if (!parent) return [];
  const out: ProjectionRecord[] = [parent];
  const groups: Array<{ key: string; kind: ProjectionKind }> = [
    { key: "before_photos", kind: "before" },
    { key: "after_photos", kind: "after" },
    { key: "photos", kind: parent.kind === "before" || parent.kind === "after" ? parent.kind : "progress" },
  ];
  for (const g of groups) {
    const arr = rec[g.key];
    if (!Array.isArray(arr)) continue;
    arr.forEach((item, idx) => {
      const obj = typeof item === "string" ? { url: item, _id: `${parent.base44Id}:${g.kind}:${idx}` } : item;
      if (!obj || typeof obj !== "object") return;
      const nested = normalizeRecord("photos", {
        ...(obj as Record<string, unknown>),
        _id:
          extractBase44Id(obj) ??
          `${parent.base44Id}:${g.kind}:${idx}`,
        property: rec.property,
        unit_number: rec.unit_number ?? rec.unit_no,
        phase: g.kind,
      });
      if (nested) out.push({ ...nested, kind: g.kind });
    });
  }
  if (rec.rework_notes || rec.rework) {
    const rework = normalizeRecord("field_submissions", {
      ...rec,
      _id: `${parent.base44Id}:rework`,
      kind: "rework",
      notes: rec.rework_notes ?? rec.rework,
    });
    if (rework) out.push({ ...rework, kind: "rework" });
  }
  return out;
}

export interface ParsedSnapshot {
  ok: true;
  collections: Partial<Record<Base44Resource, unknown[]>>;
  presence: Record<Base44Resource, CollectionPresence>;
}

export interface ParseFailure {
  ok: false;
  code: "malformed";
}

export function parseBase44Body(body: unknown): ParsedSnapshot | ParseFailure {
  if (!body || typeof body !== "object") return { ok: false, code: "malformed" };
  const root = body as Record<string, unknown>;
  const data = (root.data && typeof root.data === "object" ? root.data : root) as Record<string, unknown>;
  const collections: ParsedSnapshot["collections"] = {};
  const presence = {} as Record<Base44Resource, CollectionPresence>;
  for (const r of BASE44_RESOURCES) presence[r] = "missing";

  for (const [rawKey, value] of Object.entries(data)) {
    const resource = canonicalResource(rawKey);
    if (!resource) continue;
    if (!Array.isArray(value)) {
      // A non-array under a known key is malformed for that collection — skip it.
      continue;
    }
    collections[resource] = value;
    presence[resource] = collectionPresence(value);
  }
  return { ok: true, collections, presence };
}

function emptyStats(): ResourceStats {
  return { created: 0, updated: 0, unchanged: 0, stale: 0, errors: 0, skipped: 0, applied: false };
}

export function applyIngest(
  prev: IngestState,
  parsed: ParsedSnapshot,
  now: Date,
): IngestResult {
  const maps = new Map(prev.maps);
  const records: ProjectionRecord[] = [];
  const resources: Record<string, ResourceStats> = {};
  const nowIso = now.toISOString();

  for (const resource of BASE44_RESOURCES) {
    const stats = emptyStats();
    const presence = parsed.presence[resource];
    const rawList = parsed.collections[resource];
    if (!shouldApplyCollection(presence) || !rawList) {
      resources[resource] = stats;
      continue;
    }
    stats.applied = true;
    const seen = new Set<string>();
    const expanded: ProjectionRecord[] = [];

    for (const item of rawList) {
      if (!item || typeof item !== "object") {
        stats.errors += 1;
        continue;
      }
      const rec = item as Record<string, unknown>;
      const id = extractBase44Id(rec);
      if (!id) {
        stats.errors += 1;
        continue;
      }
      if (seen.has(id)) {
        // Duplicate in one payload: last write wins; do not double-count create.
        stats.skipped += 1;
      }
      seen.add(id);
      if (resource === "field_submissions") {
        expanded.push(...expandNestedEvidence(rec));
      } else {
        const norm = normalizeRecord(resource, rec);
        if (!norm) {
          stats.errors += 1;
          continue;
        }
        expanded.push(norm);
      }
    }

    const appliedIds = new Set<string>();
    for (const row of expanded) {
      const k = mapKey(row.resource, row.base44Id);
      appliedIds.add(k);
      records.push(row);
      const existing = maps.get(k);
      if (!existing) {
        maps.set(k, {
          resource: row.resource,
          base44Id: row.base44Id,
          status: "active",
          payloadHash: row.payloadHash,
          lastSeenAt: nowIso,
          staleAt: null,
          sourceUpdatedAt: row.sourceUpdatedAt,
        });
        if (row.resource === resource) stats.created += 1;
      } else if (existing.payloadHash === row.payloadHash && existing.status === "active") {
        maps.set(k, { ...existing, lastSeenAt: nowIso, staleAt: null, status: "active" });
        if (row.resource === resource) stats.unchanged += 1;
      } else {
        maps.set(k, {
          ...existing,
          status: "active",
          payloadHash: row.payloadHash,
          lastSeenAt: nowIso,
          staleAt: null,
          sourceUpdatedAt: row.sourceUpdatedAt,
        });
        if (row.resource === resource) stats.updated += 1;
      }
    }

    if (shouldMarkStale(presence)) {
      for (const [k, entry] of maps) {
        if (entry.resource !== resource) continue;
        if (appliedIds.has(k)) continue;
        if (entry.status === "stale") continue;
        maps.set(k, { ...entry, status: "stale", staleAt: nowIso });
        stats.stale += 1;
      }
    }

    resources[resource] = stats;
  }

  const totals = Object.values(resources).reduce(
    (acc, s) => {
      acc.totalCreated += s.created;
      acc.totalUpdated += s.updated;
      acc.totalUnchanged += s.unchanged;
      acc.totalStale += s.stale;
      acc.totalErrors += s.errors;
      return acc;
    },
    { totalCreated: 0, totalUpdated: 0, totalUnchanged: 0, totalStale: 0, totalErrors: 0 },
  );

  return { state: { maps }, records, resources, ...totals };
}

export function cloneState(state: IngestState): IngestState {
  return { maps: new Map(state.maps) };
}
