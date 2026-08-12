# Falkon Ops × HALO — Integration Map
**Audit date:** 2026-08-12  
**Classification:** Read-only audit. No code changes made.  
**Status:** Pre-implementation — this document is the design contract.

---

## 1. Executive framing

HALO is the customer-facing property/vendor management platform. Falkon Ops becomes the **invisible operating runtime** that sits beneath every HALO workflow — the same relationship as Stripe sits beneath HALO's billing, or the way UR Founders is the first downstream partner without being hard-coded into HALO. HALO operators never see "Falkon"; they see their normal job board, crew portal, and client dashboard. Falkon capabilities activate silently behind existing HALO surfaces.

The integration is structured as an internal module boundary inside the existing monorepo, following the same pattern demanded by the HALO billing integration spec: a versioned capability catalog, OFF/SHADOW/ASSISTED/LIVE mode ladder, signed callback bus, and evidence-gated state machine — all layered on top of HALO's existing data model without replacing it.

---

## 2. Current HALO architecture snapshot

### 2.1 Runtime
| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces (9 artifacts, 3 shared libs) |
| API server | Express on Node, TypeScript, `lib/db` (Drizzle + PostgreSQL) |
| Database | Single PostgreSQL cluster, no SQL foreign keys (app-level refs), 23 schema files |
| Auth — office | Scrypt-hashed passcode → signed httpOnly cookie (`officeAuth.ts`) |
| Auth — portal | Per-crew `portalToken` UUID column, sent in Bearer header |
| Auth — client | Per-property token → HMAC session exchange → signed cookie |
| Auth — walk | Walk-specific token checked by `walkAuth` middleware |
| Tenancy | **Single-tenant today.** One business_settings row. No workspace/partner/organization tables. |
| Background jobs | In-process `setInterval` scheduler (`lib/scheduler.ts`). No Redis, BullMQ, or worker process. |
| Event bus | In-process EventEmitter (`lib/boardEvents.ts`) + SSE fan-out to connected browsers. SSE → refetch only; no payload. |
| Webhooks outbound | Per-client optional webhook POST with SSRF guard (no signature). |
| Webhooks inbound | Vapi (`/vapi`). No general inbound webhook surface. |
| AI | OpenAI (via Replit proxy): gpt-4o, gpt-4o-mini-transcribe, gpt-image-1, text-embedding. Anthropic available (secrets present). |
| Storage | Replit Object Storage (object storage bucket). |
| Notifications | Resend (email) + Twilio (SMS) + Expo push (`pushToken` column on crews). |

### 2.2 Core domain model

```
business_settings (1 row)
  └── properties
        ├── contacts
        ├── price_items (per-property service rate sheet)
        ├── agreements (property contracts)
        └── jobs
              ├── job_line_items
              ├── job_broadcasts → crews (offer/accept)
              ├── schedules
              ├── cleaning_checklists
              ├── job_checklists (carpet/make_ready/painting)
              ├── job_agreements (per-job payout terms per crew)
              ├── crew_dispatch_assignments
              └── recap_shares

crews (contractor/vendor — no separate vendors table)
  ├── crew_checkins (check-in/checkout + GPS coords)
  ├── crew_route_plans (ordered stop keys per day)
  ├── crew_dispatch_assignments (member assignments)
  ├── crew_photos (before/after evidence)
  └── crew_messages + attachments

invoices → payments → expenses
crew_payments (crew-side ledger)
journal_entries + ledger_entries (double-entry books)
plaid_items (bank connections)

work_requests (client-originated work queue)
emergency_pings + emergency_ping_targets
autopilot_actions + voice_logs (JARVIS/Vapi command inbox)
activities (append-only event log, entity-scoped)
notifications (alert inbox)

client_board_cards + client_card_comments + client_board_notifications
client_board_actions + client_card_history (soft archive)
client_users + client_user_sessions + client_permissions
client_board_dashboard_cards

catalog_items (global service catalog)
wing_members + wing_audit + wing_automation_runs (profit-share program)
base44_sync_map (legacy data bridge)
```

**Critical gap: units are not a table.** `jobs.unitNo` is a free-text string. `properties.units` is an integer count. There is no `units` table — unit identity is implicit in job records and the 50-box client board template.

### 2.3 Job / make-ready state machine

HALO jobs have **two orthogonal status axes**:

| Axis | Values | Source |
|---|---|---|
| `status` (business lifecycle) | `open → in_progress → completed → cleared` | application writes |
| `boardStatus` (board rail) | `active, scheduled, on_hold, completed, billing, crewPay, pay_alert, done` | board moves |

Make-ready flow observed:
```
work_request (needs-turn signal)
  → accepted → job created (status=open, boardStatus=active)
  → crew broadcast → crew accepts (boardStatus=scheduled)
  → crew checks in (crew_checkins GPS, sets check-in time)
  → work done → photos uploaded (crew_photos before/after)
  → checklist signed off (job_checklists type=make_ready)
  → Walk app review → approve_walk → client card pushed
  → boardStatus=completed → invoice raised (SOP wizard)
  → invoice sent → client pays → boardStatus=billing→crewPay
  → crew paid → close-out checklist → boardStatus=done → cleared
```

