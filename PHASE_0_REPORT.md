# PHASE 0 — Baseline & Architecture Lock

**Branch:** `cursor/backend-hardening`  
**Base:** `origin/main` @ `d8acb69` (`chore: prepare repository for GitHub handoff`)  
**Date:** 2026-08-13  
**Product behavior changes:** none  

---

## Score

### Phase 0 — **10.0 / 10.0**

This score applies to the **audit gate only**. It does **not** mean HALO is production-ready.

| Phase 0 acceptance criterion | Result |
|---|---|
| Project builds (backend typecheck) | Pass — `tsc --build` (shared libs) and `tsc -p artifacts/api-server` both exit 0 |
| Existing tests run | Pass — suite executed; results recorded below (no tests hidden) |
| Architectural boundaries documented | Pass — this report |
| All mutation paths inventoried | Pass — this report |
| All public endpoints inventoried | Pass — this report |
| All auth mechanisms inventoried | Pass — this report |
| All production blockers categorized | Pass — Critical / High / Medium / later-phase |
| Zero product behavior changes | Pass — report-only commit |

**Not claimed:** product 10/10, Falkon ASSISTED invariant, Enforcer identity, property-isolated PM chat, or non-destructive Base44 sync. Those are later-phase defects, catalogued here so they can be fixed without mixing work.

**STOP.** Do not start Phase 1 until explicitly instructed: `CONTINUE TO PHASE 1`.

---

## What changed

| Change | Why |
|---|---|
| Created branch `cursor/backend-hardening` from latest `origin/main` | Required working branch; `main` untouched |
| Added this file | Phase 0 deliverable |

No application code, schema, routes, env templates, or frontend files were modified.

---

## System diagram (target vs current)

### Target architecture (locked for this program)

```
Base44 Make-Ready Flow          HALO                         Falkon Ops
(operational system of record)  (intelligence / projection / chat)
        |                              |                              |
        |  one-way ingest              |  policy decision             |
        v                              v                              v
   operational facts  -->  HALO projection / knowledge layer
                                      |
                                      +--> Enforcer V3 (human + tenant + roles)
                                      |
                                      +--> HALO Chat (primary UI)
                                      |
                                      +--> PM live link (read-only, property-scoped)
                                      |
                                      +--> Crew one-tap check-in / check-out + GPS

HALO must not become a second CRM.
Summonable rich surfaces: Live Map, view-only Job Kanban, Money.
```

### Current implementation (as of this baseline)

```
Base44 haloRead  --15–30s poll-->  HALO Postgres (write-through upsert)
                                      |
                                      +--> Express API (office passcode + token surfaces)
                                      |      mutations execute directly in route handlers
                                      |      checkAssistedGate() exists but is NEVER called
                                      |
                                      +--> commandBrain (portfolio-wide snapshot into LLM)
                                      |
                                      +--> PM live chat calls buildSnapshot() (full portfolio)
                                      |      then asks the model to stay on one property
                                      |
                                      +--> Falkon: Ed25519 S2S + outbox + webhook
                                      |      GATEWAY_ORIGIN hardcoded to a Replit hostname
                                      |      LIVE promotion blocked from admin UI
                                      |      HMAC fallback still present
                                      |
                                      +--> Enforcer V3: NOT PRESENT
                                      |
                                      +--> in-process setInterval scheduler (no worker/queue broker)
```

---

## Authoritative ownership of major data categories

