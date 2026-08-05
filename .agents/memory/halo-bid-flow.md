---
name: HALO bid → client request flow
description: Office bids link to client work requests by bid number; bid numbers are DB-unique; AI pricing endpoint is knowledge-based.
---
- Office creates a bid (desktop + New → Job/Bid → Bid, QuickBidDialog) and gives the client the B-xxxx number. Client types it in the request-work wizard's "Bid number" box → `/client/:token/bid-lookup/:bidNo` prefills service/budget/unit/notes; the create endpoint validates the bid belongs to THAT property (400 otherwise) and stores bidId/bidNumber on work_requests. Accepting the request marks the bid `accepted` (best-effort, only from `sent`).
- **Why:** bid numbers are shared externally as the client's start-work key, so they must be property-scoped on lookup (no enumeration) and DB-unique.
- `bids.bid_no` has a unique index (`bids_bid_no_uq`); bid creation retries on 23505 (check err.code OR err.cause.code) with a fresh nextBidNo(). Any new bid-creating path (e.g. voice) must reuse this pattern.
- Client wizard prefill is one-shot: the lookup query key is cleared after applying so background refetch never re-overwrites user edits. Keep that guard.
- POST /bids/ai-pricing is a knowledge-based Claude estimate (market range + wholesale notes + suggested price) — no live web data; responses say so. 502 on AI failure, never a silent fallback.
