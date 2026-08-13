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
 * Consequential mutations are gated by falkonMutationGuard / enforceFalkonMutation
 * (decideFalkonPolicy). checkAssistedGate remains a thin wrapper for callers
 * that already have a policy snapshot.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@workspace/db";
import {
  falkonConnectionsTable,
  falkonEventsTable,
} from "@workspace/db/schema";
import { logger } from "./logger";
import { decideFalkonPolicy } from "./falkonPolicyCore";

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
  // Make-ready pipeline
  | "make_ready.phase_advanced"
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
 * Canonical decision wrapper. LIVE is denied. SHADOW AI/workers cannot mutate.
 * ASSISTED requires approval unless a policy threshold matches.
 */
export function checkAssistedGate(
  action: ConsequentialAction,
  context: { amount?: number; crewRate?: number },
  policy: PolicySnapshot,
): DecisionPacket {
  const decision = decideFalkonPolicy({
    mode: policy.mode ?? "OFF",
    action,
    actorChannel: "human",
    amount: context.amount,
    crewRate: context.crewRate,
    policy: {
      autoDispatchEnabled: policy.autoDispatchEnabled,
      maxAutoInvoiceAmount: policy.maxAutoInvoiceAmount,
      maxAutoCrewRate: policy.maxAutoCrewRate,
      maxAutoChangeOrder: policy.maxAutoChangeOrder,
    },
  });
  return {
    permitted: decision.permitted,
    reason: decision.reason,
    summary: decision.summary,
    policyGranted: decision.policyGranted,
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
// HMAC helpers for HALO-owned webhook ping (POST /falkon/verify).
// Not used for Falkon S2S inbound or outbound gateway delivery.
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
