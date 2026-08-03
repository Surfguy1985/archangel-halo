import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Pause, Play, X, ChevronLeft, ChevronRight } from "lucide-react";

// Office Board Demo: the office-side half of the Board Demo walkthrough.
// Narrates the office client-board screen for the Presentation Mode demo
// property. Same narration chain as the client-side PresentationMode —
// pre-rendered ElevenLabs MP3 → SpeechSynthesis → reading timer, all guarded
// by a generation nonce so interrupted audio can never skip steps.

// Script + narration clips are shared with the mobile app via
// @workspace/board-demo; only the spotlight targets are app-specific
// (desktop spotlights the dense row list / filter chips testids).
import { OFFICE_DEMO_SCRIPT, officeDemoClipFor as clipFor } from "@workspace/board-demo/office";

type DemoStep = {
  title: string;
  body: string;
  /** data-testid to spotlight, or null to center. */
  target: string | null;
};

/** Per-step spotlight targets, zipped with the shared script by index. */
const TARGETS: (string | null)[] = [
  null,
  "board-row-list",
  "button-open-send-card",
  "board-row-list",
  "board-filter-chips",
  null,
  null,
];

const STEPS: DemoStep[] = OFFICE_DEMO_SCRIPT.map((s, i) => ({
  ...s,
  target: TARGETS[i] ?? null,
}));

export function OfficeBoardDemo({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [playing, setPlaying] = useState(true);
  const genRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [spot, setSpot] = useState<DOMRect | null>(null);

  const stop = useCallback(() => {
    genRef.current += 1;
    audioRef.current?.pause();
    audioRef.current = null;
    window.speechSynthesis?.cancel();
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const stepRef = useRef(step);
  stepRef.current = step;

  const advance = useCallback(
    (dir: 1 | -1) => {
      stop();
      const n = stepRef.current + dir;
      if (n >= STEPS.length) {
        onCloseRef.current();
        return;
      }
      setStep(Math.max(0, n));
      setPlaying(true);
    },
    [stop],
  );

  // Highlight geometry (same no-op-skip pattern as the client tour).
  useEffect(() => {
    const target = STEPS[step]?.target;
    const el = target ? document.querySelector(`[data-testid="${target}"]`) : null;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    const update = () =>
      setSpot((prev) => {
        const next = el ? el.getBoundingClientRect() : null;
        if (
          prev && next &&
          prev.top === next.top && prev.left === next.left &&
          prev.width === next.width && prev.height === next.height
        ) {
          return prev;
        }
        return next;
      });
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step]);

  // Narration: MP3 → SpeechSynthesis → timer, nonce-guarded.
  useEffect(() => {
    if (!playing) {
      stop();
      return;
    }
    genRef.current += 1;
    const gen = genRef.current;
    const s = STEPS[step];
    const finish = () => {
      if (genRef.current === gen) advance(1);
    };
    const startTimer = () => {
      const ms = Math.max(4500, (s.title.length + s.body.length) * 55);
      timerRef.current = setTimeout(finish, ms);
    };
    const speakFallback = () => {
      if (genRef.current !== gen) return;
      const synth = window.speechSynthesis;
      if (synth) {
        const u = new SpeechSynthesisUtterance(`${s.title}. ${s.body}`);
        u.rate = 0.98;
        u.onend = () => {
          if (genRef.current === gen) finish();
        };
        u.onerror = () => {
          if (genRef.current === gen) startTimer();
        };
        synth.cancel();
        synth.speak(u);
      } else {
        startTimer();
      }
    };
    const url = clipFor(step);
    if (url) {
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = finish;
      audio.onerror = speakFallback;
      audio.play().catch(speakFallback);
    } else {
      speakFallback();
    }
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, playing]);

  // Dialog semantics.
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        stop();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s = STEPS[step];

  return (
    <div className="fixed inset-0 z-[80]" data-testid="office-board-demo">
      <div
        className="absolute inset-0 transition-all duration-300"
        style={
          spot
            ? {
                boxShadow: "0 0 0 9999px rgba(4,10,26,0.62)",
                borderRadius: 16,
                left: spot.left - 8,
                top: spot.top - 8,
                width: spot.width + 16,
                height: spot.height + 16,
                position: "absolute",
                pointerEvents: "none",
                outline: "2px solid #B4FF44",
                outlineOffset: 2,
              }
            : { background: "rgba(4,10,26,0.62)", pointerEvents: "none" }
        }
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Board demo — ${s.title}`}
        tabIndex={-1}
        className="absolute left-1/2 -translate-x-1/2 bottom-6 w-[min(520px,calc(100vw-24px))] rounded-2xl bg-[#0B1428] text-white shadow-2xl border border-white/10 p-4 outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest uppercase text-[#B4FF44]">
            <Sparkles className="h-3.5 w-3.5" />
            Board demo · {step + 1} / {STEPS.length}
          </div>
          <button
            onClick={() => { stop(); onClose(); }}
            data-testid="button-office-demo-close"
            className="text-white/50 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-2 text-base font-bold">{s.title}</div>
        <div className="mt-1 text-sm text-white/70 leading-relaxed">{s.body}</div>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => setPlaying((p) => !p)}
            className="h-9 w-9 grid place-items-center rounded-full bg-[#B4FF44] text-black"
            data-testid="button-office-demo-play"
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button
            onClick={() => advance(-1)}
            disabled={step === 0}
            className="h-9 px-3 rounded-full border border-white/20 text-sm font-medium disabled:opacity-40 inline-flex items-center gap-1"
            data-testid="button-office-demo-back"
          >
            <ChevronLeft className="h-4 w-4" /> Back
          </button>
          <button
            onClick={() => advance(1)}
            className="h-9 px-3 rounded-full bg-[#B4FF44] text-black text-sm font-bold inline-flex items-center gap-1"
            data-testid="button-office-demo-next"
          >
            {step === STEPS.length - 1 ? "Finish" : "Next"} <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
