---
name: HALO crew instructions gate
description: The umbrella "read this before you start" gate on every crew QR link — how acceptance is attributed, scoped to a visit, and enforced.
---

# Crew link instructions gate

Every crew link surface (paycard check-in, crew portal, foreman join, Expo app) opens on a
full-screen instructions gate before the working surface. Acceptance is recorded append-only,
one row per acceptance, and is what the office cites when pay is questioned.

## Rules

**The server owns the copy; clients never post the wording.** Clients send only `{ lang, linkKind }`
and the server snapshots its own EN/ES text onto the row.
**Why:** the acceptance has to be legally citable — a client that supplies its own text could rewrite
what a crew "agreed" to, and changing the copy later must never rewrite an earlier crew's acceptance.
**How to apply:** any new surface that accepts the gate posts to the surface's `/instructions`
endpoint; never write an acknowledgement row from client-supplied text.

**Attribute the crew from the link token, never from a client-sent crew id.** Crew links are
unauthenticated bearer tokens.
**Why:** a crew id in the body is forgeable, so acceptance could be attributed to someone else.
**How to apply:** resolve the token → crew server-side. On the join link no crew row exists yet, so
the gate only *reads* copy; the acknowledgement is written inside the claim transaction and the claim
refuses without an explicit agreed flag.

**"Fresh open" is per visit, not per crew.** Web uses `sessionStorage` keyed by token; native uses a
module-scope flag that resets on cold start.
**Why:** the requirement was invisible because the portal's first-run gate fires once per crew ever —
a member who accepted months ago never saw it again. But re-nagging on every mid-shift refresh would
train crews to dismiss it blind.
**How to apply:** don't persist the "seen" flag to localStorage or the DB.

**A handoff between two crew links inside one visit is not a fresh open.** Claiming a join link mints
a brand-new paycard token and navigates straight to it.
**Why:** keying the visit flag by token alone makes that hop look like a new scan — the member is
gated twice and a second acceptance is recorded seconds after the first, which makes the audit trail
lie about what happened.
**How to apply:** any flow that mints a new crew token and redirects into it must carry the accepted
visit state onto the new token; a later scan of that same link, in a new session, still gates.

**Refusal contract is HTTP 428 + `code: "instructions_required"`.** Check-in is gated; checkout is
deliberately NOT (a crew must always be able to close out an open shift). Every client that can
check in must translate a 428 back into the gate, not a generic error toast.

**Acceptance has a TTL** (`CREW_ACK_TTL_HOURS`) for counting as "current" at check-in — an ancient
acceptance does not satisfy the gate.

## Compliance, not blocking

Missing check-in / checkout / before / after photos flag a job for *supervisor review* in the office
pay flow. Build the reviewed roster from who was **supposed** to work the job — direct leader plus
schedule and dispatch assignments — not only from who left a punch or a photo, or the crew that did
nothing (the exact case worth flagging) silently disappears from the review. A job with nobody on
record is its own review state, not an empty panel. It never blocks a payment automatically — the pay decision stays with the office. That is
what makes the "payment may be delayed until reviewed by a supervisor" wording honest rather than an
empty threat.

## Gotchas

- The acknowledgement table ships as boot-time idempotent DDL, like the other crew-link tables — no
  drizzle-kit push.
- `lib/board-ui` is not in the root tsconfig references, so `typecheck:libs` does not rebuild it.
  After editing the gate component, run `npx tsc --build lib/board-ui` or consuming apps fail with
  "has no exported member".
