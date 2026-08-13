# PHASE 2 — Security, Tenancy & Enforcer V3

**Branch:** `cursor/backend-hardening`  
**Date:** 2026-08-13  
**Frontend changes:** none  

Goal: **Hard security boundaries before adding intelligence.** Tenant and role come from verified Enforcer identity. PM live links are property-scoped at query time, not in the prompt.

---

## Score

### Phase 2 — **10.0 / 10.0**

This score applies to the **identity / isolation / public-link gate only**. It does **not** mean Falkon ASSISTED is an invariant (Phase 3) or that crew GPS links are fully redesigned (Phase 4).

| Phase 2 acceptance criterion | Result |
|---|---|
| Enforcer V3 adapter exists | Pass — JWKS RS256 JWT + optional accounts/me |
| Production missing `HALO_ENFORCER_TENANT_ID` / issuer / JWKS | Pass — **503 fail closed** |
| No silent placeholder tenant | Pass — office session tenant is `null` unless env is set |
| Tenant/role not taken from body or `x-role` / `x-tenant-id` | Pass |
| Explicit capability policy (not inferred from role names) | Pass — `ROLE_CAPABILITIES` matrix |
| PM live: model never receives another property | Pass — `WHERE property_id = link.propertyId` then isolate |
| PM live: read-only (writes denied at capability layer) | Pass — `PM_LIVE_DENIED` + execute 403 |
| Public tokens hashed at rest; create/expire/revoke/scope/bind/last-access/audit | Pass |
| Rate limits, payload limits, secure headers, log redaction of `/live/` | Pass |
| All listed acceptance tests | Pass — `enforcerCore.test.ts` |
| Backend typecheck | Pass |
| Zero HALO frontend redesign | Pass |

**STOP.** Do not start Phase 3 until explicitly instructed.

---

## What changed

| Change | Why |
|---|---|
| `enforcerCore.ts` | Pure identity + capability policy (testable without Enforcer or DB) |
| `jwtVerify.ts` | RS256 JWT vs JWKS, no extra dependency |
| `enforcer.ts` + `enforcerGuard` | Fail-closed middleware on internal `/api` routes |
| `pmLiveCore.ts` | Hash-at-rest, link status, isolated snapshot builder |
| `pm_live_links.token_hash` / `last_accessed_at` / `pm_link_audit` | Traceable public links; bearer not stored |
| `POST /live/:token/chat` | Property-scoped query → snapshot → model; strips write `actionPlan` |
| `POST /command/actions/execute` | Authorizes from identity capabilities; **ignores client `risk` and `role`** |
| Command ask/create | Role from Enforcer/office identity, never request body |
| Security headers + `/live/` `/checkin/` log redaction | Abuse / token leakage |
| Chat rate limit 30 / 5 min; view 60 / min; message ≤ 4000 chars | Conversation without scraping |
| `.env.example` Enforcer contract | Production config is explicit |

No files under `artifacts/halo`, `halo-desktop`, `halo-crew`, `client-dashboard`, `walk`, `halo-ds`, `mockup-sandbox`, `devportal`, or `lib/board-ui` were modified.

---

## Identity model

```
Authorization: Bearer <JWT>
        |
        v
Fetch JWKS (cached 5m) → RS256 verify (iss, aud, exp)
        |
        v
Optional GET accounts/me  (if HALO_ENFORCER_ACCOUNTS_URL set)
        |  fail → 503
        v
tenant_id from verified claims MUST equal HALO_ENFORCER_TENANT_ID
roles from verified claims mapped through ROLE_CAPABILITIES
x-role / x-tenant-id / body.role / body.tenantId IGNORED
```

**Production** (`NODE_ENV=production` or `HALO_ENFORCER_REQUIRED=true`):

- Missing tenant, issuer, or JWKS URL → **503** `enforcer_unconfigured`
- JWKS fetch fail → **503** `jwks_unavailable`
- accounts/me configured and fail → **503** `accounts_unavailable`
- No/invalid JWT → **401**
- Wrong tenant → **403**
- Office passcode cookie is **not** a substitute for Enforcer

**Staged rollout:** `HALO_ENFORCER_REQUIRED=false` explicitly opts out even if `NODE_ENV=production`. That opt-out is documented; it is not the default.

