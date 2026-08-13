/**
 * Canonical Falkon policy decision boundary (pure, no I/O).
 *
 * One function decides every consequential mutation. Routes, chat execute,
 * and background workers must not invent a second gate.
 */

export const FALKON_MODES = ["OFF", "SHADOW", "ASSISTED", "LIVE"] as const;
export type FalkonMode = (typeof FALKON_MODES)[number];

export const FALKON_DECISIONS = [
  "ALLOW_AUTOMATIC",
  "REQUIRE_APPROVAL",
  "DENY",
  "SHADOW_ONLY",
] as const;
export type FalkonDecisionCode = (typeof FALKON_DECISIONS)[number];

export type FalkonActorChannel = "human" | "ai" | "worker" | "s2s";

/**
 * HTTP actor channel. Never trust `x-halo-actor-channel` — clients can set it.
 * Background workers call enforceFalkonMutation in-process with actorChannel "worker".
 */
export function actorChannelFromRequest(req: {
  path: string;
  haloIdentity?: unknown;
}): FalkonActorChannel {
  if (req.path === "/command/actions/execute") return "ai";
  if (req.haloIdentity) return "human";
  return "s2s";
}

export const CONSEQUENTIAL_ACTIONS = [
  "dispatch_crew",
  "reassign_crew",
  "approve_invoice",
  "send_invoice",
  "pay_invoice",
  "approve_change_order",
  "pay_crew",
  "approve_walk",
  "submit_bid",
  "job.create",
  "job.update",
  "job.assign",
  "job.schedule",
  "job.close",
  "pricing.update",
  "vendor.suspend",
  "property.complete",
  "settings.reset",
  "payment.release",
  "ops.eod_briefing",
  "comms.sms",
  "field.voice_eod",
  "generic.mutate",
] as const;

export type ConsequentialActionName = (typeof CONSEQUENTIAL_ACTIONS)[number];

export interface FalkonPolicyThresholds {
  autoDispatchEnabled?: boolean;
  maxAutoInvoiceAmount?: number | null;
  maxAutoCrewRate?: number | null;
  maxAutoChangeOrder?: number | null;
}

export interface FalkonDecisionInput {
  mode: string;
  action: string;
  actorChannel: FalkonActorChannel;
  tenantId?: string | null;
  actor?: string | null;
  role?: string | null;
  capability?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  amount?: number | null;
  crewRate?: number | null;
  previousState?: Record<string, unknown> | null;
  requestedChange?: Record<string, unknown> | null;
  evidenceOk?: boolean;
  policy: FalkonPolicyThresholds;
  approvalConsumed?: boolean;
}

export interface FalkonDecision {
  code: FalkonDecisionCode;
  permitted: boolean;
  reason: string;
  summary: string;
  policyGranted: boolean;
  action: string;
  mode: FalkonMode | "UNKNOWN";
  actorChannel: FalkonActorChannel;
  requiresApproval: boolean;
}

export function parseFalkonMode(raw: string | null | undefined): FalkonMode | "UNKNOWN" {
  const m = (raw ?? "").trim().toUpperCase();
  if (m === "OFF" || m === "SHADOW" || m === "ASSISTED" || m === "LIVE") return m;
  return "UNKNOWN";
}

export function isConsequentialAction(action: string): boolean {
  return (CONSEQUENTIAL_ACTIONS as readonly string[]).includes(action);
}

const INVOICE_ACTIONS = new Set(["approve_invoice", "send_invoice", "pay_invoice", "payment.release"]);
const DISPATCH_ACTIONS = new Set(["dispatch_crew", "reassign_crew", "job.assign"]);
const CHANGE_ORDER_ACTIONS = new Set(["approve_change_order"]);
const CREW_PAY_ACTIONS = new Set(["pay_crew"]);

export function policyAutoAllows(input: FalkonDecisionInput): boolean {
  const { action, policy } = input;
  if (DISPATCH_ACTIONS.has(action) && policy.autoDispatchEnabled) return true;
  if (
    INVOICE_ACTIONS.has(action) &&
    typeof policy.maxAutoInvoiceAmount === "number" &&
    typeof input.amount === "number" &&
    input.amount <= policy.maxAutoInvoiceAmount
  ) {
    return true;
  }
  if (
    CHANGE_ORDER_ACTIONS.has(action) &&
    typeof policy.maxAutoChangeOrder === "number" &&
    typeof input.amount === "number" &&
    input.amount <= policy.maxAutoChangeOrder
  ) {
    return true;
  }
  if (
    CREW_PAY_ACTIONS.has(action) &&
    typeof policy.maxAutoCrewRate === "number" &&
    typeof input.crewRate === "number" &&
    input.crewRate <= policy.maxAutoCrewRate
  ) {
    return true;
  }
  return false;
}

