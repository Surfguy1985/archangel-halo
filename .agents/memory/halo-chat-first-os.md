---
name: HALO Chat-First OS
description: Architecture decisions for the stripped-down chat-first HALO OS. Panels, brain lens routing, component constraints.
---

## Panel Architecture
HaloCommand (mobile and desktop) now uses a `PanelType = "map" | "kanban" | "money"` state.
Three panels slide over the chat on demand — never navigate away from `/`.

**Summon logic (two paths):**
1. Local keyword detection in `handleSubmit` BEFORE going to AI — checked first for speed
2. Brain returns `type: "lens"` with a mapped `lensKind` — client maps it to a panel

**Brain lensKind → panel mapping:**
```
map / crew_map       → "map"    (LiveMapPanel)
timeline / turn_timeline → "kanban" (KanbanPanel)
money / budget_breakdown / invoice_detail → "money" (MoneyPanel)
```

**Why:** Brain system prompt now explicitly instructs returning these lensKinds for panel intents, so the mapping is stable.

## FalkonControlCenter Prop Interface
`FalkonControlCenter` has `{ onClose: () => void }` ONLY.
Do NOT pass `open` or `onOpenChange` — the component manages its own sheet internally.
Always use conditional rendering: `{controlOpen && <FalkonControlCenter onClose={...} />}`

**Why:** Past TS error TS2322 from passing wrong props; conditional render is the correct pattern.

## Layout.tsx
Layout is now stripped to a minimal dark header with `← Back` link and HALO logo.
- No bottom tab bar
- No secondary command bar / JARVIS input
- For detail routes only (/properties/:id, /jobs/:id, etc.)
- Main content area for those detail pages is still fully functional

**Why:** The 3 main panels are in-HaloCommand state, not separate routes.

## MakeReady Flow Brain Awareness
`commandBrain.ts` system prompt now includes:
- MakeReady Flow (Base44) as authoritative source for 14 entity types, syncs every 15 min
- Falkon Business Twin as authoritative for peer network data
- HALO native data explicitly named as a third category
Brain instructed to note "via MakeReady Flow" in sources for those entity types.

**How to apply:** When adding new data sources to the brain, add a section to `buildSystemPrompt()` in `commandBrain.ts` listing what's authoritative there.

## Panel Files
Mobile panels: `artifacts/halo/src/components/panels/{LiveMapPanel,KanbanPanel,MoneyPanel}.tsx`
Desktop panels: `artifacts/halo-desktop/src/components/panels/{LiveMapPanel,KanbanPanel,MoneyPanel}.tsx`
Mobile uses `Sheet side="bottom"` (full-height bottom sheet).
Desktop uses `Sheet side="right"` (slide-in from right).

## MinimalMenuSheet
Replaced MoreMenuSheet. Only 4 items: Presentation Mode, Falkon Network, Import, Settings.
File: `artifacts/halo/src/components/MinimalMenuSheet.tsx`

## Voice Path Gap
Voice capture (mic button → VoiceCaptureSheet) still routes through the old `parseVoice` path,
NOT through the panel intent detection. If a user speaks "open the map" via voice capture,
the transcript goes to parseVoice which does not detect panel intents.
The panel intent detection only runs on text submit in `handleSubmit`.
This is a known gap — fix: pipe voice transcripts through `handleSubmit` instead of parseVoice directly.
