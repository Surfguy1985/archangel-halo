---
name: Shipping schema changes without drizzle-kit push
description: push is broken repo-wide, so schema changes ship as boot-time idempotent DDL — and a column that gates reads must be applied before the server accepts traffic.
---

The db package's push script fails with a BigInt serialization error before it
even reaches your change. It is a pre-existing condition of the schema graph,
not something your edit caused, and it means no schema change here can be
delivered by push.

The established alternative is a boot-time "ensure schema" step of idempotent
DDL, registered in the server entrypoint alongside the existing ones.

**Why:** applying DDL by hand only touches the database you happen to be pointed
at. A deployed database keeps the old shape and the next release reads a column
that isn't there. A schema-code edit alone is not deliverable.

**How to apply:**
- Every schema change needs both the schema definition and an idempotent ensure
  step. Neither alone ships.
- Decide whether the ensure may run after the server starts listening. Most may.
  But the ORM names every column of a table in a plain select, so a new NOT NULL
  column on a heavily-read table breaks every query against that table until the
  DDL lands. Those must be applied before traffic is accepted, and should fail
  the boot rather than serve errors.
- Ordering matters when one ensure alters a table another creates; reuse the
  earlier promise rather than running it twice.
