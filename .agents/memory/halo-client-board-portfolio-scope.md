---
name: HALO client board portfolio scope
description: Why property-level client board tokens need a portfolio, and the lazy provisioning rule that keeps their Pulse page from 404ing.
---

Every portfolio-scoped client surface (Pulse, attention, pipeline, cost-to-serve, audit)
resolves through `client_portfolios` + `client_portfolio_properties` + `properties.client_org_id`.
A property-level board token (`client_accounts.dashboard_token`) that points at a property with
no org and no portfolio row therefore fails link resolution and every one of those endpoints
answers `404 {"error":"Invalid link"}` — while `/client/:token/board` still returns 200, which
makes it look like "the board works but the landing page is broken."

**Rule:** property-token resolution must guarantee a portfolio scope, not assume one. It lazily
provisions a per-property org (slug `property-<first 8 of property id>`) + single-property
portfolio + membership row, inside a transaction serialized by `pg_advisory_xact_lock`, with a
post-lock re-check so concurrent first loads converge on one row set.

**Why:** only properties that came through a regional rollout or the CAF demo seed ever got a
portfolio. Any property a user creates in the office app and then shares with a client had none,
so the client's first screen was permanently empty ("Reconnecting…", "0 COMMUNITIES"). A dead SSE
stream on that page also retries forever, which is what a flood of identical failing portfolio
requests in the logs actually means.

**How to apply:** never add a new portfolio-scoped client endpoint that assumes membership exists;
go through the link resolver. If a client-facing read 404s "Invalid link" while the board itself
loads, check portfolio membership for that property before suspecting the token.
