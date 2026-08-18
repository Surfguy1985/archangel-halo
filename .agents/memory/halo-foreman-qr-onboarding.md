---
name: HALO foreman QR crew onboarding
description: How a foreman self-onboards crew by QR, and the invariants that keep it from becoming an open door into the crew table.
---

# Foreman QR crew onboarding

A crew member flagged as foreman can mint single-use QR join codes from his own
paycard. A scanner types their name and is created as a crew member under that
foreman, with their own paycard minted on the spot.

## Foreman is two things at once — always write both

Authority is represented structurally (`crews.isLeader` / `leaderId`, used by
dispatch grouping and portal approval) and as a Wings tier (`crews.role`).
The office toggle writes `isLeader` and `role` together.

**Why:** Wings role weights differ per tier (foreman is weighted above crew), so
flipping the toggle changes profit-share weighting. Setting only one of the two
leaves dispatch and money disagreeing about who runs a crew.

**How to apply:** any new UI or importer that promotes/demotes must set both.
The office crew *list* read model carries `isLeader` but not `role`, so read
authority from `isLeader` there; server-side use the shared foreman predicate
(role foreman/superintendent OR isLeader).

## Invite invariants

- The join bearer is **never persisted** — hashed at rest, returned once at mint
  time. A code that isn't printed/sent before the sheet closes is gone; mint a
  new one. Do not "helpfully" store it on a label column to re-show it: a DB
  read or backup would then be able to enroll crew and mint a year-long paycard.
- Claiming re-checks **expiry and foreman authority inside the transaction**,
  not only in the pre-read, with the foreman row locked `FOR UPDATE`.
  **Why:** a request that starts a second before expiry, or while the foreman is
  being demoted, must not land afterwards.
- Losing foreman authority (or going inactive) **revokes outstanding unclaimed
  invites** from the office crew PATCH. **Why:** without it, re-promoting later
  silently re-arms every QR already in the wild, which is the opposite of what
  the toggle promises.
- Minting and revocation take the **same per-foreman advisory lock**, and mint
  re-reads the foreman `FOR UPDATE` inside its transaction. **Why:** otherwise a
  code minted a millisecond after a demotion survives the revocation sweep and
  re-arms on re-promotion. Revocation failure is surfaced to the office, never
  swallowed.
- The open-invite cap ignores expired rows and is enforced inside that same
  transaction. Counting expired rows would permanently
  lock a foreman out once enough codes went stale.

## Surface notes

The crew portal is retired in production, so the **paycard (`/checkin/:token`)
is the foreman's profile surface** — team roster, invite list and QR sheet live
there, below the pay flow so the money steps stay first on screen. The public
join page needs its prefix in both `PUBLIC_PREFIXES` (API) and the mobile app's
desktop-redirect exemption list, or it 401s / bounces to the desktop app.
