/**
 * Pure client-PO-intake resolution for HALO Command.
 *
 * The office says: "here's PO 12345 for unit 204 at Maple Ridge, send to vendor".
 * We must attach that PO to EXACTLY the right job. Resolution order:
 *   1. property   — by name / alias (normalized the same as the unit map)
 *   2. unit label — normalized the same as the unit map
 *   3. the unit's CURRENT live job (non-complete/paid/cancelled)
 *
 * If any step is ambiguous or unresolved we return a "clarify" outcome that
 * lists candidates and changes NOTHING. No I/O here — keep this testable.
 */

import { normalizeSiteKey, normalizeUnitKey } from "./portfolioUnitPhotos";

export interface PoPropertyCandidate {
  id: string;
  name: string;
  /** Optional alternate names/aliases the property is known by. */
  aliases?: readonly string[];
}

export interface PoJobCandidate {
  id: string;
  jobNo: string;
  unitNo: string | null;
  propertyId: string;
  status: string;
  crewLeaderId: string | null;
}

/** Terminal statuses that mean a job is no longer live and can't take a new PO. */
export const CLOSED_STATUSES = ["complete", "paid", "cancelled", "canceled"] as const;
const CLOSED_STATUS_SET = new Set<string>(CLOSED_STATUSES);

export function isLiveJob(job: { status: string }): boolean {
  return !CLOSED_STATUS_SET.has((job.status ?? "").toLowerCase());
}