function packet(
  partial: Omit<FalkonDecision, "permitted" | "requiresApproval"> & { permitted?: boolean },
): FalkonDecision {
  const code = partial.code;
  const permitted = code === "ALLOW_AUTOMATIC";
  return {
    ...partial,
    permitted,
    requiresApproval: code === "REQUIRE_APPROVAL",
  };
}

/**
 * Single policy decision. LIVE is always disabled. Unknown mode fails closed.
 */
export function decideFalkonPolicy(input: FalkonDecisionInput): FalkonDecision {
  const mode = parseFalkonMode(input.mode);
  const action = input.action || "generic.mutate";
  const base = {
    action,
    mode,
    actorChannel: input.actorChannel,
    policyGranted: false,
  };

  if (mode === "UNKNOWN") {
    return packet({
      ...base,
      code: "DENY",
      reason: "unknown_mode",
      summary: "Falkon mode is unknown — mutation denied.",
    });
  }

  if (mode === "LIVE") {
    return packet({
      ...base,
      code: "DENY",
      reason: "live_disabled",
      summary: "LIVE mode is disabled. Mutation denied.",
    });
  }

  if (input.approvalConsumed && isConsequentialAction(action)) {
    return packet({
      ...base,
      code: "ALLOW_AUTOMATIC",
      reason: "approval_consumed",
      summary: "Prior Falkon approval consumed for this mutation.",
      policyGranted: true,
    });
  }

  // HALO snapshot of facts that already happened — not a Base44 / schedule write.
  // LIVE still denied above. SHADOW workers may persist so the evening recap exists.
  if (action === "ops.eod_briefing" && (mode === "OFF" || mode === "SHADOW" || mode === "ASSISTED")) {
    return packet({
      ...base,
      code: "ALLOW_AUTOMATIC",
      reason: "halo_internal_snapshot",
      summary: "EOD briefing is a HALO snapshot — not a source-of-record write.",
    });
  }

  // Outbound dial is an external action. SHADOW observes only. ASSISTED always
  // requires approval — including single calls and batches. LIVE already denied.
  if (action === "field.voice_eod" && mode === "SHADOW") {
    return packet({
      ...base,
      code: "SHADOW_ONLY",
      reason: "shadow_no_outbound_dial",
      summary: "SHADOW mode — outbound EOD calls are recorded, not placed.",
    });
  }

  if (!isConsequentialAction(action)) {
    return packet({
      ...base,
      code: "ALLOW_AUTOMATIC",
      reason: "safe_operation",
      summary: "",
    });
  }

  if (mode === "OFF") {
    return packet({
      ...base,
      code: "ALLOW_AUTOMATIC",
      reason: "mode_off",
      summary: "",
    });
  }

  // SHADOW: humans may operate HALO (Falkon observes). AI, workers, and S2S
  // cannot change operational state — they may only simulate.
  if (mode === "SHADOW") {
    if (input.actorChannel === "human") {
      return packet({
        ...base,
        code: "ALLOW_AUTOMATIC",
        reason: "shadow_human_operator",
        summary: "",
      });
    }
    return packet({
      ...base,
      code: "SHADOW_ONLY",
      reason: "shadow_no_external_mutation",
      summary: "SHADOW mode — classified and recorded, not executed.",
    });
  }

  // ASSISTED
  if (policyAutoAllows(input)) {
    return packet({
      ...base,
      code: "ALLOW_AUTOMATIC",
      reason: "policy_threshold",
      summary: "Policy threshold pre-authorised this variant.",
      policyGranted: true,
    });
  }

  return packet({
    ...base,
    code: "REQUIRE_APPROVAL",
    reason: "assisted_approval_required",
    summary: `${action} requires office approval in ASSISTED mode.`,
  });
}

export interface ClassifiedMutation {
  action: string;
  consequential: boolean;
  targetType: string | null;
}

const SAFE_PATHS: RegExp[] = [
  /^\/office-auth(\/|$)/,
  /^\/walk-auth(\/|$)/,
  /^\/healthz$/,
  /^\/command\/conversations(\/|$)/,
  /^\/command\/briefing$/,
  /^\/settings\/sync-base44$/,
  /^\/live\//,
  /^\/client\//,
  /^\/pay\//,
  /^\/portal\//,
  /^\/storage\//,
  /^\/vapi\//,
  /^\/falkon\/(webhook|ping|inbound|admin\/verify|admin\/eligibility|admin\/test)/,
  /^\/falkon\/approvals(\/|$)/,
  /^\/falkon\/policy\/decisions$/,
  /^\/presentation\/demo/,
  /^\/voice\/parse$/,
  /^\/feed\/dismiss$/,
  /^\/brief\/refresh$/,
  /^\/ask$/,
  /^\/checkin\//,
  /^\/walks\/[^/]+\/(captures|voice-capture|complete)(\/|$)/,
  /^\/walks$/,
  /^\/walk-captures\//,
  /^\/weather\//,
  /^\/catalog\/lookup$/,
  /^\/estimates\//,
];

