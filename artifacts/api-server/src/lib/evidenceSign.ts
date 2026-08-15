import { createHmac } from "node:crypto";

function secret(): string {
  return process.env.SESSION_SECRET ?? "halo-evidence-dev";
}

export function signFileQuery(input: {
  kind: "record" | "evidence";
  id: string;
  size?: string;
  ttlSec: number;
}): { exp: string; sig: string } {
  const exp = String(Math.floor(Date.now() / 1000) + input.ttlSec);
  const payload = `${input.kind}.${input.id}.${input.size ?? "original"}.${exp}`;
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return { exp, sig };
}

export function verifyFileQuery(input: {
  kind: "record" | "evidence";
  id: string;
  size?: string;
  exp: string;
  sig: string;
}): boolean {
  const expN = Number(input.exp);
  if (!Number.isFinite(expN) || expN * 1000 < Date.now()) return false;
  const payload = `${input.kind}.${input.id}.${input.size ?? "original"}.${input.exp}`;
  const expected = createHmac("sha256", secret()).update(payload).digest("base64url");
  return expected === input.sig;
}

export function fileUrl(path: string, signed: { exp: string; sig: string }, size?: string): string {
  const q = new URLSearchParams({ exp: signed.exp, sig: signed.sig });
  if (size) q.set("size", size);
  return `/api${path}?${q.toString()}`;
}