The Walk app (`artifacts/walk`) is HALO's dedicated field QC surface: photos, voice notes, multi-service capture, and a line-item rate resolver. Walk approval is the evidence gate between field completion and billing.

### 2.4 Evidence already captured

| Evidence type | HALO table/field | Completeness |
|---|---|---|
| GPS check-in/out | `crew_checkins` (lat/lng/address/jobId) | ✅ per-job |
| GPS breadcrumb trail | `gps_trails` (30s pings while active) | ✅ background task |
| Arrival detection | Nominatim geocode vs job property lat/lng | ✅ (4h dedupe) |
| Before photos | `crew_photos` (phase=before) | ✅ |
| After photos | `crew_photos` (phase=after) | ✅ |
| Make-ready checklist | `job_checklists` (type=make_ready, 31+ items) | ✅ |
| Cleaning checklist | `cleaning_checklists` (31 items, signed off) | ✅ |
| Trade checklists | `job_checklists` (carpet/painting/make_ready) | ✅ |
| Walk QC review | Walk app `/walk-approve` route | ✅ |
| Crew payout agreement | `job_agreements` (per job+crew) | ✅ |
| Inspection pass | `jobs.inspectionPassedAt` | ✅ (optional gate) |
| PO / client approval | `jobs.poNumber` + PO gate | ✅ (required for billing) |
| Change order | `jobs.changeOrderStatus` (pending/approved/rejected) | ✅ |
| Margin floor | `marginMin` per property + margin guardian | ✅ |

### 2.5 AI / automation already in place

| Capability | Implementation | Model |
|---|---|---|
| Voice commands (JARVIS) | Vapi webhook → autopilot_actions inbox | gpt-4o via Vapi |
| OCR / document scan | `/ingest/parse` + `/ingest/commit` (AI extraction) | gpt-4o |
| Walk voice transcription | Walk app voice capture | gpt-4o-mini-transcribe |
| Price sheet import | AI extraction from uploaded file | gpt-4o |
| SOP invoice wizard | Per-property billing rule extraction | gpt-4o |
| Property hero images | On-demand generation | gpt-image-1 |
| AI pricing (bids) | Knowledge-based bid pricing | gpt-4o |
| Business report / insights | Scheduled report generation | gpt-4o |
| Autopilot | Scheduled action proposals + approval inbox | gpt-4o |
| Margin guardian | Rule-based (no AI), surfaces in Today feed | — |
| Base44 sync | 15-min scheduled pull from legacy system | — |

### 2.6 Payment / economics rails

| Layer | Implementation |
|---|---|
| Client invoicing | `invoices` + `invoice_line_items` (Drizzle) |
| Client payment record | `payments` (manual record or check-scan OCR) |
| Crew payment | `crew_payments` (approved/disbursed states) |
| Double-entry ledger | `journal_entries` + `ledger_entries` + `syncXLedger()` |
| Bank data | Plaid multi-item (MTD actuals override invoice-based metrics) |
| Payout reserve (Wings) | `wing_members.reserveHeld`, guarded HELD claim, settles on disbursement |
| Cybrid (future ACH) | Stubbed in Payments Hub — marked spots in code, no live keys |
| Margin computation | `recomputeJobFinancials()` must be called on every money mutation |
| Tax | Tax-inclusive, recomputed on every invoice write |

---

## 3. Falkon Ops capability mapping to HALO domain

### 3.1 Twin model

```
Falkon concept              HALO equivalent                  Gap?
─────────────────────────── ──────────────────────────────── ──────────────────────────────────
Management Company Twin     business_settings (1 row)        No externalId, no Falkon handshake
Property Twin               properties table row             No falkonPropertyId column
Unit/Asset Twin             *** MISSING TABLE ***            unitNo is a free-text string on jobs
Vendor / Crew relationship  crews table (no vendor entity)   No vendor taxonomy, no tier/cert
Service catalog             price_items (per-property)       No Falkon SKU mapping
Work order                  jobs table                       No falkonJobId, no durable external ref
Make-ready job              jobs with type=make_ready        boardStatus machine is HALO-internal
Evidence bundle             crew_photos + checklists         No Falkon evidence push endpoint
Payment / economics         invoices + payments              No Falkon payment event emission
Inspection / QC gate        walk approve + inspectionPassedAt  Walk not surfaced to Falkon
Change order                jobs.changeOrderStatus           No Falkon CO acknowledgment
GPS / arrival               crew_checkins + gps_trails       No Falkon location event emission
Provider routing            job_broadcasts (crew selection)  No Falkon provider-match integration
Signed callbacks            boardEvents SSE (unsigned)       No HMAC-signed outbound webhook
Usage / economics           Plaid + ledger + margin          No Falkon usage event emission
Admin Connect & Verify      settings + admin routes          No Falkon OAuth or key exchange
Failure queues              in-process scheduler only        No durable retry queue
```

