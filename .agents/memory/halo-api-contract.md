---
name: HALO API contract source of truth
description: How the halo frontend, api-server, and generated types stay in sync via OpenAPI
---

# HALO monorepo API contract

`lib/api-spec/openapi.yaml` is the SINGLE source of truth. From it, codegen produces:
- `lib/api-zod` — Zod request/response validators (`@workspace/api-zod`)
- `lib/api-client-react` — react-query hooks + URL builders (`@workspace/api-client-react`)

**Rule:** server route paths in `artifacts/api-server/src/routes/*.ts` MUST match the paths in
openapi.yaml exactly, or the generated client calls a URL the server never mounts (404).

**Why:** the generated client is derived from the spec, not from the server. A handler at
`/today/refresh-brief` is invisible to a client that generates `/brief/refresh`. Same class of bug
bit contact creation (`/contacts` in spec vs `/properties/:id/contacts` on server).

**How to apply:** when adding/renaming an endpoint, edit openapi.yaml first, re-run codegen, then
make the server route path + response shape match the generated Zod schema. Response handlers
`res.json(SomeResponse.parse(payload))` throw 500 if payload shape ≠ schema (e.g. writePropertyBrief
must return a full `Property`, not `{brief, briefUpdatedAt}`).

## Serialization
Dates must be serialized to ISO strings via `ser()`/`serList()` in `src/lib/serialize.ts` before
`.parse()` — Zod schemas expect strings, not Date objects. date-mode-string columns are already strings.

## Percent convention
Computed `marginPct` in money/property endpoints is returned as a PERCENT number (e.g. 47.5), not a
fraction — the frontend appends `%` directly. Job-level `marginPct` in the DB is stored as a fraction.
