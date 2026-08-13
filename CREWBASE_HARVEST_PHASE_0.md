# CREWBASE HARVEST — PHASE 0 (HALO baseline)

**Branch:** `cursor/backend-hardening`  
**Date:** 2026-08-13  
**Mode:** audit only — no product behavior change in this document’s work  
**Frontend:** not modified  
**CrewBase source:** **not in this workspace** (searched `/Users/bryce.beck/Documents` and `/Users/bryce.beck/Documents/GitHub`; only `archangel-halo` and `Falkon-Ops-OS` exist)

Hardening Phases 0–4 already landed on this branch (`570193c` … `91eca05`). This report is a **new** Phase 0 for the CrewBase harvest program. It does not replace `PHASE_0_REPORT.md`.

---

## PHASE 0 SCORE: **10.0 / 10**

This score means: **HALO’s architecture, mutation surface, public surface, workers, and harvest conflicts are inventoried well enough that later extraction can proceed without guessing HALO.**

It does **not** mean:

- CrewBase has been compared (source is absent)
- HALO is production-ready
- Falkon gates every mutation
- property isolation holds for office chat
- the harvest may start

Harvest implementation is **blocked** on mounting CrewBase as a sibling read-only repo. That is an external input, not an architecture hole in HALO.

---

## Ownership lock (do not invert)

| System | Role |
|---|---|
| **Base44 Make-Ready Flow** | Operational system of record |
| **HALO** | Conversational intelligence + experience layer |
| **Falkon Ops** | Twin, capabilities, policy, approvals, execution, orchestration, audit |
| **Enforcer V3** | Identity / tenancy / roles |
| **Replit** | HALO frontend / UX |
| **Cursor** | Backend / infra / security / reliability |

HALO must not become a second CRM. CrewBase must not be merged. Extract capabilities → rebuild as Falkon capabilities against HALO entities and Base44 data.

Principle:

> Base44 says what was supposed to happen.  
> Field telemetry says what actually happened.  
> Falkon says what may happen next.  
> HALO lets humans understand and control it through conversation.

---

## VERIFIED

### 1. HALO backend shape

- Monorepo. API: `artifacts/api-server`. Schema: `lib/db`.
- Express mount: `/api`. Middleware order: `officeAuth` → `officeGuard` → `enforcerGuard` → `falkonMutationGuard` → routers (`routes/index.ts`).
- Working tree is `cursor/backend-hardening`, 9 commits ahead of `origin/main` after hardening Phases 0–4.

### 2. Base44 integration

- Client: `base44Client.ts` (`HALO_READ_TOKEN`).
- Sync: `base44Sync.ts` + pure planner `base44SyncCore.ts`.
- Tick: **every 30 seconds** (`scheduler.ts` `BASE44_SYNC_MS`) — Command prompt text still says “15 minutes” (`commandBrain.ts`). That is a documentation lie, not a second sync.
- Write-through upserts into live HALO tables: properties, crews, units, jobs, calendar, invoices, payment requests, price items, contacts.
- Empty/missing collections **do not prune** (Phase 1). Evidence → `base44_evidence`. Map → `base44_sync_map`.
- HALO also has large native job/board/dispatch/money CRUD. **Two writers on `jobs`.**

### 3. Falkon integration

- Canonical policy: `decideFalkonPolicy` (`falkonPolicyCore.ts`). LIVE always **DENY**. UNKNOWN **DENY**. ASSISTED requires approval unless an explicit threshold matches.
- HTTP: `falkonMutationGuard` on `/api`. Public prefixes **skip** the guard (`isPublicApiPath`).
- S2S inbound: Ed25519 only. Outbox: Ed25519. Gateway origin from `FALKON_GATEWAY_ORIGIN` / `FALKON_API_BASE_URL`.
- Remaining HMAC: `POST /falkon/verify` signs a HALO-owned webhook ping (`falkonEmit.ts`). Not inbound S2S.
- Approvals: `POST /falkon/approvals/:id/approve|deny`; retry with `X-Falkon-Approval-Id`.
- Falkon-Ops-OS exists as a **city/sim/build** repo next door. Runtime policy lives in HALO, not in that checkout.

