---
name: HALO no-auth posture
description: The HALO app is intentionally fully unauthenticated; open storage/portal routes are by design, not security bugs.
---

HALO is a single seeded-org internal tool with NO auth by explicit product requirement. Admin API routes and the crew portal are all unauthenticated.

- Crew portals are gated only by an unguessable 32-char random `portalToken` at `/portal/:token` (unlisted-link model). Every `/portal/:token/*` handler scopes data to the crew resolved from the token — keep it that way (no cross-crew access).
- Storage routes (`GET /storage/objects/*`, `POST /storage/uploads/request-url`) are open. The scaffold's ACL/`req.isAuthenticated()` checks are commented out because they depend on `replit-auth`, which this project does not use. Uploaded object paths are UUID-based, so access is obscurity-based like the rest of the app.

**Why:** A code review will flag the open storage routes as "insecure." That is consistent with the whole app's design, not a regression. Do NOT add auth to storage without an explicit user request — it would break the public portal (crews can't log in) and contradict the requirement.

**How to apply:** If the user later wants hardening without full auth, bind upload keys to the crew (`/uploads/{crewId}/{uuid}`) and gate `/storage/objects/*` downloads behind a valid portal token, rather than introducing login.
