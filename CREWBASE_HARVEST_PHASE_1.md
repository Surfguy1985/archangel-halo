# CREWBASE HARVEST — PHASE 1 (keep / rewrite / discard)

**HALO branch:** `cursor/backend-hardening`  
**CrewBase:** `/Users/bryce.beck/Documents/GitHub/crewbase` @ `96c24ab` (`main`, private)  
**Date:** 2026-08-13  
**Mode:** read-only comparison. No CrewBase code copied into HALO. No frontend redesign.

CrewBase is a **construction CRM** (jobs, bids, invoices, LiDAR, punch list, Stripe). HALO must not become that. Extract backend capabilities into **Falkon capabilities** over Base44 + HALO entities.

---

## Verdict in one page

| # | Candidate | CrewBase | HALO | Decision |
|---|---|---|---|---|
| 1 | One-tap GPS check-in links | Present — plaintext `crew_links` | **Stronger** — hashed `/checkin` | **KEEP HALO.** Do not port CrewBase tokens. |
| 2 | Location / event telemetry | `shift_events` pings, no jobId | **Stronger** — `crew_track_points` job-bound | **KEEP HALO** trail binding. Optional: 120s ping cadence idea only. |
| 3 | AI outbound / EOD calls | Vapi outbound + webhook | HALO Vapi is **inbound** only | **REWRITE** as Falkon cap `field.voice_eod`. New HALO worker, not CRM UI. |
| 4 | Two-way SMS | Twilio in + out, `messages` table | Twilio send for emergency/dispatch | **REWRITE** as `comms.sms` against crew phone on HALO crews. No worker inbox UI. |
| 5 | Automatic EOD briefings | `briefings` + OpenAI + fallback | Evening email + Command briefing | **REWRITE** aggregator into Falkon `ops.eod_briefing` using Base44 + check-ins. Keep HALO `fallbackSummary` pattern. |
| 6 | Walkthrough → report | Whisper + Gemini + Claude PDF | HALO Walk + transcribe | **KEEP HALO Walk.** Bind output to `base44_evidence`. Discard CrewBase walkthrough UI / shares CRM. |
| 7 | Weather risk scanning | Open-Meteo `POST /weather/scan` | Absent | **REWRITE** as Falkon `weather.risk_scan` (stateless). No weather dashboard. |
| 8 | Weather-aware schedule recs | `POST /ai/schedule-rearrange` | Absent | **REWRITE** as Falkon **recommendation only**. Base44 remains schedule SoR. Never write CrewBase/HALO schedule as truth. |
| 9 | Photo/doc → estimate | GPT-4o bid-from-photos | Ingest scan + price-book match | **REWRITE** tools behind Falkon `estimate.from_evidence`. No bid CRM screens. |
| 10 | Cost catalog fuzzy match | Jaccard matcher `lib/cost-catalog` | `price_items` / `catalog_items` + tokenScore | **KEEP HALO catalog.** Optionally rewrite matcher algorithm into HALO catalog lookup — do not import `cost_items` DB. |
| 11 | Secure share-link patterns | Mixed: companion hashed; check-in/shares **plaintext** | PM + check-in hashed; portal + chat-PM mint gaps | **KEEP HALO hash-at-rest.** Close HALO `pm_link.generate` plaintext. Discard CrewBase plaintext share PKs. |
| 12 | Signed webhook / events | HMAC `t=,v1=` + SSRF pin | Falkon **Ed25519** outbox/inbound | **KEEP FALKON Ed25519.** Do not add a third HMAC bus. |
| 13 | Deterministic AI fallbacks | `fallbackSummary`, `heuristicExtract` | Limited | **REWRITE** pattern into every new Falkon AI cap. Copy the *idea*, not CrewBase files. |
| 14 | Field-proof provenance | Absent (events ≠ provenance) | Partial `base44_evidence` + check-in audit | **NEW** later: bind telemetry to Base44 ids. Do not invent a chain from CrewBase (there isn’t one). |

**Do not import:** CrewBase CRM/jobs/contacts/contractors UI, worker dashboards, punch-list, AR punch, Luma/3D twin, Procore-demo routes, LiDAR/RoomPlan UI, Stripe invoicing UI, investor/god-mode, mockup-sandbox, blueprint co-edit.

---

## Check-in (candidate 1–2) — HALO wins

CrewBase `/api/shifts/me/:token` is a fat SMS page (clock + photos + tasks + map). Tokens are **plaintext PKs**. No duplicate-tap policy. No GPS accuracy/stale server checks. Pings have **no jobId**. Public `/shifts/me/` **bypasses rate limit**.

HALO `/checkin/:token` is the product we want: two taps, hashed tokens, 15s replay, second-device idempotent, GPS policy, job-bound trails, audit, production portal retired.

Harvest from CrewBase here is **ideas only**: rotate-link boss flow, 120s foreground ping while the page is open (HALO already has `POST /checkin/:token/location`).

---

## Proposed Falkon capability ids (not implemented)

| Capability | Mode default | Writes | Notes |
|---|---|---|---|
| `field.checkin` | already HALO `/checkin` | `crew_checkins` | Already gated as public token; do not re-portal |
| `field.location` | already HALO | `crew_track_points` | jobId from open session only |
| `field.voice_eod` | ASSISTED | call log + structured report | Vapi outbound; Falkon approval before auto-dial batches |
| `comms.sms` | ASSISTED for blast; auto for inbound store | `messages`-like HALO table TBD | Twilio; tenant/property/crew scoped |
| `ops.eod_briefing` | SHADOW then ASSISTED send | briefing row + optional notify | Deterministic fallback if model fails |
| `field.walk_report` | ASSISTED | `base44_evidence` projection | HALO Walk already exists |
| `weather.risk_scan` | OFF/SHADOW ok | none (read) | Open-Meteo; no SoR write |
| `weather.schedule_recommend` | ASSISTED | **none** — recommendation packet only | Office/Falkon decides; Base44 schedules |
| `estimate.from_evidence` | ASSISTED | draft line items, not invoices | HALO catalog match |
| `catalog.lookup` | ALLOW in ASSISTED | none | HALO `price_items` |

LIVE stays disabled (HALO Phase 3).

---

## HALO bugs to fix on HALO (not CrewBase ports)

These were already in harvest Phase 0. They are HALO defects:

1. `dispatchAutoAction` `pm_link.generate` still inserts plaintext `pm_live_links.token`.
2. `x-halo-actor-channel: worker` is client-settable.
3. Unrestricted CORS.
4. Classic PAT used to clone CrewBase must be **revoked** (it was pasted in chat and has `delete_repo`, `admin:org`, `admin:enterprise`).

Not started in this Phase 1 document except the clone.

---

## CrewBase auth (do not copy Clerk as HALO identity)

CrewBase: Clerk managers + phone OTP companion + partner API keys.  
HALO: Enforcer V3 + office passcode + capability URLs.

Harvest must attach **Enforcer tenant/role**, not Clerk `X-Tenant-Id`. CrewBase itself warns tenant filter is application-only (no RLS). HALO Enforcer is the identity plane.

---

## STOP

Phase 1 mapping is complete. **Do not implement** Vapi EOD, SMS bus, or weather until explicitly instructed. Next implementation slice (when asked): HALO-only plaintext PM mint fix, then `weather.risk_scan` or `ops.eod_briefing` as the first *new* Falkon capability — never CrewBase UI.