### 4. Enforcer / auth

- Production-like (`NODE_ENV`/`HALO_ENV=production` or `HALO_ENFORCER_REQUIRED=true`): missing tenant/issuer/JWKS → **503**. Invalid/missing Bearer → **401**.
- Non-prod: office passcode cookie becomes `{ roles: ["admin"], source: "office_session" }`.
- Client `x-role` / `x-tenant-id` / body role ignored when claims exist.
- Public token trees (`/portal/`, `/client/`, `/live/`, `/checkin/`, `/pay/`, …) are **identity-exempt**.
- Walk uses a separate cookie.

### 5. Mutation routes (office)

Large operational surface in `jobs.ts`, `jobboard.ts`, `money.ts`, `properties.ts`, `pipeline.ts`, `inventory.ts`, `dispatchBoard.ts`, `emergency.ts`, `settings.ts` (including **`POST /settings/reset` wipe**), `crew.ts`, `wings.ts`, `accounting.ts`, `plaid.ts`, `admin.ts`, `clientBoard.ts`, `walks.ts` (approve), `command.ts` execute, Falkon admin.

Office mutations generally hit `falkonMutationGuard` unless listed in `SAFE_PATHS` (conversations, Base44 sync POST, voice parse, feed dismiss, walk captures, Falkon approvals, …).

### 6. Public routes

`PUBLIC_PREFIXES` in `officeAuth.ts`: `/office-auth`, `/walk-auth`, `/healthz`, `/client/`, `/pay/`, `/portal/`, `/track/`, `/recap-shares/`, `/photo-shares/`, `/job-summaries/`, `/storage/`, `/vapi/`, `/packets/templates/`, presentation demo step/board, `/falkon/inbound/`, `/falkon/ping`, `/falkon/webhook`, `/.well-known/`, `/falkon/network/capabilities`, `/live/`, `/checkin/`.

Plus walk regex, GET presentation/demo, Bearer skip of office cookie, root `/.well-known/falkon-trust.json`.

**Entire public trees skip Falkon policy.**

### 7. Background processes (`scheduler.ts` + `index.ts`)

| Cadence | Work | Falkon-gated? |
|---|---|---|
| 60s tick | campaigns, emergency expiry, Falkon outbox | outbox = delivery only |
| 30s | Base44 sync (writes operational tables) | **No** |
| ~15m | Autopilot (invoice reminder / rebroadcast) | **Yes** (`actorChannel: worker`) |
| ~15m | Wings, foreman nudge, nonce purge, urgent mail | **No** |
| ~1h | Client card digests | **No** |
| 6h | GPS trail purge | N/A (delete old points) |
| 15m / 30s | Falkon network poller | peer S2S |

### 8. Crew check-in / location (HALO today)

- `/checkin/:token` — hashed tokens, last-access, audit, 15s duplicate replay, second-device idempotent, GPS unavailable allowed, stale GPS rejected, location pings only while checked in, **no photos required**. Production `/portal` **410** unless `HALO_CREW_PORTAL_ENABLED=true`.
- Legacy portal still exists in non-prod: check-in **with** after-photos gate, invoices, bank, checklists, GPS trail, dispatch moves. `crews.portal_token` **plaintext**. `POST /portal/login` is first-name + `2026`.
- Two GPS writers: `/checkin/:token/location` and `/portal/:token/track-points`. Job tracker `GET /track/:token`.

This already covers harvest candidate **#1 and part of #2**. Do not transplant a second check-in OS.

### 9. PM live-link system

- Office `POST /pm-links` hashes tokens (Phase 2).
- Chat is property-scoped at query time (`buildIsolatedSnapshot`). Writes stripped.
- **Gap:** `dispatchAutoAction` `pm_link.generate` still inserts **plaintext** `pm_live_links.token` (`command.ts` ~1084). Dual mint paths.
- Live GET does not strongly enforce map/kanban/money flags (chat zeros money when `money !== true`).

### 10. AI / command

