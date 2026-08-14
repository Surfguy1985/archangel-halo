---
name: HALO Jarvis Grok OS
description: Chat-first Grok/SpaceX HALO shell, Claude knowledge base, compound Jarvis missions, CRM fallback.
---

- `/` is HALO Command (Grok-style void + mission HUD). Property Pulse (the only dashboard) is `/pulse`. Traditional records/CRM lives at `/ops` (mobile) and `/properties` (desktop). The lime grid icon in the HUD opens Pulse — do not put a tab bar back on chat. Seed card 1 and "Open Property Pulse" route locally before panel intents.
- Compound operator language ("note AND text Kyann AND schedule tomorrow") must emit `actionPlans[]` from `commandBrain.ts`. The mobile thread renders a Mission card and executes steps in order via `POST /command/actions/execute`.
- Real Jarvis executors live in `jarvisDispatch.ts` + pure matching in `jarvisOpsCore.ts`. Matching is name/unit/date/material — never invent a crew or unit that is not in the snapshot. "Tomorrow" uses local date parts (`halo-local-date-handling`).
- Capabilities: `note.log` (activity), `reminder.set` (calendar), `supply.order` (catalog+vendor packet + work request + PO), `crew.schedule`, `comms.sms`, `pm.notify` (PM live link + email). Voice capture on Command must call `onHeard` → `handleSubmit`, not the old parseVoice-only path.
- Claude (`claude-sonnet-4-6` in `commandBrain.ts`) is already the brain. Expand `buildSnapshot()` roster (crews, contacts, vendors, inventory, catalog, units) when adding new knowledge the model must resolve by name.
