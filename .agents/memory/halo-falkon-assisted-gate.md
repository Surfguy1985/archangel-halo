---
name: HALO Falkon ASSISTED mode gate
description: Decision Gate helper + LIVE mode blocked; checkAssistedGate() for consequential actions.
---

## ASSISTED mode gate helper

`checkAssistedGate(action, context, policy)` in `lib/falkonEmit.ts` returns a `DecisionPacket`:
- `permitted: true` → action may proceed (not ASSISTED, or policy pre-authorises)
- `permitted: false` → action needs human approval; surface `summary` to the operator

Policy fields that pre-authorise low-risk variants:
- `autoDispatchEnabled` → permits `dispatch_crew`
- `maxAutoInvoiceAmount` → permits invoice actions if `context.amount ≤ limit`
- `maxAutoCrewRate` → permits `pay_crew` if `context.crewRate ≤ limit`
- `maxAutoChangeOrder` → permits `approve_change_order` if `context.amount ≤ limit`

**Ceilings are DOLLARS, not cents.** They are compared raw against invoice
amounts, and `invoices.amount` is `double precision` dollars. (Schema comments in
`lib/db/src/schema/falkon.ts` still say cents — they are wrong.)

## The gate applies to office staff, not just Falkon

`falkonMutationGuard` runs on every non-safe mutating request (jobs, crews,
invoices, bids), whatever the caller. So in ASSISTED, an empty `falkon_policies`
table means nearly every office click 202s as REQUIRE_APPROVAL. Configure
ceilings BEFORE promoting to ASSISTED or the office stalls.

**Why:** the guard is actor-agnostic middleware; it was designed for Falkon/AI
traffic but sits in front of the whole API.

## Threshold amounts must come from the stored record

The guard resolves the compared amount from the target row (e.g. the invoice),
not `req.body.amount`/`total`. Body-only was wrong twice over: most consequential
routes send no amount at all (`POST /invoices/:id/send` has an empty body), so a
configured ceiling could never pre-authorise anything; and where a body amount
does exist it is caller-supplied, so a spoofed low value could buy auto-approval
for a large invoice. Creates legitimately fall back to the body (no row yet).

**How to apply:** any new ceiling-checked action needs an authoritative lookup in
`resolveAmount`, not a new body field.

## Per-property policy rows are only half-wired

`loadFalkonContext` (guard path) prefers an exact `property_id` row over the
`IS NULL` default — but it only knows the property from `req.body.propertyId`,
which most requests omit. `assertFalkonBoundary` (route path) ignores property
rows entirely and always reads the `IS NULL` global row. So per-property
overrides apply inconsistently; the Automation Limits UI is deliberately
global-only until both paths resolve the property the same way.

## LIVE mode — permanently blocked from this endpoint

`POST /falkon/admin/eligibility/promote` hard-rejects `targetMode === "LIVE"`.
The MODE_LADDER only contains `SHADOW → ASSISTED`.
LIVE requires a separate explicit Falkon partnership enablement process — never from the admin UI.

**Why:** Autonomous execution risk. LIVE means Falkon can auto-execute actions without human review.
**How to apply:** Never add `ASSISTED: "LIVE"` back to MODE_LADDER without a separate out-of-band process.

## Event ingest URL

`falkon_connections.event_ingest_url` (new column) — Falkon's dedicated event-ingestion endpoint.
Delivery priority: `eventIngestUrl ?? webhookUrl`. Pass in `POST /falkon/connect` body.
Schema: `lib/db/src/schema/falkon.ts` `eventIngestUrl: text("event_ingest_url")`
Migration: `ALTER TABLE falkon_connections ADD COLUMN IF NOT EXISTS event_ingest_url text;`
