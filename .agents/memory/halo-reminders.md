---
name: HALO reminders table + briefing coupling
description: Why a missing reminders table reads as "HALO ask is broken", and how the table is created.
---

The `reminders` table is created at process start by an idempotent `ensure*Schema`
bootstrap in the api-server, alongside the Falkon/Base44/client-board bootstraps.
It has no cross-schema dependency, so it can run unordered with the others.

**Why:** drizzle-kit push is TTY-bound and never runs in this project, so any new
table must ship as boot-time DDL or it simply does not exist in dev/prod. The
reminders table was missing for a long time and that produced 500s on both
`/reminders` and `GET /today/briefing` — and the briefing is the office chat's
"what needs my attention" card. To the user that reads as *"HALO ask is broken"*,
not "a table is missing", because the chat surface is the only place they see it.

**How to apply:**
- Any new table added to the drizzle schema needs a matching boot-time ensure
  step, or every endpoint touching it 500s in deployed environments.
- When someone reports a chat/ask surface misbehaving, check the endpoints the
  chat cards call (`/today`, `/today/briefing`, `/reminders`, `/crews`,
  `/properties`) before touching the brain — the brain itself
  (`POST /command/conversations/:id/ask`) holds no cache and is usually fine.

**Testing the office API without the passcode:** the office session cookie is a
stateless HMAC (`office.<expiry>.<nonce>.<hmac>` signed with `SESSION_SECRET`),
so a valid test cookie can be minted locally in node without knowing the
passcode. Chat conversations are scoped by that nonce, so a freshly minted
cookie sees an empty conversation list and old conversation ids 404 — expected,
not a bug; both apps recover by creating a new conversation.
