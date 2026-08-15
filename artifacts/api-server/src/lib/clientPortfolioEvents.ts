/**
 * In-process portfolio bus for Client Board v1.
 *
 * HTTP SSE: `GET /v1/portfolios/:id/stream` and the client-token twin.
 * Segment 2 emits typed frames; Pulse (Segment 3) attaches and refetches.
 */

import { EventEmitter } from "node:events";
import type { Response } from "express";
import type { TurnStage } from "@workspace/db";
import { emitBoardEvent } from "./boardEvents";

const bus = new EventEmitter();
bus.setMaxListeners(0);

export type PortfolioSseFrame =
  | {
      type: "turn.stage_changed";
      turnId: string;
      propertyId: string;
      from: TurnStage | null;
      to: TurnStage;
      occurredAt: string;
    }
  | {
      type: "turn.metrics_updated";
      turnId: string;
      propertyId: string;
      isStalled: boolean;
    }
  | {
      type: "turn.predicted";
      turnId: string;
      propertyId: string;
      predictedReadyAt: string;
      confidence: string;
    }
  | {
      type: "bid.awarded";
      bidRequestId: string;
      turnId: string;
      propertyId: string;
      vendorOrgId: string;
      occurredAt: string;
      scores: Array<{ vendorOrgId: string; vendorName: string; score: number; awarded: boolean }>;
    };

export function emitPortfolioFrame(portfolioId: string, frame: PortfolioSseFrame): void {
  try {
    bus.emit(`portfolio:${portfolioId}`, frame);
  } catch (err) {
    console.error("emitPortfolioFrame failed:", err);
  }
}

export function onPortfolioFrame(
  portfolioId: string,
  handler: (frame: PortfolioSseFrame) => void,
): () => void {
  const key = `portfolio:${portfolioId}`;
  bus.on(key, handler);
  return () => {
    bus.off(key, handler);
  };
}

/**
 * Attach an Express response as an SSE stream for one portfolio.
 * Emits `event: pulse` so the UI can tween headline + status dots.
 */
export function attachPortfolioStream(
  portfolioId: string,
  res: Response,
  eventName = "pulse",
): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`event: hello\ndata: {}\n\n`);

  const onFrame = (frame: PortfolioSseFrame) => {
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(frame)}\n\n`);
  };
  const off = onPortfolioFrame(portfolioId, onFrame);

  const heartbeat = setInterval(() => {
    res.write(`: ping\n\n`);
  }, 25_000);

  const cleanup = () => {
    clearInterval(heartbeat);
    off();
  };
  res.on("close", cleanup);
  res.on("error", cleanup);
}

/** Property board ping + typed frame on every portfolio that contains the property. */
export function publishTurnBoardChange(
  propertyId: string,
  portfolioIds: string[],
  frame: PortfolioSseFrame,
): void {
  emitBoardEvent(propertyId, "feed");
  for (const id of portfolioIds) emitPortfolioFrame(id, frame);
}
