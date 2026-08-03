---
name: HALO work-request PO gate
description: PO number rules for client work requests and their exemptions.
---

- Client work requests require a PO number unless flagged emergency (explicit toggle or ≤24h neededBy auto-flag). Server enforces in POST /client/:token/requests; both client UIs (dashboard RequestWorkDialog, halo ClientRequest page) mirror it; the concierge request_work tool schema requires poNumber unless emergency.
- **Why:** clients must not post billable work without a PO; emergencies still go through — they land as urgent Action Required items the office manually accepts (and can attach a PO later).
- **How to apply:** any NEW path that inserts into work_requests must either enforce the PO gate or be an explicit, commented exemption. The flags-card "schedule" action in clientAccess.ts is intentionally exempt (office-flagged items, manual accept in Pipeline, card shows "No PO — approve manually").
