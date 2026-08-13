/**
 * Falkon Policy / Mode Boundary — centralised consequential-mutation gate.
 *
 * Every surface that performs a consequential business mutation (crew dispatch,
 * invoice send/payment, walk approval, bid submission, scope change) MUST call
 * assertFalkonBoundary() BEFORE writing to the DB.
 *
 * Mode semantics enforced here:
 * ─────────────────────────────
 *   OFF      → 503 fail-closed.  Falkon is in maintenance; no mutations allowed.
 *   SHADOW   → passes (local simulation only).  emitFalkonEvent and the outbox
 *               scheduler are both suppressed in SHADOW so no external Falkon
 *               writes escape — provably non-mutating from HALO's side.
 *   ASSISTED → checkAssistedGate runs.  Not permitted → 403 gateBlocked.
 *               The caller must surface the reason to the operator so they can
 *               escalate through the chat-OS approval flow.
 *   LIVE     → unrestricted pass-through.
 *   (no row) → treated as SHADOW (safe default — no connection = no external).
 *
 * Usage
 * ─────
 *   import { assertFalkonBoundary, handleBoundaryError } from "../lib/falkonBoundary";
 *
 *   router.post("/jobs/:id/dispatch", async (req, res): Promise<void> => {
 *     try {
 *       await assertFalkonBoundary("dispatch_crew");
 *     } catch (err) {
 *       if (handleBoundaryError(err, res)) return;
 *       throw err;
 *     }
 *     // safe to mutate ...
 *   });
 */

import type { Response } from "express";
import { isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { falkonConnectionsTable, falkonPoliciesTable } from "@workspace/db/schema";
import {
  checkAssistedGate,
  type ConsequentialAction,
  type PolicySnapshot,
} from "./falkonEmit";

// ─── Structured error ─────────────────────────────────────────────────────────

export type BoundaryCode = "off" | "gateBlocked";

export class FalkonBoundaryError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: BoundaryCode,
    public readonly body: Record<string, unknown>,
  ) {
    super(`FalkonBoundary:${code}`);
    this.name = "FalkonBoundaryError";
  }
}

export function isFalkonBoundaryError(err: unknown): err is FalkonBoundaryError {
  return err instanceof FalkonBoundaryError;
}

// ─── Optional context for policy evaluation ───────────────────────────────────

export interface BoundaryContext {
  /** Invoice / change-order amount — used for maxAutoInvoiceAmount checks. */
  amount?: number;
  /** Crew pay rate — used for maxAutoCrewRate checks. */
  crewRate?: number;
}

// ─── Return value when the boundary passes ────────────────────────────────────

export interface BoundaryResult {
  mode: string;
  /** true when running in SHADOW — caller may log for diagnostics. */
  shadow: boolean;
  /** true when ASSISTED policy explicitly auto-approved this action. */
  policyGranted: boolean;
}

// ─── Core enforcement function ────────────────────────────────────────────────

/**
 * Assert that the current Falkon mode / policy permits this consequential action.
 *
 * Throws FalkonBoundaryError when blocked:
 *   OFF      → FalkonBoundaryError(503, "off")
 *   ASSISTED + not permitted → FalkonBoundaryError(403, "gateBlocked")
 *
 * Returns BoundaryResult on success.  Always call BEFORE any DB mutation.
 */
export async function assertFalkonBoundary(
  action: ConsequentialAction,
  context: BoundaryContext = {},
): Promise<BoundaryResult> {
  const [conn] = await db
    .select({ mode: falkonConnectionsTable.mode })
    .from(falkonConnectionsTable)
    .limit(1);

  const mode = conn?.mode ?? "SHADOW";

  // ── OFF: fail-closed ───────────────────────────────────────────────────────
  if (mode === "OFF") {
    throw new FalkonBoundaryError(503, "off", {
      ok: false,
      error: "off",
      message:
        "HALO is in maintenance mode (Falkon OFF). Consequential actions are " +
        "disabled until the Falkon connection is restored.",
    });
  }

  // ── ASSISTED: run the policy gate ─────────────────────────────────────────
  if (mode === "ASSISTED") {
    const [policy] = await db
      .select()
      .from(falkonPoliciesTable)
      .where(isNull(falkonPoliciesTable.propertyId))
      .limit(1);

    const snapshot: PolicySnapshot = {
      mode,
      autoDispatchEnabled:  policy?.autoDispatchEnabled  ?? false,
      maxAutoInvoiceAmount: policy?.maxAutoInvoiceAmount ?? null,
      maxAutoCrewRate:      policy?.maxAutoCrewRate      ?? null,
      maxAutoChangeOrder:   policy?.maxAutoChangeOrder   ?? null,
    };

    const decision = checkAssistedGate(action, context, snapshot);

    if (!decision.permitted) {
      throw new FalkonBoundaryError(403, "gateBlocked", {
        ok: false,
        gateBlocked: true,
        reason:  decision.reason,
        summary: decision.summary,
      });
    }

    return { mode, shadow: false, policyGranted: decision.policyGranted };
  }

  // ── SHADOW or LIVE ─────────────────────────────────────────────────────────
  // SHADOW: local mutations execute as simulation only.  External Falkon events
  // are suppressed at emitFalkonEvent + scheduler level — guaranteed from
  // HALO's side regardless of remote receiver behaviour.
  return { mode, shadow: mode === "SHADOW", policyGranted: false };
}

// ─── Express route helper ─────────────────────────────────────────────────────

/**
 * Convert a FalkonBoundaryError into an HTTP response and return true.
 * Returns false for any other error so the caller can re-throw it.
 *
 * @example
 *   } catch (err) {
 *     if (handleBoundaryError(err, res)) return;
 *     logger.error({ err }, "handler: unexpected failure");
 *     res.status(500).json({ error: "Internal error" });
 *   }
 */
export function handleBoundaryError(err: unknown, res: Response): boolean {
  if (isFalkonBoundaryError(err)) {
    res.status(err.httpStatus).json(err.body);
    return true;
  }
  return false;
}
