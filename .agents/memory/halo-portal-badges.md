---
name: HALO portal unseen badges
description: How crew-portal red notification badges work and what to update when adding new office→crew content types
---

# Portal unseen badges

Rule: red badges in the crew portal are driven by `crews.portal_seen` (jsonb map `{section: lastSeenISO}`) compared against `createdAt`/`sentAt` of office→crew rows. Sections: offers, schedule, messages, packets, documents.

**Why:** the office wanted the crew to see a red count for everything sent to them; missing key = never seen, so everything counts as unseen for new crews (intended).

**How to apply:** if a new office→crew content type is added, update ALL of:
1. `computeUnseen()` in the portal route (server count query),
2. `PortalUnseen` schema in openapi.yaml + `PortalSeenInput.section` enum (then codegen),
3. `SEEN_SECTIONS` map + tab `alert` wiring in CrewPortal.tsx.
The portal bundle's `unseen` field is REQUIRED in the schema — server must always include it. Mark-seen fires automatically when a tab opens (effect keyed on tab + unseen); no infinite loop because a successful mark drives the count to 0.

Crew invoices: `crew_invoices` + `crew_invoice_items`, amounts server-computed (round to cents), submit creates an urgent `crew_invoice` notification. BILL TO is hardcoded ArchAngel office info in the portal UI by design.
