---
name: HALO passwordless posture
description: Every human-facing password/passcode/login was removed by owner instruction; a URL is the only credential.
---

No surface in HALO may ask a human for a password, passcode or PIN. The office
app, the desktop app, Walk, the crew app and the client board all open straight
from their URL. There is no sign-in screen anywhere, and there is no read-only
guest mode on the client board — whoever holds a board link is a full admin on
that board.

**Why:** the owner asked for it explicitly and maximally ("Everything — crew,
Walk, client boards AND the office passcode. Nothing asks for a password
anywhere."). A code review will read the open office API as a vulnerability; it
is a product decision, not a regression. Do not re-introduce a login, a
passcode gate, or a guest tier without the owner asking for one.

**Machine-to-machine auth stays** and is not in scope: Falkon Ed25519 S2S
signing, the enforcer JWT path, concierge one-time HMAC confirm chips, rate
limiters, and the unguessable link tokens themselves (roster code, crew portal
token, board dashboard token, tracker token). The client board's token→httpOnly
cookie exchange also stays — it never involved a password.

**How to apply:**
- New office routes need no gate. New *token* surfaces still need their prefix
  in `lib/publicPaths.ts` PUBLIC_PREFIXES, which is now only consulted by the
  Falkon mutation guard and the enforcer identity exemption — not by any
  passcode gate.
- `lib/enforcer.ts` hardcodes `officeSessionValid = true`. That flag is what
  enforcerCore calls "the local operator"; leaving it false would 401 the whole
  API now that no cookie can ever exist. Verified JWT claims still win when
  HALO_ENFORCER_* is configured.
- The client board's viewer is a deterministic per-property identity derived as
  HMAC(SESSION_SECRET, "link-holder." + propertyId), so concierge history and
  confirm chips keep a stable, board-scoped key with no user row.
- `client_users` rows are a directory (names/emails/roles for notification and
  display only). `password_hash` is NOT NULL so new rows write `""`; it is never
  read for auth. Never add a UI that issues or resets a password for them.
