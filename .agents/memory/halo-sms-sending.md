---
name: HALO SMS sending contract
description: How outbound SMS works in api-server — credential resolution, call signature, and failure semantics
---

# Outbound SMS (`api-server/src/lib/sms.ts`)

Single helper for every outbound text (payment links, crew check-in links, anything future).

## Call signature is POSITIONAL
`sendSms(to, body)` — NOT an options object. Easy to get wrong because the sibling
email helper takes an object. Returns a result object; check `.ok` and read `.error`.

## It NEVER throws
Delivery failure is returned as `{ ok: false, error }`, not raised. Call sites must
branch on `.ok` explicitly — a bare `await sendSms(...)` silently swallows failures.

**Why:** it is called from request handlers that have no global error middleware, so a
throw would become an unhandled rejection rather than a clean 4xx.

## Credential resolution order
Env vars first, then the Twilio connector's stored credentials, cached ~5 minutes.
`TWILIO_FROM_NUMBER` (a Replit Secret) takes precedence over the connector's number.
Use `smsEnabled()` to gate UI/endpoints before minting anything; `smsPublicStatus()`
is the safe shape to expose outward.

**How to apply:** when adding a texting feature, check `smsEnabled()` *before* creating
side-effecting records. If the send then fails, undo/revoke what you created — otherwise
you leave live tokens the recipient never received (the crew check-in link endpoint
revokes its just-minted link on send failure for exactly this reason).
