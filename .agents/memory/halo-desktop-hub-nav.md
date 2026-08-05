---
name: HALO desktop hub navigation
description: 6-hub sidebar + HubShell tab bars replaced the 17-item nav; tour/testid invariants to preserve.
---

The office desktop app (halo-desktop) uses a 6-hub sidebar: Home `/`, Work `/jobboard` (+Dispatch/Calendar), Clients `/properties` (+Pipeline/Accounts=/admin), Money `/money` (+Payments), Crews, Purchasing `/catalog` (+Supply/Vendors). Import & Wings live in the bottom "More" menu. A global "+ New" dropdown in the top bar mounts QuickJobDialog and AddPropertyDialog at layout scope.

**Rules:**
- Hub tabs are `HubShell` (components/HubShell.tsx) wrapping existing pages in App.tsx routes. Route PATHS are unchanged on purpose — deep links, tour routes, and testids depend on them. New screens in a hub = add a tab entry + route wrap; never fork the page into an internal tab state.
- Guided tour targets: only nav ids nav-today, nav-jobboard, nav-properties, nav-money, nav-crews, nav-supply exist now (nav-supply = Purchasing). desktopTour.ts steps were retargeted; if nav changes again, re-run the retarget check or steps fall back to centered callouts.
- Job Board renders as 4 rails (Open=active, Reopened, Filled, Completed) with compact JobTile cards; full legacy JobBoardItem card + all its dialogs opens inside a Dialog. Client board (ClientBoardOffice/board-ui) intentionally untouched.

**Why:** user-requested Ramp/Apple consolidation (Aug 2026); preserving real routes was the trick that kept the tour, demo scripts, and deep links working with zero server changes.