/** Best-effort target id from `/resource/:id/...` office paths. */
export function targetIdFromPath(path: string): string | null {
  const m = path.match(
    /^\/(?:invoices|jobs|walks|crews|catalog-items|price-items|bids|autopilot\/actions)\/([^/]+)/,
  );
  return m?.[1] ?? null;
}

const ACTION_RULES: Array<{ re: RegExp; action: ConsequentialActionName; targetType: string | null }> = [
  { re: /^\/command\/actions\/execute$/, action: "generic.mutate", targetType: "command" },
  { re: /^\/jobs\/?$/, action: "job.create", targetType: "job" },
  { re: /^\/jobs\/[^/]+\/assign/, action: "job.assign", targetType: "job" },
  { re: /^\/jobs\/[^/]+\/schedule/, action: "job.schedule", targetType: "job" },
  { re: /^\/jobs\/[^/]+\/close/, action: "job.close", targetType: "job" },
  { re: /^\/jobs\/[^/]+/, action: "job.update", targetType: "job" },
  { re: /^\/crews\/[^/]+\/dispatch/, action: "dispatch_crew", targetType: "crew" },
  { re: /^\/invoices\/[^/]+\/send/, action: "send_invoice", targetType: "invoice" },
  { re: /^\/invoices\/[^/]+\/approve/, action: "approve_invoice", targetType: "invoice" },
  { re: /^\/invoices\/[^/]+\/pay/, action: "pay_invoice", targetType: "invoice" },
  { re: /^\/invoices/, action: "send_invoice", targetType: "invoice" },
  { re: /^\/pay\//, action: "pay_invoice", targetType: "invoice" },
  { re: /^\/pay-hub\//, action: "payment.release", targetType: "payment" },
  { re: /^\/price-items/, action: "pricing.update", targetType: "price_item" },
  { re: /^\/catalog-items/, action: "pricing.update", targetType: "catalog" },
  { re: /^\/bids/, action: "submit_bid", targetType: "bid" },
  { re: /^\/walks\/[^/]+\/approve/, action: "approve_walk", targetType: "walk" },
  { re: /^\/settings\/reset$/, action: "settings.reset", targetType: "system" },
  { re: /^\/autopilot\/actions\/[^/]+\/approve/, action: "generic.mutate", targetType: "autopilot" },
  { re: /^\/portal\/[^/]+\/invoices/, action: "pay_invoice", targetType: "invoice" },
  { re: /^\/briefings\//, action: "ops.eod_briefing", targetType: "briefing" },
  { re: /^\/sms\//, action: "comms.sms", targetType: "sms" },
  { re: /^\/voice-eod\//, action: "field.voice_eod", targetType: "crew" },
];

const CHAT_CAPABILITY_TO_ACTION: Record<string, ConsequentialActionName> = {
  "job.create": "job.create",
  "job.status.update": "job.update",
  "crew.schedule": "job.schedule",
  "crew.assign": "job.assign",
  "invoice.send": "send_invoice",
  "payment.release": "payment.release",
  "expense.approve": "pay_invoice",
  "pm_link.generate": "generic.mutate",
  "ops.eod_briefing": "ops.eod_briefing",
  "comms.sms": "comms.sms",
  "field.voice_eod": "field.voice_eod",
};

const READ_CHAT_CAPABILITIES = new Set([
  "weather.risk_scan",
  "weather.schedule_recommend",
  "catalog.lookup",
  "estimate.from_evidence",
  "status.query",
]);

export function actionFromChatCapability(capability: string | undefined | null): string {
  if (!capability) return "generic.mutate";
  if (READ_CHAT_CAPABILITIES.has(capability)) return capability;
  return CHAT_CAPABILITY_TO_ACTION[capability] ?? (isConsequentialAction(capability) ? capability : "generic.mutate");
}

export function classifyMutation(
  method: string,
  path: string,
  body?: { capability?: unknown },
): ClassifiedMutation | { skip: true } {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return { skip: true };
  if (SAFE_PATHS.some((re) => re.test(path))) return { skip: true };

  if (path === "/command/actions/execute") {
    const cap = typeof body?.capability === "string" ? body.capability : undefined;
    const action = actionFromChatCapability(cap);
    return { action, consequential: isConsequentialAction(action), targetType: "command" };
  }

  for (const rule of ACTION_RULES) {
    if (rule.re.test(path)) {
      return { action: rule.action, consequential: true, targetType: rule.targetType };
    }
  }

  return { action: "generic.mutate", consequential: true, targetType: null };
}

export function httpStatusForDecision(code: FalkonDecisionCode): number {
  switch (code) {
    case "ALLOW_AUTOMATIC":
      return 200;
    case "REQUIRE_APPROVAL":
      return 202;
    case "SHADOW_ONLY":
      return 200;
    case "DENY":
      return 403;
  }
}
