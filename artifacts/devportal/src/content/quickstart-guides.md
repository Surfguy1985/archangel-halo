# Role Quick-Start Guides

One-page, print-ready quick-start guides for onboarding each role on HALO. Each guide is a US Letter PDF in the Falkon brand — hand them out on day one or keep a stack in the office.

## Downloads

- [Office Quick-Start Guide (PDF)](/devportal/downloads/halo-quickstart-office.pdf) — passcode sign-in, the Today feed, Quick Job, dispatch, invoices, check scanning, and the close-out checklist, plus the office daily rhythm.
- [Crew Quick-Start Guide (PDF, English + Spanish)](/devportal/downloads/halo-quickstart-crew.pdf) — saving the portal link, routes and directions, check-in/out with before/after photos, messaging the office, and portal invoicing. Every step is bilingual, mirroring the portal's Guide tab.
- [Client Board Quick-Start Guide (PDF)](/devportal/downloads/halo-quickstart-client.pdf) — reading the board, card details and messaging, paying from a card, requesting work, the Units map, and the History archive.

## Printing tips

- Each guide is exactly one page, US Letter, edge-to-edge color. Print at 100% scale ("Actual size"), borderless if your printer supports it.
- The guides pair with the in-app training: the desktop narrated tour, the mobile Training Center (Settings), the crew portal's bilingual Guide tab, and the client board's `?present=1` narrated walkthrough.

## Regenerating

The PDFs are generated from a script in the repo: `artifacts/devportal/scripts/quickstart-guides/generate.mjs`. Update the copy there and re-run it with Node to refresh all three PDFs in `public/downloads/`.
