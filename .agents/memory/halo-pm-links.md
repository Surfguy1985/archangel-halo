---
name: HALO PM Live Links + Crew Check-in Links
description: Secure texted links generated from chat — PM live view and crew GPS check-in.
---

## PM Live Links

Table: `pm_live_links` — token, propertyId, permissions jsonb, expiresAt, revokedAt, label.

Token format: `pmlink_` + 12 random hex bytes.
Default expiry: 24 hours.

**Office API (behind passcode gate):**
- `POST /pm-links` — create link, returns { url, smsText, link }
- `GET /pm-links` — list active non-expired links
- `DELETE /pm-links/:token` — revoke

**Public API (in PUBLIC_PREFIXES):**
- `GET /live/:token` — returns property data bundle: summary, crews, photos, workNotes, permissions
- `POST /live/:token/chat` — property-scoped chat using runCommandBrain with "pm" role

**Frontend:** `/live/:token` → `PMliveView.tsx` (public route in App.tsx, no OfficeGate)

## Crew Check-in Links

Table: `crew_checkin_links` — token, crewId, expiresAt, revokedAt, label.

Token format: `crew_` + 12 random hex bytes.
Default expiry: 90 days (semi-permanent bookmarks).

**Office API (behind gate):**
- `POST /crew-checkin-links`, `GET /crew-checkin-links`, `DELETE /crew-checkin-links/:token`
- `POST /crew-checkin-links/paycards` — mint/reuse one printable URL per active crew. Label stores `HALO paycard | {url}` so printed QR codes stay stable.

**Public API:**
- `GET /checkin/:token` — crew info + today's assignment + today's before/after photos
- `POST /checkin/:token/checkin` — GPS required, unit required (`unitNo`). Writes `crew_checkins` + a `crew_track_points` breadcrumb so the green pin appears immediately
- `POST /checkin/:token/photos` — `{ storagePath, phase: before|after }` into `crew_photos` (same store as the portal)
- `POST /checkin/:token/checkout` — 409 unless before AND after photos exist
- `POST /checkin/:token/location` — trail pings while checked in

Check-in records go into the existing `crew_checkins` table (not a new table). The links table only holds tokens. Map pins treat an open GPS check-in as `todayStatus: "site"` even without a schedule row.

**Frontend:** `/checkin/:token` → `HaloCrewPaycardPage` (public, no OfficeGate). Punchlist Crew card prints the QR.

## Brain Commands

Brain generates links via voice_action with these capabilities:

```
"pm_link.generate"     → params: { propertyName, expiresInHours=24, permissions }
                          risk: "auto"
                          result JSON: { type: "live_link", propertyName, url, token, smsText, expiresAt }

"crew_checkin_link.generate" → params: { crewName, expiresInDays=90 }
                               risk: "auto"
                               result JSON: { type: "crew_link", crewName, url, token, smsText, expiresAt }
```

Both handled in `dispatchAutoAction()` in `command.ts`.
baseUrl derived from `REPLIT_DEV_DOMAIN` env var or request headers; passed as 4th param to `dispatchAutoAction`.

Property/crew resolved by fuzzy name match (`.includes()` both ways).

## HaloCommand Live Link Card

`parseLiveLinkResult(result)` parses the JSON string from the action result.
When it detects `type: "live_link"` or `type: "crew_link"`, adds a `live-link-card` message to the thread.
`LiveLinkCard` component renders the pre-formatted SMS text with a "Copy for texting" button.
`onRevoke` calls `DELETE /api/pm-links/:token` or `DELETE /api/crew-checkin-links/:token`.

## Public Route Registration

officeAuth.ts PUBLIC_PREFIXES must include `/live/` and `/checkin/`.
App.tsx must have these routes BEFORE the OfficeGate-wrapped root `/` route.

## Data Queries for PM Live View

- Crews on site: crew_checkins (today, kind=checkin, jobId in active job IDs) — no propertyId on crew_checkins
- Photos: crew_photos filtered by jobId in active job IDs — no propertyId on crew_photos
- Work notes: job_summaries filtered by propertyId (has propertyId directly)
- No unitNumber on jobsTable — removed from crew checkin links handler

## Why
This architecture keeps HALO as a thin coordination layer. Base44 remains the operational source of truth. HALO generates secure share links from chat, then presents Base44-synced data in a minimal mobile view. No separate portal app needed.
