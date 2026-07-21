---
name: HALO autopilot & JARVIS entry points
description: Rules for the autopilot background agent, Vapi phone webhook, and command-bar text entry into the voice pipeline.
---

- Autopilot (`lib/autopilot.ts`, 15-min scheduler + POST /autopilot/run) dedupes notifications by kind+entityId — the entityId used in `alreadyNotified()` MUST match the one passed to `raise()`, or alerts re-fire every run. New checks must follow this rule.
  **Why:** stale-offer check once used offer.id vs jobId and duplicated alerts.
- Vapi phone webhook (`/api/vapi/webhook`) optionally enforces `x-vapi-secret` header when the `VAPI_WEBHOOK_SECRET` env var is set; user must set the same secret in the Vapi assistant server settings. Without the secret it is open.
- JARVIS command bars (both apps' layouts) reuse the existing voice pipeline: they open VoiceCaptureDialog/Sheet with an `initialText` prop that auto-parses via /voice/parse. The parse effect must be cancel-guarded on close, or a late response repopulates stale review state.
