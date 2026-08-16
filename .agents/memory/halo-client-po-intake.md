---
name: HALO client PO intake
description: Rules for attaching a client PO to a job from chat, and for the purple "PO received" alert.
---

The office can say "here's PO 1234 for unit 204 at <property>, send to vendor" and the
system attaches it to the unit's current live job, notifies the assigned crew, and raises a
flashing purple alert on that job in the office boards until someone acknowledges it.

**Why:** a PO on the wrong job silently corrupts billing — the client is invoiced against a
number that belongs to someone else's unit, and the job that actually needs the PO stays
blocked. Wrong is far worse than "ask me again".

**How to apply:**
- Resolution is property → normalized unit label → that unit's current LIVE job. If any
  step has more than one candidate, or none, return the candidates and write nothing.
  Never fall back to "closest match". Property matching must be token-boundary, not
  substring — a substring match will happily hit an unrelated property.
- Candidate sets must be scoped to the caller's identity/property scope, the same way
  office reads are, before any matching happens.
- The write is one guarded conditional UPDATE that re-asserts job id, property, normalized
  unit and still-live status. Zero rows affected means the job closed or moved underneath
  you — report that, never treat it as success.
- Re-submitting the SAME PO number for the same job must be a true no-op: no re-stamp, no
  clearing of the acknowledgement, no duplicate activity/notification, no second vendor
  send. Only a genuinely new PO number re-arms the alert.
- Acknowledgement must be receipt-matched (the PO number / received-at the client saw), or
  a stale tab dismisses a newer receipt.
- The chime is client-side WebAudio, once per newly seen unacknowledged PO, with seen ids
  in localStorage; browsers reject autoplay before interaction, so failure must be silent.
- A new capability is unreachable until it is mapped in the enforcer's action→capability
  map — unmapped actions are rejected with 403 before dispatch ever runs.
