/**
 * Predictive suggestions → approvable autopilot actions.
 *
 * The cortex computes what the operator has not noticed yet and phrases it as
 * a decision. This module turns those decisions into rows in the SAME
 * autopilot_actions queue the office already approves from, so:
 *
 *  - dedupe is one-shot per (kind, entity) via the unique index — a dismissed
 *    suggestion never re-fires for that entity;
 *  - approval goes through executeAutopilotAction's atomic pending→executing
 *    claim, so approving twice cannot apply twice;
 *  - nothing executes on render. Approval is what authorizes execution.
 *
 * A prediction with no executor never becomes a proposal — it stays a bullet.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db, autopilotActionsTable } from "@workspace/db";
import { propose } from "./autopilot";
import { logger } from "./logger";
import { cortexProposals, type OpsCortex, type OpsProposal } from "./opsCortex";
import type { AnswerProposal } from "./commandBrain";

/** At most this many chips under one answer — more is a wall of text again. */
const MAX_PROPOSALS_PER_ANSWER = 2;

function toDto(
  row: { id: string; kind: string; title: string; body: string; entityType: string; entityId: string },
  decision: string,
): AnswerProposal {
  return {
    id: row.id,
    kind: row.kind,
    decision,
    title: row.title,
    body: row.body,
    entityType: row.entityType,
    entityId: row.entityId,
    approveUrl: `/api/autopilot/actions/${row.id}/approve`,
    dismissUrl: `/api/autopilot/actions/${row.id}/dismiss`,
  };
}

/**
 * Persist (or re-find) the top predictive proposals for this answer and return
 * them as approvable chips. Never throws — a failed proposal must not take the
 * answer down with it.
 */
export async function surfaceProposals(cortex: OpsCortex): Promise<AnswerProposal[]> {
  try {
    const candidates = cortexProposals(cortex);
    if (candidates.length === 0) return [];

    // The decision copy lives on the insight, not the proposal row.
    const decisionByKey = new Map<string, string>();
    for (const i of [...cortex.predictions, ...cortex.onFire, ...cortex.needsYou]) {
      if (i.proposal && i.decision) {
        const key = `${i.proposal.kind}:${i.proposal.entityId}`;
        if (!decisionByKey.has(key)) decisionByKey.set(key, i.decision);
      }
    }

    // Anything already resolved (executed / dismissed / failed / executing) is
    // out: a dismissed suggestion must not immediately return, and an executed
    // one must not be offered a second time.
    const entityIds = [...new Set(candidates.map((c) => c.entityId))];
    const existing = await db
      .select()
      .from(autopilotActionsTable)
      .where(inArray(autopilotActionsTable.entityId, entityIds));
    const byKey = new Map(existing.map((r) => [`${r.kind}:${r.entityId}`, r]));

    const out: AnswerProposal[] = [];
    for (const c of candidates) {
      if (out.length >= MAX_PROPOSALS_PER_ANSWER) break;
      const key = `${c.kind}:${c.entityId}`;
      const decision = decisionByKey.get(key);
      if (!decision) continue;

      const prior = byKey.get(key);
      if (prior) {
        // Still awaiting the operator — keep offering it. Otherwise it is done.
        if (prior.status === "pending") out.push(toDto(prior, decision));
        continue;
      }

      const created = await propose({
        kind: c.kind,
        entityType: c.entityType,
        entityId: c.entityId,
        title: c.title,
        body: c.body,
      });
      // null = another request won the insert race; the winner surfaces it.
      if (created) out.push(toDto(created, decision));
    }
    return out;
  } catch (err) {
    logger.warn({ err }, "predictiveProposals: could not surface proposals");
    return [];
  }
}

/** Pending proposals for a specific entity — used by entity-scoped threads. */
export async function pendingProposalsFor(
  entityType: string,
  entityId: string,
): Promise<Array<{ id: string; kind: string; title: string; body: string }>> {
  const rows = await db
    .select()
    .from(autopilotActionsTable)
    .where(
      and(
        eq(autopilotActionsTable.entityType, entityType),
        eq(autopilotActionsTable.entityId, entityId),
        eq(autopilotActionsTable.status, "pending"),
      ),
    );
  return rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body }));
}

export type { OpsProposal };
