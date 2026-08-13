/**
 * Express middleware: one Falkon policy boundary for mutating HTTP APIs.
 */

import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { classifyMutation, httpStatusForDecision, targetIdFromPath } from "./falkonPolicyCore";
import { enforceFalkonMutation } from "./falkonPolicy";
import { logger } from "./logger";
import type { FalkonActorChannel } from "./falkonPolicyCore";
import { isPublicApiPath } from "./officeAuth";

function actorChannel(req: Request): FalkonActorChannel {
  if (req.path === "/command/actions/execute") return "ai";
  if (req.headers["x-halo-actor-channel"] === "worker") return "worker";
  if (req.haloIdentity) return "human";
  return "s2s";
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
    const amount =
      typeof req.body?.amount === "number"
        ? req.body.amount
        : typeof req.body?.total === "number"
          ? req.body.total
          : null;

    try {
      const result = await enforceFalkonMutation({
        action: classified.action,
        actorChannel: actorChannel(req),
        identity: req.haloIdentity,
        capability: typeof req.body?.capability === "string" ? req.body.capability : classified.action,
        targetType: classified.targetType,
        targetId:
          (typeof req.params?.id === "string" && req.params.id) || targetIdFromPath(req.path),
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
