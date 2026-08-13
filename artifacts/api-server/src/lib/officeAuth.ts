// officeAuth.ts — passcode gate for the office API surface.
//
// The office apps (HALO mobile + desktop) were historically unauthenticated:
// anyone with the URL could call /jobs, /invoices, /admin/*, /settings, ...
// This module closes that. The passcode hash lives in business_settings
// (survives the Settings data reset, like all business config). A successful
// setup/login mints a signed httpOnly cookie; the guard below rejects every
// non-public API call without it.
//
// Public (token- or webhook-authenticated) surfaces stay open:
//   /client/*  /pay/*  /portal/*  /track/*  /recap-shares/*  /photo-shares/*
//   /job-summaries/*  /storage/*  /vapi/*  /healthz  /office-auth/*
// plus GET /presentation/demo (the client board polls demo state) and the
// single presentation-demo board action the demo audience's browser drives.
import {
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, businessSettingsTable } from "@workspace/db";
import { getBusinessSettings } from "./businessSettings";
import { getPresentationDemoState } from "./presentationDemo";
import { limits, rateLimit } from "./rateLimit";
import { sendEmail } from "./email";

const COOKIE_NAME = "halo_office_session";
const WALK_COOKIE_NAME = "halo_walk_session";
const SESSION_TTL_S = 60 * 60 * 24 * 30; // 30 days per device
const SECRET = process.env.SESSION_SECRET ?? "";
if (!SECRET) throw new Error("SESSION_SECRET is not set (Replit → Secrets)");

// ---------------------------------------------------------------------------
// Passcode hashing (scrypt, per-hash salt)
// ---------------------------------------------------------------------------

function hashPasscode(passcode: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(passcode, salt, 64);
  return `s2:${salt.toString("base64url")}:${hash.toString("base64url")}`;
}

