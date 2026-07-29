import { EventEmitter } from "node:events";
import type { Response } from "express";

// ---------------------------------------------------------------------------
// Client-board live push (SSE)
//
// In-process pub/sub keyed by propertyId. Every mutation that changes what a
// client board (or the office mirror of it) shows calls emitBoardEvent(), and
// any open SSE stream for that property gets a tiny "changed" ping. Clients
// react by refetching their board query — the event carries no card data, so
// there is nothing sensitive to leak and no payload shape to keep in sync.
// ---------------------------------------------------------------------------

const bus = new EventEmitter();
// Many boards can be open at once (office + several client tabs per property).
bus.setMaxListeners(0);

export type BoardEventSource = "feed" | "dashboard";

/** Ping every open board stream for this property. Never throws. */
export function emitBoardEvent(propertyId: string, source: BoardEventSource = "feed"): void {
  try {
    bus.emit(`board:${propertyId}`, source);
  } catch (err) {
    console.error("emitBoardEvent failed:", err);
  }
}

/**
 * Attach an Express response as an SSE stream for one property's board.
 * Handles headers, heartbeats, and cleanup on disconnect.
 */
export function attachBoardStream(propertyId: string, res: Response): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`event: hello\ndata: {}\n\n`);

  const onChange = (source: BoardEventSource) => {
    res.write(`event: board\ndata: {"source":"${source}"}\n\n`);
  };
  bus.on(`board:${propertyId}`, onChange);

  // Keep intermediaries (the Replit proxy) from timing out an idle stream.
  const heartbeat = setInterval(() => {
    res.write(`: ping\n\n`);
  }, 25_000);

  const cleanup = () => {
    clearInterval(heartbeat);
    bus.off(`board:${propertyId}`, onChange);
  };
  res.on("close", cleanup);
  res.on("error", cleanup);
}
