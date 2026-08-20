---
name: Working tree can reset to origin/main mid-session
description: Symptom and recovery when edits vanish while untracked new files survive.
---

The workspace has been reset to origin/main in the middle of a session
(`git reflog` shows "reset: moving to origin/main"). Tracked-file edits are lost;
newly created untracked files survive.

**Why it matters:** the failure does not look like a lost edit. It looks like a
feature that worked five minutes ago suddenly 404ing, or a component that no
longer renders — because the route registration, the spec entry and the page
wiring are gone while the new route/component files are still on disk.

**How to apply:** when something that was verified working starts failing with
"Cannot GET /api/..." or a missing UI element, run `git status` and `git reflog`
before debugging the code. Recovery: re-apply the edits to the tracked files.
Generated client output can be rebuilt from the spec, and if the spec itself was
lost, the surviving generated type files under lib/api-zod are an accurate record
of the schemas to rewrite. Commit early once a feature verifies.
