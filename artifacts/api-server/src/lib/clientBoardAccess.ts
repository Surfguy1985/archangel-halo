/**
 * Segment 9 — roles and property scope. Office cookie without a member header
 * is the asset manager (existing office). A property_manager scoped to A
 * receives 403 on every property B resource.
 */

import type { Request, Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  propertiesTable,
  clientOrgMembersTable,
  clientPortfolioPropertiesTable,
  clientTurnsTable,
  clientScopesTable,
  clientTurnInvoicesTable,
  clientVarianceRequestsTable,
  clientTurnRecordsTable,
  clientEvidenceItemsTable,
  clientScopeLinesTable,
  CLIENT_ORG_ROLES,
  type ClientOrgRole,
  type ClientMemberScope,
} from "@workspace/db";
import { isClientBoardSegmentEnabled } from "./clientBoardFlags";

export const CLIENT_BOARD_MEMBER_HEADER = "x-halo-member-id";

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = "Not allowed") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export type ClientBoardActor = {
  actorId: string;
  orgId: string;
  role: ClientOrgRole;
  scope: ClientMemberScope | null;
  memberId: string | null;
};

export type AccessMode = "read" | "write" | "approve";

function asRole(raw: string): ClientOrgRole {
  return (CLIENT_ORG_ROLES as readonly string[]).includes(raw) ? (raw as ClientOrgRole) : "crew";
}

export function sendAccessError(res: Response, err: unknown): boolean {
  if (err instanceof ForbiddenError) {
    res.status(403).json({ error: err.message });
    return true;
  }
  return false;
}

export async function officeActor(req: Request, orgId: string): Promise<ClientBoardActor> {
  const memberId = (req.header(CLIENT_BOARD_MEMBER_HEADER) ?? "").trim();
  if (!memberId || !(await isClientBoardSegmentEnabled("workSource"))) {
    return {
      actorId: "office",
      orgId,
      role: "asset_manager",
      scope: null,
      memberId: null,
    };
  }
  const [row] = await db
    .select()
    .from(clientOrgMembersTable)
    .where(and(eq(clientOrgMembersTable.id, memberId), eq(clientOrgMembersTable.orgId, orgId)))
    .limit(1);
  if (!row) throw new ForbiddenError("Unknown member");
  return {
    actorId: row.userId,
    orgId: row.orgId,
    role: asRole(row.role),
    scope: row.scope,
    memberId: row.id,
  };
}

export async function propertyIdsForActor(actor: ClientBoardActor): Promise<string[] | null> {
  if (actor.role === "asset_manager" || actor.role === "auditor") return null;
  if (actor.role === "crew") return [];
  if (actor.role === "property_manager" || actor.role === "maintenance_lead") {
    return actor.scope?.propertyIds ?? [];
  }
  if (actor.role === "regional_manager") {
    const portfolioIds = actor.scope?.portfolioIds;
    if (!portfolioIds || portfolioIds.length === 0) return null;
    const rows = await db
      .select({ propertyId: clientPortfolioPropertiesTable.propertyId })
      .from(clientPortfolioPropertiesTable)
      .where(inArray(clientPortfolioPropertiesTable.portfolioId, portfolioIds));
    return rows.map((r) => r.propertyId);
  }
  if (actor.role === "vendor_admin") return null;
  return [];
}

export async function assertPropertyAccess(
  actor: ClientBoardActor,
  propertyId: string,
  mode: AccessMode,
): Promise<void> {
  if (actor.role === "crew") throw new ForbiddenError("Crew portal only");
  if (mode !== "read" && actor.role === "auditor") throw new ForbiddenError("Read-only");
  if (mode === "approve" && (actor.role === "maintenance_lead" || actor.role === "vendor_admin")) {
    throw new ForbiddenError("This role cannot approve");
  }

  const [property] = await db
    .select({ orgId: propertiesTable.clientOrgId })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, propertyId))
    .limit(1);
  if (!property?.orgId || property.orgId !== actor.orgId) {
    throw new ForbiddenError("Not allowed");
  }

  if (actor.role === "vendor_admin") {
    const [assigned] = await db
      .select({ id: clientTurnsTable.id })
      .from(clientTurnsTable)
      .where(and(eq(clientTurnsTable.propertyId, propertyId), eq(clientTurnsTable.assignedVendorOrgId, actor.orgId)))
      .limit(1);
    if (!assigned) throw new ForbiddenError("Not assigned to this property");
    return;
  }

  const allowed = await propertyIdsForActor(actor);
  if (allowed && !allowed.includes(propertyId)) {
    throw new ForbiddenError("Not allowed");
  }
}

