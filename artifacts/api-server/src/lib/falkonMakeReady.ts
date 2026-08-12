/**
 * Falkon Ops — Make-Ready Pipeline Gate Evaluation.
 *
 * The make-ready pipeline has 12 phases. Each phase transition is guarded
 * by evidence gates that read existing HALO data. This module evaluates
 * gates for a given execution and either advances the phase or returns the
 * blocking gates as a checklist.
 *
 * SHADOW safety: advance() writes only to falkon_executions and
 * falkon_execution_events — never to jobs, invoices, or activities.
 */

import { and, eq, sql, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  jobsTable,
  crewCheckinsTable,
  crewPhotosTable,
  jobChecklistsTable,
  cleaningChecklistsTable,
  activitiesTable,
  propertiesTable,
  falkonPoliciesTable,
  falkonUnitsTable,
} from "@workspace/db/schema";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Phase definitions
// ---------------------------------------------------------------------------

export const PHASES = [
  "needs_turn",
  "scoping",
  "vendor_selection",
  "scheduled",
  "arriving",
  "before_photos",
  "work_in_progress",
  "after_photos",
  "qc_review",
  "invoice_validation",
  "approval_pending",
  "resident_ready",
] as const;

export type MakeReadyPhase = typeof PHASES[number];

// ---------------------------------------------------------------------------
// Gate result
// ---------------------------------------------------------------------------

export interface GateResult {
  id: string;
  name: string;
  pass: boolean;
  detail: string;
}

// ---------------------------------------------------------------------------
// Policy helper
// ---------------------------------------------------------------------------

async function getPolicy(propertyId: string) {
  // Property-specific policy takes precedence over global
  const [propPolicy] = await db
    .select()
    .from(falkonPoliciesTable)
    .where(eq(falkonPoliciesTable.propertyId, propertyId))
    .limit(1);

  const [globalPolicy] = await db
    .select()
    .from(falkonPoliciesTable)
    .where(sql`${falkonPoliciesTable.propertyId} IS NULL`)
    .limit(1);

  return {
    requirePhotoMinBefore: propPolicy?.requirePhotoMinBefore ?? globalPolicy?.requirePhotoMinBefore ?? 1,
    requirePhotoMinAfter: propPolicy?.requirePhotoMinAfter ?? globalPolicy?.requirePhotoMinAfter ?? 2,
    requireArrivalRadius: propPolicy?.requireArrivalRadius ?? globalPolicy?.requireArrivalRadius ?? 300,
    requireInspection: propPolicy?.requireInspection ?? globalPolicy?.requireInspection ?? false,
    marginFloorOverride: propPolicy?.marginFloorOverride ?? globalPolicy?.marginFloorOverride ?? null,
  };
}

// ---------------------------------------------------------------------------
// Per-phase gate definitions
// ---------------------------------------------------------------------------

/**
 * Returns the gates required before the given phase can start.
 * (i.e. gates that must pass to ENTER this phase from the previous one)
 */
