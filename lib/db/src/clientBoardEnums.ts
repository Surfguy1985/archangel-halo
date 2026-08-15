/**
 * Client Board v1 (CAF Edition) — shared enums and stage ownership seed.
 *
 * Stages are ordered. `rework` is a loop back into `in_progress`; the Turn Ring
 * must render repeats. Ownership is first-class: client-owned stages render on
 * the same clock as vendor work. Do not collapse this to vendor-only timing.
 */

export const TURN_STAGES = [
  "notice",
  "vacated",
  "walk",
  "scoped",
  "pending_approval",
  "approved",
  "scheduled",
  "in_progress",
  "qc",
  "rework",
  "ready",
] as const;

export type TurnStage = (typeof TURN_STAGES)[number];

export const STAGE_OWNERS = ["client", "vendor", "shared"] as const;
export type StageOwner = (typeof STAGE_OWNERS)[number];

/**
 * Seed map. pending_approval + approved belong to the client — that is the
 * "we measure both sides" behavior. Changing this without a migration is a
 * product decision, not a code convenience.
 */
export const STAGE_OWNERSHIP_SEED: Readonly<Record<TurnStage, StageOwner>> = {
  notice: "shared",
  vacated: "shared",
  walk: "vendor",
  scoped: "vendor",
  pending_approval: "client",
  approved: "client",
  scheduled: "vendor",
  in_progress: "vendor",
  qc: "vendor",
  rework: "vendor",
  ready: "shared",
};

export const WORK_SOURCES = ["in_house", "third_party"] as const;
export type WorkSource = (typeof WORK_SOURCES)[number];

export const ORG_TYPES = ["pm_company", "vendor"] as const;
export type ClientOrgType = (typeof ORG_TYPES)[number];

export const STAGE_EVENTS = ["entered", "exited"] as const;
export type StageEventKind = (typeof STAGE_EVENTS)[number];

export const EVIDENCE_KINDS = ["photo", "video", "signature", "doc"] as const;
export const EVIDENCE_PHASES = ["before", "during", "after", "qc"] as const;

export const SCOPE_COMPLIANCE = [
  "matched",
  "variance_pending",
  "variance_approved",
  "off_schedule",
] as const;

export const PREDICTION_CONFIDENCE = ["high", "medium", "low"] as const;

export const CLIENT_BOARD_FLAG_SEGMENTS = [
  "dataModel",
  "turnEngine",
  "pulse",
  "propertyBoard",
  "evidence",
  "invoiceCompliance",
  "bidBoard",
  "pipeline",
  "workSource",
  "realtime",
  "security",
  "demo",
] as const;

export type ClientBoardFlagSegment = (typeof CLIENT_BOARD_FLAG_SEGMENTS)[number];

/** dataModel + turnEngine + pulse + propertyBoard ship on. Later UI segments stay dark. */
export const CLIENT_BOARD_FLAG_DEFAULTS: Readonly<
  Record<ClientBoardFlagSegment, boolean>
> = {
  dataModel: true,
  turnEngine: true,
  pulse: true,
  propertyBoard: true,
  evidence: false,
  invoiceCompliance: false,
  bidBoard: false,
  pipeline: false,
  workSource: false,
  realtime: false,
  security: false,
  demo: false,
};
