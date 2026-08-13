/**
 * Falkon policy adapter — load mode/thresholds, persist decisions, consume approvals.
 */

import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  falkonConnectionsTable,
  falkonPoliciesTable,
  falkonPolicyDecisionsTable,
  falkonPendingApprovalsTable,
} from "@workspace/db";
import { logger } from "./logger";
import {
  decideFalkonPolicy,
  type FalkonActorChannel,
  type FalkonDecision,
  type FalkonPolicyThresholds,
} from "./falkonPolicyCore";
import type { HaloIdentity } from "./enforcerCore";
import { primaryRole } from "./enforcerCore";

export interface EnforceInput {
  action: string;
  actorChannel: FalkonActorChannel;
  identity?: HaloIdentity;
  capability?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  amount?: number | null;
  crewRate?: number | null;
  propertyId?: string | null;
  approvalId?: string | null;
  payload?: Record<string, unknown>;
  correlationId?: string;
}

export interface EnforceResult {
  decision: FalkonDecision;
  correlationId: string;
  approvalId: string | null;
}

let modeOverrideForTests: string | null = null;

export function setFalkonModeOverrideForTests(mode: string | null): void {
  modeOverrideForTests = mode;
}

export async function loadFalkonContext(propertyId?: string | null): Promise<{
  mode: string;
  policy: FalkonPolicyThresholds;
}> {
  if (modeOverrideForTests) {
    return { mode: modeOverrideForTests, policy: {} };
  }
  const [conn] = await db.select().from(falkonConnectionsTable).limit(1);
  const mode = conn?.mode ?? "OFF";
  const policies = await db
    .select()
    .from(falkonPoliciesTable)
    .orderBy(desc(falkonPoliciesTable.updatedAt));
  const row =
    (propertyId ? policies.find((p) => p.propertyId === propertyId) : undefined) ??
    policies.find((p) => p.propertyId == null) ??
    null;
  return {
    mode,
    policy: {
      autoDispatchEnabled: row?.autoDispatchEnabled ?? false,
      maxAutoInvoiceAmount: row?.maxAutoInvoiceAmount ?? null,
      maxAutoCrewRate: row?.maxAutoCrewRate ?? null,
      maxAutoChangeOrder: row?.maxAutoChangeOrder ?? null,
    },
  };
}

async function consumeApproval(id: string, action: string): Promise<boolean> {
  const [row] = await db
    .update(falkonPendingApprovalsTable)
    .set({ status: "consumed", resolvedAt: new Date() })
    .where(
      and(
        eq(falkonPendingApprovalsTable.id, id),
        eq(falkonPendingApprovalsTable.status, "approved"),
        eq(falkonPendingApprovalsTable.action, action),
      ),
    )
    .returning({ id: falkonPendingApprovalsTable.id });
  return Boolean(row);
}

export async function enforceFalkonMutation(input: EnforceInput): Promise<EnforceResult> {
  const correlationId = input.correlationId ?? randomUUID();
  const ctx = await loadFalkonContext(input.propertyId);
  let approvalConsumed = false;
  if (input.approvalId) {
    approvalConsumed = await consumeApproval(input.approvalId, input.action);
  }

  const decision = decideFalkonPolicy({
    mode: ctx.mode,
    action: input.action,
    actorChannel: input.actorChannel,
    tenantId: input.identity?.tenantId,
    actor: input.identity?.subject,
    role: input.identity ? primaryRole(input.identity) : null,
    capability: input.capability,
    targetType: input.targetType,
    targetId: input.targetId,
    amount: input.amount,
    crewRate: input.crewRate,
    policy: ctx.policy,
    approvalConsumed,
  });

  let approvalId: string | null = null;
  if (decision.code === "REQUIRE_APPROVAL") {
    const [row] = await db
      .insert(falkonPendingApprovalsTable)
      .values({
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        actor: input.identity?.subject ?? null,
        role: input.identity ? primaryRole(input.identity) : null,
        tenantId: input.identity?.tenantId ?? null,
        capability: input.capability ?? null,
        payload: input.payload ?? {},
        status: "pending",
      })
      .returning({ id: falkonPendingApprovalsTable.id });
    approvalId = row?.id ?? null;
  }

  try {
    await db.insert(falkonPolicyDecisionsTable).values({
      correlationId,
      mode: String(decision.mode),
      action: decision.action,
      decision: decision.code,
      actorChannel: decision.actorChannel,
      actor: input.identity?.subject ?? null,
      role: input.identity ? primaryRole(input.identity) : null,
      tenantId: input.identity?.tenantId ?? null,
      capability: input.capability ?? null,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      policyGranted: decision.policyGranted,
      reason: decision.reason,
      approvalId,
    });
  } catch (err) {
    logger.warn({ err, correlationId }, "falkon: failed to persist policy decision");
  }

  return { decision, correlationId, approvalId };
}

export async function resolveFalkonApproval(
  id: string,
  status: "approved" | "denied",
): Promise<boolean> {
  const [row] = await db
    .update(falkonPendingApprovalsTable)
    .set({ status, resolvedAt: new Date() })
    .where(
      and(eq(falkonPendingApprovalsTable.id, id), eq(falkonPendingApprovalsTable.status, "pending")),
    )
    .returning({ id: falkonPendingApprovalsTable.id });
  return Boolean(row);
}