export async function evaluateGatesForPhase(
  jobId: string | null,
  propertyId: string,
  phase: MakeReadyPhase,
): Promise<GateResult[]> {
  const policy = await getPolicy(propertyId);
  const gates: GateResult[] = [];

  // When no job is attached to the execution, job-dependent gates auto-pass
  // (the make-ready board is tracking the unit even before a job is created).
  if (!jobId) {
    // All phases after "needs_turn" require a linked job for their gate checks.
    if (PHASES.indexOf(phase) > 0) {
      gates.push({
        id: "job_assigned",
        name: "Job Assigned",
        pass: false,
        detail: "No job linked to this make-ready execution — assign a job card to enable job gates",
      });
    }
    return gates;
  }

  // Fetch shared data once
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, jobId))
    .limit(1);

  const [property] = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.id, propertyId))
    .limit(1);

  // ── Gates by phase ──────────────────────────────────────────────────

  if (phase === "arriving" || PHASES.indexOf(phase) > PHASES.indexOf("arriving")) {
    // GPS arrival gate
    const checkin = await db
      .select({ lat: crewCheckinsTable.lat, lng: crewCheckinsTable.lng, kind: crewCheckinsTable.kind })
      .from(crewCheckinsTable)
      .where(
        and(
          eq(crewCheckinsTable.jobId, jobId),
          eq(crewCheckinsTable.kind, "checkin"),
        ),
      )
      .limit(1);

    if (checkin.length > 0 && property?.latitude && property?.longitude) {
      const { lat, lng } = checkin[0]!;
      const dist = haversineMeters(
        lat ?? 0,
        lng ?? 0,
        property.latitude,
        property.longitude,
      );
      gates.push({
        id: "gps_arrival",
        name: "GPS Arrival",
        pass: dist <= policy.requireArrivalRadius,
        detail: `Crew checked in ${Math.round(dist)}m from property (threshold: ${policy.requireArrivalRadius}m)`,
      });
    } else {
      gates.push({
        id: "gps_arrival",
        name: "GPS Arrival",
        pass: checkin.length > 0,
        detail: checkin.length > 0
          ? "GPS check-in recorded (coordinates pending geocode)"
          : "No crew GPS check-in recorded for this job",
      });
    }
  }

  if (PHASES.indexOf(phase) > PHASES.indexOf("before_photos")) {
    // Before photos gate
    const beforePhotos = await db
      .select({ id: crewPhotosTable.id })
      .from(crewPhotosTable)
      .where(
        and(
          eq(crewPhotosTable.jobId, jobId),
          eq(crewPhotosTable.phase, "before"),
        ),
      );

    gates.push({
      id: "before_photos",
      name: "Before Photos",
      pass: beforePhotos.length >= policy.requirePhotoMinBefore,
      detail: `${beforePhotos.length} before photo(s) captured (minimum: ${policy.requirePhotoMinBefore})`,
    });
  }

  if (PHASES.indexOf(phase) > PHASES.indexOf("work_in_progress")) {
    // Checklist complete gate
    const checklists = await db
      .select()
      .from(jobChecklistsTable)
      .where(eq(jobChecklistsTable.jobId, jobId));

    const cleaningChecks = await db
      .select()
      .from(cleaningChecklistsTable)
      .where(eq(cleaningChecklistsTable.jobId, jobId));

    const allSigned =
      [...checklists, ...cleaningChecks].every(
        (c) => c.signedOffAt !== null,
      );

    gates.push({
      id: "work_checklist",
      name: "Work Checklist",
      pass: allSigned || (checklists.length === 0 && cleaningChecks.length === 0),
      detail:
        checklists.length === 0 && cleaningChecks.length === 0
          ? "No checklists assigned (auto-pass)"
          : allSigned
            ? "All checklists signed off"
            : `${[...checklists, ...cleaningChecks].filter((c) => !c.signedOffAt).length} checklist(s) pending sign-off`,
    });
  }

  if (PHASES.indexOf(phase) > PHASES.indexOf("after_photos")) {
    // After photos gate
    const afterPhotos = await db
      .select({ id: crewPhotosTable.id })
      .from(crewPhotosTable)
      .where(
        and(
          eq(crewPhotosTable.jobId, jobId),
          eq(crewPhotosTable.phase, "after"),
        ),
      );

    gates.push({
      id: "after_photos",
      name: "After Photos",
      pass: afterPhotos.length >= policy.requirePhotoMinAfter,
      detail: `${afterPhotos.length} after photo(s) captured (minimum: ${policy.requirePhotoMinAfter})`,
    });
  }

  if (PHASES.indexOf(phase) > PHASES.indexOf("qc_review")) {
    // Walk QC approval gate
    const walkApproved = await db
      .select({ id: activitiesTable.id })
      .from(activitiesTable)
      .where(
        and(
          eq(activitiesTable.entityId, jobId),
          eq(activitiesTable.kind, "walk_approved"),
        ),
      )
      .limit(1);

    gates.push({
      id: "qc_walk_approved",
      name: "Walk QC Approval",
      pass: walkApproved.length > 0,
      detail:
        walkApproved.length > 0
          ? "Walk findings approved by client/PM"
          : "Walk QC not yet approved — pending client board approval",
    });

    // Approved scope / PO gate
    gates.push({
      id: "approved_scope",
      name: "Approved Scope / PO",
      pass: !!job?.poNumber && walkApproved.length > 0,
      detail:
        !job?.poNumber
          ? "No client PO number recorded"
          : walkApproved.length === 0
            ? "PO recorded but Walk not yet approved"
            : `PO ${job.poNumber} confirmed with Walk approval`,
    });

    // No pending change orders
    const hasPendingCO = job?.changeOrderStatus === "requested";
    gates.push({
      id: "change_orders_settled",
      name: "Change Orders Settled",
      pass: !hasPendingCO,
      detail: hasPendingCO
        ? "Change order pending — office must review before proceeding"
        : "No pending change orders",
    });
  }

  if (PHASES.indexOf(phase) > PHASES.indexOf("invoice_validation")) {
    // Invoice validated gate
    const { invoicesTable } = await import("@workspace/db/schema");
    const invoice = await db
      .select({
        id: invoicesTable.id,
        total: invoicesTable.amount,
        status: invoicesTable.status,
      })
      .from(invoicesTable)
      .where(eq(invoicesTable.jobId, jobId))
      .orderBy(desc(invoicesTable.createdAt))
      .limit(1);

    const hasInvoice =
      invoice.length > 0 &&
      (invoice[0]!.total ?? 0) > 0 &&
      invoice[0]!.status !== "cancelled";

    gates.push({
      id: "invoice_validated",
      name: "Invoice Validated",
      pass: hasInvoice,
      detail: hasInvoice
        ? `Invoice total $${(invoice[0]!.total ?? 0).toFixed(2)} validated`
        : "No valid invoice found for this job",
    });

    // Margin floor gate
    const marginMin =
      policy.marginFloorOverride ??
      property?.marginMin ??
      0.25;
    const marginPct = job?.marginPct ?? 0;
    gates.push({
      id: "margin_floor",
      name: "Margin Floor",
      pass: marginPct >= marginMin,
      detail: `Margin ${(marginPct * 100).toFixed(1)}% vs floor ${(marginMin * 100).toFixed(1)}%`,
    });
  }

  if (phase === "resident_ready") {
    // Final approval gate
    const { invoicesTable } = await import("@workspace/db/schema");
    const approvedInvoice = await db
      .select({ status: invoicesTable.status })
      .from(invoicesTable)
      .where(
        and(
          eq(invoicesTable.jobId, jobId),
          sql`${invoicesTable.status} IN ('approved', 'paid')`,
        ),
      )
      .limit(1);

    gates.push({
      id: "invoice_approved",
      name: "Invoice Approved for Payment",
      pass: approvedInvoice.length > 0,
      detail:
        approvedInvoice.length > 0
          ? `Invoice status: ${approvedInvoice[0]!.status}`
          : "Invoice not yet approved or paid",
    });
  }

  return gates;
}

