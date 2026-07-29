---
Push composer (desktop ClientBoardOffice) is a two-step tile picker: templates map onto the 7 card kinds; property "To" dropdown switches target board — switching property or manually editing prefilled fields must reset/clear the quick-pick source or stale invoice/tracker data leaks to the wrong client. Office board polls every 4s to mirror client column moves.

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

## Instant push notify (Jul 2026)
Office can push any card kind onto a client board (admin board/push endpoint → raiseClientCard with sourceType office_push + random sourceId, so each push is a new card unless caller passes an entity dedupe ref). notifyCardPush sends the "Your vendor has sent you a card" email immediately using the same claim-before-send notifiedAt contract as the digest — toggle-off claims silently, send failure releases the claim so the hourly digest retries. linkUrl must be validated http(s) server-side (client board renders links as raw hrefs).