export async function assertApproveAmount(
  actor: ClientBoardActor,
  propertyId: string,
  amountCents: bigint,
): Promise<void> {
  await assertPropertyAccess(actor, propertyId, "approve");
  if (actor.role !== "property_manager") return;
  const [row] = await db
    .select({ cap: propertiesTable.scopeApprovalCents })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, propertyId))
    .limit(1);
  const cap = row?.cap ?? 0n;
  if (amountCents > cap) {
    throw new ForbiddenError(`Approval exceeds the ${cap.toString()} cent property cap`);
  }
}

export async function propertyIdOfTurn(turnId: string): Promise<string | null> {
  const [row] = await db
    .select({ propertyId: clientTurnsTable.propertyId })
    .from(clientTurnsTable)
    .where(eq(clientTurnsTable.id, turnId))
    .limit(1);
  return row?.propertyId ?? null;
}

export async function propertyIdOfScope(scopeId: string): Promise<string | null> {
  const [row] = await db
    .select({ propertyId: clientTurnsTable.propertyId })
    .from(clientScopesTable)
    .innerJoin(clientTurnsTable, eq(clientTurnsTable.id, clientScopesTable.turnId))
    .where(eq(clientScopesTable.id, scopeId))
    .limit(1);
  return row?.propertyId ?? null;
}

export async function propertyIdOfInvoice(invoiceId: string): Promise<string | null> {
  const [row] = await db
    .select({ propertyId: clientTurnsTable.propertyId })
    .from(clientTurnInvoicesTable)
    .innerJoin(clientTurnsTable, eq(clientTurnsTable.id, clientTurnInvoicesTable.turnId))
    .where(eq(clientTurnInvoicesTable.id, invoiceId))
    .limit(1);
  return row?.propertyId ?? null;
}

export async function propertyIdOfVariance(varianceId: string): Promise<string | null> {
  const [row] = await db
    .select({ propertyId: clientTurnsTable.propertyId })
    .from(clientVarianceRequestsTable)
    .innerJoin(clientTurnsTable, eq(clientTurnsTable.id, clientVarianceRequestsTable.turnId))
    .where(eq(clientVarianceRequestsTable.id, varianceId))
    .limit(1);
  return row?.propertyId ?? null;
}

export async function propertyIdOfRecord(recordId: string): Promise<string | null> {
  const [row] = await db
    .select({ propertyId: clientTurnsTable.propertyId })
    .from(clientTurnRecordsTable)
    .innerJoin(clientTurnsTable, eq(clientTurnsTable.id, clientTurnRecordsTable.turnId))
    .where(eq(clientTurnRecordsTable.id, recordId))
    .limit(1);
  return row?.propertyId ?? null;
}

export async function propertyIdOfEvidence(evidenceId: string): Promise<string | null> {
  const [row] = await db
    .select({ propertyId: clientTurnsTable.propertyId })
    .from(clientEvidenceItemsTable)
    .innerJoin(clientTurnsTable, eq(clientTurnsTable.id, clientEvidenceItemsTable.turnId))
    .where(eq(clientEvidenceItemsTable.id, evidenceId))
    .limit(1);
  return row?.propertyId ?? null;
}

export async function scopeTotalCents(scopeId: string): Promise<bigint> {
  const rows = await db
    .select({ cents: clientScopeLinesTable.extendedCents })
    .from(clientScopeLinesTable)
    .where(eq(clientScopeLinesTable.scopeId, scopeId));
  return rows.reduce((s, r) => s + r.cents, 0n);
}

