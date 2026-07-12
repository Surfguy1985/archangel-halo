---
name: HALO desktop tour narration
description: How the desktop guided tour voices its steps (pre-rendered ElevenLabs clips + fallbacks) and the invariants to keep.
---

# Desktop guided tour narration

The desktop guided tour (GuidedTour.tsx) narrates each step with **pre-generated
ElevenLabs MP3s** (voice "Jessica"), not live browser speech. One clip per step,
stored at `artifacts/halo-desktop/src/assets/tour-audio/<chapterId>-<stepIndex>.mp3`.
`useTourNarration.ts` loads them via `import.meta.glob(..., {eager,query:'?url'})`,
keyed by `"<chapterId>-<stepIndex>"`, and plays them through one HTMLAudioElement.

**Rule: clip keys must match `desktopTour.ts` chapter ids + step order.** The
player builds the key as `${tourChapters[ci].id}-${si}`. If you add/reorder/remove
steps, regenerate the affected clips or the tour silently falls back.

**Fallback chain (intentional, keep all three):**
1. MP3 clip if present and autoplay allowed.
2. SpeechSynthesis (`useSpeech`) if clip missing OR audio play() promise rejects
   (autoplay blocked).
3. If SpeechSynthesis is also unsupported, an **estimated-reading timer** advances
   the step. **Why:** without this, `useSpeech.speak` calls `onEnd` immediately
   when unsupported, blasting through every step with no delay.

**Lifecycle invariant:** `useTourNarration` uses a generation nonce (`genRef`)
incremented on every `play()`/`stop()`; all `onended`/`onerror`/fallback-timer
callbacks are gated on `myGen === genRef.current` so stale callbacks (after close,
pause, step-change, unmount) can't advance the tour or double-fire. `stop()` must
be called at every transition (effect start/cleanup, close-reset, back button);
the hook also self-stops on unmount.

**Regenerating clips:** use `externalApi__elevenlabs`, model `eleven_multilingual_v2`,
voice id `cgSgspJ2msm6clMCkdW9` (Jessica), settings `{stability:0.4,
similarity_boost:0.75, style:0.35, use_speaker_boost:true}`, narration text
`` `${title}. ${body}` ``. The request `body` MUST be `JSON.stringify`'d.
