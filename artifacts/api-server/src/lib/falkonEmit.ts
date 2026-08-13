/**
 * Falkon Ops — outbound event emission library.
 *
 * Called from HALO route handlers after a successful DB commit.
 * All functions are fire-and-forget: they never throw, so a Falkon
 * delivery problem can never break a HALO request.
 *
 * Delivery is asynchronous via the falkon_events outbox table.
 * The scheduler tick (falkonScheduler.ts) picks up pending rows and
 * delivers them using Ed25519 signing (canonical Falkon contract).
 *
 * ASSISTED-mode Decision Gate:
 *   checkAssistedGate(action, payload, policy) — returns a DecisionPacket
 *   when an action requires human approval in ASSISTED mode. Routes that
 *   perform "consequential" external writes (dispatch, invoice, payment,
 *   scope change) MUST call this before executing if mode === "ASSISTED".
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@workspace/db";
import {
  falkonConnectionsTable,
  falkonEventsTable,
} from "@workspace/db/schema";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Event type registry
// ---------------------------------------------------------------------------

export type FalkonEventType =
  // Job lifecycle
  | "job.created"
  | "job.assigned"
  | "job.reassigned"
  | "job.unassigned"
  | "job.scheduled"
  | "job.bid_submitted"
  | "job.checked_in"
  | "job.checked_out"
  | "job.walk_submitted"
  | "job.walk_approved"
  | "job.qc_approved"
  | "job.qc_failed"
  | "job.invoiced"
  | "job.invoice_sent"
  | "job.payment_eligible"
  | "job.approved"
  | "job.paid"
  | "job.crew_paid"
  | "job.closed"
  | "job.change_order_requested"
  | "job.change_order_approved"
  // Evidence / photos
  | "evidence.captured"
  | "evidence.before_complete"
  | "evidence.after_complete"
  | "evidence.inspection_complete"
  // Unit / property
  | "unit.status_changed"
  | "unit.make_ready_started"
  | "unit.resident_ready"
  | "property.updated"
  // Crew / vendor
  | "crew.checked_in"
  | "crew.checked_out"
  | "crew.dispatched"
  | "crew.assigned"
  | "vendor.compliance_updated"
  | "vendor.compliance_expired"
  // Invoice / payment
  | "invoice.created"
  | "invoice.sent"
  | "invoice.approved"
  | "invoice.paid"
  | "invoice.overdue"
  // Schedule / reminders
  | "schedule.created"
  | "schedule.reminder"
  | "schedule.cancelled"
  // System
  | "ping";

export type FalkonEntityType =
  | "job"
  | "property"
  | "unit"
  | "crew"
  | "invoice"
  | "system";

// ---------------------------------------------------------------------------
// ASSISTED-mode Decision Gate
// ---------------------------------------------------------------------------

/**
 * Consequential actions in ASSISTED mode that require a human Decision Packet
 * before executing externally. Policy fields can pre-authorize low-risk variants.
 */
export type ConsequentialAction =
  | "dispatch_crew"        // Assign a crew to a job
  | "reassign_crew"        // Change crew assignment mid-job
  | "approve_invoice"      // Mark an invoice as approved
  | "send_invoice"         // Send invoice to client
  | "pay_invoice"          // Record payment on an invoice
  | "approve_change_order" // Approve a change order (scope/budget change)
  | "pay_crew"             // Release crew payment
  | "approve_walk"         // Approve a walk (already handled, but gatable)
  | "submit_bid";          // Send a bid to a client/partner

export interface PolicySnapshot {
  mode?: string;
  autoDispatchEnabled?: boolean;
  maxAutoInvoiceAmount?: number | null;
  maxAutoCrewRate?: number | null;
  maxAutoChangeOrder?: number | null;
}

export interface DecisionPacket {
  /** true = action may proceed; false = needs approval */
  permitted: boolean;
  reason: string;
  /** Operator-facing explanation shown in the UI */
  summary: string;
  /** Whether a Policy explicitly pre-authorised this variant */
  policyGranted: boolean;
}

/**
 * Check whether a consequential action needs a human Decision Packet.
 *
 * Returns { permitted: true } when:
 *   - Mode is not ASSISTED (SHADOW / LIVE / OFF act on existing rules)
 *   - A relevant low-risk policy explicitly pre-authorises this variant
 *
 * Returns { permitted: false } when ASSISTED and no policy override.
 * Routes MUST surface the returned `summary` to the office operator and
 * await explicit confirmation before executing.
 */
