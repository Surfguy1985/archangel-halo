---
name: HALO invoice quick-create UX
description: Fast Apple-style invoice creation flow shared conventions (mobile sheet + desktop page).
---

Invoice creation is a one-tap flow: property image tiles → price-book pills (from the property detail's priceItems) add pre-priced line items or bump qty of an identical line → qty steppers → terms segmented pills.

**Rules:**
- The mobile `InvoiceEditor` sheet is ALSO the edit form (invoice prop) used from InvoiceDetail/PropertyDetail/Money/Today — any redesign must keep edit mode working (hydration, linked-job select, all detail fields incl. per-line dateOfWork).
- Terms pills auto-compute the due date from the invoice date until the user manually edits due date (`dueTouched` flag); an effect re-syncs due date when the invoice date changes and dueTouched is false.
- **Why:** losing detail fields or edit-mode behavior in a "simplify" pass was flagged in review; the detailed fields live in a collapsible "More details" section, not removed.
- **How to apply:** new invoice-entry surfaces should reuse the price-book quick-add + dueTouched patterns rather than reinventing.
