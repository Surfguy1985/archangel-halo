/**
 * session-auth.ts — gets the capability token out of every URL.
 *
 * TODAY: every client call is /client/{token}/... and every crew call is
 * /portal/{token}/... A bearer credential in the URL path leaks into server
 * access logs, proxy logs, browser history, and the Referer header of any
 * outbound link click — on a surface that approves invoices and stores bank
 * details. Highest-severity finding in the audit.
 *
 * FIX (zero-breakage migration):
 *   1. The emailed link keeps its token — one click, no login wall. UNCHANGED.
 *   2. First request: frontend calls POST /client/{token}/session. Server
 *      validates the token ONCE and mints an httpOnly SameSite=Strict cookie.
 *   3. Middleware accepts cookie-OR-path-token during migration; every request
 *      that arrives with a valid cookie never re-exposes the token.
 *   4. When you're ready, flip STRICT_MODE and path tokens stop being
 *      honored for state-changing requests.
 *
 * Reference implementation (server code isn't in the zip) — Express +
 * cookie-parser assumed; the two seams are marked.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, clientAccountsTable } from '@workspace/db';
import { resolveClientBoardLink, sessionSubjectForLink } from './clientBoardLink';

/** The same token->property lookup the board feed endpoints already use. */
export async function resolveClientPropertyIdForToken(token: string): Promise<string | null> {
  const [account] = await db
    .select({ propertyId: clientAccountsTable.propertyId, status: clientAccountsTable.status })
    .from(clientAccountsTable)
    .where(eq(clientAccountsTable.dashboardToken, token))
    .limit(1);
  if (!account || account.status !== 'active') return null;
  return account.propertyId;
}

/**
 * Same lookup but WITHOUT the active-status gate. The session exchange and the
 * cookie↔path match use this so paused accounts (billing resume in ClientAdmin)
 * can still mint and use a cookie in strict mode. Handlers keep doing their own
 * status validation — a cookie only proves "this browser clicked a real link
 * for this property", never "this account is active".
 */
export async function resolveClientPropertyIdForTokenAnyStatus(
  token: string,
): Promise<{ propertyId: string; status: string } | null> {
  const [account] = await db
    .select({ propertyId: clientAccountsTable.propertyId, status: clientAccountsTable.status })
    .from(clientAccountsTable)
    .where(eq(clientAccountsTable.dashboardToken, token))
    .limit(1);
  if (!account) return null;
  return { propertyId: account.propertyId, status: account.status };
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const COOKIE_NAME = 'halo_client_session'; // matches securitySchemes in the spec
const SESSION_TTL_S = 60 * 60 * 12; // 12h; the emailed link re-mints on next click
const STRICT_MODE = true; // all client surfaces now perform the /session exchange on load

// Seam: set SESSION_SECRET in Replit Secrets. Refusing to boot without it is
// the point — a guessable default here is a forged-session generator.
const SECRET = process.env.SESSION_SECRET ?? '';
if (!SECRET) throw new Error('SESSION_SECRET is not set (Replit → Secrets)');

// ---------------------------------------------------------------------------
// Stateless signed session value: propertyId.expiry.nonce.hmac
// No session table needed; revocation = the existing token regenerate endpoint
// (regenerating rotates propertyToken, which invalidates future mints, and the
// short TTL bounds existing cookies).
// ---------------------------------------------------------------------------

function sign(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('base64url');
}

function mintSession(propertyId: string): string {
  const payload = `${propertyId}.${Math.floor(Date.now() / 1000) + SESSION_TTL_S}.${randomBytes(9).toString('base64url')}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySession(cookie: string | undefined): { propertyId: string } | null {
  if (!cookie) return null;
  const i = cookie.lastIndexOf('.');
  if (i < 0) return null;
  const payload = cookie.slice(0, i);
  const mac = cookie.slice(i + 1);
  const expected = sign(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [propertyId, expStr] = payload.split('.');
  if (!propertyId || !expStr) return null;
  if (Number(expStr) < Math.floor(Date.now() / 1000)) return null;
  return { propertyId };
}

// ---------------------------------------------------------------------------
// POST /api/client/:token/session — the exchange (in the hardened spec)
// ---------------------------------------------------------------------------

export function clientSessionExchangeHandler() {
  return async (req: Request, res: Response) => {
    const link = await resolveClientBoardLink(String(req.params.token));
    if (!link) {
      const paused = await resolveClientPropertyIdForTokenAnyStatus(String(req.params.token));
      if (!paused) {
        res.status(404).json({ error: 'Invalid link' });
        return;
      }
      res.cookie(COOKIE_NAME, mintSession(paused.propertyId), {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        maxAge: SESSION_TTL_S * 1000,
        path: '/api',
      });
      res.status(204).end();
      return;
    }
    res.cookie(COOKIE_NAME, mintSession(sessionSubjectForLink(link)), {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: SESSION_TTL_S * 1000,
      path: '/api',
    });
    res.status(204).end();
  };
}

// ---------------------------------------------------------------------------
// Middleware for every /client/:token/* route
// ---------------------------------------------------------------------------

export function clientAuth(
  resolvePropertyIdForToken: (token: string) => Promise<string | null>,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Preferred path: the cookie. Token never travels after the first click.
    const session = verifySession(req.cookies?.[COOKIE_NAME]);
    if (session) {
      const link = await resolveClientBoardLink(String(req.params.token));
      if (link && session.propertyId === sessionSubjectForLink(link)) {
        if (link.propertyId) (req as any).propertyId = link.propertyId;
        (req as any).authVia = 'cookie';
        return next();
      }
      const pathAccount = await resolveClientPropertyIdForTokenAnyStatus(String(req.params.token));
      if (pathAccount && pathAccount.propertyId === session.propertyId) {
        if (pathAccount.status === 'active') {
          (req as any).propertyId = session.propertyId;
        }
        (req as any).authVia = 'cookie';
        return next();
      }
    }

    // Migration path: honor the raw token, but only outside strict mode for
    // anything that changes state or moves money. Pulse login is the bootstrap
    // that mints the PM bearer token — it must work before a session cookie
    // exists (the browser still POSTs /session first; API clients and tests
    // may call login directly).
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const isPulseLogin = /\/board\/login\/?$/.test(req.path);
    if (STRICT_MODE && mutating && !isPulseLogin) {
      res.status(401).json({ error: 'Session required — reopen your board link' });
      return;
    }
    const propertyId = await resolvePropertyIdForToken(String(req.params.token));
    if (!propertyId) {
      // Don't reject here: some /client/:token routes legitimately serve
      // non-active accounts (e.g. billing resume for paused accounts). Each
      // handler keeps doing its own token/status validation, exactly as
      // before this middleware existed.
      next();
      return;
    }
    (req as any).propertyId = propertyId;
    (req as any).authVia = 'token';
    next();
  };
}

/**
 * Frontend companion (one-time, in the client board bootstrap):
 *
 *   useEffect(() => {
 *     fetch(`/api/client/${token}/session`, { method: 'POST', credentials: 'include' })
 *       .catch(() => {}); // best-effort; token path still works during migration
 *   }, [token]);
 *
 * Log hygiene that must ship WITH this file, not later:
 *   - redact the token path segment in your request logger:
 *       req.url.replace(/(\/(client|portal|pay|track|recap-shares|photo-shares|job-summaries)\/)[^/]+/, '$1<redacted>')
 *   - add `Referrer-Policy: no-referrer` on board HTML responses so outbound
 *     links stop carrying the tokened URL.
 */