export function checkAssistedGate(
  action: ConsequentialAction,
  context: { amount?: number; crewRate?: number },
  policy: PolicySnapshot,
): DecisionPacket {
  if (!policy.mode || policy.mode !== "ASSISTED") {
    return { permitted: true, reason: "Not in ASSISTED mode", summary: "", policyGranted: false };
  }

  // Policy-gated auto-permits
  if (action === "dispatch_crew" && policy.autoDispatchEnabled) {
    return {
      permitted: true,
      reason: "Policy: autoDispatchEnabled",
      summary: "Auto-dispatch authorised by policy",
      policyGranted: true,
    };
  }

  if (
    (action === "approve_invoice" || action === "send_invoice" || action === "pay_invoice") &&
    typeof policy.maxAutoInvoiceAmount === "number" &&
    typeof context.amount === "number" &&
    context.amount <= policy.maxAutoInvoiceAmount
  ) {
    return {
      permitted: true,
      reason: `Policy: amount ${context.amount} ≤ maxAutoInvoiceAmount ${policy.maxAutoInvoiceAmount}`,
      summary: "Invoice within auto-approval limit",
      policyGranted: true,
    };
  }

  if (
    action === "approve_change_order" &&
    typeof policy.maxAutoChangeOrder === "number" &&
    typeof context.amount === "number" &&
    context.amount <= policy.maxAutoChangeOrder
  ) {
    return {
      permitted: true,
      reason: `Policy: amount ${context.amount} ≤ maxAutoChangeOrder ${policy.maxAutoChangeOrder}`,
      summary: "Change order within auto-approval limit",
      policyGranted: true,
    };
  }

  if (
    action === "pay_crew" &&
    typeof policy.maxAutoCrewRate === "number" &&
    typeof context.crewRate === "number" &&
    context.crewRate <= policy.maxAutoCrewRate
  ) {
    return {
      permitted: true,
      reason: `Policy: crewRate ${context.crewRate} ≤ maxAutoCrewRate ${policy.maxAutoCrewRate}`,
      summary: "Crew payment within auto-approval limit",
      policyGranted: true,
    };
  }

  // Default: ASSISTED mode requires explicit human approval
  const actionLabels: Record<ConsequentialAction, string> = {
    dispatch_crew:        "Dispatching a crew to this job",
    reassign_crew:        "Reassigning the crew mid-job",
    approve_invoice:      "Approving this invoice",
    send_invoice:         "Sending this invoice",
    pay_invoice:          "Recording payment on this invoice",
    approve_change_order: "Approving this change order",
    pay_crew:             "Releasing crew payment",
    approve_walk:         "Approving this walk",
    submit_bid:           "Submitting this bid",
  };

  return {
    permitted: false,
    reason: "ASSISTED mode — explicit approval required",
    summary: `${actionLabels[action] ?? action} requires office approval in ASSISTED mode.`,
    policyGranted: false,
  };
}

// ---------------------------------------------------------------------------
// Core emit — writes to outbox, never throws
// ---------------------------------------------------------------------------

/**
 * Queue a Falkon event for signed Ed25519 delivery.
 *
 * No-ops when:
 *   - No falkon_connections row exists
 *   - mode is "OFF"
 *
 * Must be called AFTER the primary DB mutation succeeds to avoid ghost
 * events from rolled-back transactions.
 */
export async function emitFalkonEvent(
  eventType: FalkonEventType,
  entityType: FalkonEntityType,
  entityId: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const [conn] = await db
      .select({ mode: falkonConnectionsTable.mode })
      .from(falkonConnectionsTable)
      .limit(1);

    if (!conn || conn.mode === "OFF") return;

    await db.insert(falkonEventsTable).values({
      eventType,
      entityType,
      entityId:
        entityId && /^[0-9a-f-]{36}$/i.test(entityId) ? entityId : undefined,
      payload: {
        ...payload,
        _ts: new Date().toISOString(),
        _schema: "halo-falkon/v2",
      },
      mode: conn.mode,
      status: "pending",
      attempts: 0,
      nextRetryAt: new Date(),
    });
  } catch (err) {
    logger.warn(
      { err, eventType, entityType, entityId },
      "falkon: emitFalkonEvent failed silently",
    );
  }
}

// ---------------------------------------------------------------------------
// Legacy HMAC helpers — kept for inbound verification fallback only.
// NOT used for outbound delivery. Outbound uses Ed25519 (falkonScheduler.ts).
// ---------------------------------------------------------------------------

/**
 * HMAC-SHA256 fallback for inbound webhook verification.
 * Only used when: Ed25519 remote key is absent AND webhookSecret is set.
 * Will be removed once all callers migrate to Ed25519.
 *
 * @deprecated Use Ed25519 via falkonWebhook.ts verifyFalkonSignatureEd25519
 */
export function buildFalkonHmacSignature(
  secret: string,
  timestampMs: number,
  rawBody: string,
): string {
  // Uses millisecond timestamp (consistent with Falkon canonical contract)
  const msg = `${timestampMs}.${rawBody}`;
  const sig = createHmac("sha256", secret).update(msg).digest("hex");
  return `v1=${sig}`;
}

/**
 * Verify an inbound Falkon HMAC-SHA256 signature (fallback only).
 * Accepts timestamps in either ms or seconds — auto-detected by magnitude.
 *
 * @deprecated Prefer Ed25519 verification.
 */
export function verifyFalkonHmac(
  secret: string,
  timestampHeader: string | undefined,
  signatureHeader: string | undefined,
  rawBody: string,
): boolean {
  if (!timestampHeader || !signatureHeader) return false;
  const tsRaw = parseInt(timestampHeader, 10);
  if (isNaN(tsRaw)) return false;
  // Auto-detect seconds vs milliseconds
  const tsMs = tsRaw < 1_000_000_000_000 ? tsRaw * 1_000 : tsRaw;
  if (Math.abs(Date.now() - tsMs) > 5 * 60_000) return false; // ±5 min

  const expected = buildFalkonHmacSignature(secret, tsMs, rawBody);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signatureHeader, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Re-export legacy name for any callers that still import it
export { buildFalkonHmacSignature as buildFalkonSignature };
export { verifyFalkonHmac as verifyFalkonSignature };
