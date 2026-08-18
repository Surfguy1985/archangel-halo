---
name: HALO vendors module
description: Contract status, the single in-house vendor row, and how vendor averages signal "no data".
---

# Vendors module rules

## Vendors reach jobs only through purchase orders
There is no vendor↔job link in the schema. Any per-vendor work metric must be
derived from that vendor's POs and the jobs those POs point at.

**Why:** attribution was deliberately left with POs when the module was rebuilt;
adding a direct link was ruled out of scope.

**How to apply:** when a vendor has several POs against the same job, count the
job's duration once (dedupe by vendor+job) but keep every received PO as its own
order-cycle sample.

## Null means "no data", never zero
Vendor averages are `number | null` end to end, and both UIs render "No data
yet". A 0 or a dash reads like a measurement of zero days.

**Why:** most vendors have no received POs yet, so the empty state is the common
case, not the edge case.

**How to apply:** never coalesce these to 0 in serializers, CSV export, or sorts.
Unmeasured rows sort last rather than sorting as 0.

## Exactly one in-house vendor row
Our own organization is a vendor row with `vendor_type = 'in_house'`. It is
pinned first, cannot be deleted, cannot be set inactive, and is measured from our
crews' completed staffed jobs (falling back to client turn records).

**Why:** every in-house row would be pinned and would carry the same aggregate
average, so a second one is a duplicate of the company itself.

**How to apply:** the invariant is enforced by a partial unique index
(`vendor_type` where `vendor_type = 'in_house'`), so promoting a second vendor
raises 23505 — handle it as a 409, not a 500. The row is seeded by the boot-time
ensure, which also creates the index before inserting so concurrent boots collide
instead of duplicating.

## This bootstrap blocks startup
Unlike the other ensure-DDL bootstraps, the vendor one is awaited before
`app.listen`. Several code paths `select *` from vendors, so serving before the
columns exist means production 500s during the rollout window.
