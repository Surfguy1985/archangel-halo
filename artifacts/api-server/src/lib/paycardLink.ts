/**
 * The crew's paycard link — check in, before and after photos, check out.
 *
 * There is one live link per crew and everything must hand out that same one:
 * the card printed for the wall, the link the office texts, and the phone the
 * office has just approved off the shared roster code. Two links for one
 * person means two histories, and the crew trusts whichever they scanned last.
 *
 * The plaintext token can't be recovered once hashed, so the issued URL rides
 * along on the row's label and is reused. A new link is minted only when the
 * crew has none left that is live.
 */

import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db, crewCheckinLinksTable } from "@workspace/db";
import { decodePaycardUrl, encodePaycardLabel, mintCrewToken } from "./crewCheckinCore";

type Db = typeof db;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** The live paycard URL this crew already holds, if any. */
async function existingPaycardUrl(exec: Db | Tx, crewId: string): Promise<string | null> {
  const links = await exec
    .select()
    .from(crewCheckinLinksTable)
    .where(
      and(
        eq(crewCheckinLinksTable.crewId, crewId),
        isNull(crewCheckinLinksTable.revokedAt),
        gte(crewCheckinLinksTable.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(crewCheckinLinksTable.createdAt));
  for (const row of links) {
    const url = decodePaycardUrl(row.label);
    if (url) return url;
  }
  return null;
}

export async function ensurePaycardUrl(crew: { id: string }, origin: string): Promise<string> {
  const held = await existingPaycardUrl(db, crew.id);
  if (held) return held;

  // Minting is a read-then-write, and the callers are a public poll and a
  // whole office printing cards at once. Without the lock two of them both see
  // "no card" and both mint, which quietly hands one person two live paycards.
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`paycard:${crew.id}`}))`);
    const raced = await existingPaycardUrl(tx, crew.id);
    if (raced) return raced;
    const minted = mintCrewToken();
    const url = `${origin}/checkin/${minted.token}`;
    await tx.insert(crewCheckinLinksTable).values({
      token: `h:${minted.tokenHash}`,
      tokenHash: minted.tokenHash,
      tokenPrefix: minted.tokenPrefix,
      crewId: crew.id,
      expiresAt: new Date(Date.now() + 365 * 86_400_000),
      label: encodePaycardLabel(url),
    });
    return url;
  });
}

/**
 * The same link as a bare path. A phone that is already on the site should be
 * sent within it — handing back an absolute URL would pin whichever origin the
 * card happened to be minted from, which is how a crew ends up bounced to a
 * dev domain from a link they scanned in production.
 */
export async function ensurePaycardPath(crew: { id: string }, origin: string): Promise<string | null> {
  const url = await ensurePaycardUrl(crew, origin);
  if (url.startsWith("/")) return url;
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}
