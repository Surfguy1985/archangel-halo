---
name: HALO voice tools
description: How the AI voice-intake feature is wired and the two-place sync rule when adding a new voice tool.
---

# HALO voice tools (voice.ts)

The voice feature (`artifacts/api-server/src/routes/voice.ts`) turns a spoken/typed transcript into structured actions the user confirms before any DB write. Two endpoints: `/voice/parse` (LLM parses transcript → actions) and `/voice/confirm` (applies selected actions as real writes).

## Rule: a voice tool lives in TWO places — keep them in sync
Adding/changing a tool requires editing BOTH:
1. The `TOOLS` prompt string — the tool name + its field list that the LLM is told about.
2. The `if (a.tool === ...)` chain in `/voice/confirm` — the actual DB write for that tool.
A tool in the prompt but not the confirm chain silently falls through to "Unknown action". A tool in confirm but not the prompt is never produced.

**Why:** The LLM only emits tools it's told about (prompt), but nothing is written unless the confirm handler exists. They are separate strings, not generated from one source.

## Field names must match the drizzle schema, not the spoken wording
The LLM field names in the prompt must equal the actual column keys. E.g. properties use `pmcName`/`units` (NOT `managementCompany`/`unitsTotal`). Check `lib/db/src/schema/*.ts` before naming prompt fields.

## Relative dates
`/voice/parse` injects today's date into the prompt so the LLM resolves "tomorrow"/"next Monday" to `YYYY-MM-DD`. `schedule_job` confirm validates the date with a `^\d{4}-\d{2}-\d{2}$` regex and skips if invalid.

## LLM field types are loose — coerce defensively
The LLM may return booleans as strings (e.g. `"true"`). Coerce in the confirm handler rather than trusting the type.

## The prompt only refreshes after the workflow restarts
Editing the `TOOLS` string requires restarting `artifacts/api-server: API Server` — a stale server keeps emitting the old tool set (observed: it returned add_note "not supported by available tools" until restart).

## Confirm action shape (generic, no OpenAPI regen needed)
Voice actions are `{ tool, title, summary, confidence, needsReview?, fields }` where `fields` is an open record. Because it's generic, adding a tool needs NO openapi.yaml/client regen — only the two edits above.
