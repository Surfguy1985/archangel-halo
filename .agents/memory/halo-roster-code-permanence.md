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
