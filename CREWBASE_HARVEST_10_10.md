# HALO 10/10 gaps — backend close-out

**HALO branch:** `cursor/backend-hardening`  
**Date:** 2026-08-13  
**Frontend changes:** none  
**Phase 5 PM-live product UI:** not in this slice

---

## What closed

| Gap | What shipped |
|---|---|
| `crews.portal_token` plaintext + `Firstname2026` | Hash-at-rest (`portal_token_hash`, placeholder `h:<sha256>`). `POST /portal/login` is **410** even when the portal flag is on. Lookup hashes first, then legacy plaintext so existing tests/bookmarks still work. SMS/office `portal-link` reveal a bearer once; hashed placeholders are never returned as URL tokens. |
| Command `buildSnapshot()` portfolio leak | Retrieval is scoped by Enforcer identity. `property_manager` / `vendor` / `crew` / PM live are property-bound or **empty** (fail closed). Executive/admin/field_manager/accounting stay tenant-wide. Prompt is not the security boundary. Briefing + attention feed follow the same filter. |
| Base44 “15 minutes” lie | Command prompt and scheduler comment match reality: projection pull ~**30 seconds**. Ingest stays ungated (SoR read, not a HALO mutation). |
| Field-proof provenance | Successful `/checkin` check-in, checkout, and location writes `base44_evidence` resource **`halo_field`**. Job id comes from dispatch/open session only. Body cites mapped `crew_jobs` Base44 id when `base44_sync_map` has one. |
| Thicken harvest caps | `ops.eod_briefing` optional LLM recap, always `fallbackSummary` on failure. `estimate.from_evidence` optional JSON polish, heuristic fallback. `field.voice_eod` structured `{done,blockers,tomorrow}` from transcript (heuristic if the model fails). `field.checkin` / `field.location` registered in `FALKON_CAPABILITIES` against existing `/checkin` (no second product). |

Apply `lib/db/migrations/0010_portal_token_hash.sql` (also `ALTER` at API startup).

---

## Still true / out of scope

- LIVE remains disabled. Public `/portal`, `/client`, `/pay`, `/checkin` skip `falkonMutationGuard`.
- Base44 remains the operational system of record. HALO does not write Base44 schedules or invoices from these caps.
- CrewBase CRM/UI, punch-list, Stripe, Phase 5 PM-live screens: not imported.
- Production still needs `ALLOWED_ORIGINS`, Twilio/Vapi env, and the operator should **revoke** the PAT used to clone CrewBase.

---

## Tests

See the vitest + tsc run in this change. Cores added/extended: `portalTokenCore`, `commandSnapshotCore`, `fieldProvenanceCore`, EOD/estimate/voice fallbacks, `authorizePropertyAccess` fail-closed when a property-bound identity omits a property id.