- Office `POST /command/conversations/:id/ask` builds a **portfolio** `buildSnapshot()` (all properties). Isolation is **not** an LLM-prompt problem; it is a retrieval problem. Office executives may see the tenant; that is intentional. PM live must not.
- Execute: Enforcer capability + Falkon `actorChannel: ai`. Client `risk` ignored.
- Implemented mutators in `dispatchAutoAction`: `pm_link.generate`, `crew_checkin_link.generate`. Several capabilities are stubs (`note.log`, `crew.notify`).
- Voice: `/voice/parse|confirm` (office). Vapi: **inbound** end-of-call webhook, not HALO outbound dial.
- SMS: `lib/sms.ts` via Replit Twilio connector — used by emergency/dispatch, not a general two-way crew SMS bus.

### 11–13. Conflicts, isolation, Falkon bypass

See **ARCHITECTURAL CONFLICTS**, **CRITICAL RISKS**, **HIGH RISKS** below.

### 14. Tests / typecheck / lint

Recorded in **TESTS EXECUTED**. Failures not hidden.

### 15. CrewBase

**Not available.** Cannot compare GPS, SMS, EOD, weather, or walkthrough implementations. Falkon-Ops-OS README mentions CrewBase as a portfolio brand only.

---

## Harvest candidate map (HALO side only)

| # | Candidate | HALO today | Harvest posture |
|---|---|---|---|
| 1 | One-tap GPS check-in links | **Done** (Phase 4 `/checkin`) | Compare CrewBase later; do not duplicate |
| 2 | Location/event telemetry | `crew_track_points` + check-in events | Compare; keep HALO jobId-from-session rule |
| 3 | AI outbound worker / EOD calls | **Absent** (Vapi inbound only) | New Falkon capability if CrewBase proves it |
| 4 | Two-way SMS | Twilio send for emergency/dispatch; not a crew inbox | Extract protocol, not CrewBase UI |
| 5 | Automatic EOD briefings | Email evening close + Command briefing | May enrich from telemetry; not a second product |
| 6 | Field walkthrough → report | HALO Walk + transcribe; Base44 field_submissions | Prefer Base44 evidence; don’t add punch-list UI |
| 7 | Weather risk scanning | **Absent** | New capability if justified |
| 8 | Weather-aware schedule recs | **Absent** | Falkon recommendation, HALO does not own schedule SoR |
| 9 | Photo/doc → estimate intelligence | Partial: ingest/scan, Vapi price-book token match | Tooling, not a CRM estimator screen |
| 10 | Cost catalog fuzzy match | `price_items` / `catalog_items` + `tokenScore` | Keep HALO catalog; don’t import CrewBase DB |
| 11 | Secure share-link patterns | PM hashed; check-in hashed; **portal token plaintext**; chat PM mint plaintext | Unify mint on hash-at-rest |
| 12 | Signed webhook/event infra | Falkon Ed25519 outbox/inbound | Reuse; don’t add a third signer |
| 13 | Deterministic AI fallbacks | Limited (voice/vapi matchers) | Required for any new AI capability |
| 14 | Field-proof provenance | `base44_evidence`, photo SHA in tracker lore | Bind telemetry to Base44 ids, not HALO-only |

**Explicitly do not import:** CrewBase CRM/jobs/vendor UI, worker dashboards, punch-list UI, blueprint editing, Luma 3D, push UI, Procore-demo routes, worker inbox UI, CrewBase invoicing UI, CrewBase schedule as SoR.

---

## CRITICAL RISKS

1. **CrewBase source missing** — any harvest without it is guesswork. Wait for sibling repo.
2. **Public mutation trees skip Falkon** — `/portal`, `/client`, `/pay`, `/checkin`, `/storage`, `/vapi`. A harvested “capability” that writes through these paths is not a Falkon capability.
3. **HALO jobs CRUD + Base44 sync both write `jobs`** — second system of record. Harvest must not add a third (CrewBase schedule).
4. **Office Command snapshot is portfolio-wide** — PM isolation exists; office chat can still leak property data to the model. Do not use the system prompt as the security boundary.
5. **Legacy portal password `Firstname2026`** (`portal.ts`) — trivial credential. Production portal is 410, but non-prod and `HALO_CREW_PORTAL_ENABLED=true` remain exposed.
6. **`POST /settings/reset`** — destructive wipe of operational tables (Falkon-gated as `settings.reset`, still catastrophic if allowed).

