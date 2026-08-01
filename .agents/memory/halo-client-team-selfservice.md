---
name: HALO client self-service team management
description: Client-side board setup, invites, roles, and seat rules on the /client/:token/access surface.
---
- The whole `/client/:token/access` surface (roster read + every mutation) requires a signed-in ADMIN client session — the raw dashboard link alone gets 403. Exception: an unclaimed board (zero client_users) serves the empty roster and accepts `POST /access/setup` (rate-limited by the login limiter) so whoever holds the link can claim it by creating the first admin.
- **Why:** roster emails/roles leaked to any link holder, and token-only role edits defeated role delegation (architect review flagged both as critical).
- **How to apply:** any new team endpoint must call `requireAdmin` (resolveViewer + role==="admin"). The legacy root-app ClientAdmin panel intentionally degrades to its billing-only fallback when /access 403s — don't "fix" that by weakening the gate.
- Guards that must survive refactors: seat caps via FOR UPDATE tx on the property's user rows (invite, role change, reactivate — deactivation must NOT run the seat check), duplicate-email check inside the same tx, no self-delete/self-deactivate, never remove/demote/deactivate the last active admin.
- Auto-generated temp passwords are returned once in the invite response (`tempPassword`, null when the admin set a custom one) and optionally emailed via the office `emailCredentials` helper; custom passwords are never echoed.
- Client-dashboard Team page lives at `/:token/team` (setup mode / admins-only gate / management view); upgrade-for-more-seats CTA links to the root-app `/client/:token/admin` billing panel.
