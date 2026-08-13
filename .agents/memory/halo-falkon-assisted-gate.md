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
- `maxAutoInvoiceAmount` (cents) → permits invoice actions if `context.amount ≤ limit`
- `maxAutoCrewRate` (cents) → permits `pay_crew` if `context.crewRate ≤ limit`
- `maxAutoChangeOrder` (cents) → permits `approve_change_order` if `context.amount ≤ limit`

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
