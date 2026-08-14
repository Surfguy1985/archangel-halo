---
name: HALO SMS sending contract
description: How outbound SMS works in api-server — credential resolution, call signature, failure semantics, and why "sent" never means "delivered"
---

# Outbound SMS (`api-server/src/lib/sms.ts`)

Single helper for every outbound text (payment links, crew check-in links, anything future).

## Call signature is POSITIONAL
`sendSms(to, body, opts?)` — the first two args are NOT an options object. Easy to get
wrong because the sibling email helper takes an object. The optional third arg carries
metadata for the log row (e.g. `{ crewId }`). Returns a result object; check `.ok` and
read `.error`.

## It NEVER throws
Delivery failure is returned as `{ ok: false, error }`, not raised. Call sites must
branch on `.ok` explicitly — a bare `await sendSms(...)` silently swallows failures.

**Why:** it is called from request handlers that have no global error middleware, so a
throw would become an unhandled rejection rather than a clean 4xx.

## `ok: true` means ACCEPTED, never DELIVERED
Twilio returns 201 the moment it takes the message. US carriers then silently drop
traffic from numbers that fail registration — the app sees a perfect success and the
phone never rings. The two codes that cause this in practice:

- **30032** — toll-free number whose Toll-Free Verification was rejected.
- **30034** — 10DLC local number whose A2P campaign is not registered/approved.

Neither is fixable in code; both require resubmitting the business's legal and
opt-in details in the Twilio Console. When someone reports "texts aren't coming
through", check the message logs for these codes *before* touching the send path.

**How to apply:** never report a text as delivered on the strength of `ok: true`. The
real verdict arrives later on the status webhook and is written to the message's row.

## Delivery tracking: the nonce callback pattern
Every send reserves its log row *before* the Twilio POST and embeds a per-message
128-bit nonce in the `StatusCallback` URL. Twilio calls back with the carrier verdict.

**Why the nonce instead of a signature:** the Twilio connector authenticates with an
API key and stores no auth token, so `X-Twilio-Signature` cannot be verified (the
inbound webhook fails closed with 503 for the same reason). Possessing the nonce
proves the callback belongs to a message we sent and can only ever settle that one row.
It is a bearer capability, not proof of Twilio origin — so the path must stay in the
request-logger's URL redaction list.

**How to apply** when touching this path:
- Reserve the row before sending. Twilio's callback can beat its own HTTP response;
  if the row doesn't exist yet the verdict is lost and the callback still 200s.
- Every local settlement (accepted, failed) must be guarded on the row still being
  `pending`, and the webhook must refuse to move a row that already reached a terminal
  status. Otherwise retries, out-of-order callbacks, and lost responses corrupt the verdict.
- Log outbound rows **only** inside `sendSms`. Senders that write their own row produce a
  duplicate that never settles and contradicts the real one.

## Credential resolution order
Env vars first, then the Twilio connector's stored credentials, cached ~5 minutes.
Precedence is `HALO_SMS_FROM_NUMBER` → `TWILIO_FROM_NUMBER` → `TWILIO_PHONE_NUMBER` →
connector number, and each candidate is tried in turn so a malformed high-precedence
value cannot strand the send.

**Why an explicit override exists:** an account can own several numbers and only some of
them clear US carrier registration, so the connector's own number is not necessarily the
sendable one. The operator needs a way to pin the registered number.

Use `smsEnabled()` to gate UI/endpoints before minting anything; `smsPublicStatus()`
is the safe shape to expose outward.

**How to apply:** when adding a texting feature, check `smsEnabled()` *before* creating
side-effecting records. If the send then fails, undo/revoke what you created — otherwise
you leave live tokens the recipient never received (the crew check-in link endpoint
revokes its just-minted link on send failure for exactly this reason).