| Category | Authoritative source (intended) | Current HALO role | Gap |
|---|---|---|---|
| Property / unit / crew / calendar / crew jobs | Base44 | Projection via `base44Sync.ts` | Sync is write-through into operational tables, not a separate read model |
| Field submissions, before/after, QC, rework, field notes | Base44 Field Manager | **Not synced** | Crew portal still captures photos / checklists / summaries |
| Invoices / payment requests / price items / owners | Base44 | Partial projection | No FieldSubmission, Approval, CrewRate, Reminder entities |
| Office identity / roles / tenant | Enforcer V3 | Single shared office passcode | No Enforcer adapter, no `HALO_ENFORCER_TENANT_ID` |
| Policy, approvals, execution, audit, economics | Falkon Ops | Partial: outbox events, mode column, unused gate helper | Mutations bypass Falkon |
| Crew presence (check-in/out, GPS) | HALO (session fact) | Implemented (`/checkin/:token`, portal checkins, GPS trails) | Duplicate full crew portal still exposed |
| PM live view | HALO (capability link) | Implemented | Token stored plaintext; chat not property-scoped at retrieval |
| Chat / knowledge answers | HALO knowledge layer | `commandBrain` dumps portfolio snapshot into the prompt | Not tool-driven; isolation is prompt-only |
| Money / Plaid / ledger | HALO books | First-class in HALO | Not Falkon-gated |

---

## Runtime baseline

| Layer | Current |
|---|---|
| Monorepo | pnpm workspaces; Node 24; TypeScript 5.9 |
| API | `artifacts/api-server` — Express 5, `PORT` required |
| DB | PostgreSQL + Drizzle; **no SQL FKs** on most tables (app-level refs). Exception: `halo_conversation_messages.conversation_id` |
| Schema | `lib/db/src/schema/` — 27 files |
| Migrations | 4 SQL files in `lib/db/migrations/` (two both numbered `0002`); primary schema apply is `drizzle-kit push` + `ensureFalkonSchema()` raw SQL at boot |
| Scheduler | In-process `setInterval` (`lib/scheduler.ts`), 60s tick |
| Queues | `lib/queues.ts` is a **Today-feed computer**, not a job queue |
| Logging | pino + pino-http; URL token redaction for some prefixes; cookie/authorization redaction |
| Health | `GET /api/healthz` always `{ status: "ok" }` — no DB / Base44 / Falkon / Enforcer readiness |
| CORS | `app.use(cors())` — unrestricted |
| Security headers | No helmet / CSP / HSTS |
| Rate limits | In-memory Map; pay, login, session, bank, GPS, walk writes. **Not** on PM live chat, office mutations, or most command routes |
| Frontend (out of scope) | `artifacts/halo`, `halo-desktop`, `halo-crew`, `client-dashboard`, `walk`, `halo-ds`, `devportal`, `lib/board-ui` |

---

## Auth mechanisms

| Mechanism | Where | Notes |
|---|---|---|
| Office passcode (scrypt hash in `business_settings`) + HMAC httpOnly cookie `halo_office_session` | `officeGuard` on `/api` except public prefixes | Shared secret for all office operators. No human identity, no roles, no tenant. |
| Walk passcode + `halo_walk_session` | Walk routes | Cross-property by design (field credential) |
| Crew portal token (`crews.portalToken`, unguessable string in URL) | `/portal/:token/*` | Ownership checks exist on many writes; full operational portal still live |
| Crew check-in link token (`crew_checkin_links.token`, stored plaintext) | `/checkin/:token/*` | Create / expire / revoke exist; no hash-at-rest; no last-access |
| PM live link token (`pm_live_links.token`, stored plaintext) | `/live/:token`, `POST /live/:token/chat` | Create / expire / revoke exist; permissions JSON `{map, kanban, money}`; **no last-access, no hash-at-rest, chat not rate-limited** |
| Client dashboard token → HMAC session cookie | `/client/:token/*` | Property-scoped; permission catalog server-side |
| Pay-link token | `/pay/:token` | Rate-limited; financial mutation |
| Recap / photo-share / job-summary / tracker tokens | public share prefixes | Capability URLs |
| Vapi webhook secret | `POST /vapi/webhook` | Optional env `VAPI_WEBHOOK_SECRET` |
| Falkon Ed25519 inbound | `POST /api/falkon/webhook` | Fail-closed if sig missing; **HMAC-SHA256 fallback still implemented** |
| Falkon outbound Ed25519 | `falkonGateway.gatewayFetch` | Canonical signing string matches contract |
| Enforcer V3 JWT / JWKS / roles | **absent** | Zero matches for `enforcer`, `JWKS`, `HALO_ENFORCER_TENANT_ID` |