/** Pulse + chat share one PO shape: trim, strip #, uppercase, short token. */
export function normalizePoNumber(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().replace(/^#+\s*/, "").toUpperCase();
  if (!t || t.length > 24) return null;
  if (!/^[A-Z0-9][A-Z0-9-]{0,23}$/.test(t)) return null;
  return t;
}

/**
 * Pull the PO number out of operator language.
 * Accepts "PO 12345", "PO# 12345", "PO-12345", "purchase order 12345",
 * and bare "12345" only when preceded by a PO cue elsewhere (caller decides).
 */
export function extractPoNumber(text: string): string | null {
  const m = text.match(
    /\b(?:p\.?\s*o\.?|purchase\s+order)\s*#?\s*[:-]?\s*([A-Za-z0-9][A-Za-z0-9-]{1,23})\b/i,
  );
  if (m) return m[1]!.toUpperCase();
  return null;
}

/**
 * Extract the unit label from operator language, reusing the same intent as the
 * unit map. Returns the raw label (not normalized) so callers can echo it back.
 */
export function extractUnitLabel(text: string): string | null {
  const m = text.match(/\b(?:unit|apt|apartment)\s*#?\s*([A-Za-z0-9-]{1,12})\b/i);
  if (m) return m[1]!.toUpperCase();
  const hash = text.match(/#\s*([A-Za-z0-9-]{1,12})\b/);
  return hash ? hash[1]!.toUpperCase() : null;
}

function siteKeys(p: PoPropertyCandidate): string[] {
  return [p.name, ...(p.aliases ?? [])]
    .map((n) => normalizeSiteKey(n))
    .filter((k) => k.length > 0);
}

/**
 * True when `key` appears in `hay` on token boundaries — i.e. `key`'s tokens
 * occur as a contiguous run of whole words, never as a substring inside a
 * larger word. `hay`/`key` are already space-normalized site keys.
 */
function tokenBoundaryMatch(hay: string, key: string): boolean {
  if (!key) return false;
  if (hay === key) return true;
  return (
    hay.startsWith(`${key} `) ||
    hay.endsWith(` ${key}`) ||
    hay.includes(` ${key} `)
  );
}

/**
 * Resolve which property the operator meant. A property matches only when its
 * normalized site key (or an alias) appears in the request text on *token
 * boundaries* — a name that merely appears inside an unrelated word never
 * matches. Returns all surviving matches so the caller can detect ambiguity
 * and clarify rather than guessing.
 */
export function matchProperties(
  text: string,
  properties: readonly PoPropertyCandidate[],
): PoPropertyCandidate[] {
  const hay = normalizeSiteKey(text);
  if (!hay) return [];
  const hits: Array<{ p: PoPropertyCandidate; len: number }> = [];
  for (const p of properties) {
    let best = 0;
    for (const key of siteKeys(p)) {
      if (tokenBoundaryMatch(hay, key)) best = Math.max(best, key.length);
    }
    if (best > 0) hits.push({ p, len: best });
  }
  if (hits.length === 0) return [];
  // Prefer the longest (most specific) key match; keep ties for ambiguity so
  // the caller clarifies instead of picking one.
  const max = Math.max(...hits.map((h) => h.len));
  return hits.filter((h) => h.len === max).map((h) => h.p);
}

export type PoResolution =
  | {
      ok: true;
      property: PoPropertyCandidate;
      unitLabel: string;
      /** normalizeUnitKey(unitLabel) — used by the guarded UPDATE to re-assert the unit. */
      normalizedUnitKey: string;
      job: PoJobCandidate;
    }
  | {
      ok: false;
      reason:
        | "no_po_number"
        | "no_property"
        | "ambiguous_property"
        | "no_unit"
        | "no_unit_job"
        | "no_live_job"
        | "ambiguous_job";
      message: string;
      /** Candidate labels the caller can list back to the operator. */
      candidates?: string[];
    };

export interface PoResolveInput {
  text: string;
  poNumber?: string | null;
  unitLabel?: string | null;
  properties: readonly PoPropertyCandidate[];
  /** All jobs, across properties. We scope by resolved property + unit. */
  jobs: readonly PoJobCandidate[];
}

/**
 * The full resolver: property → unit → current live job. Returns either an
 * unambiguous target or a clarify outcome. Never mutates anything.
 */
export function resolveClientPo(input: PoResolveInput): PoResolution {
  const poNumber = input.poNumber ?? extractPoNumber(input.text);
  if (!poNumber) {
    return {
      ok: false,
      reason: "no_po_number",
      message:
        "I couldn't read a PO number. Tell me the PO like \"PO 12345 for unit 204 at Maple Ridge\".",
    };
  }

  // 1. Property.
  const props = matchProperties(input.text, input.properties);
  if (props.length === 0) {
    return {
      ok: false,
      reason: "no_property",
      message: `Which property is PO ${poNumber} for? I couldn't match one.`,
      candidates: input.properties.map((p) => p.name).slice(0, 8),
    };
  }
  if (props.length > 1) {
    return {
      ok: false,
      reason: "ambiguous_property",
      message: `PO ${poNumber} could be for more than one property — which one?`,
      candidates: props.map((p) => p.name),
    };
  }
  const property = props[0]!;

  // 2. Unit label.
  const unitLabel = input.unitLabel ?? extractUnitLabel(input.text);
  if (!unitLabel) {
    return {
      ok: false,
      reason: "no_unit",
      message: `Which unit at ${property.name} is PO ${poNumber} for?`,
    };
  }
  const wantUnit = normalizeUnitKey(unitLabel);

  const propertyJobs = input.jobs.filter((j) => j.propertyId === property.id);
  const unitJobs = propertyJobs.filter(
    (j) => j.unitNo != null && normalizeUnitKey(j.unitNo) === wantUnit,
  );
  if (unitJobs.length === 0) {
    return {
      ok: false,
      reason: "no_unit_job",
      message: `I don't see a job for unit ${unitLabel} at ${property.name}.`,
      candidates: Array.from(
        new Set(propertyJobs.map((j) => j.unitNo).filter((u): u is string => !!u)),
      ).slice(0, 12),
    };
  }

  // 3. Current live job for that unit.
  const liveJobs = unitJobs.filter(isLiveJob);
  if (liveJobs.length === 0) {
    return {
      ok: false,
      reason: "no_live_job",
      message: `Unit ${unitLabel} at ${property.name} has no live job — every job there is already closed out.`,
      candidates: unitJobs.map((j) => `${j.jobNo} (${j.status})`),
    };
  }
  if (liveJobs.length > 1) {
    return {
      ok: false,
      reason: "ambiguous_job",
      message: `Unit ${unitLabel} at ${property.name} has more than one live job — which one gets PO ${poNumber}?`,
      candidates: liveJobs.map((j) => `${j.jobNo} (${j.status})`),
    };
  }

  return { ok: true, property, unitLabel, normalizedUnitKey: wantUnit, job: liveJobs[0]! };
}
