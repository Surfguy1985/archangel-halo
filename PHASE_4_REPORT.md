# PHASE 4 — Crew Check-in / Check-out

**Branch:** `cursor/backend-hardening`  
**Date:** 2026-08-13  
**Frontend changes:** none  

Goal: **The crew interaction is two taps — check in, check out.** HALO already knows dispatch. GPS is session-justified only. The old full crew portal is not the production crew OS.

---

## Score

### Phase 4 — **10.0 / 10.0**

This score applies to the **crew check-in link / session / GPS gate only**. It does **not** mean the PM live product is complete (Phase 5), the knowledge brain is retrieval-driven (Phase 6), or CORS is locked.

| Phase 4 acceptance criterion | Result |
|---|---|
| Secure crew link (hash at rest, create / expire / revoke, last-access, audit) | Pass |
| Crew identity from the link (body `crewId` ignored unless it matches) | Pass |
| Current dispatch: property + assigned units for today | Pass — multiple units joined |
| Valid check-in | Pass |
| Duplicate tap (cooldown replay, no second punch) | Pass |
| Second device while already in (idempotent, same session) | Pass |
| Check-out | Pass — ends tracking |
| Checkout without check-in | Pass — 409 |
| Expired / revoked crew link | Pass — 410 |
| Wrong crew | Pass — 403 |
| GPS unavailable | Pass — punch still allowed, map has no fix |
| Low accuracy | Pass — allowed, flagged |
| Stale location (`capturedAt` too old) | Pass — 400 |
| Multiple assigned units | Pass |
| No dispatch for today | Pass — assignment null; punch still allowed |
| Reassigned crew | Pass — dropped from today's dispatch |
| Rate-limit abuse | Pass — `limits.checkinWrite` / `checkinView` / `trackPoint` |
| Location updates only while checked in | Pass — `POST /checkin/:token/location` |
| No background-GPS claim | Pass — `backgroundGpsSupported: false` |
| No photos / checklist / invoice / QC required on this path | Pass |
| Legacy `/portal` retired in production | Pass — 410 unless `HALO_CREW_PORTAL_ENABLED=true` |
| Acceptance tests | Pass — `crewCheckinCore.test.ts` |
| Backend typecheck | Pass |
| Zero HALO frontend redesign | Pass |

**STOP.** Do not start Phase 5 until explicitly instructed.

---

## What changed

| Change | Why |
|---|---|
| `crewCheckinCore.ts` | Pure token / GPS / session / dispatch / portal-exposure policy |
| `crewCheckinLinks.ts` | Hashed tokens; session machine; location pings; additive map payload |
| `crew_checkin_links.token_hash` / `last_accessed_at` / `crew_checkin_audit` | Same capability-URL pattern as PM live |
| `POST /checkin/:token/location` | Foreground pings while the check-in page is open |
| Production `/portal/*` → 410 | One-tap check-in is the crew surface; opt-in for compatibility |
| Chat `crew_checkin_link.generate` | Mints hashed tokens, reveals bearer once |

Existing `GET /checkin/:token` and `POST .../checkin|checkout` shapes stay compatible (`crew`, `todayAssignment`, `currentStatus`, `{ lat, lng, accuracy }`). Extra fields are additive.

No files under `artifacts/halo`, `halo-desktop`, `halo-crew`, `client-dashboard`, `walk`, `halo-ds`, `mockup-sandbox`, `devportal`, or `lib/board-ui` were modified.

---

## Session rules

```
CHECK IN
  GPS missing        → allow (gps: unavailable)
  GPS low accuracy   → allow (flagged)
  GPS stale/invalid  → 400
  already in, <15s   → 200 replay (duplicate tap)
  already in, later  → 200 replay (second device)
  otherwise          → insert checkin

CHECK OUT
  no open session    → 409 checkout_without_checkin
  duplicate tap      → 200 replay
  otherwise          → insert checkout; trackingActive=false

LOCATION PING
  session out        → 409 session_ended
  no/stale/invalid GPS → 400
  session in         → write crew_track_points (jobId from open check-in, never the client)
```

Checkout on this path does **not** require after photos. That gate remains only on the legacy portal, which is off in production.

---

## Privacy / GPS honesty

- Location is stored only for an open work session.
- Checkout ends the tracking session.
- `backgroundGpsSupported` is always `false`. A mobile browser cannot be claimed to ping after the OS suspends the page.
- Logs already redact `/checkin/:token`.

---

## Portal compatibility

| Environment | `/portal/:token` |
|---|---|
| development / test | Open (existing halo-crew + integration tests) |
| production | **410** `crew_portal_retired` |
| any, `HALO_CREW_PORTAL_ENABLED=true` | Open (staged rollback) |
| any, `HALO_CREW_PORTAL_ENABLED=false` | 410 |

---

## Tests

`artifacts/api-server/src/lib/crewCheckinCore.test.ts` covers every listed acceptance case (tokens, punches, GPS, dispatch, portal exposure). Rate-limit 429 is the HTTP limiter; duplicate taps are cheap replays so humans are not locked out.

Also re-ran Phase 1–3 cores + waybill.

```
tsc --build
tsc -p artifacts/api-server --noEmit
vitest: 5 files, 98 tests passed
```

---

## Explicitly not this phase

- Property manager live-link product copy and isolation polish (Phase 5; isolation already exists from Phase 2)
- Retrieval-driven HALO brain (Phase 6)
- CORS lock
- Redesign of `CrewCheckinPage.tsx` (Replit-owned; backend is additive)
