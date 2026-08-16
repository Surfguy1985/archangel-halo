---
name: HALO scoped light theme (Clients hub)
description: How a light-mode island survives inside the dark desktop app, and the portal trap that breaks it.
---

The desktop app ships both palettes as CSS custom properties: `:root` is the light set and
a `.dark` class overrides it app-wide. A subtree can therefore be forced light by
re-declaring the light token values on a wrapper class — no theme provider, no per-page
palette. The Clients hub (Portfolio / Properties / Pipeline / Accounts / client board) is
wrapped this way while the rest of the app stays dark.

**Why:** the client-facing surfaces are the ones the owner shows to property managers, so
they follow the light brand; ops surfaces stay dark. Duplicating a palette per page would
guarantee drift.

**How to apply:**
- Convert hardcoded hexes to tokens before wrapping, or the wrapper does nothing for them.
- `--secondary` is dark navy in the LIGHT palette — it is an accent, not a page surface.
  Using it as a background is the usual cause of a "still dark" page.
- Lime is unreadable as text on white. Use it as a fill behind dark text or as indicator
  dots; use deep navy for text, borders and active states.
- **Radix portals escape the wrapper.** Dialogs, sheets, popovers, dropdown and select
  content render at `document.body`, so they inherit the app-level dark tokens over a light
  page. Theme them at the content boundary (put the light class on the *Content element),
  or portal them into the themed subtree. Any new dialog opened from a light page needs
  this too.
- A shared component used by client-facing apps must take a theme prop defaulting to its
  current look — never flip it globally, or the client dashboard changes with it.
