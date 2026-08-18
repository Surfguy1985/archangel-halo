/**
 * Crew portal token lookup + mint (I/O).
 * Hash-at-rest with legacy plaintext fallback for existing rows/tests.
 */

import { and, eq, or } from "drizzle-orm";
import { db, crewsTable, crewPortalBearersTable } from "@workspace/db";
import {
  classifyPortalTokenShape,
  hashPortalToken,
  isHashedPortalStorage,
  mintPortalToken,
  portalTokenColumns,
  publicPortalBearer,
} from "./portalTokenCore";

export {
  classifyPortalTokenShape,
  hashPortalToken,
  isHashedPortalStorage,
  mintPortalToken,
  portalTokenColumns,
  publicPortalBearer,
} from "./portalTokenCore";

type CrewRow = typeof crewsTable.$inferSelect;

export async function findCrewByPortalBearer(token: string): Promise<CrewRow | null> {
  if (classifyPortalTokenShape(token) === "malformed") return null;
  const tokenHash = hashPortalToken(token);
  const rows = await db
    .select()
    .from(crewsTable)
    .where(or(eq(crewsTable.portalTokenHash, tokenHash), eq(crewsTable.portalToken, token)));
  const hashed = rows.find((r) => r.portalTokenHash === tokenHash);
  if (hashed) return hashed;
  const legacy = rows.find((r) => r.portalToken === token && !isHashedPortalStorage(r.portalToken));
  if (legacy) return legacy;

  // Extra device keys minted by the shared roster code. They open the same
  // portal, which is what lets a second phone claim a person without rotating
  // (and killing) the link already on the first one.
  //
  // Only an APPROVED key authenticates. The shared code proves nothing about
  // who is holding it, so the office's approval is what ties a device to a
  // person — and pay, invoices and payment details all hang off that identity.
  const [device] = await db
    .select()
    .from(crewPortalBearersTable)
    .where(
      and(
        eq(crewPortalBearersTable.tokenHash, tokenHash),
        eq(crewPortalBearersTable.status, "approved"),
      ),
    )
    .limit(1);
  if (!device) return null;
  const [crew] = await db
    .select()
    .from(crewsTable)
    .where(eq(crewsTable.id, device.crewId))
    .limit(1);
  return crew ?? null;
}

export async function mintAndPersistPortalToken(crewId: string): Promise<string> {
  const minted = mintPortalToken();
  await db.update(crewsTable).set(portalTokenColumns(minted)).where(eq(crewsTable.id, crewId));
  return minted.token;
}

/** Legacy plaintext is reused. Hashed rows cannot be reconstructed — mint a new bearer. */
export async function ensurePortalBearer(crew: {
  id: string;
  portalToken: string | null;
}): Promise<string> {
  const legacy = publicPortalBearer(crew.portalToken);
  if (legacy) return legacy;
  return mintAndPersistPortalToken(crew.id);
}
