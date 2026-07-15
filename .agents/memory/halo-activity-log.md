---
name: HALO activity log persistence
description: Activity log is permanent history that survives the Settings data wipe
---
The activities table is intentionally NOT deleted by POST /settings/reset ("Wipe all data & start clean"). A "system/reset" marker activity is inserted inside the same transaction.

**Why:** User explicitly wants activity history to persist across wipes; both Today pages surface an "Activity Log" section fed by GET /activities.

**How to apply:** Don't "fix" the reset endpoint to delete activities. Activity rows may reference deleted entities — render them as plain text, never as links. GET /activities supports server-side limit (default 100, max 200); always pass a small limit from UI since the log grows forever.
