---
name: HALO billing integration package location
description: Where the supplied billing/pricing integration spec and instructions live in the repo
---

**Rule:** the user-supplied billing/pricing integration package lives at `/integration` in the repo root: `integration/halo-billing-service/INTEGRATION_INSTRUCTIONS.md` (954-line principal-engineer brief), `integration/halo-billing-service/PRODUCTION_READINESS_AUDIT.md` (post-integration adversarial audit checklist), `integration/halo-billing-service/README.md`, plus `integration/halo-openapi.yaml`, `integration/halo-user-tier-pricing.json`, and `integration/BILLING_INTEGRATION_ADDENDUM.md`.

**Why:** the user explicitly placed these "somewhere easy for the agent to find" ahead of a future billing-system integration task; the instructions file mandates an audit-first workflow before any code changes.

**How to apply:** when asked to integrate billing/pricing/entitlements, start by reading INTEGRATION_INSTRUCTIONS.md and the addendum; do the coverage-matrix audit before editing code. The same docs are also published on the devportal.
