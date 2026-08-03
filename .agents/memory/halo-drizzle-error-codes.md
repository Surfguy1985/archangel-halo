---
name: Drizzle-wrapped Postgres error codes
description: How to reliably detect unique-violation (23505) and other pg error codes under drizzle-orm.
---

# Drizzle wraps Postgres errors

Drizzle (≥0.44, DrizzleQueryError) wraps the underlying `pg` error: the SQLSTATE lives on `error.cause.code`, not `error.code`. A catch like `(e as {code?:string}).code === "23505"` never matches, so intended 409 mappings fall through to 500.

**Why:** an integration test for the dispatch move-approve 23505 path returned 500 in production code — the guard existed but never fired.

**How to apply:** use a helper that checks `e.code ?? e.cause?.code` (see `isUniqueViolation` exported from the dispatch board routes; admin/payhub have local variants that also regex the message). Any new catch mapping pg error codes must check the `cause` too.