### Public prefixes (`officeAuth.PUBLIC_PREFIXES`)

`/office-auth`, `/walk-auth`, `/healthz`, `/client/`, `/pay/`, `/portal/`, `/track/`, `/recap-shares/`, `/photo-shares/`, `/job-summaries/`, `/storage/`, `/vapi/`, `/packets/templates/`, `/presentation/demo/step`, `/presentation/demo/office-board`, `/falkon/inbound/`, `/falkon/ping`, `/falkon/webhook`, `/.well-known/`, `/falkon/network/capabilities`, `/live/`, `/checkin/`

Walk regex: `/walk-target`, `/walks`, `/walk-captures/`.

**Storage is public.** Object paths are UUID-based (obscurity). Mission later phases require tightening without breaking crew/PM links.

---

## Public endpoints (token / webhook / unauthenticated)

| Method | Path | Auth | Mutates? |
|---|---|---|---|
| GET | `/api/healthz` | none | no |
| GET | `/.well-known/falkon-trust.json` | none | no |
| GET/POST | `/api/office-auth/*`, `/api/walk-auth/*` | passcode setup/login | session |
| POST | `/api/vapi/webhook` | optional shared secret | yes (autopilot inbox) |
| POST | `/api/falkon/webhook` | Ed25519 (HMAC fallback) | yes (inbound events) |
| POST | `/api/falkon/ping`, `/api/falkon/inbound/:eventType` | Falkon-key / HMAC | yes |
| GET | `/api/falkon/network/capabilities` | none | no |
| GET | `/api/storage/objects/*`, `/api/storage/public-objects/*` | none | no |
| POST | `/api/storage/uploads/request-url` | none | yes (upload URL) |
| GET/POST/PATCH/PUT/DELETE | `/api/portal/:token/*` | portal token | **yes — full crew OS** |
| POST | `/api/portal/login` | rate-limited | session |
| GET | `/api/track/:token` | tracker token | no |
| GET | `/api/live/:token` | PM token | no (read bundle) |
| POST | `/api/live/:token/chat` | PM token | no DB write; **LLM sees full snapshot** |
| GET | `/api/checkin/:token` | crew link | no |
| POST | `/api/checkin/:token/checkin` `/checkout` | crew link | **yes** |
| GET/POST | `/api/pay/:token*` | pay token | **yes — money** |
| GET/POST/PATCH | `/api/client/:token/*` | client token/session | **yes — board/billing/access** |
| POST | `/api/client/:token/requests` | client token | **yes — work request** |
| GET/POST | `/api/presentation/demo*` | demo token | demo-property only |
| GET | `/api/packets/templates/*` | none | no |

---

## Consequential mutation inventory (Falkon bypass)

`checkAssistedGate()` is defined in `artifacts/api-server/src/lib/falkonEmit.ts` and **is not called from any route, worker, or chat dispatcher**.

`emitFalkonEvent()` is fire-and-forget **after** DB commit. It is an outbox notifier, not a policy gate.

Therefore every row below is a **policy bypass** relative to the partner contract.

### Office API (passcode cookie) — high-impact