### 3.2 Canonical HALO Lego → Falkon capability map

| HALO Lego module | Core Falkon capability exposed |
|---|---|
| HALO Core | Property Twin read, unit roster, contacts, make-ready trigger |
| HALO Work | Durable make-ready job, evidence gate, checklist sign-off, Walk QC |
| HALO Team | Provider/crew registry, availability, dispatch routing, GPS/arrival |
| HALO Money | Invoice lifecycle, client payment, crew payout, margin enforcement |
| HALO Books | Double-entry sync, Plaid actuals, tax-inclusive ledger |
| HALO Documents | Agreement storage, W-9 vault, recap PDF, job summary PDF |
| HALO Analytics | Job economics, margin trend, turn-time KPIs, business report |
| HALO Automations | Autopilot action inbox, scheduler hooks, workflow triggers |
| HALO AI | OCR scan, voice command, SOP extraction, property image gen |
| HALO Connector Hub | Base44 sync, Plaid, Twilio, Resend, Expo push, Vapi |
| HALO Sell | Work requests, bid/quote flow, change orders, client board |
| HALO Tax | Tax planner, tax-inclusive invoice engine |

---

## 4. Twin registration design

### 4.1 Management Company Twin

**What it is:** The single HALO deployment is one Management Company. Falkon needs an external handshake identifier and a connection record.

**Proposed new table:** `falkon_connections`
```sql
id            uuid PK
falkonOrgId   text UNIQUE NOT NULL      -- Falkon-issued org ID
apiKeyHash    text NOT NULL             -- hashed inbound Falkon partner key
webhookUrl    text                      -- where HALO pushes signed callbacks
webhookSecret text NOT NULL             -- HMAC-SHA256 signing secret (encrypted at rest)
mode          text NOT NULL DEFAULT 'OFF'  -- OFF | SHADOW | ASSISTED | LIVE
capabilities  jsonb NOT NULL DEFAULT '[]'  -- which capabilities are active
connectedAt   timestamptz NOT NULL
verifiedAt    timestamptz                  -- NULL until admin completes Connect & Verify
lastPingAt    timestamptz
createdAt     timestamptz NOT NULL
```

**Reuse as-is:** `business_settings` carries company name, address, phone. No change needed.  
**New:** `falkon_connections` singleton (one row per Falkon integration).

### 4.2 Property Twin

**Proposed additions to `properties` table:**
```
falkonPropertyId   text UNIQUE    -- Falkon-assigned property external ID
falkonSyncedAt     timestamptz    -- last successful twin push
falkonMode         text           -- property-level mode override (NULL = inherit from connection)
```

**Push contract:** On `PUT /properties/:id` (or any property mutation), if `falkonPropertyId` is set and mode ≥ SHADOW, emit a signed callback `property.updated` to the Falkon webhook URL.

**Reuse as-is:** All property fields (name, pmcName, address, units, latitude, longitude, brief, marginMin, marginTarget, status) map directly to Falkon property attributes.

### 4.3 Unit/Asset Twin

**This is the most significant structural gap.** HALO has no `units` table. Unit identity is `jobs.unitNo` (free text) and the client board's 50-box template.

**Proposed new table:** `property_units`
```sql
id           uuid PK
propertyId   uuid NOT NULL REFERENCES properties(id)
unitLabel    text NOT NULL              -- "101", "A2", "Penthouse 3"
falkonUnitId text                       -- Falkon-assigned unit external ID
status       text DEFAULT 'vacant'      -- vacant | occupied | needs_turn | in_progress | ready
currentJobId uuid                       -- FK to jobs (current active make-ready)
notes        text
createdAt    timestamptz NOT NULL
UNIQUE (propertyId, unitLabel)
```

**Impact on existing tables:**
- `jobs.unitNo` stays as-is (it is the display label; resolve to `property_units.id` at read time for Falkon)
- `cleaning_checklists.unitNo`, `client board unit template` stay as-is
- No existing rows break — migration populates `property_units` from distinct `(propertyId, unitNo)` pairs in `jobs`

**Asset relationships:** Each unit can have linked assets (appliances, HVAC, fixtures). Falkon provides asset taxonomy. HALO reuses `catalog_items` + `price_items` as the service/asset rate surface; a thin `unit_assets` join table suffices.

### 4.4 Vendor / Crew Twin

**HALO has no separate vendor table.** `crews` holds both employees and independent contractors. Falkon needs vendor-level attributes HALO lacks: license number, insurance certificate, trade certification, Falkon vendor tier.

**Proposed additions to `crews` table:**
```
falkonVendorId      text UNIQUE    -- Falkon vendor registry ID
vendorLicense       text           -- contractor license number
insuranceCert       text           -- cert number or storagePath
insuranceExpiry     date
falkonTier          text           -- preferred | standard | on-demand | emergency
falkonSyncedAt      timestamptz
```

