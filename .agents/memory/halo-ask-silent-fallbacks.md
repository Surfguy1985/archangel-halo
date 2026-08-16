---
name: HALO ask surfaces — no silent fallbacks
description: Why "HALO ask feels dumb" is usually a client-side fallback hiding a healthy brain, and the rules both ask surfaces must follow.
---

There are two independent "ask" surfaces, and both used to disguise failure as a
canned answer. Check the client before suspecting the brain: the ask endpoints
can be driven directly with a minted office cookie (see `halo-reminders.md`) and
are usually healthy.

- Office chat (`HaloCommand`, mobile + desktop twins): ask failure must render an
  error turn. Falling through to the local `parseVoice` path ends in a generic
  "try asking about your jobs…" reply, which users read as HALO getting dumb.
- Portfolio pill (`PulseGuide`): the board computes a local canned packet first,
  then calls the server. Any non-ok status, network error, or `inventGuard`
  rejection keeps the local packet — it must be labelled as the board's own read,
  never passed off as HALO's answer.

**Rule:** a failed ask is reported, never substituted.

**Why:** `inventGuard` validates server answers against only the units the board
has loaded, so correct answers about the wider portfolio get rejected; and a
missing session/table/flag produces the same canned text as a healthy answer, so
outages stay invisible for weeks.

**How to apply:** when touching either ask flow, keep the error branch, and
remember the chat updates its thinking bubble by placeholder id — clearing the
message list during stale-conversation recovery makes the recovered answer
render nowhere. Mint a conversation on demand if none exists, and clear the
recorded error once a retry succeeds.
