import type { Request, Response, NextFunction } from "express";
import { applyDemoSafe, isDemoSafeEnabled } from "@workspace/db";

/** When DEMO_SAFE=true, redact emails / phones / capturer names on JSON bodies. */
export function demoSafeJson(_req: Request, res: Response, next: NextFunction) {
  if (!isDemoSafeEnabled()) {
    next();
    return;
  }
  const orig = res.json.bind(res);
  res.json = ((body: unknown) => orig(applyDemoSafe(body))) as typeof res.json;
  next();
}