**Reuse as-is:** `crews.services` (jsonb array of services offered), `crews.trade`, `crews.availability`, `crews.paymentTerms`, `crews.w9`, and all portal/GPS/photo machinery.

---

## 5. Mode ladder: OFF / SHADOW / ASSISTED / LIVE

The mode ladder governs how deeply Falkon Ops participates in each HALO workflow. Modes are set at the connection level and overridable per property.

### 5.1 Mode definitions

```
OFF        Falkon receives nothing. HALO is standalone.
           No callbacks emitted. No Falkon data ingested.
           Existing behavior 100% preserved.

SHADOW     Falkon receives read-only event copies.
           Every HALO mutation that produces a relevant event emits
           a signed callback to Falkon's webhook URL.
           HALO ignores any Falkon response.
           No HALO UI changes. No workflow changes.
           Purpose: Falkon indexes HALO data for its own twin model.

ASSISTED   Falkon can propose actions. HALO shows them in the
           autopilot_actions inbox (existing JARVIS mechanism).
           Office must approve before any action executes.
           Falkon receives event copies (as in SHADOW).
           Purpose: AI-assisted scheduling, routing, pricing suggestions.

LIVE       Falkon can execute approved action types automatically
           within configured policy thresholds (see §7).
           Thresholds that are exceeded still require human approval.
           Falkon receives event copies.
           Purpose: fully automated make-ready dispatch and turn-time optimization.
```

### 5.2 Mode enforcement

Mode is checked at the **callback emission point** (after HALO commits to DB), not at the trigger point. This means:
- HALO's own behavior is identical in all modes
- The mode ladder is a **purely additive side-effect channel**
- Switching from LIVE back to OFF reverts immediately — no HALO data changes
- Mode transitions are audit-logged in the new `falkon_events` table

### 5.3 Property-level override

If `properties.falkonMode` is non-NULL, it overrides the connection-level mode for that property. This enables a phased rollout: set connection mode=SHADOW globally, then promote individual properties to ASSISTED or LIVE as they're verified.

---

## 6. Durable make-ready jobs

HALO's job model is 90% of the way there. The gaps are durability (in-process scheduler = single point of failure for retries) and external reference (no `falkonJobId`).

### 6.1 Make-ready job lifecycle — needs-turn → resident-ready

```
Phase 0: TRIGGER
  Source: work_request (client board "request new work"), 
          direct job creation, or Falkon LIVE push
  HALO action: creates job (status=open, boardStatus=active)
  Falkon callback: job.created {jobId, propertyId, unitId, category, scheduledOn}
  
Phase 1: PROVIDER ROUTING
  HALO action: job_broadcasts (offer sent to candidate crews)
  Falkon capability (ASSISTED/LIVE): suggest crew ranking by 
    proximity (last GPS checkin), service match (crews.services), 
    availability (crews.availability jsonb), Wings tier, historical turn-time
  HALO action: crew accepts (guarded first-wins UPDATE)
  Falkon callback: job.assigned {crewId, falkonVendorId, estimatedArrival}

Phase 2: ARRIVAL + CHECK-IN
  HALO action: crew_checkins INSERT (lat/lng captured)
  Evidence gate: arrival detection (Nominatim vs property coords, 4h dedupe)
  Falkon callback: job.checked_in {crewId, lat, lng, matchedAddress, arrivalAccuracy}

Phase 3: WORK + EVIDENCE CAPTURE
  HALO action: crew_photos (before → during → after)
  HALO action: job_checklists / cleaning_checklists items completed
  HALO action: job_line_items completed (per-service checklist)
  Falkon callback (streaming in SHADOW+): evidence.captured per photo/checklist item
  Evidence gate: all required checklist items signed off before Walk submit

Phase 4: WALK QC REVIEW  [THE KEY GATE]
  HALO action: Walk app submit → review → approve_walk
  approve_walk: pushes per-job photo cards to client board + emits boardEvent
  Evidence bundle locked: {photos[], checklists[], gpsTrail, checkInTs, checkOutTs}
  Falkon callback: job.walk_approved {evidenceBundle, approvedBy, approvedAt}
  → This is the "resident-ready" signal to Falkon

Phase 5: BILLING + CLOSE-OUT
  HALO action: invoice raised (SOP wizard applies billing rules)
  HALO action: client pays → crew paid → close-out checklist
  Falkon callback: job.invoiced, job.paid, job.crew_paid, job.closed
  Economics snapshot: {grossProfit, marginPct, crewRate, turnDays}
```

### 6.2 What makes it "durable"

HALO's current scheduler is in-process setInterval — it dies if the server restarts mid-retry. For Falkon integration, callback delivery must be durable.

**Proposed: `falkon_events` outbox table**
```sql
id           uuid PK
eventType    text NOT NULL              -- job.created, evidence.captured, etc.
entityType   text NOT NULL              -- job | property | unit | crew | invoice
entityId     uuid NOT NULL
payload      jsonb NOT NULL
mode         text NOT NULL              -- mode at time of emit
status       text DEFAULT 'pending'     -- pending | delivered | failed | dead
attempts     int DEFAULT 0
nextRetryAt  timestamptz
deliveredAt  timestamptz
error        text
createdAt    timestamptz NOT NULL
```

