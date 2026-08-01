---
name: HALO card messaging (client ↔ office threads)
description: Durable rules for board-card message threads — thread family keying, read-receipt authz, digest claim semantics.
---

# Card messaging rules

- Card threads reuse the existing card-comments store, NOT a separate table. **Why:** preserves existing threads, comment-count projections, and generated hooks.
- A pushed mirror card and its projected source card share ONE thread family. Any new thread reader/writer must resolve the family (helper exported from the client board routes) — reads span all family keys, writes land on the canonical (source) key — or conversations orphan on push/dedupe/lane moves.
- Unread state is per-message read receipts, and read receipts are STATE: only authenticated writers (client side) may mark seen — guests holding a board link must never clear badges or suppress the email digest. UI auto-mark-seen effects must be gated on !readOnly.
- Digest sends use claim-before-send, and the claim query must re-check "still unread" at claim time; anything read between snapshot and claim is claimed silently, never emailed.
- Message attachments accept object-storage entity paths only (`/objects/...`); anything else is rejected so threads can't link arbitrary URLs.
