---
name: HALO Clients hub dark-panel style
description: Properties/Pipeline/Accounts desktop pages use a user-chosen dark navy panel style; office admin can edit client billing (sanitized).
---
- The Clients hub pages (Properties, Pipeline, Admin/Accounts + AdminAccount) are deliberately dark navy "panel islands" on the paper background, per a user reference image: lime (--gold-light) reserved for primary actions/active pills, rounded status pills, stacked table rows with small property thumbnails (NOT big AI-image cards). Keep restyles consistent with this.
- **Why:** explicit user directive (Aug 2026 reference image); the rest of the desktop app stays light-themed.
- Office admin account upsert now carries billingDay/billingContact/paymentMethod — paymentMethod is sanitized display-only (methodType card|ach validated server-side, last4 only, never full numbers). Any office billing UI must keep collecting last-4 only.
