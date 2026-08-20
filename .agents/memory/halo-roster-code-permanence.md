---
name: HALO crew roster code permanence
description: Why the shared crew QR code must never expire on its own, and what is allowed to kill it.
---

The shared crew roster code is printed, laminated and hung in a shop. A crew
standing in a stairwell cannot be issued a new one, so the code is treated as
permanent infrastructure, not as a rotating credential.

**Rule:** every code ever issued stays valid until a human revokes it. The
settings singleton holds the code the office hands out today; a separate
acceptance list decides what still opens the door. Nothing mints a replacement
implicitly — if the settings value goes missing, the newest un-revoked code is
adopted back instead of a fresh one being generated.

**Why:** a code that dies quietly reads to the crew as "HALO is broken", and
they have no way to recover in the field. The failure is invisible to the
office, who sees a working screen. Wipes, restores and rotations all used to
strand a printed QR silently.

**How to apply:**
- Never write a new roster code as a side effect of a read.
- Rotation defaults to additive (old code keeps working); revoking is a
  separate, explicit act and the only thing that can 404 a printed code.
- The acceptance table must stay out of the Settings-reset delete list.
- Client-side, only a 404 may say "this code isn't active". Offline, 5xx and
  rate-limit responses are transient and must offer a retry — otherwise a
  dropped packet sends a crew hunting for a QR that doesn't exist.
- Rate limits on the roster routes are sized for a whole crew behind one
  carrier NAT; a tripped limiter looks exactly like a dead link.
- The IP limiter in front of these routes keys off a caller-supplied
  forwarding header, so it cannot be the real ceiling. Abuse of the claim flow
  is capped server-side per crew (a bounded number of pending claims), and the
  office bell gets one ping per crew while anything is still waiting.

## Where an approved roster phone lands

Approval sends the phone to the crew's **paycard** (`/checkin/<token>`), not the general
portal: check in, before photos, after photos, check out is what they opened their phone
to do. The claim-status poll carries the path back once the claim is approved, and only
then — a pending or denied claim must never see it.

**Why:** the office approving someone is the only thing that vouches for that device, and
handing them the wider portal made them hunt for the work surface.

**How to apply:** one crew has exactly one live paycard link — printed card, texted link
and roster approval must all resolve to the same one. The plaintext token is unrecoverable
after hashing, so the issued URL is kept on the link row's label and reused. Minting is a
read-then-write called from a public 5s poll, so it runs under a per-crew advisory lock
inside a transaction; without it two concurrent approvals mint two live cards for one
person and the crew trusts whichever they scanned last.
