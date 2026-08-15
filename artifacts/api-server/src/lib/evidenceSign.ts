import { createHmac, randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, clientSignedUrlTicketsTable } from "@workspace/db";

export const EVIDENCE_URL_TTL_SEC = 15 * 60;

function secret(): string {
  return process.env.SESSION_SECRET ?? "halo-evidence-dev";
}

export function signFileQuery(input: {
  kind: "record" | "evidence";
  id: string;
  size?: string;
  ttlSec: number;
  jti: string;
}): { exp: string; sig: string; jti: string } {
  const exp = String(Math.floor(Date.now() / 1000) + input.ttlSec);
  const payload = `${input.kind}.${input.id}.${input.size ?? "original"}.${exp}.${input.jti}`;
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return { exp, sig, jti: input.jti };
}

export async function issueSignedFile(input: {
  kind: "record" | "evidence";
  id: string;
  size?: string;
  ttlSec: number;
}): Promise<{ exp: string; sig: string; jti: string }> {
  const jti = randomUUID();
  const signed = signFileQuery({ ...input, jti });
  await db.insert(clientSignedUrlTicketsTable).values({
    jti,
    kind: input.kind,
    resourceId: input.id,
    expiresAt: new Date(Number(signed.exp) * 1000),
  });
  return signed;
}

export function verifyFileQuery(input: {
  kind: "record" | "evidence";
  id: string;
  size?: string;
  exp: string;
  sig: string;
  jti: string;
}): boolean {
  const expN = Number(input.exp);
  if (!Number.isFinite(expN) || expN * 1000 < Date.now()) return false;
  if (!input.jti) return false;
  const payload = `${input.kind}.${input.id}.${input.size ?? "original"}.${input.exp}.${input.jti}`;
  const expected = createHmac("sha256", secret()).update(payload).digest("base64url");
  return expected === input.sig;
}

/** HMAC + unused ticket. First successful GET burns the jti. */
export async function consumeSignedFile(input: {
  kind: "record" | "evidence";
  id: string;
  size?: string;
  exp: string;
  sig: string;
  jti: string;
}): Promise<boolean> {
  if (!verifyFileQuery(input)) return false;
  const [row] = await db
    .update(clientSignedUrlTicketsTable)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(clientSignedUrlTicketsTable.jti, input.jti),
        isNull(clientSignedUrlTicketsTable.usedAt),
        sql`${clientSignedUrlTicketsTable.expiresAt} > now()`,
      ),
    )
    .returning({ jti: clientSignedUrlTicketsTable.jti });
  return Boolean(row);
}

export function fileUrl(
  path: string,
  signed: { exp: string; sig: string; jti: string },
  size?: string,
): string {
  const q = new URLSearchParams({ exp: signed.exp, sig: signed.sig, jti: signed.jti });
  if (size) q.set("size", size);
  return `/api${path}?${q.toString()}`;
}
