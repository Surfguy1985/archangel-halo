---
name: HALO crew profile selfies
description: Crew selfie onboarding step and avatar rendering rules
---

Crews are prompted for a profile selfie in the portal right after accepting the
first-visit agreement (modal is skippable, skip is per-session only so it
re-prompts next visit). The photo lives in object storage; `crews.selfie_path`
points at it.

**Why:** the office wants to recognize who's on site; a hard-required selfie
would block crews from reaching offers/schedule, so it's a nudge, not a gate.

**How to apply:** any UI showing a crew name with an icon/initial should render
the selfie when `selfiePath` is set (img `/api/storage${selfiePath}`, absolute
path) and fall back to the initial/icon otherwise. The portal selfie endpoint
must verify the uploaded object exists before persisting, consistent with the
no-auth token-portal posture.