function verifyPasscode(passcode: string, stored: string): boolean {
  const [v, saltB64, hashB64] = stored.split(":");
  if (v !== "s2" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64url");
  const actual = scryptSync(passcode, Buffer.from(saltB64, "base64url"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ---------------------------------------------------------------------------
// Stateless signed session cookie: office.<expiry>.<nonce>.<hmac>
// Rotating the passcode does not need to revoke cookies (single-org office);
// clearing SESSION_SECRET would.
// ---------------------------------------------------------------------------

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

function mintSession(scope: "office" | "walk"): string {
  const payload = `${scope}.${Math.floor(Date.now() / 1000) + SESSION_TTL_S}.${randomBytes(9).toString("base64url")}`;
  return `${payload}.${sign(payload)}`;
}

function verifySessionScoped(cookie: string | undefined, expected: "office" | "walk"): boolean {
  if (!cookie) return false;
  const i = cookie.lastIndexOf(".");
  if (i < 0) return false;
  const payload = cookie.slice(0, i);
  const mac = cookie.slice(i + 1);
  const a = Buffer.from(mac);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const [scope, expStr] = payload.split(".");
  if (scope !== expected || !expStr) return false;
  return Number(expStr) >= Math.floor(Date.now() / 1000);
}

export function verifyOfficeSession(cookie: string | undefined): boolean {
  return verifySessionScoped(cookie, "office");
}

export function verifyWalkSession(cookie: string | undefined): boolean {
  return verifySessionScoped(cookie, "walk");
}

function setSessionCookie(res: Response, scope: "office" | "walk" = "office"): void {
  res.cookie(scope === "walk" ? WALK_COOKIE_NAME : COOKIE_NAME, mintSession(scope), {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: SESSION_TTL_S * 1000,
    path: "/api",
  });
}

// ---------------------------------------------------------------------------
// Passcode-hash cache (avoid a settings query on every office request)
// ---------------------------------------------------------------------------

let cachedHash: string | null | undefined; // undefined = not loaded yet
let cachedWalkHash: string | null | undefined;
let cachedAt = 0;
const CACHE_TTL_MS = 10_000;

async function loadHashes(): Promise<void> {
  const now = Date.now();
  if (cachedHash !== undefined && now - cachedAt < CACHE_TTL_MS) return;
  const settings = await getBusinessSettings();
  cachedHash = settings.officePasscodeHash ?? null;
  cachedWalkHash = settings.walkPasscodeHash ?? null;
  cachedAt = now;
}

async function passcodeHash(): Promise<string | null> {
  await loadHashes();
  return cachedHash ?? null;
}

async function walkPasscodeHash(): Promise<string | null> {
  await loadHashes();
  return cachedWalkHash ?? null;
}

function invalidateHashCache(): void {
  cachedHash = undefined;
  cachedWalkHash = undefined;
}

// ---------------------------------------------------------------------------
// Guard middleware
// ---------------------------------------------------------------------------

// Token-authenticated, public-share, or webhook surfaces. Everything else on
// /api is office-only.
export const PUBLIC_PREFIXES = [
  "/office-auth",
  "/walk-auth",
  "/healthz",
  "/client/",
  "/pay/",
  "/portal/",
  "/track/",
  "/recap-shares/",
  "/photo-shares/",
  "/job-summaries/",
  "/storage/",
  "/vapi/",
  // Source legal PDFs that crews must read during onboarding — no office
  // session needed; the template key + form code are not secret.
  "/packets/templates/",
  // Presentation Mode: an unauthenticated audience device drives the scripted
  // card lifecycle and renders the office-side board. Both endpoints are
  // token-guarded (current demo dashboardToken + active demo) and only ever
  // touch the demo property's data, so exempting them from the passcode gate
  // is safe. See routes/presentation.ts.
  "/presentation/demo/step",
  "/presentation/demo/office-board",
  // Falkon Ops inbound webhook and round-trip ping — HMAC-signed by Falkon,
  // verified in routes/falkon.ts before any processing.
  "/falkon/inbound/",
  "/falkon/ping",
  // Falkon Phase 1: Ed25519-verified inbound webhook + trust document
  "/falkon/webhook",
  "/.well-known/",
  // Falkon Network Phase 1: public capability catalog (external peers need to discover HALO)
  "/falkon/network/capabilities",
  // PM live view — token-validated, property-scoped, sent via SMS to property managers
  "/live/",
  // Crew check-in — one-tap GPS check-in/checkout via a texted link, no login needed
  "/checkin/",
];

// Walk app routes are gated by their OWN passcode (separate from the office
// one) via the halo_walk_session cookie. Office sessions also pass, so a
// signed-in office device can use Walk. Walks may target any ACTIVE property
// (GPS nearest-pick in routes/walks.ts — the shared walk passcode is an
// office field credential, so cross-property access is intentional) and every
// mutation is rate-limited there. Boundary-anchored so a future
// "/walks-report" style route does NOT silently join this bucket.
const WALK_RE = /^\/(walk-target$|walks(\/|$)|walk-captures\/)/;

const DEMO_ACTION_RE = /^\/admin\/accounts\/([^/]+)\/board\/actions$/;

export function isPublicApiPath(path: string): boolean {
  return PUBLIC_PREFIXES.some((p) => path.startsWith(p));
}

export function isIdentityExemptPath(path: string, method: string): boolean {
  if (isPublicApiPath(path)) return true;
  if (WALK_RE.test(path)) return true;
  if ((method === "GET" || method === "HEAD") && path === "/presentation/demo") return true;
  return false;
}

export function officeGuard() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.method === "OPTIONS") return next();
    const path = req.path;
    if (isPublicApiPath(path)) return next();
    // Enforcer bearer tokens are verified by enforcerGuard — do not require
    // the office cookie when a Bearer credential is present.
    const authz = req.headers.authorization;
    if (typeof authz === "string" && /^Bearer\s+\S+/i.test(authz)) return next();
    if (WALK_RE.test(path)) {
      if (
        verifyWalkSession(req.cookies?.[WALK_COOKIE_NAME]) ||
        verifyOfficeSession(req.cookies?.[COOKIE_NAME])
      )
        return next();
      const configured = (await walkPasscodeHash()) !== null;
      res.status(401).json({
        error: configured ? "Walk sign-in required" : "Walk passcode setup required",
        setupRequired: !configured,
      });
      return;
    }
    // The client board polls demo state to know a presentation is running.
    if ((req.method === "GET" || req.method === "HEAD") && path === "/presentation/demo")
      return next();
    if (verifyOfficeSession(req.cookies?.[COOKIE_NAME])) return next();
    // Presentation Mode: while the demo is live, the audience's browser drives
    // the scripted card moves against the DEMO property's board only. Scope is
    // deliberately tiny: card.moved only, rate-limited like any card action —
    // never the full admin action surface.
    if (req.method === "POST") {
      const m = DEMO_ACTION_RE.exec(path);
      if (m && req.body?.action === "card.moved") {
        try {
          const demo = await getPresentationDemoState();
          if (demo?.active && demo.propertyId === m[1]) {
            limits.cardAction(req, res, next);
            return;
          }
        } catch {
          /* fall through to 401 */
        }
      }
    }
    const configured = (await passcodeHash()) !== null;
    res.status(401).json({
      error: configured
        ? "Office sign-in required"
        : "Office passcode setup required",
      setupRequired: !configured,
    });
  };
}

// ---------------------------------------------------------------------------
// Routes: status / setup / login / logout
// ---------------------------------------------------------------------------

const router: IRouter = Router();

router.get("/office-auth/status", async (req, res): Promise<void> => {
  const hash = await passcodeHash();
  res.json({
    configured: hash !== null,
    authenticated: verifyOfficeSession(req.cookies?.[COOKIE_NAME]),
  });
});

// One-time setup: only possible while no passcode exists. Guarded by a
// row-count check so two racing setups can't both win.
router.post("/office-auth/setup", limits.login, async (req, res): Promise<void> => {
  const passcode = typeof req.body?.passcode === "string" ? req.body.passcode.trim() : "";
  if (passcode.length < 6 || passcode.length > 128) {
    res.status(400).json({ error: "Passcode must be at least 6 characters" });
    return;
  }
  const settings = await getBusinessSettings();
  if (settings.officePasscodeHash) {
    res.status(409).json({ error: "A passcode is already set — sign in instead" });
    return;
  }
  const updated = await db
    .update(businessSettingsTable)
    .set({ officePasscodeHash: hashPasscode(passcode), updatedAt: new Date() })
    // Atomic first-wins: the NULL condition makes two racing setups impossible
    // — the second one matches zero rows and gets the 409 below.
    .where(and(eq(businessSettingsTable.id, settings.id), isNull(businessSettingsTable.officePasscodeHash)))
    .returning({ id: businessSettingsTable.id });
  invalidateHashCache();
  if (!updated.length) {
    res.status(409).json({ error: "Setup failed — reload and try again" });
    return;
  }
  setSessionCookie(res);
  res.json({ ok: true });
});

router.post("/office-auth/login", limits.login, async (req, res): Promise<void> => {
  const passcode = typeof req.body?.passcode === "string" ? req.body.passcode.trim() : "";
  const hash = await passcodeHash();
  if (!hash) {
    res.status(409).json({ error: "No passcode set yet", setupRequired: true });
    return;
  }
  if (!passcode || !verifyPasscode(passcode, hash)) {
    res.status(401).json({ error: "Wrong passcode" });
    return;
  }
  setSessionCookie(res);
  res.json({ ok: true });
});

// Change passcode: requires an authenticated office session AND the current
// passcode (defense in depth against an unattended signed-in device).
router.post("/office-auth/change", limits.login, async (req, res): Promise<void> => {
  if (!verifyOfficeSession(req.cookies?.[COOKIE_NAME])) {
    res.status(401).json({ error: "Office sign-in required" });
    return;
  }
  const current = typeof req.body?.current === "string" ? req.body.current.trim() : "";
  const next = typeof req.body?.next === "string" ? req.body.next.trim() : "";
  const hash = await passcodeHash();
  if (!hash || !verifyPasscode(current, hash)) {
    res.status(401).json({ error: "Current passcode is wrong" });
    return;
  }
  if (next.length < 6 || next.length > 128) {
    res.status(400).json({ error: "New passcode must be at least 6 characters" });
    return;
  }
  const settings = await getBusinessSettings();
  await db
    .update(businessSettingsTable)
    .set({ officePasscodeHash: hashPasscode(next), updatedAt: new Date() })
    .where(eq(businessSettingsTable.id, settings.id));
  invalidateHashCache();
  res.json({ ok: true });
});

router.post("/office-auth/logout", async (_req, res): Promise<void> => {
  res.clearCookie(COOKIE_NAME, { path: "/api" });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Passcode reset via email: single-use signed token, 1-hour expiry.
//
// Flow:
//   1. POST /office-auth/forgot  → generates & emails a reset link
//   2. POST /office-auth/reset   → token in body; clears hash → setup screen
//
// Token format:  <expiry_s>.<nonce>.<hmac(SECRET, "reset:<expiry>.<nonce>")>
//
// Single-use guarantee (restart-safe):
//   The SHA-256 hash of the nonce is stored in business_settings alongside its
//   expiry.  The /reset handler atomically clears both the token hash and the
//   passcode hash in one UPDATE … WHERE reset_token_hash = ? AND
//   reset_token_expires_at > NOW().  A server restart cannot replay a consumed
//   token because the DB row is already cleared.  A new /forgot call overwrites
//   the stored hash, invalidating any outstanding link.
// ---------------------------------------------------------------------------

const RESET_TTL_S = 60 * 60; // 1 hour

/** Mint a reset token and return the token string plus the raw nonce for storage. */
function mintResetToken(): { token: string; nonce: string; expiresAt: Date } {
  const expiry = Math.floor(Date.now() / 1000) + RESET_TTL_S;
  const nonce = randomBytes(18).toString("base64url");
  const payload = `${expiry}.${nonce}`;
  const mac = createHmac("sha256", SECRET).update(`reset:${payload}`).digest("base64url");
  return {
    token: `${payload}.${mac}`,
    nonce,
    expiresAt: new Date(expiry * 1000),
  };
}

/** SHA-256 hex of a nonce — what we store in the DB (not the full token). */
function hashNonce(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
}

/**
 * Verify the HMAC signature and expiry of a reset token.
 * Does NOT check single-use — that is enforced by the DB UPDATE in /reset.
 */
function verifyResetTokenSignature(token: string): { ok: true; nonce: string } | { ok: false; reason: string } {
  const parts = token.split(".");
  if (parts.length < 3) return { ok: false, reason: "malformed" };
  const mac = parts[parts.length - 1];
  const payload = parts.slice(0, -1).join(".");
  const expected = createHmac("sha256", SECRET).update(`reset:${payload}`).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "invalid" };
  const [expStr, nonce] = payload.split(".");
  if (!expStr || !nonce) return { ok: false, reason: "malformed" };
  if (Number(expStr) < Math.floor(Date.now() / 1000)) return { ok: false, reason: "expired" };
  return { ok: true, nonce };
}

// Strict rate limit: max 2 reset-email requests per IP per hour.
const resetRequestLimit = rateLimit({ limit: 2, windowMs: 60 * 60_000 });

// The reset link itself is also rate-limited (5 attempts/hour per IP) so a
// leaked token can't be brute-forced even before it expires.
const resetUseLimit = rateLimit({ limit: 5, windowMs: 60 * 60_000 });

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

router.post("/office-auth/forgot", resetRequestLimit, async (req, res): Promise<void> => {
  const hash = await passcodeHash();
  if (!hash) {
    // No passcode set — nothing to reset, just redirect to setup.
    res.status(400).json({ error: "No passcode is set. Use the setup screen instead." });
    return;
  }
  const settings = await getBusinessSettings();
  const email = settings.email;
  if (!email) {
    res.status(400).json({
      error: "No business email is on file. Contact your system administrator to clear the passcode manually.",
    });
    return;
  }

  const { token, nonce, expiresAt } = mintResetToken();
  // Persist the token hash in the DB before sending the email so that even if
  // the server restarts between send and use, the consumed state is durable.
  await db
    .update(businessSettingsTable)
    .set({
      resetTokenHash: hashNonce(nonce),
      resetTokenExpiresAt: expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(businessSettingsTable.id, settings.id));

  // Construct the reset URL from the server-configured canonical origin.
  // We never use request headers (Host / X-Forwarded-Host) here — an
  // unauthenticated caller could forge them and redirect the reset token to
  // an attacker-controlled domain.  Instead we prefer, in order:
  //   1. APP_ORIGIN env var (explicit override, e.g. in production)
  //   2. REPLIT_DOMAINS (comma-separated; first entry is the published domain)
  //   3. REPLIT_DEV_DOMAIN (dev preview domain)
  // The link always lands on the root office app ( / ), not /desktop —
  // desktop users are redirected there by the desktop gate after reset.
  const origin = (() => {
    if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/$/, "");
    const replitDomains = process.env.REPLIT_DOMAINS;
    if (replitDomains) {
      const first = replitDomains.split(",")[0]?.trim();
      if (first) return `https://${first}`;
    }
    const devDomain = process.env.REPLIT_DEV_DOMAIN;
    if (devDomain) return `https://${devDomain}`;
    // Last resort: nothing configured — refuse to send a link with an unknown origin.
    return null;
  })();
  if (!origin) {
    res.status(503).json({ error: "Server origin is not configured — cannot generate a safe reset link. Set APP_ORIGIN or deploy on Replit." });
    return;
  }
  const resetUrl = `${origin}/?reset=${encodeURIComponent(token)}`;

  const company = settings.companyName || "HALO Office";
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f2ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f2ee;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr><td style="background:#17181c;border-radius:14px 14px 0 0;padding:22px 26px;">
          <div style="font-size:12px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#B4FF44;">${escHtml(company)}</div>
          <div style="font-size:22px;font-weight:800;color:#ffffff;margin-top:6px;">Office passcode reset</div>
        </td></tr>
        <tr><td style="background:#ffffff;padding:24px 26px;border-radius:0 0 14px 14px;box-shadow:0 1px 3px rgba(23,24,28,0.08);">
          <p style="font-size:15px;color:#3a3c42;line-height:1.6;margin:0 0 14px 0;">Someone requested a passcode reset for the ${escHtml(company)} office. If that was you, click the button below to clear the passcode and set a new one.</p>
          <div style="text-align:center;margin:24px 0;">
            <a href="${escHtml(resetUrl)}" style="display:inline-block;background:#B4FF44;color:#000000;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;padding:12px 28px;">Reset passcode</a>
          </div>
          <p style="font-size:13px;color:#6b6e77;line-height:1.6;margin:0 0 8px 0;">This link expires in <strong>1 hour</strong> and can only be used once. If you didn't request a reset, ignore this email — your passcode hasn't changed.</p>
          <p style="font-size:12px;color:#9a9da4;line-height:1.5;margin:0;word-break:break-all;">If the button doesn't work, copy this URL into your browser:<br>${escHtml(resetUrl)}</p>
        </td></tr>
        <tr><td style="padding:16px 8px 4px 8px;">
          <div style="font-size:12px;color:#9a9da4;line-height:1.5;text-align:center;">${escHtml(company)} · HALO Office Access</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const result = await sendEmail({
    to: email,
    subject: `${company} — office passcode reset link`,
    html,
  });

  if (!result.ok) {
    res.status(502).json({ error: result.error ?? "Failed to send reset email" });
    return;
  }
  res.json({ ok: true, sentTo: email });
});

router.post("/office-auth/reset", resetUseLimit, async (req, res): Promise<void> => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  const passcode = typeof req.body?.passcode === "string" ? req.body.passcode.trim() : "";
  if (!token) {
    res.status(400).json({ error: "Reset token is required" });
    return;
  }
  if (passcode.length < 6 || passcode.length > 128) {
    res.status(400).json({ error: "New passcode must be at least 6 characters" });
    return;
  }
  // 1. Verify HMAC signature and expiry (stateless checks — fast, no DB hit).
  const verified = verifyResetTokenSignature(token);
  if (!verified.ok) {
    res.status(400).json({ error: `Reset link is ${verified.reason}. Request a new one.` });
    return;
  }
  // 2. Atomically consume the token AND set the new passcode in one UPDATE.
  //    The WHERE clause matches only the row with the stored nonce hash and a
  //    non-expired expiry — making the operation single-use and restart-safe.
  //    Crucially, the new passcode hash is written in the same statement so
  //    there is no window between "passcode cleared" and "new passcode set"
  //    that a racing /setup call could exploit.
  const settings = await getBusinessSettings();
  const consumed = await db
    .update(businessSettingsTable)
    .set({
      officePasscodeHash: hashPasscode(passcode),
      resetTokenHash: null,
      resetTokenExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(businessSettingsTable.id, settings.id),
        eq(businessSettingsTable.resetTokenHash, hashNonce(verified.nonce)),
        sql`${businessSettingsTable.resetTokenExpiresAt} > now()`,
      ),
    )
    .returning({ id: businessSettingsTable.id });

  if (!consumed.length) {
    res.status(400).json({ error: "Reset link has already been used or has expired. Request a new one." });
    return;
  }
  invalidateHashCache();
  // Issue a session cookie so the user is immediately signed in with the new passcode.
  setSessionCookie(res);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Walk app auth: its own passcode, its own cookie. Same shape as office-auth.
// ---------------------------------------------------------------------------

router.get("/walk-auth/status", async (req, res): Promise<void> => {
  const hash = await walkPasscodeHash();
  res.json({
    configured: hash !== null,
    authenticated:
      verifyWalkSession(req.cookies?.[WALK_COOKIE_NAME]) ||
      verifyOfficeSession(req.cookies?.[COOKIE_NAME]),
  });
});

// One-time setup while no walk passcode exists. Requires office authority so
// a stranger can't claim the walk lock first: either an office session cookie
// or the office passcode sent inline (the Walk lock screen asks for it).
router.post("/walk-auth/setup", limits.login, async (req, res): Promise<void> => {
  if (!verifyOfficeSession(req.cookies?.[COOKIE_NAME])) {
    const officePasscode =
      typeof req.body?.officePasscode === "string" ? req.body.officePasscode.trim() : "";
    const officeHash0 = await passcodeHash();
    if (!officeHash0 || !officePasscode || !verifyPasscode(officePasscode, officeHash0)) {
      res.status(401).json({ error: "Office passcode required to set the Walk passcode" });
      return;
    }
  }
  const passcode = typeof req.body?.passcode === "string" ? req.body.passcode.trim() : "";
  if (passcode.length < 6 || passcode.length > 128) {
    res.status(400).json({ error: "Passcode must be at least 6 characters" });
    return;
  }
  const officeHash = await passcodeHash();
  if (officeHash && verifyPasscode(passcode, officeHash)) {
    res.status(400).json({ error: "Walk passcode must be different from the office passcode" });
    return;
  }
  const settings = await getBusinessSettings();
  if (settings.walkPasscodeHash) {
    res.status(409).json({ error: "A Walk passcode is already set" });
    return;
  }
  const updated = await db
    .update(businessSettingsTable)
    .set({ walkPasscodeHash: hashPasscode(passcode), updatedAt: new Date() })
    // Atomic first-wins, same as office setup.
    .where(and(eq(businessSettingsTable.id, settings.id), isNull(businessSettingsTable.walkPasscodeHash)))
    .returning({ id: businessSettingsTable.id });
  invalidateHashCache();
  if (!updated.length) {
    res.status(409).json({ error: "Setup failed — reload and try again" });
    return;
  }
  setSessionCookie(res, "walk");
  res.json({ ok: true });
});

router.post("/walk-auth/login", limits.login, async (req, res): Promise<void> => {
  const passcode = typeof req.body?.passcode === "string" ? req.body.passcode.trim() : "";
  const hash = await walkPasscodeHash();
  if (!hash) {
    res.status(409).json({ error: "No Walk passcode set yet", setupRequired: true });
    return;
  }
  if (!passcode || !verifyPasscode(passcode, hash)) {
    res.status(401).json({ error: "Wrong passcode" });
    return;
  }
  setSessionCookie(res, "walk");
  res.json({ ok: true });
});

// Change the Walk passcode from a signed-in office device (no current walk
// passcode needed — the office owns it and may need to reset a lost one).
router.post("/walk-auth/change", limits.login, async (req, res): Promise<void> => {
  if (!verifyOfficeSession(req.cookies?.[COOKIE_NAME])) {
    res.status(401).json({ error: "Office sign-in required" });
    return;
  }
  const next = typeof req.body?.next === "string" ? req.body.next.trim() : "";
  if (next.length < 6 || next.length > 128) {
    res.status(400).json({ error: "New passcode must be at least 6 characters" });
    return;
  }
  const officeHash = await passcodeHash();
  if (officeHash && verifyPasscode(next, officeHash)) {
    res.status(400).json({ error: "Walk passcode must be different from the office passcode" });
    return;
  }
  const settings = await getBusinessSettings();
  await db
    .update(businessSettingsTable)
    .set({ walkPasscodeHash: hashPasscode(next), updatedAt: new Date() })
    .where(eq(businessSettingsTable.id, settings.id));
  invalidateHashCache();
  res.json({ ok: true });
});

router.post("/walk-auth/logout", async (_req, res): Promise<void> => {
  res.clearCookie(WALK_COOKIE_NAME, { path: "/api" });
  res.json({ ok: true });
});

export default router;
