---
name: Dev database diverges from code lineage
description: Why drizzle-kit push in this repo is dangerous and how to check before running it
---

# The dev DB and the code are not always the same lineage

Observed state: the schema code defined one generation of Falkon tables
(`falkon_connections/events/inbound_events/policies`) while the dev database held a
*different* generation (`falkon_identity/peers/api_keys/executions/phase_gates`).
Dozens of tables existed on each side that the other did not know about.

This is not "the DB is simply behind." Running `drizzle-kit push` in that state makes
drizzle ask an interactive create-vs-rename question, and it fails outright in a
non-TTY shell. **`push --force` would drop the tables the code no longer declares.**

Those orphan tables are not necessarily empty — the Base44 legacy id-mapping tables
carried hundreds of rows, alongside wings and Falkon gate data.

**Why:** task branches merge schema changes at different times than the shared dev
database gets migrated, so the two drift apart in both directions.

**How to apply:** before any `push`, diff declared tables against
`information_schema.tables`, then row-count anything that would be dropped. If tables
with rows would disappear, stop and ask rather than forcing. Symptom that you are in
this state: every passcode-gated office endpoint returns 500 from the auth middleware
because `business_settings` is missing columns the code selects.
