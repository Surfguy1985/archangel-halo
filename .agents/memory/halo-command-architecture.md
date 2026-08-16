---
name: HALO Command Architecture
description: Thread-based conversational OS that replaces the Today dashboard at root ("/"); routing structure, component layout, and key design decisions.
---

## The change
- `/` now renders **HaloCommand** (conversational OS) in both mobile and desktop apps.
- Legacy **Today** page moved to `/today` in both apps.
- Mobile: HaloCommand sits outside the Layout wrapper (its own minimal chrome); Desktop: inside DesktopLayout (sidebar stays).

## Mobile routing (artifacts/halo/src/App.tsx)
- Outer Switch: `<Route path="/">` → `<OfficeGate><HaloCommand /></OfficeGate>` placed BEFORE the `<Route component={GatedAdminRouter} />` catch-all.
- AdminRouter inner Switch: `/` changed to `/today`.
- All other routes unchanged, still inside Layout.

## Desktop routing (artifacts/halo-desktop/src/App.tsx)
- Inner Switch (inside DesktopLayout): `<Route path="/">` → `HaloCommand`, `<Route path="/today">` → Today.
- HaloCommand lives inside DesktopLayout (sidebar nav stays for expert fallback access).

## Component files
All under `{app}/src/components/command/`:
- `DecisionPacket.tsx` — consequential action card for Now-tier feed items + autopilot suggestions.
- `ConfirmCard.tsx` — inline voice-parse confirmation card rendered in thread.
- `LensCard.tsx` — six lazy lenses (money/timeline/evidence/network/portfolio/map), each fetches real data.
- `WalkModeOverlay.tsx` — full-screen walk capture (setup → capture → review phases).

Both apps have identical copies of all four command components (desktop LensCard uses `/integrations` for Falkon Network instead of `/falkon-network`).

## New shared lib files
- `artifacts/halo-desktop/src/lib/falkonNetwork.ts` — copy of mobile falkonNetwork.ts (hand-written TanStack Query hooks for Falkon API).
- `artifacts/halo-desktop/src/components/HaloRing.tsx` — animated SVG ring, copied from mobile.

## Key fix: removed non-existent hooks
- `useListVendors` / `getListVendorsQueryKey` do NOT exist in `@workspace/api-client-react` — removed from LensCard.
- `useParseWalkVoice` does NOT exist in `@workspace/api-client-react` — removed from WalkModeOverlay (uses direct fetch to `/api/walk/voice/parse`).

## Brain / knowledge
Command chat (`commandBrain.ts`) pulls the live org snapshot (jobs, invoices, crews, check-ins, schedule, roster, queues) **plus** open client-board turns. `opsCortex.ts` ranks risk and predicts slip before Claude writes. Retrieval stays the security boundary (`commandSnapshotCore`). Do not dump a second vacancy formula into the prompt — use metrics-view days and Pulse window cents when those are already computed.

## Intent detection (client-side)
`detectIntent()` in HaloCommand: keyword scan → lens type (query), or `isFalkonFormationIntent()` → Falkon, else → action (parse/confirm flow). No new server routes.

## Falkon mode derivation
`healthy` → ASSISTED, `degraded`/`no_peers` → SHADOW, LIVE reserved.

**Why:** Thread-based state machine is initialized from `computeQueues()` (Today feed); all 20 voice tools reused via existing `/voice/parse` → `/voice/confirm` pipeline.
