---
name: HALO Expo push delivery contract
description: sendExpoPush must check response.ok AND Expo ticket status before reporting acceptance; transport errors and error tickets are both silent failure modes.
---

# Expo Push Delivery Contract

## Rule
`sendExpoPush` must check **both** `response.ok` (HTTP level) **and** `ticket.status === "ok"` (Expo application level) before returning `true`. Any callers that surface a "delivered" flag to users depend on this check being honest.

**Why:** Expo returns HTTP 200 even when it rejects a notification (e.g. invalid credential, device unregistered). `fetch` resolving successfully only means the TCP connection worked — it says nothing about whether Expo queued the notification. Reporting `deliveredPush: true` on any HTTP success causes office/voice users to believe a crew received a live link when Expo silently dropped it.

**How to apply:**
- After `await fetch(...)`, check `response.ok` first; return false if not.
- Then `await response.json()` and check `data[0]?.status === "ok"`.
- Wrap both json parse and ticket check in try/catch; return false on any error.
- Name the returned flag `acceptedPush` or `pushQueued` in new code to communicate that final device delivery is asynchronous — we only know Expo accepted the ticket.
- Test with mocks for: transport throw, HTTP 4xx/5xx, empty data array, error-ticket status, malformed JSON body.

## Tests
`artifacts/api-server/src/lib/pushNotification.test.ts` — 15 tests covering all failure modes.
