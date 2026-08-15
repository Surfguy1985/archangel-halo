---
name: HALO data reset / start-fresh
description: The "wipe all data" endpoint — what it clears, what it must never clear, and the maintenance rule when adding tables
---

# Start-fresh / wipe-all-data

Rule: POST /settings/reset deletes every operational table inside one transaction to give a clean slate, but must PRESERVE `business_settings` (company info), `plaid_items` (real bank connection), and `activities` (permanent activity log — see halo-activity-log.md).

**Why:** the user wants demo/sample data gone without re-entering company branding or reconnecting their bank.

**How to apply:**
- Any NEW schema table added to `lib/db/src/schema/*` must be added to the delete list in the reset handler, or it will silently survive a "start fresh" and leak stale data. Preserve list stays just settings + plaid unless there's a new "real config" table.
- Client Board v1: wipe all `client_*` operational tables (turns, events, invoices, units, orgs). Preserve `client_stage_ownership` and `client_board_flags` (catalog/config). Append-only tables need `set_config('halo.allow_append_delete', 'on', true)` inside the reset transaction or DELETE is rejected.
- Client Board v1 append-only tables (`client_turn_stage_events`, `client_audit_log`, `client_turn_invoice_lines`) block DELETE unless the reset transaction sets `halo.allow_append_delete=on`. Catalog tables `client_stage_ownership` and `client_board_flags` are preserved (like tax-planner settings).
- Exposed as a danger-zone action in settings on both apps: desktop inside BusinessInfoDialog, mobile at the `/settings` page (linked from the More menu). Both use an AlertDialog confirm and invalidate ALL queries on success.
- It's a one-way destructive button, not a literal on/off toggle (the user asked for a "toggle" but a reset is irreversible).
