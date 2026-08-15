/**
 * Segment 12 — demo seed counts. Full 12×40×120 rebuild; serial with other
 * client-board files so teardown cannot interleave.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import {
  db,
  propertiesTable,
  clientScopeLinesTable,
  clientScopesTable,
  clientTurnsTable,
  clientVarianceRequestsTable,
  clientVendorBidsTable,
  clientBidRequestsTable,
} from "@workspace/db";
import { ensureClientBoardSchema } from "../lib/ensureClientBoardSchema";
import { CAF_SEED_BRIEF, CAF_SEED_NAME_PREFIX, seedClientBoard } from "../lib/seedClientBoard";

describe("demo seed (12×40×120)", { timeout: 180_000 }, () => {
  let orgId = "";
  let palomaId = "";

  beforeAll(async () => {
    await ensureClientBoardSchema();
    const summary = await seedClientBoard({ applySchema: false });
    expect(summary.properties).toBe(12);
    expect(summary.variancePending).toBeGreaterThanOrEqual(1);
    orgId = summary.orgId;
    const [paloma] = await db
      .select({ id: propertiesTable.id })
      .from(propertiesTable)
      .where(
        and(
          like(propertiesTable.name, `${CAF_SEED_NAME_PREFIX}Paloma Creek`),
          eq(propertiesTable.brief, CAF_SEED_BRIEF),
        ),
      )
      .limit(1);
    palomaId = paloma!.id;
  }, 180_000);

  it("keeps Paloma marble off-schedule, a pending variance, and a 3-vendor live bid", async () => {
    const marble = await db
      .select({ compliance: clientScopeLinesTable.compliance })
      .from(clientScopeLinesTable)
      .innerJoin(clientScopesTable, eq(clientScopeLinesTable.scopeId, clientScopesTable.id))
      .innerJoin(clientTurnsTable, eq(clientScopesTable.turnId, clientTurnsTable.id))
      .where(eq(clientTurnsTable.propertyId, palomaId));
    expect(marble.some((r) => r.compliance === "off_schedule")).toBe(true);
    expect(marble.some((r) => r.compliance === "variance_pending")).toBe(true);

    const pending = await db
      .select({ id: clientVarianceRequestsTable.id })
      .from(clientVarianceRequestsTable)
      .where(eq(clientVarianceRequestsTable.orgId, orgId));
    expect(pending.length).toBeGreaterThanOrEqual(1);

    const [openBid] = await db
      .select({ id: clientBidRequestsTable.id })
      .from(clientBidRequestsTable)
      .where(eq(clientBidRequestsTable.propertyId, palomaId))
      .limit(1);
    expect(openBid).toBeTruthy();
    const bids = await db
      .select({ id: clientVendorBidsTable.id })
      .from(clientVendorBidsTable)
      .where(eq(clientVendorBidsTable.bidRequestId, openBid!.id));
    expect(bids).toHaveLength(3);
  });
});
