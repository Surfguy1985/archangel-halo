/**
 * Enforcer V3 adapter — JWKS JWT verification + accounts/me + Express guard.
 */

import type { NextFunction, Request, Response } from "express";
import {
  readEnforcerConfig,
  resolveIdentityFromInputs,
  rolesFromVerifiedClaims,
  tenantFromVerifiedClaims,
  type EnforcerEnv,
  type HaloIdentity,
  type IdentityResult,
  type VerifiedClaims,
} from "./enforcerCore";
import { verifyRs256Jwt, type Jwk } from "./jwtVerify";
import { isIdentityExemptPath } from "./publicPaths";
import { logger } from "./logger";

let jwksCache: { fetchedAt: number; keys: Jwk[] } | null = null;
const JWKS_TTL_MS = 5 * 60_000;

export interface EnforcerDeps {
  fetchFn?: typeof fetch;
  now?: () => number;
  env?: EnforcerEnv;
}

function envFromProcess(override?: EnforcerEnv): EnforcerEnv {
  return {
    NODE_ENV: process.env.NODE_ENV,
    HALO_ENV: process.env.HALO_ENV,
    HALO_ENFORCER_REQUIRED: process.env.HALO_ENFORCER_REQUIRED,
    HALO_ENFORCER_TENANT_ID: process.env.HALO_ENFORCER_TENANT_ID,
    HALO_ENFORCER_ISSUER: process.env.HALO_ENFORCER_ISSUER,
    HALO_ENFORCER_JWKS_URL: process.env.HALO_ENFORCER_JWKS_URL,
    HALO_ENFORCER_AUDIENCE: process.env.HALO_ENFORCER_AUDIENCE,
    HALO_ENFORCER_ACCOUNTS_URL: process.env.HALO_ENFORCER_ACCOUNTS_URL,
    ...override,
  };
}

function bearerFrom(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h || typeof h !== "string") return null;
  const m = /^Bearer\s+(\S+)/i.exec(h);
  return m?.[1] ?? null;
}

async function fetchJwks(
  url: string,
  fetchFn: typeof fetch,
): Promise<{ ok: true; keys: Jwk[] } | { ok: false; code: "jwks_unavailable" }> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return { ok: true, keys: jwksCache.keys };
  }
  try {
    const resp = await fetchFn(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5_000) });
    if (!resp.ok) return { ok: false, code: "jwks_unavailable" };
    const body = (await resp.json()) as { keys?: Jwk[] };
    if (!body || !Array.isArray(body.keys) || body.keys.length === 0) {
      return { ok: false, code: "jwks_unavailable" };
    }
    jwksCache = { fetchedAt: now, keys: body.keys };
    return { ok: true, keys: body.keys };
  } catch {
    return { ok: false, code: "jwks_unavailable" };
  }
}