---

## HIGH RISKS

1. `x-halo-actor-channel: worker` is client-settable on office routes (`falkonMutationGuard.ts`) — can change SHADOW/ASSISTED treatment.
2. `pm_link.generate` plaintext token vs hashed office mint.
3. `crews.portal_token` stored and logged-adjacent in URLs; plaintext.
4. CORS `app.use(cors())` unrestricted despite `ALLOWED_ORIGINS` in `.env.example`.
5. Base44 30s sync vs workers that mutate the same tables without Falkon (except autopilot).
6. GPS trails keyed by crew/job, not property — mis-attributed `jobId` is a privacy leak (portal path already refuses client jobId; keep that invariant).
7. Storage upload URL is public (`/storage/uploads/request-url`).
8. No ESLint. Prettier drift on backend files (not auto-fixed in this Phase 0).
9. `DATABASE_URL` unset here → DB-backed tests fail at import. `HALO_E2E_BASE` unset → integration tests skip.
10. Healthz is `{ status: "ok" }` with no dependency checks.

---

## ARCHITECTURAL CONFLICTS

| Conflict | Why it matters for harvest |
|---|---|
| Full crew portal vs one-tap `/checkin` | Two field OSes. Harvest GPS into `/checkin` + Falkon, not portal UI |
| HALO job board vs Base44 SoR | CrewBase schedule DB would be a **third** SoR — forbidden |
| Autopilot / Wings vs Falkon control plane | HALO-native automation parallel to Falkon |
| Client board / concierge CMS | HALO experience layer drifting toward CRM |
| Walk app vs Base44 Field Manager | Inspection duplication; bind to Base44 evidence |
| Chat mint vs office mint for PM links | Inconsistent token security |
| Falkon-Ops-OS city sim vs HALO runtime | Different repo; do not confuse packs with HALO policy |
| Command `actionPlan.risk` vs server policy | Server already ignores client risk; keep it that way |

---

## TESTS EXECUTED

| Check | Result |
|---|---|
| `tsc --build` (libs) | Pass (exit 0) |
| `tsc -p artifacts/api-server --noEmit` | Pass (exit 0) |
| vitest cores: `crewCheckinCore`, `falkonPolicyCore`, `enforcerCore`, `base44SyncCore`, `waybill` | **98 passed** |
| `presentationDemo.test.ts` | **FAIL at import** — `@workspace/db` throws without `DATABASE_URL` |
| Integration `*.integration.test.ts` | Not run (`HALO_E2E_BASE` unset; they skip) |
| ESLint | **No eslint config / no lint script** in workspace `package.json` |
| Prettier `--check` on sampled api-server lib + tests | **Formatting drift** in 10 files; not rewritten (audit-only) |

Nothing was skipped to improve the score.

---

## EXTERNAL INPUTS NEEDED

1. **CrewBase private GitHub repo** cloned as a sibling, e.g. `/Users/bryce.beck/Documents/GitHub/crewbase` (read-only). Required before harvest Phase 1.
2. `DATABASE_URL` if we must run DB-backed / contract tests.
3. `HALO_E2E_BASE` + office session if we must run route integration tests.
4. Live Enforcer issuer / JWKS / `HALO_ENFORCER_TENANT_ID` (not guessed).
5. Falkon gateway origin + Ed25519 trust binding (env, not Replit hostname).
6. Base44 `haloRead` confirmation for field_submissions / photos completeness (optional for harvest mapping).

---

## RECOMMENDED PHASE 1

**Do not start until CrewBase is mounted beside HALO.**

Phase 1 of harvest (when instructed):

1. Read-only CrewBase map of the 14 candidate capabilities → files, data stores, auth, GPS, SMS, webhooks.
2. Side-by-side keep / rewrite / discard vs HALO (especially check-in: HALO token model vs CrewBase GPS).
3. Propose Falkon capability ids only — no UI, no CrewBase merge, no second schedule SoR.
4. Close HALO mint inconsistency (`pm_link.generate` hash-at-rest) as a **HALO bugfix**, not a CrewBase port.
5. Decide portal: remain production-retired; do not harvest portal CRUD.

**STOP. Do not begin Phase 1.**