**Delivery:** The existing `lib/scheduler.ts` setInterval tick picks up `pending` rows with `nextRetryAt <= now()`, POSTs HMAC-signed to `falkon_connections.webhookUrl`, and marks delivered or increments attempts (exponential backoff). Dead-lettered after 5 attempts.

**Why outbox and not direct POST:** HALO's DB commit and the POST must be atomic from the consumer's perspective. Write to `falkon_events` inside the same transaction as the HALO mutation. The scheduler delivers asynchronously. This prevents ghost events on rollback and prevents lost events if the server crashes between commit and POST.

---

## 7. Evidence gates

Evidence gates are **policy predicates** checked before a phase transition is allowed. They map to existing HALO checks plus new Falkon-configurable policy fields.

| Gate | HALO implementation | Falkon extension |
|---|---|---|
| Crew arrival confirmed | `crew_checkins` row exists for job + arrival detection pass | Configurable radius threshold (default: 300m) |
| Before photos present | `crew_photos` where phase=before count ≥ N | Configurable minimum count per unit type |
| Checklist complete | `job_checklists.signedOffAt` IS NOT NULL | Checklist type required per job category |
| After photos present | `crew_photos` where phase=after count ≥ N | Configurable minimum count |
| Walk QC approved | `approve_walk` called AND `jobs.boardStatus` updated | Approver role configurable (crew leader / office / Falkon AI review) |
| Inspection pass (optional) | `jobs.inspectionPassedAt` IS NOT NULL | Can be made required per property |
| PO gate | `jobs.poNumber` non-null | Required before billing transition |
| Margin floor | `jobs.marginPct >= properties.marginMin` | Falkon policy can raise the floor |
| Change order approved | `jobs.changeOrderStatus = 'approved'` | Falkon receives CO for independent acknowledgment |

**New: Falkon AI photo review** (ASSISTED/LIVE mode)  
Walk approval can optionally trigger a Falkon AI review of the photo bundle before marking the job resident-ready. Falkon returns a quality score and flagged items. If below threshold, the job stays in Walk review for human re-inspection. This is additive — it does not replace HALO's Walk app.

---

## 8. Policy / approval thresholds

Policy thresholds control which Falkon-proposed actions execute automatically (LIVE mode) vs. require human approval (ASSISTED/LIVE with threshold exceeded).

**Proposed: `falkon_policies` table** (one row per property or global default)
```sql
propertyId              uuid NULLABLE  -- NULL = global default
maxAutoCrewRate         numeric        -- max crew rate auto-approved (cents)
maxAutoInvoiceAmount    numeric        -- max invoice auto-approved
maxAutoChangeOrder      numeric        -- max CO amount auto-approved
requirePhotoMinBefore   int DEFAULT 1  -- min before photos required
requirePhotoMinAfter    int DEFAULT 2  -- min after photos required
requireArrivalRadius    int DEFAULT 300 -- meters for GPS match
requireInspection       boolean DEFAULT false
autoDispatchEnabled     boolean DEFAULT false  -- LIVE: auto-broadcast to top crew
aiPhotoReviewEnabled    boolean DEFAULT false  -- Falkon AI photo QC
aiPhotoReviewThreshold  numeric DEFAULT 0.80   -- min quality score
marginFloorOverride     numeric NULLABLE       -- if set, overrides property.marginMin
createdAt               timestamptz NOT NULL
updatedAt               timestamptz NOT NULL
```

Threshold checks run **server-side** in the action handler, not client-side. A LIVE-mode auto-action that exceeds a threshold is downgraded to an `autopilot_actions` PENDING row for human approval — same inbox JARVIS uses.

---

## 9. Provider routing

HALO's current routing is broadcast-to-first-win: the office manually selects candidate crews, sends an offer, the first crew to accept gets the job. This works. Falkon can enhance it without replacing it.

### 9.1 Reuse as-is
- `job_broadcasts` table + first-wins guarded UPDATE — the atomicity is correct
- `crews.services` (jsonb) — service matching already used in specialty dispatch mode
- `crews.availability` (jsonb) — availability window already stored
- `crew_checkins` (last GPS coords) — proximity signal available

### 9.2 ASSISTED/LIVE enhancement
Falkon provides a **ranked provider list** for a given job via a callback response (or via an inbound Falkon → HALO push to the `falkon_inbound` endpoint). HALO's broadcast logic incorporates the ranking:

```
Today (SHADOW): office sees normal crew list
ASSISTED:       office sees Falkon-recommended rank badge next to each crew name
LIVE:           HALO auto-broadcasts to top-ranked crew first (staggered start times, 
                existing specialty-mode pattern), falls back to next if no response
```