async function fetchAccountsMe(
  url: string,
  token: string,
  fetchFn: typeof fetch,
): Promise<{ ok: true; claims: Record<string, unknown> } | { ok: false; code: "accounts_unavailable" }> {
  try {
    const resp = await fetchFn(url, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) return { ok: false, code: "accounts_unavailable" };
    const body = (await resp.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object") return { ok: false, code: "accounts_unavailable" };
    return { ok: true, claims: body };
  } catch {
    return { ok: false, code: "accounts_unavailable" };
  }
}

export async function authenticateEnforcer(
  req: Request,
  deps: EnforcerDeps = {},
): Promise<IdentityResult> {
  const env = envFromProcess(deps.env);
  const fetchFn = deps.fetchFn ?? fetch;
  const bearer = bearerFrom(req);
  // The office passcode is gone — the owner asked for every password and login
  // in HALO to be removed — so there is no session cookie left to check and any
  // caller reaching a non-exempt route IS the local operator. This flag is what
  // enforcerCore calls the "office session": keep it true or the enforcer would
  // 401 the whole app now that nothing can ever present that cookie. External
  // JWT identity is unaffected; verified claims still win when configured.
  const officeSessionValid = true;
  const clientTenant =
    (typeof req.headers["x-tenant-id"] === "string" ? req.headers["x-tenant-id"] : null) ??
    (typeof req.body?.tenantId === "string" ? req.body.tenantId : null);
  const clientRole =
    (typeof req.headers["x-role"] === "string" ? req.headers["x-role"] : null) ??
    (typeof req.body?.role === "string" ? req.body.role : null);

  if (!bearer) {
    return resolveIdentityFromInputs({
      env,
      bearerPresent: false,
      officeSessionValid,
      verifiedClaims: null,
      verifyError: null,
      clientTenant,
      clientRole,
    });
  }

  const cfg = readEnforcerConfig(env);
  if (!cfg.ok) {
    return resolveIdentityFromInputs({
      env,
      bearerPresent: true,
      officeSessionValid,
      verifiedClaims: null,
      verifyError: null,
      clientTenant,
      clientRole,
    });
  }

  const jwks = await fetchJwks(cfg.jwksUrl, fetchFn);
  if (!jwks.ok) {
    return resolveIdentityFromInputs({
      env,
      bearerPresent: true,
      officeSessionValid,
      verifiedClaims: null,
      verifyError: "jwks_unavailable",
      clientTenant,
      clientRole,
    });
  }

  const verified = verifyRs256Jwt(bearer, { keys: jwks.keys }, {
    issuer: cfg.issuer,
    audience: cfg.audience,
  });
  if (!verified.ok) {
    return resolveIdentityFromInputs({
      env,
      bearerPresent: true,
      officeSessionValid,
      verifiedClaims: null,
      verifyError: "token_invalid",
      clientTenant,
      clientRole,
    });
  }

  let claims = verified.payload;
  if (cfg.accountsUrl) {
    const me = await fetchAccountsMe(cfg.accountsUrl, bearer, fetchFn);
    if (!me.ok) {
      return resolveIdentityFromInputs({
        env,
        bearerPresent: true,
        officeSessionValid,
        verifiedClaims: null,
        verifyError: "accounts_unavailable",
        clientTenant,
        clientRole,
      });
    }
    claims = { ...claims, ...me.claims };
  }

  const tenantId = tenantFromVerifiedClaims(claims);
  const roles = rolesFromVerifiedClaims(claims);
  const sub = typeof claims.sub === "string" ? claims.sub : "";
  const verifiedClaims: VerifiedClaims | null =
    tenantId && sub
      ? { sub, tenantId, roles }
      : null;

  return resolveIdentityFromInputs({
    env,
    bearerPresent: true,
    officeSessionValid,
    verifiedClaims,
    verifyError: verifiedClaims ? null : "token_invalid",
    clientTenant,
    clientRole,
  });
}

export function enforcerGuard(deps: EnforcerDeps = {}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.method === "OPTIONS") {
      next();
      return;
    }
    if (isIdentityExemptPath(req.path, req.method, req.headers)) {
      next();
      return;
    }
    const result = await authenticateEnforcer(req, deps);
    if (!result.ok) {
      const message =
        result.code === "enforcer_unconfigured"
          ? "Enforcer identity is not configured"
          : result.code === "jwks_unavailable"
            ? "Enforcer JWKS is unavailable"
            : result.code === "accounts_unavailable"
              ? "Enforcer accounts/me is unavailable"
              : result.code === "enforcer_unavailable"
                ? "Enforcer is unavailable"
                : result.code === "wrong_tenant"
                  ? "Wrong tenant"
                  : result.code === "insufficient_role"
                    ? "Insufficient role"
                    : "Authentication required";
      logger.warn({ code: result.code, path: req.path }, "enforcer: request denied");
      res.status(result.status).json({ error: message, code: result.code });
      return;
    }
    req.haloIdentity = result.identity;
    next();
  };
}

export function getIdentity(req: Request): HaloIdentity | undefined {
  return req.haloIdentity;
}

/** Test helper — drop JWKS cache between cases. */
export function resetEnforcerJwksCache(): void {
  jwksCache = null;
}