export async function scopeTotalForTurn(turnId: string): Promise<bigint> {
  const [scope] = await db
    .select({ id: clientScopesTable.id })
    .from(clientScopesTable)
    .where(eq(clientScopesTable.turnId, turnId))
    .limit(1);
  return scope ? scopeTotalCents(scope.id) : 0n;
}

export function assertAuditAccess(actor: ClientBoardActor): void {
  if (actor.role !== "auditor" && actor.role !== "asset_manager") {
    throw new ForbiddenError("Not allowed");
  }
}

export async function requireProperty(
  req: Request,
  orgId: string,
  propertyId: string | null,
  mode: AccessMode,
): Promise<ClientBoardActor> {
  if (!propertyId) throw new ForbiddenError("Not allowed");
  const actor = await officeActor(req, orgId);
  await assertPropertyAccess(actor, propertyId, mode);
  return actor;
}

/** Canonical office paths the property_manager 403 test must hit for property B. */
export const CLIENT_BOARD_PROPERTY_BOUND_OFFICE_PATHS = [
  { method: "GET" as const, path: (ids: ResourceIds) => `/api/v1/properties/${ids.propertyId}/board` },
  { method: "GET" as const, path: (ids: ResourceIds) => `/api/v1/properties/${ids.propertyId}/compliance-stats` },
  { method: "GET" as const, path: (ids: ResourceIds) => `/api/v1/turns/${ids.turnId}` },
  { method: "POST" as const, path: (ids: ResourceIds) => `/api/v1/turns/${ids.turnId}/approve-scope` },
  { method: "POST" as const, path: (ids: ResourceIds) => `/api/v1/turns/${ids.turnId}/approve-variance` },
  { method: "POST" as const, path: (ids: ResourceIds) => `/api/v1/turns/${ids.turnId}/request-work` },
  { method: "GET" as const, path: (ids: ResourceIds) => `/api/v1/turns/${ids.turnId}/evidence` },
  { method: "GET" as const, path: (ids: ResourceIds) => `/api/v1/turns/${ids.turnId}/verify` },
  { method: "GET" as const, path: (ids: ResourceIds) => `/api/v1/turns/${ids.turnId}/scope` },
  { method: "POST" as const, path: (ids: ResourceIds) => `/api/v1/turns/${ids.turnId}/records` },
  { method: "POST" as const, path: (ids: ResourceIds) => `/api/v1/scopes/${ids.scopeId}/lines` },
  { method: "POST" as const, path: (ids: ResourceIds) => `/api/v1/scopes/${ids.scopeId}/validate` },
  { method: "POST" as const, path: (ids: ResourceIds) => `/api/v1/scopes/${ids.scopeId}/invoice` },
  { method: "GET" as const, path: (ids: ResourceIds) => `/api/v1/invoices/${ids.invoiceId}/export?format=json` },
  { method: "POST" as const, path: (ids: ResourceIds) => `/api/v1/invoices/${ids.invoiceId}/entrata` },
  { method: "POST" as const, path: (ids: ResourceIds) => `/api/v1/scopes/${ids.scopeId}/bid-requests` },
  { method: "GET" as const, path: (ids: ResourceIds) => `/api/v1/bid-requests/${ids.bidRequestId}/comparison` },
  { method: "POST" as const, path: (ids: ResourceIds) => `/api/v1/bid-requests/${ids.bidRequestId}/invitations` },
  { method: "POST" as const, path: (ids: ResourceIds) => `/api/v1/bid-requests/${ids.bidRequestId}/bids` },
  { method: "POST" as const, path: (ids: ResourceIds) => `/api/v1/bid-requests/${ids.bidRequestId}/award` },
  { method: "POST" as const, path: (ids: ResourceIds) => `/api/v1/turns/${ids.turnId}/capacity-hold` },
  { method: "POST" as const, path: (ids: ResourceIds) => `/api/v1/units/${ids.unitId}/vacate-notice` },
] as const;

export type ResourceIds = {
  propertyId: string;
  turnId: string;
  scopeId: string;
  invoiceId: string;
  bidRequestId: string;
  unitId: string;
};
