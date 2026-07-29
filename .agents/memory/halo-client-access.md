---
name: HALO client dashboard access control
description: Per-user feature permissions for the client (PM) dashboard — catalog, role defaults, token-gated admin panel.
---
- The client dashboard feature catalog + ROLE_DEFAULTS live server-side in the client-access route; `permissions` on client_users is NULL while the user follows role defaults, an array (even empty) once a manager customizes.
- **Why:** the upcoming client dashboard (task: client PWA) must gate every section by `effectivePermissions(user)`, not by role alone; empty array = deliberately no access.
- **How to apply:** any new client dashboard section needs a new feature key added to the catalog + role defaults; the manager-facing admin panel (root app, /client/:dashboardToken/admin) picks it up automatically.
- Seat caps: any role change on client users must go through a transaction with `.for("update")` on the property's user rows (same pattern in office admin routes and the token-gated access route) or concurrent changes oversubscribe seats.
- Token endpoints must serialize users through a redacted shape — never return the raw client_users row (passwordHash).

**Subscription billing (Admin page):** billing routes accept active AND paused accounts (cancelled = dead) so a paused admin can resume; ClientAdmin renders a billing-only view when /access 404s but /billing works. Payment info is stored sanitized only (last4/brand/exp/name/zip — full numbers and CVV never persisted or echoed). Plan changes are transactional with a FOR UPDATE seat guard (409 on downgrade below active usage) and reset seats to the plan's allowance. nextChargeOn is computed from local date parts, never toISOString.
