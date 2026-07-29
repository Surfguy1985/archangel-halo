---
name: HALO shared board UI package
description: '@workspace/board-ui shared Apple-style board consumed by client-dashboard and halo-desktop office view'
---

The Apple-style client board (AppleBoard/AppleCard/templates/BoardCardModules) lives in `lib/board-ui` (@workspace/board-ui), purely presentational — apps pass board data, viewer, token, and callbacks.

Rules learned the hard way:
- **Tailwind v4 does not scan workspace libs.** Any app consuming board-ui must have `@source "../../../lib/board-ui/src";` in its index.css or every class silently no-ops (lanes stack vertically, styles vanish).
- **Composite lib:** board-ui is composite + emitDeclarationOnly → run `tsc --build` (or --build --force) in board-ui before consuming apps typecheck, or prop changes appear "missing".
- **token prop must be threaded** AppleBoard→AppleCard or ModuleDecision (pay/approve action buttons) never renders; actions only show for signed-in, non-readOnly viewers.
- Office view (halo-desktop ClientBoardOffice) renders the same board read-only from `GET /admin/accounts/:propertyId/board/full` (same projection/shape as the client GET — office endpoint is open by design per no-auth posture). DesktopLayout `<main>` needs `min-w-0` or wide boards stretch the page and push header buttons off-screen.
- Vendor board AI card composer: POST /client/:token/board/ai-card — AI only picks kind + ids from a property-scoped snapshot; server validates ids and builds modules deterministically via cardModules builders, inserts via raiseClientCard. Never let AI supply URLs/amounts.
- Office drags go through `POST /admin/accounts/:propertyId/board/actions` — same ACTIONS table as the client route with a synthetic office viewer, so lane guards stay enforced. Board projection: EVERY card family must pass through `applyOverride` or client/office drags silently snap back (pushed cards were the miss).
- pnpm catalog gotcha: `"dep": "catalog:"` with no entry in pnpm-workspace.yaml catalog breaks `pnpm install` for the whole repo (post-merge setup fails).
