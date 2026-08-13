# CREWBASE HARVEST — PHASE 2 (first implementation slice)

**HALO branch:** `cursor/backend-hardening`  
**Date:** 2026-08-13  
**Frontend changes:** none  
**CrewBase:** not copied. Algorithms rewritten against HALO / Base44 entities.

---

## Score

### Harvest Phase 2 — **implementation complete for this slice**

| Criterion | Result |
|---|---|
| Chat `pm_link.generate` hashes tokens at rest (same as `POST /pm-links`) | Pass |
| HTTP cannot spoof `x-halo-actor-channel: worker` | Pass — header ignored |
| Production CORS fail-closed without `ALLOWED_ORIGINS` | Pass |
| `weather.risk_scan` read-only, office-gated, no schedule write | Pass |
| `ops.eod_briefing` from HALO jobs / check-ins / photos / Base44 freshness | Pass — deterministic fallback |
| LIVE still denies including briefing persist | Pass |
| Zero CrewBase UI / CRM / portal import | Pass |
| Zero HALO frontend redesign | Pass |

**Not in this slice:** `field.voice_eod`, `comms.sms`, `weather.schedule_recommend`, `estimate.from_evidence`, catalog Jaccard matcher, CORS product UX.

---

## What shipped

### HALO defects (harvest Phase 1 bugs 1–3)

| Change | Why |
|---|---|
| `command.ts` `pm_link.generate` uses `mintPmToken` | Chat mint stored plaintext; office mint already hashed |
| `actorChannelFromRequest` | Worker channel is in-process only |
| `corsOriginSetting` + `app.use(cors({ origin, credentials }))` | `ALLOWED_ORIGINS` honor; prod unset → deny |

### Falkon capabilities (rewritten, not ported)

| Capability | HTTP | Writes |
|---|---|---|
| `weather.risk_scan` | `POST /api/weather/scan` | none |
| `ops.eod_briefing` | `GET /api/briefings/latest`, `POST /api/briefings/run-now` | `halo_eod_briefings` only |

Weather loads HALO properties (optional `propertyIds`). Missing lat/lng falls back to a **place-name** geocode (city, or `City, ST` from address). Open-Meteo forecast, 3-day risk classify. **Does not write Base44 or HALO schedules.**

EOD briefing aggregates Eastern-day jobs, check-ins, photos, latest Base44 sync freshness, stale evidence. Summary is a template (`fallbackSummary`). Scheduler persists once at 18:30 Eastern, independent of evening-close email. Falkon: ALLOW in OFF/SHADOW/ASSISTED as `halo_internal_snapshot`; LIVE DENY.

---

## How to verify

```
./node_modules/.bin/tsc --build --pretty false
./node_modules/.bin/tsc -p artifacts/api-server/tsconfig.json --noEmit --pretty false
cd artifacts/api-server && ../../node_modules/.bin/vitest run \
  src/lib/weatherRiskCore.test.ts \
  src/lib/eodBriefingCore.test.ts \
  src/lib/corsPolicy.test.ts \
  src/lib/falkonPolicyCore.test.ts \
  src/lib/crewCheckinCore.test.ts \
  src/lib/enforcerCore.test.ts \
  src/lib/base44SyncCore.test.ts
```

Apply `lib/db/migrations/0008_halo_eod_briefings.sql` (also created at API startup via `ensureFalkonSchema`).

Set `ALLOWED_ORIGINS` to the Replit frontend origin in production.

---

## STOP

Do not start Vapi outbound EOD, SMS inbox, weather schedule writes, or CrewBase UI. Next slice when asked: `weather.schedule_recommend` (recommendation packet only) or `catalog.lookup` matcher — still no CRM screens.
