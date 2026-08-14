---
name: HALO Field Jarvis (Earpiece / Presence / Watch)
description: Live field loop — AirPods earpiece, GPS presence briefing, morning autopilot watch. Not an in-browser Hugging Face dump.
---

- **Earpiece** is a one-tap session on HALO Command (headphones icon). It uses Apple-class browser APIs: `getUserMedia` + Web Audio keep-alive (AirPods routing), Screen Wake Lock, Media Session, `speechSynthesis` for short acks. STT is **Whisper** (`gpt-4o-mini-transcribe`) via `POST /api/field/transcribe` — same model as Walk hold-to-talk. Do **not** ship Transformers.js / Moonshine (~120MB) into the PWA.
- **Honest iOS limit:** the mic dies when the phone locks or HALO is backgrounded. Copy on the HUD says so. No Porcupine always-on wake word (needs a Picovoice key + still cannot beat iOS background kill). Wake words work *inside* an open session (`hey halo`, `go`, `next`, `skip`, `stop`).
- **Field Presence:** `GET /api/field/presence?lat=&lng=` (250m, same as arrivals). Speaks the site + open turns + uncrewed unit. Arrival sheet primary CTA is "Run this site with HALO" → `halo-field-go` into Command. ArrivalDetection is mounted on Command (`/`) because Command is outside Layout.
- **Morning Watch:** `GET /api/field/watch` from pending/executed `autopilot_actions` between local hours 5–11. Seeds Command once per local day. Earpiece prepends it on boot.
- Pure copy/intents live in `fieldOpsCore.ts` (tested). Falkon skips `/field/*` — transcribe is not a money mutation. Money still goes through Jarvis `review` capabilities.
- Duplicate `EarpieceMode.tsx` in halo + halo-desktop.
