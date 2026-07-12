import { useCallback, useEffect, useRef, useState } from "react";
import { useSpeech } from "./useSpeech";

// Rough spoken duration so we can still auto-advance when neither the audio
// clip nor SpeechSynthesis is available (e.g. locked-down environments).
function estimateMs(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.min(24000, Math.max(3600, (words / 2.6) * 1000));
}

// Pre-generated ElevenLabs narration (Jessica). Keyed by "<chapterId>-<stepIndex>".
const audioUrls: Record<string, string> = (() => {
  const files = import.meta.glob("../assets/tour-audio/*.mp3", {
    eager: true,
    query: "?url",
    import: "default",
  }) as Record<string, string>;
  const map: Record<string, string> = {};
  for (const [path, url] of Object.entries(files)) {
    const name = path.split("/").pop()?.replace(/\.mp3$/, "");
    if (name) map[name] = url;
  }
  return map;
})();

type PlayOpts = { onEnd?: () => void; onError?: () => void };

/**
 * Plays the natural pre-rendered narration for a tour step. Falls back to the
 * browser's SpeechSynthesis (useSpeech) if a clip is missing or blocked.
 */
export function useTourNarration() {
  const [audioSpeaking, setAudioSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Increments on every play/stop so stale audio callbacks (fired after an
  // interruption, pause, or close) are ignored instead of advancing the tour.
  const genRef = useRef(0);
  const speech = useSpeech();

  const audioCapable =
    typeof window !== "undefined" && typeof window.Audio !== "undefined";

  const getAudio = useCallback(() => {
    if (!audioRef.current) audioRef.current = new Audio();
    return audioRef.current;
  }, []);

  const stop = useCallback(() => {
    genRef.current += 1;
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    const a = audioRef.current;
    if (a) {
      try {
        a.pause();
      } catch {
        /* no-op */
      }
      a.onended = null;
      a.onerror = null;
    }
    speech.cancel();
    setAudioSpeaking(false);
  }, [speech]);

  // Guarantee narration halts if the component using this hook unmounts.
  useEffect(() => stop, [stop]);

  // Unlock audio/speech playback from within a user gesture.
  const prime = useCallback(() => {
    speech.prime();
    const a = getAudio();
    try {
      a.muted = true;
      const p = a.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
      a.pause();
      a.currentTime = 0;
      a.muted = false;
    } catch {
      /* no-op */
    }
  }, [speech, getAudio]);

  const play = useCallback(
    (key: string, text: string, opts?: PlayOpts) => {
      genRef.current += 1;
      const myGen = genRef.current;

      const fallback = () => {
        // No SpeechSynthesis either: keep the tour moving on an estimated timer
        // instead of advancing instantly (which would blast through all steps).
        if (!speech.supported) {
          fallbackTimerRef.current = setTimeout(() => {
            if (myGen === genRef.current) {
              setAudioSpeaking(false);
              opts?.onEnd?.();
            }
          }, estimateMs(text));
          return;
        }
        speech.speak(text, {
          onEnd: () => {
            if (myGen === genRef.current) {
              setAudioSpeaking(false);
              opts?.onEnd?.();
            }
          },
          onError: () => {
            if (myGen === genRef.current) {
              setAudioSpeaking(false);
              opts?.onError?.();
            }
          },
        });
      };

      const url = audioUrls[key];
      const a = getAudio();
      try {
        a.pause();
      } catch {
        /* no-op */
      }
      speech.cancel();

      if (!url) {
        fallback();
        return;
      }

      a.src = url;
      a.currentTime = 0;
      a.onended = () => {
        if (myGen !== genRef.current) return;
        setAudioSpeaking(false);
        opts?.onEnd?.();
      };
      a.onerror = () => {
        if (myGen !== genRef.current) return;
        fallback();
      };

      const pr = a.play();
      if (pr && typeof pr.then === "function") {
        pr.then(() => {
          if (myGen === genRef.current) setAudioSpeaking(true);
        }).catch(() => {
          if (myGen !== genRef.current) return;
          fallback();
        });
      } else {
        setAudioSpeaking(true);
      }
    },
    [speech, getAudio],
  );

  return {
    supported: audioCapable || speech.supported,
    speaking: audioSpeaking || speech.speaking,
    play,
    stop,
    prime,
  };
}
