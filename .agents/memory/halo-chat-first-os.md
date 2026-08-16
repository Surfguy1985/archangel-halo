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

## Cortex (do not skip)
`opsCortex.ts` pre-ranks live facts before Claude speaks. Command snapshot now includes client-board open turns (days from the metrics view — do not recompute), overdue/uncrewed/due-tomorrow job detail, and overdue invoices. `buildSystemPrompt()` leads with a Reasoning protocol + cortex brief. If the model is unreachable, `answerFromCortex` still answers. Pulse Ask uses the same cortex with `voice: "client"` (no HALO / Work App / Falkon jargon).

## Pulse Ask reasoner (do not skip)
`askReason.ts` is the ChatGPT-grade partner on Pulse. It scores intent, resolves sites/units (token overlap + memory for “that unit”), compares communities, and always attaches a why trail + citations (vacancy $ = Pulse window, days = turn clock, dollars stop at ready). Proof tiles stay locked to that focus. `POST .../portfolio/ask` may narrate JSON `{ answer, why, citations, followUps, partner }` but an invent-guard drops any unit not on the board. Do not embed HaloCommand. Do not invent photos or a second vacancy formula.

## Pulse Ask partner loop (do not skip)
Cortex still ranks. Superpowers wrap it — they do not replace it:
- **Learn:** `mem0ai` `MemoryClient` when `MEM0_API_KEY` is set; otherwise local jsonl at `CLIENT_BOARD_AGENT_DIR/episodes.jsonl` with `HaloEmbedder` (same add/search shape). Vectors from Hugging Face Transformers.js (`Xenova/all-MiniLM-L6-v2`) or hashed 3-grams when `AGENT_HF=0` / `VITEST`. Temporal graph is `graphology` (`graph.json`) — Graphiti-shaped ASKED / VACANT / WAITING edges. Set `MEM0_TELEMETRY=false`. Do not add `better-sqlite3` to api-server — it forks drizzle-orm types.
- **Predict:** `zodiac-ts` Holt on vacant **days** from `client_turn_metrics_mv` (already computed). History is closed-turn terminal `daysVacant` (frozen at ready), then community closed turns, then an open-turn cross-section as last resort. Never mint a second vacancy dollar.
- **Act:** Propose queues a durable HITL nudge (`acts.json`). Queue-only POSTs skip narration. Next Ask says “Still queued” until the wait is gone or dismissed. Do not auto-call autopilot, write invoices, or close a turn.
- **Fork:** Ask renders a morning decision packet — unit + vacant-day ring + sparkline + you-sign / you-wait + Base44 proof + lime HITL. Ghost typeahead names the next signature before anyone types. Linear-style Tab accepts the ghost.
- **Learn:** Intent prefs in `prefs.json` (photos / needs you / brief). Episodes + graph as before.

Set `AGENT_HF=0` in tests/CI so MiniLM does not download. Production tries Transformers.js **WASM first**, then CPU, then hash.

**How to apply:** When adding new data sources to the brain, add them to `buildSnapshot()` / `snapshotToFacts()`, then to `buildSystemPrompt()` evidence. Do not invent a second vacancy-days or cents formula — pass already-computed figures into the cortex.

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
