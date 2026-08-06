---
name: HALO Walk voice capture & OpenAI proxy audio limits
description: Hold-to-talk walk capture pipeline + which audio endpoints the Replit OpenAI proxy supports
---
- The Replit OpenAI AI-integrations proxy does NOT support `/audio/speech` (TTS) and rejects model `whisper-1`; audio transcription works only via `gpt-4o-mini-transcribe` / `gpt-4o-transcribe` on `/audio/transcriptions`.
- **Why:** discovered while building walk voice capture — whisper-1 and TTS both returned proxy errors; wasted a test cycle.
- **How to apply:** any server audio feature should use `gpt-4o-mini-transcribe` via `@workspace/integrations-openai-ai-server` (`openai`, `toFile` re-exported); pre-rendered ElevenLabs MP3s in halo-desktop tour-audio are handy real-speech test fixtures.
- Walk voice endpoint `/walks/:id/voice-capture` returns DRAFTS only (never inserts captures); client queues drafts through the existing tagging drawer; captures may be photo-less (storagePath omitted, mic-icon fallback in lists).