// ---------------------------------------------------------------------------
// Execution advance
// ---------------------------------------------------------------------------

export interface AdvanceResult {
  advanced: boolean;
  fromPhase: MakeReadyPhase;
  toPhase: MakeReadyPhase | null;
  gates: GateResult[];
  blockedGates: GateResult[];
  completed: boolean;
}

export async function advanceExecution(
  executionId: string,
): Promise<AdvanceResult> {
  // Load execution
  const execRow = await db.execute(
    sql`SELECT * FROM falkon_executions WHERE id = ${executionId} LIMIT 1`,
  );
  const exec = (execRow as any).rows?.[0] ?? (execRow as any)[0];
  if (!exec) throw new Error(`Execution ${executionId} not found`);

  const currentPhase = exec.phase as MakeReadyPhase;
  const currentIdx = PHASES.indexOf(currentPhase);
  const nextPhase = currentIdx < PHASES.length - 1
    ? PHASES[currentIdx + 1]!
    : null;

  // Use exec.job_id only; never substitute unit_id as a job_id fallback.
  // When job_id is null the gate evaluator returns a "no job assigned" blocker.
  const gates = nextPhase
    ? await evaluateGatesForPhase(exec.job_id ?? null, exec.property_id, nextPhase)
    : [];

  const blockedGates = gates.filter((g) => !g.pass);
  const allPass = blockedGates.length === 0;

  if (allPass && nextPhase) {
    const completed = nextPhase === "resident_ready";

    // Write phase transition (SHADOW-safe: only touches falkon_* tables)
    if (completed) {
      await db.execute(
        sql`UPDATE falkon_executions SET
              phase = ${nextPhase},
              status = 'completed',
              gates_snapshot = ${JSON.stringify(gates)},
              completed_at = now(),
              resident_ready_at = now(),
              updated_at = now()
            WHERE id = ${executionId}`,
      );
    } else {
      await db.execute(
        sql`UPDATE falkon_executions SET
              phase = ${nextPhase},
              status = 'active',
              gates_snapshot = ${JSON.stringify(gates)},
              completed_at = NULL,
              resident_ready_at = NULL,
              updated_at = now()
            WHERE id = ${executionId}`,
      );
    }

    // Append event
    await db.execute(
      sql`INSERT INTO falkon_execution_events
            (id, execution_id, event_kind, from_phase, to_phase, payload, created_at)
          VALUES
            (gen_random_uuid(), ${executionId}, 'phase_transition',
             ${currentPhase}, ${nextPhase},
             ${JSON.stringify({ gates, gatesPass: gates.length, mode: exec.mode_at_start })}::jsonb,
             now())`,
    );

    return {
      advanced: true,
      fromPhase: currentPhase,
      toPhase: nextPhase,
      gates,
      blockedGates: [],
      completed,
    };
  }

  // Log the blocked evaluation
  await db.execute(
    sql`INSERT INTO falkon_execution_events
          (id, execution_id, event_kind, from_phase, to_phase, payload, created_at)
        VALUES
          (gen_random_uuid(), ${executionId}, 'gate_check',
           ${currentPhase}, ${nextPhase ?? currentPhase},
           ${JSON.stringify({ gates, blocked: blockedGates.map((g) => g.id) })}::jsonb,
           now())`,
  );

  return {
    advanced: false,
    fromPhase: currentPhase,
    toPhase: nextPhase,
    gates,
    blockedGates,
    completed: false,
  };
}

// ---------------------------------------------------------------------------
// Haversine distance (metres)
// ---------------------------------------------------------------------------

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000; // Earth radius in metres
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
