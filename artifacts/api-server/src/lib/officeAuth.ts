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
import { and, eq, isNull } from "drizzle-orm";
import { db, businessSettingsTable } from "@workspace/db";
import { getBusinessSettings } from "./businessSettings";
import { getPresentationDemoState } from "./presentationDemo";
import { limits } from "./rateLimit";

const COOKIE_NAME = "halo_office_session";
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

function mintSession(): string {
  const payload = `office.${Math.floor(Date.now() / 1000) + SESSION_TTL_S}.${randomBytes(9).toString("base64url")}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyOfficeSession(cookie: string | undefined): boolean {
  if (!cookie) return false;
  const i = cookie.lastIndexOf(".");
  if (i < 0) return false;
  const payload = cookie.slice(0, i);
  const mac = cookie.slice(i + 1);
  const a = Buffer.from(mac);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const [scope, expStr] = payload.split(".");
  if (scope !== "office" || !expStr) return false;
  return Number(expStr) >= Math.floor(Date.now() / 1000);
}

function setSessionCookie(res: Response): void {
  res.cookie(COOKIE_NAME, mintSession(), {
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
let cachedAt = 0;
const CACHE_TTL_MS = 10_000;

async function passcodeHash(): Promise<string | null> {
  const now = Date.now();
  if (cachedHash !== undefined && now - cachedAt < CACHE_TTL_MS) return cachedHash;
  const settings = await getBusinessSettings();
  cachedHash = settings.officePasscodeHash ?? null;
  cachedAt = now;
  return cachedHash;
}

function invalidateHashCache(): void {
  cachedHash = undefined;
}

// ---------------------------------------------------------------------------
// Guard middleware
// ---------------------------------------------------------------------------

// Token-authenticated, public-share, or webhook surfaces. Everything else on
// /api is office-only.
const PUBLIC_PREFIXES = [
  "/office-auth",
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
];

const DEMO_ACTION_RE = /^\/admin\/accounts\/([^/]+)\/board\/actions$/;

export function officeGuard() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.method === "OPTIONS") return next();
    const path = req.path;
    if (PUBLIC_PREFIXES.some((p) => path.startsWith(p))) return next();
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

export default router;
