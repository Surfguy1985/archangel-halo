---
name: Environment-gated router gates must be path-scoped
description: Why a retired-feature 410 gate silently killed most of the production API while dev looked healthy.
---

Feature-retirement gates (410/403 middleware for a sunset surface) must be registered with the
path prefix they guard — `router.use("/prefix", gate)` — never bare `router.use(gate)`.

**Why:** the API's sub-routers are all mounted unscoped (`router.use(someRouter)`), so a bare
`use` inside one of them runs for *every* request that reaches it and, when it answers instead of
calling `next()`, it also swallows every router mounted after it in the mount list. A crew-portal
retirement gate written this way took out the client board, settings, command, falkon and
reminders in production, plus a public route defined lower in its own file.

**Extra trap:** these gates are usually keyed on `NODE_ENV === "production"`, so dev and the
workflow logs look perfectly healthy and only the published app is broken. A wall of 410/403 in the
deployment log where the same paths return 200 in dev is the signature — read the mount order in
`routes/index.ts` and find which router's bare `use` sits above the first broken path.

**How to apply:** when adding or reviewing any blanket gate inside a route module, scope it, and
check that no route defined lower in the same file falls outside the retired surface. Verify by
running the built server locally with `NODE_ENV=production` on a spare port and curling one route
from each side of the gate — dev-mode testing cannot see this class of bug.
