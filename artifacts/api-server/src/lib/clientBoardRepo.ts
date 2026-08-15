/**
 * Org-scoped client-board queries. Route handlers look up a turn/portfolio
 * then construct `new ClientBoardRepo(sessionOrgId)` — never org from the body.
 */

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import {
  db,
  clientTurnsTable,
  clientAuditLogTable,
  clientEvidenceItemsTable,
  clientOrgsTable,
  clientPortfoliosTable,
  propertiesTable,
  ClientBoardRepo,
  assertOrgScope,
  DEFAULT_EVIDENCE_RETENTION_YEARS,
} from "@workspace/db";

export { ClientBoardRepo, assertOrgScope, MissingOrgScopeError } from "@workspace/db";

export async function loadTurnRef(turnId: string): Promise<{
  id: string;
  orgId: string;
  propertyId: string;
} | null> {
  const [row] = await db
    .select({
      id: clientTurnsTable.id,
      orgId: clientTurnsTable.orgId,
      propertyId: clientTurnsTable.propertyId,
    })
    .from(clientTurnsTable)
    .where(eq(clientTurnsTable.id, turnId))
    .limit(1);
  return row ?? null;
}

export async function loadPortfolioRef(portfolioId: string): Promise<{
  id: string;
  orgId: string;
} | null> {
  const [row] = await db
    .select({
      id: clientPortfoliosTable.id,
      orgId: clientPortfoliosTable.orgId,
    })
    .from(clientPortfoliosTable)
    .where(eq(clientPortfoliosTable.id, portfolioId))
    .limit(1);
  return row ?? null;
}

export async function loadEvidenceRef(evidenceId: string): Promise<{
  id: string;
  turnId: string;
  orgId: string;
  propertyId: string;
} | null> {
  const [row] = await db
    .select({
      id: clientEvidenceItemsTable.id,
      turnId: clientEvidenceItemsTable.turnId,
      orgId: clientTurnsTable.orgId,
      propertyId: clientTurnsTable.propertyId,
    })
    .from(clientEvidenceItemsTable)
    .innerJoin(clientTurnsTable, eq(clientTurnsTable.id, clientEvidenceItemsTable.turnId))
    .where(eq(clientEvidenceItemsTable.id, evidenceId))
    .limit(1);
  return row ?? null;
}

export async function loadPropertyOrg(propertyId: string): Promise<string | null> {
  const [row] = await db
    .select({ orgId: propertiesTable.clientOrgId })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, propertyId))
    .limit(1);
  return row?.orgId ?? null;
}

export type AuditListQuery = {
  entityType?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
};

export type AuditEntry = {
  id: string;
  occurredAt: string;
  actorId: string | null;
  entityType: string;
  entityId: string;
  action: string;
};

export class ClientBoardStore extends ClientBoardRepo {
  async requireTurn(turnId: string): Promise<{ id: string; orgId: string; propertyId: string }> {
    const row = await loadTurnRef(turnId);
    if (!row || row.orgId !== this.orgId) return Promise.reject(new Error("Turn not found"));
    return row;
  }

  async listAudit(query: AuditListQuery = {}): Promise<AuditEntry[]> {
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
    const filters = [eq(clientAuditLogTable.orgId, this.orgId)];
    if (query.entityType) filters.push(eq(clientAuditLogTable.entityType, query.entityType));
    if (query.actorId) filters.push(eq(clientAuditLogTable.actorId, query.actorId));
    if (query.from) filters.push(gte(clientAuditLogTable.occurredAt, query.from));
    if (query.to) filters.push(lte(clientAuditLogTable.occurredAt, query.to));
    const rows = await db
      .select({
        id: clientAuditLogTable.id,
        occurredAt: clientAuditLogTable.occurredAt,
        actorId: clientAuditLogTable.actorId,
        entityType: clientAuditLogTable.entityType,
        entityId: clientAuditLogTable.entityId,
        action: clientAuditLogTable.action,
      })
      .from(clientAuditLogTable)
      .where(and(...filters))
      .orderBy(desc(clientAuditLogTable.occurredAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      occurredAt: r.occurredAt.toISOString(),
      actorId: r.actorId,
      entityType: r.entityType,
      entityId: r.entityId,
      action: r.action,
    }));
  }

  async tombstoneEvidence(evidenceId: string, actorId: string): Promise<{ id: string; turnId: string }> {
    const [item] = await db
      .select({
        id: clientEvidenceItemsTable.id,
        turnId: clientEvidenceItemsTable.turnId,
        tombstonedAt: clientEvidenceItemsTable.tombstonedAt,
      })
      .from(clientEvidenceItemsTable)
      .innerJoin(clientTurnsTable, eq(clientTurnsTable.id, clientEvidenceItemsTable.turnId))
      .where(
        and(eq(clientEvidenceItemsTable.id, evidenceId), eq(clientTurnsTable.orgId, this.orgId)),
      )
      .limit(1);
    if (!item) throw new Error("Evidence not found");
    if (!item.tombstonedAt) {
      await db
        .update(clientEvidenceItemsTable)
        .set({ tombstonedAt: new Date() })
        .where(eq(clientEvidenceItemsTable.id, evidenceId));
    }
    await db.insert(clientAuditLogTable).values({
      orgId: this.orgId,
      actorId,
      entityType: "evidence",
      entityId: evidenceId,
      action: "evidence.tombstone",
      after: { turnId: item.turnId },
    });
    return { id: item.id, turnId: item.turnId };
  }
}

export function store(orgId: string | null | undefined): ClientBoardStore {
  return new ClientBoardStore(orgId);
}

export async function retentionYearsForOrg(orgId: string): Promise<number> {
  assertOrgScope(orgId);
  const [row] = await db
    .select({ years: clientOrgsTable.evidenceRetentionYears })
    .from(clientOrgsTable)
    .where(eq(clientOrgsTable.id, orgId))
    .limit(1);
  return row?.years ?? DEFAULT_EVIDENCE_RETENTION_YEARS;
}

/** Soft-delete evidence older than the org retention window. Bytes stay; hash still verifies. */
export async function tombstoneExpiredEvidence(now = new Date()): Promise<number> {
  const orgs = await db
    .select({
      id: clientOrgsTable.id,
      years: clientOrgsTable.evidenceRetentionYears,
    })
    .from(clientOrgsTable);
  let total = 0;
  for (const org of orgs) {
    const years = org.years ?? DEFAULT_EVIDENCE_RETENTION_YEARS;
    const cutoff = new Date(now);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
    const result = await db.execute(sql`
      UPDATE client_evidence_items e
         SET tombstoned_at = ${now}
        FROM client_turns t
       WHERE e.turn_id = t.id
         AND t.org_id = ${org.id}
         AND e.tombstoned_at IS NULL
         AND e.server_received_at < ${cutoff}
    `);
    const count = (result as { rowCount?: number }).rowCount;
    if (typeof count === "number") total += count;
  }
  return total;
}
