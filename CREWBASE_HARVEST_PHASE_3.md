# CREWBASE HARVEST — PHASE 3 (remaining Falkon capabilities)

**HALO branch:** `cursor/backend-hardening`  
**Date:** 2026-08-13  
**Frontend changes:** none  
**CrewBase:** algorithms rewritten. No CRM / worker inbox / schedule SoR import.

---

## What shipped

| Capability | HTTP | Writes | Falkon |
|---|---|---|---|
| `catalog.lookup` | `POST /api/catalog/lookup` | none | skip (read) |
| `weather.schedule_recommend` | `POST /api/weather/recommend` | **none** | skip (read) |
| `estimate.from_evidence` | `POST /api/estimates/from-evidence` | `halo_estimate_drafts` only | skip — not an invoice |
| `field.walk_report` | on `POST /walks/:id/complete` | `base44_evidence` resource `halo_walk` | Walk complete already SAFE_PATH |
| `comms.sms` | `POST /sms/send`, `/sms/blast`; public `POST /twilio/webhook` | `halo_sms_messages` | outbound ASSISTED approval; inbound HMAC fail-closed |
| `field.voice_eod` | `POST /voice-eod/call`, `/voice-eod/batch` | `halo_voice_eod_calls` | SHADOW = no dial; ASSISTED = always approve; LIVE deny; unconfigured = 503 |

**Still true:** Base44 owns schedule. HALO recommendations do not call job.schedule. LIVE remains disabled.

---

## Notes

- Catalog matcher is Jaccard + size-token boost against HALO `price_items` / `catalog_items`, not CrewBase `cost_items`.
- Twilio inbound requires `TWILIO_AUTH_TOKEN` (env or connector). Missing token → 503, not AccountSid fallback.
- No worker SMS inbox UI. `GET /sms/recent` is office-only.
- No auto-dial cron. Batches cap at 10 and still need Falkon approval.
- Walk evidence uses resource `halo_walk` so Base44 sync will not mark it stale.

Apply `lib/db/migrations/0009_halo_harvest_comms.sql` (also created at API startup).

---

## STOP

Harvest capability set from Phase 1 is implemented on the backend. Do not port CrewBase CRM screens, punch-list, Stripe UI, or schedule writes.
