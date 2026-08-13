/**
 * Crew portal token lookup + mint (I/O).
 * Hash-at-rest with legacy plaintext fallback for existing rows/tests.
 */

import { eq, or } from "drizzle-orm";
import { db, crewsTable } from "@workspace/db";
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
  return legacy ?? null;
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
