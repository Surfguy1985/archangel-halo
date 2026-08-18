---
name: HALO crew pin colours
description: The persistent rule that decides a crew member's map pin colour, why role (not company) is the Archangel discriminator, and why colour can't encode check-in status.
---

# A pin's colour identifies the person, never their status

Resolution order, applied server-side for the whole roster at once and shipped
on every crew read model (list, map pins, client-board map):

1. Archangel staff (`crews.role` in owner / employee / office / admin / staff) → gold.
2. Anyone with a `leaderId` → their foreman's colour, walking the chain to the
   ultimate leader. A member's own saved colour is deliberately ignored.
3. A foreman or independent → their saved `pin_color`, else a deterministic
   palette slot hashed from their id (stable across restarts, no storage).
4. Unknown → grey.

**Why:**
- `crews.company` looks like the Archangel/sub discriminator but is blank on
  every live row, so using it paints the entire roster gold. `role` is the only
  field that actually separates in-house staff from subs.
- Colour used to mean check-in status, which made a team unreadable the moment
  two crews shared a property — the whole point of the change was that a
  foreman's people read as one unit at a glance. Status moved to a small corner
  badge on the pin, so nothing was lost.
- Resolving per-crew on the client drifted between the six map surfaces; one
  server resolver over the whole roster is the only way the same person is the
  same colour everywhere.

**How to apply:**
- New surfaces that draw crews must consume the server-resolved colour field,
  never re-derive one.
- Any hex that reaches an inline style or `divIcon` HTML must be validated
  against a strict 6-digit hex pattern first — these strings go into the DOM raw.
- Changing who is "Archangel" is a data edit (`role`), not a code change.
- The leader walk needs a visited-set guard: there are no FKs, so a self- or
  mutual-reference is possible and would otherwise hang the request.
