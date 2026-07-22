---
name: HALO portal guide
description: Bilingual crew-portal Guide tab and ?guide= deep link conventions
---
The crew portal has a Guide tab with EN/ES copy in `portalGuideContent.ts` (mobile app). `?guide=en|es` on the portal URL opens the Guide tab preset to that language; the pending-offer auto-switch must skip the guide tab or deep links get hijacked.

**Why:** office texts crews the guide link in their language; if new auto-navigation is added to the portal it must respect the `?guide` deep link.

**How to apply:** new portal content types should follow the same pattern — content object keyed by language, URL param for deep linking, and admin send buttons on both CrewDetail pages (SMS on mobile, copy-link on desktop).
