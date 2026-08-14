---
name: HALO E2E mode-toggle suite
description: Durable guard-ordering and middleware lessons from running the Falkon boundary suite against the live server.
---

- A sub-router mounted with bare `router.use(subRouter)` must path-scope its own middleware (`router.use("/prefix", mw)`), or the middleware gates EVERY route registered after the mount. The falkon-test helper's token gate once 401'd the whole API.
- The Falkon mutation guard sits IN FRONT of per-route boundary gates: in ASSISTED it returns **202 REQUIRE_APPROVAL** before any route-level 403 gateBlocked can fire; identity-exempt paths (walk routes) count as s2s and get 200 SHADOW_ONLY in SHADOW. Tests must assert the layered contract, not just the route's.
- Test-only mutation helpers must be in the guard's SAFE_PATHS or ASSISTED mode 202-blocks the very endpoint used to leave ASSISTED (chicken-and-egg).
- A failed/aborted test run can leave falkon_connections in ASSISTED, which 202-blocks nearly every other integration test's fixture setup. If the whole suite suddenly 202s, restore the mode row (baseline: SHADOW).
- The E2E helper credential is derived from SESSION_SECRET (HMAC) — never commit a literal token to `.replit`/env files.

**Why:** the suite toggles live server state; guard ordering and restore paths matter as much as the assertions.
**How to apply:** when adding boundary/mode tests, new test helpers, or new mutation-guard rules.
