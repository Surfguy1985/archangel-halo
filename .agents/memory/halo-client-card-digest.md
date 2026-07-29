---
name: HALO client card digest
description: Hourly batched email pings to clients when new board cards land
---

New client-board cards are notified via an hourly scheduler sweep (clientCardDigest), NOT inside raiseClientCard — one digest email per account covering all cards with `notifiedAt IS NULL`.

**Rules:**
- Cards are atomically claimed (guarded update on `notifiedAt IS NULL`) BEFORE sending; on send failure the claim is released for retry. Never send before claiming.
- Per-account toggle `clientAccounts.notifyNewCards` (default on); toggle-off / cancelled / no-account cards are claimed silently so they never pile up.
- Recipient: billingContact.email, fallback first active admin client user; no contact → left unclaimed for retry, force-claimed after 7 days.
- Re-sends that update an existing card do NOT re-notify (notifiedAt untouched) — only brand-new cards ping.
- SMS deliberately not wired: no Twilio helper exists in the api-server yet (separate task adds one). When it lands, add a text channel to the digest sweep.

**Why:** batching/dedupe prevents multi-send days from spamming clients; claim-before-send prevents double emails from overlapping sweeps or restarts.
