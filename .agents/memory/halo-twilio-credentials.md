---
name: HALO Twilio credential resolution
description: Why Twilio SMS auth/from-number resolution matches on value shape instead of trusting connector field names or toE164.
---

# Twilio credential resolution

## Rule 1 — resolve Twilio SIDs by shape, never by field name

The Replit Twilio connector settings bag is operator-filled and its fields can be
crossed or junk. Resolve credentials by matching value shape:

- Account SID = `AC` + 32 hex (34 chars) — required in every REST path.
- API Key SID = `SK` + 32 hex (34 chars) — the Basic-auth **username** when key auth is used.
- API Key Secret = 32 chars.

**Why:** a real incident had the API Key SID stored under `account_sid`, an 8-char
label under `api_key`, no `auth_token`, and no Account SID anywhere. The send path
trusted the field names, used the 8-char label as the username, and every text
failed with Twilio `20003 "Authentication Error - invalid username"`. The
credentials themselves were valid the whole time.

**How to apply:** any code reading Twilio settings must pick the AC/SK values by
regex from anywhere in the bag and refuse to send when no AC-shaped Account SID
resolves — a clear error beats a bare Twilio 401.

## Rule 2 — the Account SID is recoverable from a valid API key

`messaging.twilio.com/v1/Services` and `verify.twilio.com/v2/Services` are scoped by
the credential itself (no Account SID in the path), so one authenticated read
returns objects carrying the owning `AC…`. Use this when the connector never stored
an Account SID, instead of asking the operator to paste one.

Note `GET /2010-04-01/Accounts.json` returns 401 under API-key auth even when the
key is perfectly valid — API keys cannot list accounts. Do not read that 401 as
"the credentials are bad"; probe a credential-scoped endpoint instead.

## Rule 3 — never validate a *sending* number with toE164

`toE164` is deliberately forgiving and falls back to `+1` + the **last 10 digits**,
so an over-long corrupt value is silently reshaped into a real-looking number.

**Why:** the `TWILIO_FROM_NUMBER` secret held a 19-digit value. `toE164` truncated
it into a well-formed number the Twilio account did not own, which would have
failed at send time with `21606` — a second, independent fault hiding behind the
auth error.

**How to apply:** check the **raw** digit count is 10–15 before normalizing, then
confirm the result against a strict E.164 test. A malformed `TWILIO_FROM_NUMBER`
must fall back to the connector's stored number rather than shadowing it.

## Rule 4 — re-proposing an added connection does not re-prompt for keys

Accepting a `ProposeIntegration` for an already-`added` connection re-attaches it
but leaves stored credentials untouched (`updated_at` does not move). For a
key-based connector holding bad values, expect to fix it in code or have the
operator edit the connector fields — a reconnect alone will not clear it.
