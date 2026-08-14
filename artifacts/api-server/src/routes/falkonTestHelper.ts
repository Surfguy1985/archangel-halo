/**
 * Falkon Test Helper — dev/test-only endpoints.
 *
 * SAFETY CONTRACT — three layers, all must hold:
 *
 *   1. This file is only imported in index.ts when HALO_E2E_ENABLED=1.
 *   2. index.ts throws at startup if HALO_E2E_ENABLED=1 and NODE_ENV==="production",
 *      so the server refuses to boot in production with the flag set.
 *   3. Every request must carry the X-E2E-Token header matching HALO_E2E_TOKEN.
 *      This unguessable secret ensures that an office session cookie alone is
 *      never sufficient — a second, separately-issued credential is required.
 *
 * Because all three guards must be circumvented simultaneously, an accidental
 * production flag-set terminates the server rather than exposing these routes.
 *
 * Endpoints (all require office session + X-E2E-Token):
 *   POST /falkon-test/set-mode   { mode }              → { ok, previousMode, hadRow }
 *   POST /falkon-test/restore    { previousMode, hadRow }
 *   GET  /falkon-test/events     ?entityId=&status=    → matching falkon_events rows
 */

import { createHmac } from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  falkonConnectionsTable,
  falkonEventsTable,
} from "@workspace/db/schema";
import { logger } from "../lib/logger";

const VALID_MODES = ["OFF", "SHADOW", "ASSISTED", "LIVE"] as const;
type FalkonMode = (typeof VALID_MODES)[number];

// ── Token gate ───────────────────────────────────────────────────────────────
// Requires X-E2E-Token: <HALO_E2E_TOKEN> on every request.
// If HALO_E2E_TOKEN is not set, ALL requests are rejected — the helper is
// inoperable until a secret is explicitly configured, preventing accidental
// open access.

/**
 * Expected token: HALO_E2E_TOKEN env override, or an HMAC derived from
 * SESSION_SECRET. The derived form keeps the credential out of the repo and
 * out of committed env files — anyone able to compute it already holds
 * SESSION_SECRET and could mint office sessions outright.
 */
export function expectedE2eToken(): string | null {
  if (process.env.HALO_E2E_TOKEN) return process.env.HALO_E2E_TOKEN;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update("halo-falkon-e2e-helper").digest("base64url");
}

function e2eTokenMiddleware(req: Request, res: Response, next: NextFunction): void {
  const expected = expectedE2eToken();
  if (!expected) {
    res.status(503).json({
      ok: false,
      error: "No E2E token available (SESSION_SECRET or HALO_E2E_TOKEN must be set).",
    });
    return;
  }
  const provided = req.headers["x-e2e-token"];
  if (typeof provided !== "string" || provided !== expected) {
    res.status(401).json({ ok: false, error: "Missing or invalid X-E2E-Token header." });
    return;
  }
  next();
}

const router = Router();

// Apply the token gate to every /falkon-test/* route.
// IMPORTANT: must be path-scoped — this router is mounted with router.use(...)
// at the API root, so an unscoped middleware here would gate EVERY route
// registered after it behind X-E2E-Token.
router.use("/falkon-test", e2eTokenMiddleware);

// ── POST /falkon-test/set-mode ────────────────────────────────────────────────
// Upserts the falkon_connections singleton to the requested mode.
// Returns the previous mode and whether a row existed so /restore can undo it.
router.post("/falkon-test/set-mode", async (req, res): Promise<void> => {
  const { mode } = req.body ?? {};
  if (!VALID_MODES.includes(mode as FalkonMode)) {
    res.status(400).json({ ok: false, error: `mode must be one of ${VALID_MODES.join(", ")}` });
    return;
  }

  const [existing] = await db
    .select({ id: falkonConnectionsTable.id, mode: falkonConnectionsTable.mode })
    .from(falkonConnectionsTable)
    .limit(1);

  const previousMode: string = existing?.mode ?? "NONE";
  const hadRow = !!existing;

  if (existing) {
    await db
      .update(falkonConnectionsTable)
      .set({ mode: mode as string, updatedAt: new Date() })
      .where(eq(falkonConnectionsTable.id, existing.id));
  } else {
    await db.insert(falkonConnectionsTable).values({
      mode: mode as string,
      capabilities: [],
    });
  }

  logger.info({ mode, previousMode, hadRow }, "falkon-test: set-mode");
  res.json({ ok: true, previousMode, hadRow });
});

// ── POST /falkon-test/restore ─────────────────────────────────────────────────
// Restores falkon_connections to the state before set-mode was called.
//   hadRow=false  → delete the row that set-mode inserted
//   hadRow=true   → set mode back to previousMode
router.post("/falkon-test/restore", async (req, res): Promise<void> => {
  const { previousMode, hadRow } = req.body ?? {};

  if (typeof hadRow !== "boolean") {
    res.status(400).json({ ok: false, error: "hadRow (boolean) is required" });
    return;
  }

  const [existing] = await db
    .select({ id: falkonConnectionsTable.id })
    .from(falkonConnectionsTable)
    .limit(1);

  if (!hadRow) {
    // set-mode created the row; remove it to return to a clean state
    if (existing) {
      await db
        .delete(falkonConnectionsTable)
        .where(eq(falkonConnectionsTable.id, existing.id));
    }
  } else if (
    existing &&
    typeof previousMode === "string" &&
    VALID_MODES.includes(previousMode as FalkonMode)
  ) {
    await db
      .update(falkonConnectionsTable)
      .set({ mode: previousMode, updatedAt: new Date() })
      .where(eq(falkonConnectionsTable.id, existing.id));
  }

  logger.info({ previousMode, hadRow }, "falkon-test: restore");
  res.json({ ok: true });
});

// ── GET /falkon-test/events ───────────────────────────────────────────────────
// Returns falkon_events rows matching ?entityId and/or ?status.
// Allows tests to prove that SHADOW mode suppresses outbound event rows.
router.get("/falkon-test/events", async (req, res): Promise<void> => {
  const { entityId, status } = req.query as { entityId?: string; status?: string };

  const conditions = [];
  if (entityId) conditions.push(eq(falkonEventsTable.entityId, entityId));
  if (status)   conditions.push(eq(falkonEventsTable.status, status));

  const rows =
    conditions.length > 0
      ? await db.select().from(falkonEventsTable).where(and(...conditions))
      : await db.select().from(falkonEventsTable);

  res.json(rows);
});

export default router;
