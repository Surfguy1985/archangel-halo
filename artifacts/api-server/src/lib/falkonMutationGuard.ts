/**
 * Express middleware: one Falkon policy boundary for mutating HTTP APIs.
 */

import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, invoicesTable } from "@workspace/db";
import { classifyMutation, httpStatusForDecision, targetIdFromPath, actorChannelFromRequest } from "./falkonPolicyCore";
import { enforceFalkonMutation } from "./falkonPolicy";
import { logger } from "./logger";
import { isPublicApiPath } from "./officeAuth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve the amount a policy ceiling is compared against.
 *
 * Reading it from the request body alone was wrong in both directions: most
 * consequential routes don't carry an amount at all (`POST /invoices/:id/send`
 * has an effectively empty body), so a configured invoice ceiling could never
 * pre-authorise anything and every send stopped for approval; and where a body
 * amount IS present it is caller-supplied, so a spoofed low value could buy
 * auto-approval for a large invoice.
 *
 * The stored record is authoritative, so prefer it. Creates have no record yet,
 * so they legitimately fall back to the submitted value.
 */
async function resolveAmount(
  targetType: string | null,
  targetId: string | null,
  body: unknown,
): Promise<number | null> {
  const b = body as { amount?: unknown; total?: unknown } | undefined;
  const fromBody =
    typeof b?.amount === "number" ? b.amount : typeof b?.total === "number" ? b.total : null;

  if (targetType === "invoice" && targetId && UUID_RE.test(targetId)) {
    try {
      const [row] = await db
        .select({ amount: invoicesTable.amount })
        .from(invoicesTable)
        .where(eq(invoicesTable.id, targetId))
        .limit(1);
      if (row && typeof row.amount === "number") return row.amount;
    } catch (err) {
      // Do NOT fall back to the body here. Once we know an authoritative record
      // should exist, silently dropping to a caller-supplied number would let a
      // spoofed low amount clear the ceiling whenever the lookup happens to
      // fail. Rethrow so the guard's fail-closed 503 path handles it.
      logger.error({ err, targetId }, "falkon: invoice amount lookup failed");
      throw err;
    }
  }

  return fromBody;
}

export function falkonMutationGuard() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (isPublicApiPath(req.path)) {
      next();
      return;
    }

    const classified = classifyMutation(req.method, req.path, req.body);
    if ("skip" in classified) {
      next();
      return;
    }

    const approvalHeader = req.headers["x-falkon-approval-id"];
    const approvalId = typeof approvalHeader === "string" ? approvalHeader : undefined;
    const correlationId =
      (typeof req.headers["x-correlation-id"] === "string" && req.headers["x-correlation-id"]) ||
      randomUUID();
    const targetId =
      (typeof req.params?.id === "string" && req.params.id) || targetIdFromPath(req.path);
    const amount = await resolveAmount(classified.targetType, targetId, req.body);

    try {
      const result = await enforceFalkonMutation({
        action: classified.action,
        actorChannel: actorChannelFromRequest(req),
        identity: req.haloIdentity,
        capability: typeof req.body?.capability === "string" ? req.body.capability : classified.action,
        targetType: classified.targetType,
        targetId,
        amount,
        propertyId: typeof req.body?.propertyId === "string" ? req.body.propertyId : null,
        approvalId,
        payload: { path: req.path, method: req.method },
        correlationId,
      });

      res.setHeader("X-Falkon-Decision", result.decision.code);
      res.setHeader("X-Correlation-Id", result.correlationId);

      if (result.decision.code === "ALLOW_AUTOMATIC") {
        next();
        return;
      }

      logger.info(
        {
          code: result.decision.code,
          action: classified.action,
          path: req.path,
          correlationId: result.correlationId,
          approvalId: result.approvalId,
        },
        "falkon: mutation gated",
      );
      res.status(httpStatusForDecision(result.decision.code)).json({
        ok: false,
        executed: false,
        decision: result.decision.code,
        reason: result.decision.reason,
        summary: result.decision.summary,
        approvalId: result.approvalId,
        correlationId: result.correlationId,
        actorChannel: result.decision.actorChannel,
        mode: result.decision.mode,
      });
    } catch (err) {
      logger.error({ err, path: req.path }, "falkon: policy guard failed closed");
      res.status(503).json({ error: "Falkon policy unavailable" });
    }
  };
}