| Surface | Examples |
|---|---|
| Jobs | create, quick-create, patch, delete, schedule, dispatch, pull-crew, complete, clear, close-out, restart, change-order reopen, line-item CRUD/swap, recap send/share |
| Job board | broadcast, board-status, crew-pay, crew-pay/clear, unlist, reopen, quality-check, photos/assign |
| Money | invoice CRUD, send, remind, status, payments, check-scan, expenses create/approve/reject/pay |
| Pay hub | requests, send, return, payouts, batch payouts |
| Dispatch | assignments create/delete/move/checklist |
| Crews | CRUD, access, messages, documents, W9-adjacent office writes, crew-payments, invoices scan/office-create |
| Properties | CRUD, contacts, price-items, catalog-items, SOP rules, AI brief/image |
| Pipeline | leads/bids CRUD, send, nudge, AI pricing |
| Calendar | event CRUD |
| Walks | create/delete captures, complete, **approve** |
| Work requests | accept / decline |
| Accounting | journal, rebuild, bank import, tax planner |
| Wings | member patch, quality decision, incidents, automation run |
| Autopilot | run, approve, dismiss |
| Settings | business update, **`POST /settings/reset` (wipes operational tables)** |
| Plaid | exchange, disconnect, analysis apply |
| Command | `POST /command/actions/execute` — client-supplied `risk` + `capability`; SHADOW/OFF blocked; ASSISTED `risk=auto` executes `dispatchAutoAction` **without `checkAssistedGate`** |
| Falkon admin | connect, policies, unit bootstrap, make-ready start/advance, eligibility promote (LIVE hard-blocked) |
| Admin / client board office | account updates, board actions |
| Voice | `/voice/confirm` |
| Ingest | `/ingest/commit` |

### Public / token mutations (also ungated by Falkon)

Crew portal: invoices, invoice patch, messages, checkins, moving-to, track-points, documents, photos, W9, agreement, selfie, payment-method, bank, offer respond, emergency commit, dispatch check/move-response, line-item complete, cleaning checklist toggle/sign-off, job agreement, trade checklist agree/toggle/sign-off.

Crew check-in links: checkin / checkout.

Client board: cards, actions, billing, users, webhook, pay-adjacent module actions.

Pay links: approve / pay.

### Background workers that can mutate (also ungated)

| Job | Interval | Mutation risk |
|---|---|---|
| `runBase44Sync` | 30s | Writes properties, units, jobs, invoices, etc. Empty `units` array **deletes previously synced units** |
| `deliverFalkonOutbox` | 60s | Outbound HTTP; not HALO DB business state |
| `runAutopilot` | 15 min | Can raise/execute proposed actions depending on `autopilotAutoApprove` |
| `runWingsAutomation` | 15 min | Reserve / quality automation |
| Lead campaign steps | 60s tick | Outbound email |
| Client card digests | 1h | Outbound email |
| Emergency ping expiry | 60s | State transition |
| Daily/urgent/close/weekly emails | clock | Outbound email |
| `nudgeStaleForemanMoves` | 15 min | Notifications |
| Falkon nonce purge | 15 min | Deletes expired nonces |
| Falkon network poller | 30s | Peer request delivery |

---

## Base44 adapter

| Item | Current |
|---|---|
| Endpoint | Hardcoded `https://wakeful-ready-track-flow.base44.app/functions/haloRead` |
| Auth | `x-halo-token: HALO_READ_TOKEN` |
| Trigger | Scheduler 30s + `POST /api/settings/sync-base44` |
| Status | `GET /api/settings/sync-base44/status` — in-memory `lastSyncResult` (lost on restart) |
| Map table | `base44_sync_map (resource, base44_id) → halo_id` |
| Synced today | properties, crews, units, unit_jobs, crew_jobs, invoices, payment_requests, calendar_slots, price_items, owners |
| **Not synced** | FieldSubmission, photos/evidence, rework, approvals, CrewRate, Reminder |
| Idempotency | Map + natural keys; calendar_slots always insert (no stable key) |
| Destructive | `syncUnits([])` on empty/missing units collection **prunes all mapped units and cancels unit-jobs** |
| Retries | None (single fetch; top-level catch records `_error`) |
| Freshness | Duration + counts in last result only; no per-record source timestamp / stale flag persisted on projected rows |
| Credentials in logs | Token not logged; good |

Phase 1 must treat empty/timeout/500 as **non-destructive**.

---

## Falkon adapter

