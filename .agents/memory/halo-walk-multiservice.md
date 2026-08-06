---
name: HALO Walk multi-service capture & client approve
description: Multi-photo/multi-service walk items save atomically via a batch endpoint; walk-findings client cards carry canApprove and approve via approve_walk.
---

**Rules:**
- Walk items can carry several photos (`walk_captures.photos` jsonb) and several services. Multi-line saves MUST go through the atomic batch endpoint (`/walks/:id/captures/batch`) — never loop single-capture POSTs from the client; a mid-loop failure leaves partial data (code-review-confirmed severity).
- `storagePath` is a legacy mirror of `photos[0]`; any photo counting/collection (complete, approve, review) must union `photos[]` with legacy `storagePath` fallback.
- Photos ride only on the FIRST line's row of a batch so counts don't double.
- Walk-findings client cards (sourceType `walk_job`, module type `photos`) carry `canApprove: true`; the client legacy card-action `approve_walk` stamps `clientApprovedAt/By` once and sets card `column='in_progress'` (idempotent). Client BoardCardModules shows APPROVE WORK; board-ui office copy is read-only state display. Remember TWO BoardCardModules copies.
- Client card actions in dev need BOTH the session cookie (`POST /api/client/:token/session`, strict mode) AND a Bearer client-user session token (HMAC `userId.exp.sig` with SESSION_SECRET).

**Why:** non-atomic multi-row saves and single-copy UI edits have both bitten before.
