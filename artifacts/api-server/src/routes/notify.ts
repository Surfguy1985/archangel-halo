import { Router, type IRouter } from "express";
import {
  sendDailyDigest,
  sendUrgentAlert,
  sendEveningClose,
  sendWeeklyScorecard,
  ADMIN_EMAIL,
} from "../lib/notifications";

const router: IRouter = Router();

const COOLDOWN_MS = 60 * 1000;
const lastSentAt: Record<string, number> = {};

function throttled(key: string): number | null {
  const now = Date.now();
  const prev = lastSentAt[key] ?? 0;
  const remaining = COOLDOWN_MS - (now - prev);
  if (remaining > 0) return Math.ceil(remaining / 1000);
  lastSentAt[key] = now;
  return null;
}

router.post("/notify/daily", async (_req, res): Promise<void> => {
  const wait = throttled("daily");
  if (wait !== null) {
    res.status(429).json({ error: `Just sent one. Try again in ${wait}s.` });
    return;
  }
  const result = await sendDailyDigest();
  res.json({ ok: true, to: ADMIN_EMAIL, ...result });
});

router.post("/notify/urgent", async (_req, res): Promise<void> => {
  const wait = throttled("urgent");
  if (wait !== null) {
    res.status(429).json({ error: `Just sent one. Try again in ${wait}s.` });
    return;
  }
  const result = await sendUrgentAlert();
  res.json({ ok: true, to: ADMIN_EMAIL, ...result });
});

router.post("/notify/close", async (_req, res): Promise<void> => {
  const wait = throttled("close");
  if (wait !== null) {
    res.status(429).json({ error: `Just sent one. Try again in ${wait}s.` });
    return;
  }
  const result = await sendEveningClose();
  res.json({ ok: true, to: ADMIN_EMAIL, ...result });
});

router.post("/notify/weekly", async (_req, res): Promise<void> => {
  const wait = throttled("weekly");
  if (wait !== null) {
    res.status(429).json({ error: `Just sent one. Try again in ${wait}s.` });
    return;
  }
  const result = await sendWeeklyScorecard();
  res.json({ ok: true, to: ADMIN_EMAIL, ...result });
});

export default router;