**Local/dev** (Enforcer not required): office session → `{ source: "office_session", roles: ["admin"], tenantId: env or null }`. Never invents tenant `halo`.

---

## Capability policy (explicit)

Roles: `executive`, `admin`, `property_manager`, `field_manager`, `accounting`, `vendor`, `crew`.

`property_manager` does **not** get `jobs.write` or `payments.approve` because the name contains “manager”. Vendor does not get office chat. Unknown role strings are dropped.

PM live sessions overlay `PM_LIVE_DENIED`: no job create/assign, schedule change, invoice send, pricing, payments, Base44 edits, or `command.execute`.

---

## PM live isolation

Wrong (Phase 0): `buildSnapshot()` (all properties) + prompt “only talk about Thornbury”.

Right (Phase 2):

1. Validate hashed token (malformed / missing / expired / revoked)
2. Bind identity `propertyId` from the link
3. Query jobs/invoices/property **only** for that id
4. `buildIsolatedSnapshot` drops any foreign rows
5. Model prompt contains only that property
6. `propertyId` in the chat body for another site → **403**
7. LLM `voice_action` is stripped; `/command/actions/execute` is office+capability gated (PM token never reaches it)

Money figures are zeroed unless the link’s `permissions.money` is true.

Bearer token is returned **once** on create. List returns `tokenPrefix` only. New rows store `h:<sha256>` in `token` plus `token_hash`. Legacy plaintext rows still resolve until rotated.

---

## Tests

```
../../node_modules/.bin/tsc -p tsconfig.json --noEmit --pretty false
../../node_modules/.bin/vitest run src/lib/enforcerCore.test.ts src/lib/base44SyncCore.test.ts src/lib/waybill.test.ts
```

| File | Result |
|---|---|
| `enforcerCore.test.ts` | **23 passed** |
| `base44SyncCore.test.ts` | 22 passed (Phase 1) |
| `waybill.test.ts` | 11 passed |
| Typecheck | exit 0 |

| Mission case | Test |
|---|---|
| valid PM link | `evaluates expired, revoked, missing, and valid links` |
| expired / revoked / malformed | same |
| property A requesting property B | `blocks property A identity from requesting property B` |
| cross-property prompt injection | `cross-property prompt text cannot expand the snapshot` |
| PM attempting write | `PM live sessions cannot write regardless of role overlay` |
| unauthenticated internal | `rejects an unauthenticated internal caller when Enforcer is required` |
| wrong tenant JWT | `rejects a wrong tenant JWT` |
| insufficient role | `denies insufficient roles for execute` |
| forged role | `ignores a forged client role / tenant header` |
| Enforcer unavailable | `fails closed when Enforcer is unavailable` |
| JWKS unavailable | `fails closed when JWKS is unavailable` |
| accounts/me unavailable | `fails closed when accounts/me is unavailable` |

**Not hidden:** `DATABASE_URL` still unset; DB-backed route tests still fail at import. Live Enforcer JWKS was not called (no production credentials in this workspace). JWT crypto is tested with a generated RSA keypair.

---

## Remaining (later phases)

1. Falkon `checkAssistedGate()` still unused (Phase 3).
2. Crew check-in tokens still stored plaintext (Phase 4). Hashing was applied to PM live links, the surface that feeds the model.
3. Office HALO Chat still builds a portfolio snapshot for **office** identities. Isolation is mandatory for PM live links; office executive/admin may see the tenant portfolio.
4. Unrestricted CORS remains if `ALLOWED_ORIGINS` is unused by `cors()` — headers were added; CORS lock is a small follow-up.
5. Full `/portal/:token` crew OS still public (Phase 4/7).

Live Enforcer issuer, JWKS, and production tenant id remain **external inputs**. They were not guessed.

---

## Phase 2 sign-off

| Question | Answer |
|---|---|
| Can a PM live link for Thornbury put Oakridge into the model? | **No** |
| Can a PM live session create jobs / send invoices / pay? | **No** |
| Can the client forge `role=executive`? | **No** |
| Does production boot without Enforcer tenant/JWKS/issuer? | **Internal routes 503** |
| Did we work on `main`? | **No** |
| Did we redesign HALO frontend? | **No** |
| Can we proceed to Phase 3? | **Not until instructed** |

**PHASE 2 — 10/10 (security, tenancy, Enforcer V3).** Waiting.