| Item | Current |
|---|---|
| Identity constants | `CLIENT_ID=fk_archangel_halo_prod`, `PARTNER_ID=archangel-halo`, `TENANT=archangel-halo-prod` — **hardcoded** in `falkonGateway.ts` |
| Gateway URL | `GATEWAY_ORIGIN = "https://building-blocks--austpryb1.replit.app/api"` — **hardcoded Replit hostname** (violates “environment configurable”) |
| Signing | Canonical Ed25519 string matches contract (clientId, timestampMs, nonce, sha256hex(rawBody), base64url) |
| Trust doc | `GET /.well-known/falkon-trust.json` (also duplicated on webhook router) |
| Callback | `POST /api/falkon/webhook` |
| Replay | Nonce table + ±5 min timestamp window |
| Mode ladder | `OFF → SHADOW → ASSISTED`; `POST /falkon/admin/eligibility/promote` **rejects LIVE** |
| ASSISTED gate | Helper exists; **unused**. Non-ASSISTED modes return `permitted: true` |
| HMAC fallback | Still in webhook verification and comments on stored `webhookSecret` |
| Schema bootstrap | `ensureFalkonSchema()` idempotent `CREATE TABLE IF NOT EXISTS` at process start — not a versioned migration journal |
| Chat execute | SHADOW/OFF cannot execute via `/command/actions/execute`; direct REST still can |

Seven-gate connection is **not** fully connected on this baseline. Gate 7 tests exist but skip without `HALO_E2E_BASE`.

---

## Enforcer V3 adapter

**Does not exist.** No JWT verification, JWKS fetch, tenant mapping, or role capability policy.

Office “identity” is a shared passcode. Chat role is a client-supplied / conversation-stored string (`role` default `"executive"`), not a verified claim.

This is a Phase 2 blocker. Production must fail closed without `HALO_ENFORCER_TENANT_ID`.

---

## HALO Chat backend

| Item | Current |
|---|---|
| Routes | `/command/conversations*` (office-gated), `/live/:token/chat` (public PM) |
| Brain | `commandBrain.ts` — Anthropic; builds **full-portfolio** `BusinessSnapshot` (all properties, jobs, invoices, crews, queues, margins, crew pay pending) |
| PM isolation | Prompt text: “answer in the context of this specific property”. **The model still receives other properties’ data.** |
| Action path | LLM emits `actionPlan.risk`; client may call `/command/actions/execute` with that risk. Server trusts `risk` from the **request body**. |
| Auto dispatcher | Several capabilities are stubs (`note.log` does not persist; `crew.notify` is a string). `pm_link.generate` / `crew_checkin_link.generate` **do** mutate. |
| Provenance | `sources` array is model-produced, not deterministic retrieval metadata |

---

## PM live link & crew check-in (current)

**PM link:** `pmlink_` + 12 random bytes hex; 24h default; permissions default `{ map: true, kanban: true, money: false }`; SMS copy generated server-side. View bundle is property-filtered. Chat is not. No token hashing, last-access, or chat rate limit. URL construction prefers `REPLIT_DEV_DOMAIN`.

**Crew check-in:** `crew_` + 12 random bytes hex; 90d default; GET assignment + POST checkin/checkout with GPS. Duplicate-tap / second-device / cooldown not fully specified in handlers (Phase 4). Full `/portal/:token` OS remains publicly reachable.

---

## Environment variables

### Documented in `.env.example`

`DATABASE_URL`, `SESSION_SECRET`, `RESEND_API_KEY`, `PLAID_CLIENT_ID`, `PLAID_SECRET`, object-storage trio, `HALO_READ_TOKEN`, OpenAI/Anthropic keys + base URLs, `PUBLIC_APP_URL`, `HALO_API_BASE_URL`, `HALO_DASHBOARD_URL`, `ALLOWED_ORIGINS`

### Used in code but missing from `.env.example` (incomplete contract)