The staggered-start pattern (`job_broadcasts.startTime` with configurable delay between offers) already exists in HALO's specialty dispatch mode. LIVE routing simply pre-populates the candidate list from Falkon's ranking instead of a manual office selection.

---

## 10. Signed callbacks

HALO's current outbound webhooks (client board mirror) use an HTTPS+SSRF guard but **no signature**. Falkon requires HMAC-SHA256 signed callbacks.

**Signature scheme** (follows Stripe webhook pattern):
```
HALO-Timestamp: <unix seconds>
HALO-Signature: v1=<hmac-sha256(secret, timestamp + "." + raw body)>
```

**Implementation:**
- `falkon_connections.webhookSecret` (stored encrypted, never exposed in API responses)
- `lib/falkon/emitCallback.ts` — signs the payload before POST
- Falkon verifies on receipt; replay window: ±300 seconds on timestamp

**Inbound signed requests** (Falkon → HALO, ASSISTED/LIVE mode):
- New route group: `POST /falkon/inbound/:eventType`
- HMAC verified against the same `webhookSecret` before any processing
- Request body stored in `falkon_inbound_events` before processing (dedupe by Falkon event ID)
- Processing is synchronous for SHADOW reads, enqueued in `autopilot_actions` for ASSISTED/LIVE proposals

---

## 11. Usage / economics events

Every Falkon capability consumption must emit a usage event. This aligns with the HALO billing integration spec's metering requirements.

| Falkon capability used | HALO source event | Usage meter |
|---|---|---|
| Property Twin read | GET /properties/:id | api_request |
| Unit Twin status sync | property_units mutation | api_request |
| Evidence bundle fetch | Walk approve + GET /crew-photos | api_request + storage_gb_day |
| AI photo review | Falkon AI call via HALO proxy | ai_tokens |
| GPS/arrival event | crew_checkins INSERT | api_request |
| Provider routing call | Falkon inbound ranking | api_request |
| Signed callback delivery | falkon_events outbox delivery | webhook_delivery |
| OCR scan consumed | /ingest/parse | ocr_page |
| Voice command | Vapi webhook processed | voice_seconds |
| SMS notification | Twilio send | sms |
| Push notification | Expo push send | — (Expo free tier) |

These feed the `usage_events` table proposed by the billing integration spec. The Falkon integration is a consumer of those meters, not a separate system.

---

## 12. Admin Connect & Verify flow

The Connect & Verify surface lives in the HALO desktop admin hub (Settings). It is the only place the Falkon connection is configured. No HALO operator UI surface exposes "Falkon" anywhere else.

```
Step 1: Connect
  Admin enters Falkon partner key (sk_live_ prefix, validated against Falkon's verify endpoint)
  HALO stores key hash in falkon_connections.apiKeyHash
  HALO generates a webhookSecret for outbound signing
  HALO sends its own service key to Falkon for inbound verification
  Status: connected (unverified)

Step 2: Verify
  HALO sends a test ping event (signed) to falkon_connections.webhookUrl
  Falkon echoes it back to /falkon/inbound/ping
  HALO checks signature + round-trip < 5s
  Sets falkon_connections.verifiedAt
  Status: verified (mode=SHADOW)

Step 3: Shadow review (recommended: 2 weeks)
  All HALO events flow to Falkon; HALO ignores responses
  Admin reviews Falkon dashboard for twin accuracy

Step 4: ASSISTED
  Admin promotes connection mode to ASSISTED
  Falkon proposals appear in JARVIS/autopilot inbox
  Office reviews and approves

Step 5: LIVE (per property)
  Admin sets falkonMode=LIVE on specific properties
  Auto-dispatch and AI photo review activate per policy thresholds
```

---

## 13. Failure queues

HALO currently has no durable retry queue. All retries are in-process setInterval sweeps. For Falkon integration this is acceptable in SHADOW mode but insufficient for LIVE mode.

### 13.1 Short term (uses existing scheduler)
The `falkon_events` outbox table + scheduler tick covers SHADOW and ASSISTED modes reliably. The scheduler runs every ~60s. Failure visibility: query `falkon_events WHERE status='failed'` in the admin UI.

### 13.2 Medium term (LIVE mode)
When LIVE mode is enabled on any property, the outbox delivery should be promoted to a **dedicated worker process** (separate from the web server), following the HALO billing integration spec's worker guidance. This prevents LIVE-mode delivery delays from starving the main scheduler.

**Dead-letter handling:** `falkon_events WHERE status='dead'` rows are surfaced in the admin Falkon panel. Admin can retry individually or in bulk. Each retry resets `attempts=0, status=pending`.

### 13.3 Inbound failure handling
Falkon → HALO inbound events that fail processing are stored in `falkon_inbound_events.status='failed'` with error text. They do not affect HALO's core workflow — Falkon is advisory. HALO always retains the ability to operate standalone.

---

## 14. Phased rollout — make-ready: needs-turn → resident-ready

### Phase 0: Foundation (SHADOW mode, 2–4 weeks)
**Goal:** Zero behavioral change to HALO. Falkon starts indexing HALO data.

