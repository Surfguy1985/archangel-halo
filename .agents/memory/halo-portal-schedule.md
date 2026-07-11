---
name: HALO portal schedule feed
description: Crew portal schedule merges crew_schedules AND calendar_events; rules for extending it
---
The crew portal `GET /portal/:token` schedule feed is a MERGE of two sources: `crew_schedules` rows and `calendar_events` rows with `crew_id` = crew, both bounded to the current local week (Mon–Sun, built from LOCAL date parts).

**Rules:**
- Calendar events become items with `kind: "event"` and id `event-${id}`; deduped against schedule rows by `jobId|date` so a job isn't shown twice.
- Task lists come from `taskify()` (splits on newline/•/; caps at 8). Event items prefer `ev.notes`; only fall back to the linked job description when notes are empty.
- Property contact is chosen by `contactForProp` preferring on-site/maintenance role with a phone.
- Properties now have a street `address` column; portal items carry `propertyAddress/propertyCity/contactName/contactPhone/tasks` per PortalScheduleItem in openapi.

**Why:** crews need one feed showing their daily location assignment (address, phone, tasks) regardless of whether admins scheduled via jobs or the calendar.

**How to apply:** any new source of crew assignments (e.g. recurring events) must be merged into this same feed with dedup, not surfaced as a separate portal tab.