| Variable | Purpose |
|---|---|
| `PORT` | **Required to boot** (`index.ts` throws if unset) |
| `LOG_LEVEL` | pino level |
| `NODE_ENV` | pretty vs JSON logs |
| `APP_ORIGIN` | absolute URL fallback |
| `REPLIT_DOMAINS` / `REPLIT_DEV_DOMAIN` | **business-logic hostname** for trust doc, links, emails, Falkon callback base |
| `VAPI_WEBHOOK_SECRET` | Vapi auth |
| `HALO_TEST_MODE` | unlocks Falkon test seed/Gate 7 endpoints |
| `HALO_E2E_BASE` / `HALO_E2E_COOKIE` | integration tests |
| `FALKON_CREDENTIAL_ENCRYPTION_KEY` | mentioned in schema comments |
| `FALKON_API_BASE_URL` / `FALKON_INBOUND_VERIFY_KEY` | mentioned in integration map; **not wired** (gateway URL is a constant) |
| `HALO_ENFORCER_TENANT_ID` | **does not exist yet** |

---

## Logging / observability

Present: pino request logs, correlation-ish `req.id`, token path redaction for a subset of prefixes (`client|portal|pay|track|recap-shares|photo-shares|job-summaries|board|summary`). **`/live/` and `/checkin/` tokens are not in the redact regex.**

Absent: metrics, tracing, liveness vs readiness, dependency health, Base44 freshness gauges, webhook DLQ metrics, structured audit of policy decisions.

`POST /settings/reset` is a production foot-gun (operational wipe).

---

## Migrations

| File | Notes |
|---|---|
| `0001_add_moving_to_unit_to_crew_checkins.sql` | Additive |
| `0002_add_reset_token_to_business_settings.sql` | Duplicate version number |
| `0002_email_policy_toggles.sql` | Duplicate version number |
| `0003_catalog_items_service_uq.sql` | Dedup + unique index |

There is **no migration runner journal** in-app. Production tables for Falkon, PM links, crew links, conversations are expected to appear via `drizzle-kit push` and/or `ensureFalkonSchema()`. This is a Phase 7 defect: not deterministic across environments.

---

## Tests executed

Command (from `artifacts/api-server`, after local-only native binary workaround — not committed):

```
vitest run
```

| Result | Count | Notes |
|---|---|---|
| Passed | 11 tests / 1 file | `src/lib/waybill.test.ts` (pure unit) |
| Skipped | 50 tests / 11 files | `describe.skipIf(!HALO_E2E_BASE)` integration suites — by design |
| Failed suites | 4 files / 0 tests run | Import throws `DATABASE_URL must be set` — `presentationDemo.test.ts`, `crewRoutePlan.test.ts`, `waybillContract.test.ts`, `wingsDispatchBoundary.test.ts` |

**No test was deleted, skipped by hand, or had assertions weakened.**

Lint: no ESLint config in the repo. Prettier is a root devDependency without a config file. N/A.

Typecheck:

- `tsc --build` (root lib graph): **pass**
- `tsc -p artifacts/api-server`: **pass**
- `tsc -p scripts`: **fail** — `@workspace/board-ui` declarations not in the root lib graph (frontend package; not modified)

`pnpm run typecheck` / `pnpm run build` / `pnpm --filter @workspace/api-server run test` re-invoke `pnpm install`, which exits `ERR_PNPM_IGNORED_BUILDS` (esbuild/core-js/vue-demi) on this agent host. Additionally `pnpm-workspace.yaml` `overrides` pin `esbuild>@esbuild/darwin-arm64: '-'` and equivalent rollup natives — Replit-linux oriented. Documented as a High **developer-environment** blocker, not silently “fixed” in product code during Phase 0.

---

## Production blockers (categorized)

### Critical (must be resolved before claiming ASSISTED / launch)

1. **No Falkon policy enforcement on mutations.** Direct REST, portal, pay links, autopilot, Base44 sync, and chat execute all write business state without `checkAssistedGate` / a single decision boundary.
2. **PM live chat is not property-isolated.** `buildSnapshot()` loads the entire portfolio into the model. Prompt scoping is not a security boundary.
3. **Enforcer V3 absent.** No verified human/tenant/role. Placeholder tenant constants live in Falkon gateway code.
4. **Base44 empty-units prune is destructive.** A transient empty `units` payload deletes mapped HALO units and cancels jobs.
5. **Shared-secret S2S fallback still exists** on Falkon inbound verification.