**Implementation tasks (smallest surface area):**
1. Add `falkon_connections`, `falkon_events`, `falkon_policies` tables (migration)
2. Add `falkonPropertyId` to `properties`, `falkonVendorId` to `crews` (nullable, no existing rows break)
3. Create `lib/falkon/emitCallback.ts` (signs + writes to outbox, no-ops if mode=OFF)
4. Wire outbox delivery into existing `lib/scheduler.ts` tick
5. Add Connect & Verify UI to desktop Settings hub
6. Wire `job.created`, `job.assigned`, `job.checked_in`, `job.walk_approved`, `job.closed` callbacks from existing route handlers
7. No Falkon inbound routes yet (SHADOW is read-only)

**Verification:** Falkon dashboard shows HALO properties, jobs, and evidence bundles within minutes of events.

### Phase 1: Unit table + evidence enrichment (still SHADOW, 2 weeks)
**Goal:** Falkon gets a clean unit-level view.

**Implementation tasks:**
1. Create `property_units` table; populate from existing `(propertyId, unitNo)` job pairs
2. Resolve `unitNo` → `property_units.id` at read time in job routes (backward-compatible)
3. Add `unit.status_changed` callback when job phases advance a unit's status
4. Enrich photo callbacks with checklist completion rates and GPS arrival accuracy
5. Add Falkon evidence bundle endpoint: `GET /falkon/jobs/:id/evidence` (signed, Falkon-key-gated)

### Phase 2: ASSISTED mode — provider routing suggestions (2 weeks)
**Goal:** Office sees Falkon crew ranking suggestions on the dispatch board.

**Implementation tasks:**
1. Add `/falkon/inbound/crew-ranking` route (HMAC verified)
2. Store rankings in `falkon_inbound_events` and surface in job broadcast UI as "Falkon recommends" badges
3. No auto-dispatch yet — office still manually selects
4. Wire `autopilot_actions` for Falkon-proposed schedule changes (office approves)

### Phase 3: ASSISTED mode — AI photo QC (2 weeks)
**Goal:** Walk approval can optionally trigger Falkon AI review before marking resident-ready.

**Implementation tasks:**
1. Add `aiPhotoReviewEnabled` to `falkon_policies`
2. After Walk submit, if enabled: emit `evidence.submitted` callback, await `evidence.reviewed` inbound (timeout: 60s, fallback: auto-pass)
3. If Falkon returns quality score < threshold: block Walk approval, surface flagged items in Walk UI
4. If score ≥ threshold or timeout: auto-approve proceeds normally

### Phase 4: LIVE mode — auto-dispatch on selected properties (4 weeks, monitored)
**Goal:** For opted-in properties, Falkon auto-triggers the broadcast to the top-ranked crew.

**Implementation tasks:**
1. Set `falkonMode=LIVE` on 1–2 pilot properties
2. On job creation (or work_request acceptance), if LIVE and `autoDispatchEnabled`: trigger broadcast to Falkon-ranked crew #1
3. If no acceptance in `policy.firstOfferWindowMinutes`, broadcast to #2, etc.
4. All economics checks (margin floor, PO gate, SOP billing rules) still enforced by HALO server
5. Promote `falkon_events` delivery to dedicated worker process
6. Monitor turn-time KPIs vs. pre-Falkon baseline

---

## 15. Coverage matrix: reuse / adapt / HALO-native

### ✅ Reuse as-is (no change required)

| HALO component | Falkon use |
|---|---|
| `crew_checkins` GPS + arrival detection | GPS/arrival evidence gate |
| `crew_photos` before/after | Photo evidence bundle |
| `job_checklists` (make_ready/carpet/painting) | Trade checklist evidence |
| `cleaning_checklists` | Cleaning evidence |
| `job_agreements` payout terms | Crew agreement record |
| `job_broadcasts` first-wins | Provider selection atomicity |
| `schedules` + `crew_route_plans` | Day-plan routing data |
| `activities` append-only log | Event audit trail |
| Walk app (`artifacts/walk`) | QC review surface |
| `autopilot_actions` inbox | ASSISTED mode proposal delivery |
| `lib/scheduler.ts` setInterval | SHADOW/ASSISTED outbox delivery |
| `officeAuth.ts` passcode + cookie | Admin Connect & Verify access control |
| `price_items` per-property rate sheet | Service/asset rate resolution |
| `recomputeJobFinancials()` | Economics snapshot accuracy |
| Resend + Twilio + Expo push | Notification delivery |
| HMAC session exchange (client board) | Pattern for inbound signed requests |
| SSRF guard (outbound webhooks) | Basis for Falkon outbound safety |

### 🔧 Adapt (add columns / extend logic)

