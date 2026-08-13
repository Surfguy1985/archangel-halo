/**
 * rate-limit.ts — fixed-window limiter for the routes that move money or
 * guess credentials. In-memory, zero dependencies: right-sized for a
 * single-process Replit deployment. (If you ever run multiple instances,
 * swap the Map for Redis — the interface below doesn't change.)
 *
 * Mount points (from the audit):
 *   POST /api/pay/:token/*                      — payment approval
 *   POST /api/client/:token/board/cards/:cardId/action — module actions (approve/pay)
 *   POST /api/client/:token/board/login          — credential guessing
 *   POST /api/client/:token/session              — token guessing
 *   POST /api/portal/:token/bank                 — crew bank details
 *
 * Keying: token + IP together. Token alone lets one bad actor lock a property
 * out (griefing); IP alone lets a botnet spread guesses thin.
 */

import type { NextFunction, Request, Response } from 'express';

interface Window {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Window>();

// Bound memory: sweep expired windows once a minute.
const sweeper: { unref?: () => void } = setInterval(() => {
  const now = Date.now();
  for (const [k, w] of buckets) if (w.resetAt <= now) buckets.delete(k);
}, 60_000) as unknown as { unref?: () => void };
sweeper.unref?.(); // don't hold the process open in tests/scripts

export interface LimitOpts {
  /** requests allowed per window */
  limit: number;
  /** window length in ms */
  windowMs: number;
  /** what to key on; defaults to token-or-path + IP */
  key?: (req: Request) => string;
}

export function rateLimit({ limit, windowMs, key }: LimitOpts) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
      req.socket.remoteAddress ??
      'unknown';
    const k = key ? key(req) : `${req.params.token ?? req.path}:${ip}`;

    const now = Date.now();
    let w = buckets.get(k);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + windowMs };
      buckets.set(k, w);
    }
    w.count += 1;

    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - w.count)));

    if (w.count > limit) {
      const retryS = Math.ceil((w.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryS));
      res.status(429).json({ error: 'Too many requests — slow down and retry shortly' });
      return;
    }
    next();
  };
}

// Presets tuned per surface: strict where money moves or credentials are
// guessed; generous where a legitimate user might click fast.
export const limits = {
  /** payment approval — nobody legitimately approves 10 payments/min from one link */
  pay: rateLimit({ limit: 10, windowMs: 60_000 }),
  /** card module actions — drag-happy users are fine, scripts are not */
  cardAction: rateLimit({ limit: 30, windowMs: 60_000 }),
  /** login — brute force is the only reason to exceed this */
  login: rateLimit({ limit: 5, windowMs: 60_000 }),
  /** session mint / token probing */
  session: rateLimit({ limit: 10, windowMs: 60_000 }),
  /** bank detail writes */
  bank: rateLimit({ limit: 5, windowMs: 60_000 }),
  /** 30-second GPS breadcrumb pings — 1 legit ping per 30s, allow retries */
  trackPoint: rateLimit({ limit: 10, windowMs: 60_000 }),
  /** passcode-free Walk app writes — a PM taps at human speed, scripts don't */
  walkWrite: rateLimit({ limit: 30, windowMs: 60_000 }),
  /** PM live chat — conversation-speed, not scraping */
  pmChat: rateLimit({ limit: 30, windowMs: 5 * 60_000 }),
  /** PM live view bundle */
  pmView: rateLimit({ limit: 60, windowMs: 60_000 }),
};

/**
 * Wiring example:
 *
 *   import { limits } from './rate-limit';
 *   app.post('/api/client/:token/board/login', limits.login, loginHandler);
 *   app.post('/api/client/:token/session', limits.session, exchangeHandler);
 *   app.post('/api/client/:token/board/cards/:cardId/action', limits.cardAction, actionHandler);
 *   app.use('/api/pay/:token', limits.pay);
 *   app.post('/api/portal/:token/bank', limits.bank, bankHandler);
 */
