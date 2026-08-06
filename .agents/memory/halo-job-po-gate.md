---
name: HALO job PO billing gate
description: Client PO required before a job can move Done→Billing; every completion path must enforce it.
---

- Jobs carry a client PO (`jobs.po_number`). A job may NOT move to the Billing rail without one — no PO, no billing, and `force` does not override it.
- **Why:** office requirement — clients won't pay invoices without a PO, so the gate lives at the rail transition, not at invoice time only.
- **How to apply:** any path that sets job `status: "complete"` (REST complete route, PATCH job, voice tools, future close-out shortcuts) must 409 with `missingCodes: ["po"]` when PO is blank. The PATCH bypass was caught once in review — check every new completion path. PO surfaces on the client-board job card and the Done-rail tile chip.