| HALO component | What to add |
|---|---|
| `properties` | `falkonPropertyId`, `falkonSyncedAt`, `falkonMode` |
| `crews` | `falkonVendorId`, `vendorLicense`, `insuranceCert`, `insuranceExpiry`, `falkonTier` |
| `jobs` | `falkonJobId` (for external reference, nullable) |
| `lib/scheduler.ts` | Outbox delivery sweep for `falkon_events` |
| Walk approve route | Optional Falkon AI review gate (behind `aiPhotoReviewEnabled` flag) |
| Job broadcast route | Optional Falkon-ranked candidate list (ASSISTED/LIVE only) |
| Admin settings UI | Connect & Verify panel (desktop Settings hub) |
| `openapi.yaml` | `/falkon/*` inbound routes documented |

### ➕ New — required additions

| Component | Purpose |
|---|---|
| `property_units` table | Unit/Asset Twin — largest structural gap |
| `falkon_connections` table | Connection state, keys, mode, webhook |
| `falkon_events` table | Signed callback outbox (durable delivery) |
| `falkon_inbound_events` table | Inbound Falkon → HALO events, dedupe |
| `falkon_policies` table | Per-property thresholds and gates |
| `lib/falkon/emitCallback.ts` | HMAC signing + outbox write |
| `lib/falkon/verifyInbound.ts` | Inbound signature verification |
| Routes: `/falkon/inbound/*` | Falkon → HALO inbound surface |
| Routes: `/falkon/connect`, `/falkon/verify` | Admin Connect & Verify API |
| Routes: `/falkon/jobs/:id/evidence` | Evidence bundle read API |
| Desktop UI: Settings → Falkon panel | Connect & Verify admin surface |

### 🔒 Remain HALO-native (do not expose to Falkon)

| Component | Reason |
|---|---|
| `business_settings.officePasscodeHash` | Auth secret — never leaves HALO |
| `plaid_items` + bank credentials | Financial data — regulatory boundary |
| `journal_entries` / `ledger_entries` | Books are HALO-internal |
| `tax_settings` + tax computation | Tax data — regulatory boundary |
| `wing_members` (Founding Wings) | HALO equity-adjacent program |
| `client_permissions` + `client_user_sessions` | Client portal auth — HALO-managed |
| `voice_logs` + raw JARVIS transcripts | PII / confidential |
| Raw crew W-9 documents | PII / tax compliance |
| Base44 sync bridge | Legacy migration artifact |
| Stripe / Cybrid credentials | Payment rail secrets |
| HALO AI prompts (SOP, autopilot, walk) | Proprietary business logic |

---

## 16. Key risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| No SQL foreign keys in HALO schema | Medium | `falkon_connections`, `falkon_events` use Drizzle app-level refs consistently with existing pattern; add FK constraints only on new Falkon tables |
| In-process scheduler single point of failure in LIVE mode | High | Promote outbox delivery to dedicated worker process before enabling LIVE on any property |
| `unitNo` is free text — deduplication across jobs | Medium | `property_units` migration derives from distinct `(propertyId, unitNo)` pairs; manual review step for properties with variant spellings |
| Falkon webhook delivery failure during HALO outage | Low | Outbox table persists events across restarts; scheduler retries on next tick |
| Mode ladder allows Falkon to propose HALO mutations in ASSISTED mode | Low | All ASSISTED proposals go through `autopilot_actions` inbox — human approves before execution; no direct DB mutation path |
| Signed callback secret rotation | Low | `falkon_connections.webhookSecret` rotatable via admin panel; grace period allows both old and new secret verification during rotation |
| HALO single-tenant today, billing spec assumes multi-tenant | Medium | Falkon integration scoped to single-tenant now; `falkon_connections` schema is forward-compatible with future workspace/org columns |

---

## 17. Secrets required for Falkon integration

```
FALKON_INBOUND_VERIFY_KEY   Falkon-issued key for verifying inbound request signatures
FALKON_CREDENTIAL_ENCRYPTION_KEY  AES-256 key for encrypting stored webhook secrets at rest
FALKON_API_BASE_URL         Falkon's API endpoint (for Connect & Verify handshake)
```

These join the existing secret set. The outbound `webhookSecret` per connection is stored in the DB encrypted with `FALKON_CREDENTIAL_ENCRYPTION_KEY` (same pattern as Plaid credential storage).

---

## 18. Next implementation step

When ready to begin implementation, start with **Phase 0** above:

1. Read `integration/halo-billing-service/INTEGRATION_INSTRUCTIONS.md` §"Mandatory first step" — run the coverage matrix before editing any code.
2. Create a checkpoint before the first migration.
3. Write and run the three new tables migration (`falkon_connections`, `falkon_events`, `falkon_policies`) against the development database only.
4. Add nullable columns to `properties` and `crews`.
5. Implement `lib/falkon/emitCallback.ts` as a pure function (signs + writes to outbox, returns immediately).
6. Wire the first callback: `job.walk_approved` from the walk approve route — this is the highest-value signal for Falkon.
7. Add the Connect & Verify admin UI (desktop Settings hub, Falkon tab).
8. Set mode=SHADOW and run for 2 weeks before any ASSISTED activation.