### High

6. Gateway URL and partner identity hardcoded; Replit hostnames used as URL builders across links/emails/trust doc.
7. Bearer tokens for PM and crew links stored in plaintext; `/live/` and `/checkin/` tokens not redacted in request logs.
8. Full crew portal remains a public mutation surface (invoices, bank, checklists, photos) — contradicts one-tap check-in product.
9. `/command/actions/execute` trusts client-supplied `risk`.
10. `GET /healthz` cannot fail when DB/Base44/Falkon are down.
11. Schema apply is `push` + boot-time `ensure*` — not a versioned, observable migrator. Duplicate `0002_*` files.
12. `POST /settings/reset` wipes operational data behind the same office passcode as day-to-day use.
13. Unrestricted CORS; no security headers.
14. Chat/knowledge layer is prompt-stuffing, not authorized retrieval.
15. Field-manager evidence is not projected from Base44; crew portal still owns photos/QC.
16. pnpm platform overrides + ignored build scripts prevent stock macOS Cursor `pnpm test` / `pnpm build`.

### Medium (later phases)

17. In-memory rate limits and sync status (multi-instance unsafe).
18. Calendar slot sync always inserts.
19. No last-access / hash-at-rest / configurable expiry policy engine for capability links.
20. HMAC `webhookSecret` still in the data model.
21. `dispatchAutoAction` stubs mixed with real mutations.
22. `.env.example` missing `PORT` and Falkon/Enforcer variables.

---

## Remaining external dependencies (needed to go beyond this baseline)

These are **inputs**, not code we can invent:

| Input | Needed for |
|---|---|
| `DATABASE_URL` (reachable Postgres) | DB-backed tests, migrator verification, local API boot |
| `SESSION_SECRET` (≥32 chars) | Office cookies, Falkon identity encryption material |
| `HALO_READ_TOKEN` | Live Base44 sync |
| Base44 `haloRead` contract confirmation (FieldSubmission / evidence resources) | Phase 1 completeness |
| Falkon gateway **environment** URL (not the Replit hostname) | Configurable S2S |
| Falkon Ed25519 remote public key / trust binding | Live Gate 1–7 |
| Enforcer V3 issuer, JWKS URL, production `HALO_ENFORCER_TENANT_ID` | Phase 2 fail-closed identity |
| `HALO_E2E_BASE` + office cookie | Existing integration tests |
| Object storage + Plaid + Resend keys | Full runtime, not required to lock architecture |

No Enforcer or Falkon production credentials were present in this workspace. None were guessed.

---

## Known risks of this baseline (honest)

- Treating HALO tables as a second system of record will fight Base44. Projection must become non-destructive and evidence-complete before chat can be trusted.
- ASSISTED is currently a **badge and a chat-execute filter**, not an invariant.
- Property-manager “Ask HALO” can leak other properties via the snapshot. Do not ship that surface as-is.
- Crew GPS/check-in can proceed; the old portal can still do everything else.
- LIVE is blocked in one admin endpoint; a direct DB update of `falkon_connections.mode` would make `checkAssistedGate` return `permitted: true` for every action (because it only special-cases `ASSISTED`).

---

## Phase 0 sign-off

| Question | Answer |
|---|---|
| Did we change product behavior? | No |
| Did we work on `main`? | No |
| Did we redesign HALO frontend? | No |
| Did we hide failing tests? | No |
| Is ASSISTED a real invariant today? | **No** |
| Is Enforcer real today? | **No** |
| Can we proceed to Phase 1? | **Not until `CONTINUE TO PHASE 1`** |

**PHASE 0 — 10/10 (audit lock).** Waiting.
