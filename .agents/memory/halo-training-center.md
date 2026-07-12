---
name: HALO guided training / voice narration
description: The in-app "HALO Academy" voice-guided training center and how its speech engine avoids step-skipping races
---

# HALO guided training center

The mobile app (artifacts/halo) has an in-app voice-guided training tour ("HALO Academy") opened from the Settings tab, covering every feature as ordered chapters/steps.

## Voice = browser SpeechSynthesis (Web Speech API)
There is NO server TTS. Narration uses the browser's `speechSynthesis` — the output counterpart to the existing `webkitSpeechRecognition` used for voice input. Zero cost, no backend, offline-capable in the PWA, high-quality native voices on iOS. Degrades to silent read-only when unsupported.

**Why this choice:** the app already relies on Web Speech for input; adding paid/backO---end TTS was unjustified for a training feature.

## The one hazard to respect: interrupted-utterance races
A voice-narration + auto-advance engine MUST guard against stale utterance callbacks. `speechSynthesis.cancel()` (and starting a new utterance) still fires the previous utterance's `onend`/`onerror` in browsers. If those callbacks advance the tour, pausing/going back/closing causes phantom step jumps and background auto-advance.

**How to apply:** use a generation nonce — increment a ref on BOTH `speak()` and `cancel()`; capture `myGen` per utterance; every `onstart`/`onend`/`onerror` early-returns unless `myGen === genRef.current`. Treat interruption/cancel as NOT a real error (so no fallback-timer advance). Also wrap `synth.speak()` in try/catch → route sync throws to the fallback so the tour never stalls. For iOS, unlock speech by speaking a blank utterance inside the user-gesture handler (`prime()`), called before playback starts.
